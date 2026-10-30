import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, MOSAIC_SECTION_TEXT } from '../lib/index.js'

// The prompt override lives under DSH_HOME; keep every test off the real one.
const storeHome = mkdtempSync(join(tmpdir(), 'mosaic-host-'))
process.env.DSH_HOME = storeHome
test.after(() => rmSync(storeHome, { recursive: true, force: true }))

/**
 * A minimal Cordis-shaped context: enough of `systemPrompt`, `tools`, `skills` and
 * `webServer` to drive this plugin's real `apply(ctx, config)` path, and to prove every
 * registration hands back its disposer.
 */
function createContext() {
  const state = {
    sections: [],
    routes: [],
    tools: [],
    providers: [],
    effects: [],
    disposed: false,
  }

  const scope = {
    // Mirrors Cordis: a callback may return a disposer, or be a generator whose
    // yielded values are the disposables to unwind.
    effect(callback, label) {
      const disposables = []
      const result = callback()
      if (result && typeof result.next === 'function') {
        for (const yielded of result) disposables.push(yielded)
      } else if (typeof result === 'function') {
        disposables.push(result)
      }
      const cleanup = () => {
        for (const disposable of disposables.splice(0)) disposable?.()
      }
      state.effects.push({ label, cleanup })
      return cleanup
    },
    systemPrompt: {
      section(section) {
        state.sections.push(section)
        return () => {
          const index = state.sections.indexOf(section)
          if (index >= 0) state.sections.splice(index, 1)
        }
      },
      getSectionOrder(name) {
        throw new Error(`repository-owned order name resolved by an external plugin: ${name}`)
      },
    },
    tools: {
      register(definition) {
        state.tools.push(definition)
        return () => {
          state.tools = state.tools.filter((entry) => entry !== definition)
        }
      },
    },
    skills: {
      registerProvider(create) {
        state.providers.push(create({ signal: new AbortController().signal, invalidate() {} }))
        return () => {
          state.providers.pop()
        }
      },
    },
    webServer: {
      register(route) {
        state.routes.push(route)
        return () => {
          state.routes = state.routes.filter((entry) => entry !== route)
        }
      },
    },
  }

  const ctx = {
    ...scope,
    inject(names, callback) {
      for (const name of names) assert.ok(name in ctx, `injected service is not composed: ${name}`)
      callback(ctx)
      return () => {}
    },
    get(name) {
      return ctx[name]
    },
  }

  ctx.dispose = () => {
    state.disposed = true
    for (const effect of state.effects.splice(0)) effect.cleanup()
  }
  ctx.state = state
  return ctx
}

test('activating with no config contributes the built-in prompt at an external order', () => {
  const ctx = createContext()
  apply(ctx, undefined)
  assert.equal(ctx.state.sections.length, 1)
  const [section] = ctx.state.sections
  assert.equal(section.name, 'mosaic:view')
  assert.equal(section.order, 9800, 'a finite order the plugin owns, not a reserved name')
  assert.equal(section.text, MOSAIC_SECTION_TEXT)
  assert.equal(section.interpolate, false)
})

test('a row config.prompt replaces the contributed text', () => {
  const ctx = createContext()
  apply(ctx, { prompt: '  Only answer with tables when asked.  ' })
  assert.equal(ctx.state.sections[0].text, 'Only answer with tables when asked.')
})

test('activation registers both tools and the bundled skill provider', () => {
  const ctx = createContext()
  apply(ctx, {})
  assert.deepEqual(ctx.state.tools.map((entry) => entry.name).sort(), ['render_view', 'validate_view'])
  assert.equal(ctx.state.providers.length, 1)
  assert.equal(ctx.state.providers[0].name, 'dsh-mosaic')
})

test('activation serves plugin assets and one guarded prompt route', () => {
  const ctx = createContext()
  apply(ctx, {})
  assert.equal(ctx.state.routes.length, 2)
  const asset = ctx.state.routes.find((entry) => entry.path.startsWith('/dsh-mosaic/assets'))
  assert.ok(asset && asset.kind === 'prefix', 'the module system owns /plugins')
  const prompt = ctx.state.routes.find((entry) => entry.path === '/dsh-mosaic/prompt')
  assert.ok(prompt, 'the settings page reads and writes the prompt here')
  assert.equal(prompt.kind, 'exact')
  assert.equal(typeof prompt.handler, 'function')
})

test('disposing the plugin removes the prompt section, tools, provider and route', () => {
  const ctx = createContext()
  apply(ctx, {})
  ctx.dispose()
  assert.deepEqual(ctx.state.sections, [])
  assert.deepEqual(ctx.state.tools, [])
  assert.deepEqual(ctx.state.providers, [])
  assert.deepEqual(ctx.state.routes, [])
})

test('the bundled skill still resolves after activation', async () => {
  const ctx = createContext()
  apply(ctx, {})
  const [provider] = ctx.state.providers
  const discovery = await provider.list({})
  assert.equal(discovery.complete, true)
  assert.equal(discovery.candidates.length, 1)
  const [candidate] = discovery.candidates
  assert.equal(candidate.name, 'mosaic')
  assert.equal(candidate.provider, 'dsh-mosaic')
  assert.equal(candidate.source, 'bundled')
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: true })
  assert.equal(typeof candidate.locator, 'string')
  const definition = await provider.get(candidate)
  assert.equal(definition.name, 'mosaic')
  assert.match(definition.content, /dsh-view/)
  assert.doesNotMatch(definition.content, /AUTO-ON|every substantive answer/)
})
