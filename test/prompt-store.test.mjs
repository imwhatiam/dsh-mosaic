import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import {
  createPromptController,
  parsePromptBody,
  crossSiteError,
  readPromptFile,
  requestPolicyError,
  writeStoredPrompt,
} from '../lib/prompt-store.js'

const BUILTIN = 'BUILT-IN PROMPT'
const workdirs = []

async function workdir() {
  const dir = await mkdtemp(join(tmpdir(), 'mosaic-prompt-'))
  workdirs.push(dir)
  return dir
}

after(async () => {
  for (const dir of workdirs) await rm(dir, { recursive: true, force: true })
})

function request(headers = {}, method = 'POST') {
  return { method, headers: { host: '127.0.0.1:55467', ...headers } }
}

function response() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(body) {
      this.body = body ?? ''
    },
  }
}

/** A controller wired to an in-memory section registry. */
function controller(options = {}) {
  const sections = []
  const instance = createPromptController({
    ctx: {},
    config: options.config,
    builtin: BUILTIN,
    resolveConfigPrompt: (config) => (
      config && typeof config === 'object' && typeof config.prompt === 'string' && config.prompt.trim() !== ''
        ? config.prompt.trim()
        : BUILTIN
    ),
    registerSection: (_ctx, text) => {
      sections.push(text)
      return () => {
        const index = sections.lastIndexOf(text)
        if (index >= 0) sections.splice(index, 1)
      }
    },
    path: options.path,
  })
  return { instance, sections }
}

test('a prompt body is accepted only when it is usable text', () => {
  assert.deepEqual(parsePromptBody({ prompt: '  hello  ' }), { ok: true, prompt: 'hello' })
  assert.deepEqual(parsePromptBody({ reset: true }), { ok: true, reset: true })
  assert.equal(parsePromptBody({ prompt: '' }).error, 'prompt_required')
  assert.equal(parsePromptBody({ prompt: '   ' }).error, 'prompt_required')
  assert.equal(parsePromptBody({ prompt: 'x'.repeat(128 * 1024 + 1) }).error, 'prompt_too_large')
  assert.equal(parsePromptBody(null).error, 'invalid_body')
  assert.equal(parsePromptBody(['x']).error, 'invalid_body')
  assert.equal(parsePromptBody({ prompt: 42 }).error, 'prompt_required')
})

test('a state-changing request must be same-origin JSON', () => {
  assert.equal(requestPolicyError(request({ 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' })), undefined)
  assert.equal(requestPolicyError(request({ 'content-type': 'application/json; charset=utf-8', origin: 'http://127.0.0.1:55467' })), undefined)
  assert.equal(
    requestPolicyError(request({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' })),
    'cross_site',
  )
  assert.equal(
    requestPolicyError(request({ 'content-type': 'application/json', origin: 'http://evil.example' })),
    'cross_site',
  )
  assert.equal(
    requestPolicyError(request({ 'content-type': 'text/plain' })),
    'json_required',
    'a simple cross-site form post cannot reach the handler',
  )
  assert.equal(requestPolicyError(request({})), 'json_required')
})

test('the override round-trips through disk and clears on reset', async () => {
  const dir = await workdir()
  const path = join(dir, 'mosaic', 'prompt.json')
  assert.equal((await readPromptFile(path)).prompt, undefined, 'no file yet')

  assert.equal((await writeStoredPrompt(path, 'my prompt')).persisted, true)
  assert.equal((await readPromptFile(path)).prompt, 'my prompt')
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.prompt, 'my prompt')
  assert.equal(typeof stored.updatedAt, 'string')

  assert.equal((await writeStoredPrompt(path, undefined)).persisted, true)
  assert.equal((await readPromptFile(path)).prompt, undefined, 'reset removes the override')
})

test('the effective prompt follows user > config > built-in', async () => {
  const dir = await workdir()
  const { instance, sections } = controller({ path: join(dir, 'prompt.json') })
  instance.start()
  assert.deepEqual(sections, [BUILTIN])
  assert.equal(instance.snapshot().source, 'builtin')

  const saved = await instance.update({ prompt: 'mine' })
  assert.equal(saved.status, 200)
  assert.equal(saved.body.prompt, 'mine')
  assert.equal(saved.body.customized, true)
  assert.equal(saved.body.persisted, true)
  assert.deepEqual(sections, ['mine'], 'the section is replaced, not duplicated')

  const reset = await instance.update({ reset: true })
  assert.equal(reset.body.prompt, BUILTIN)
  assert.equal(reset.body.customized, false)
  assert.deepEqual(sections, [BUILTIN])
})

test('a configured row prompt is the fallback, and reset returns to it', async () => {
  const dir = await workdir()
  const { instance } = controller({ path: join(dir, 'prompt.json'), config: { prompt: 'from config' } })
  instance.start()
  assert.equal(instance.snapshot().prompt, 'from config')
  assert.equal(instance.snapshot().source, 'config')

  await instance.update({ prompt: 'mine' })
  assert.equal(instance.snapshot().source, 'user')
  await instance.update({ reset: true })
  assert.equal(instance.snapshot().prompt, 'from config', 'reset stops the override, it does not forget the config')
})

test('a saved override is picked up on activation', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'from last time')
  const { instance, sections } = controller({ path })
  instance.start()
  await instance.hydrate()
  assert.deepEqual(sections, ['from last time'])
  assert.equal(instance.snapshot().persisted, true)
})

test('an unwritable store keeps the change in memory and says so', async () => {
  const { instance } = controller({ path: '/dev/null/not-a-directory/prompt.json' })
  instance.start()
  const result = await instance.update({ prompt: 'memory only' })
  assert.equal(result.status, 200)
  assert.equal(result.body.prompt, 'memory only')
  assert.equal(result.body.persisted, false)
  assert.ok(result.body.persistenceError, 'the response carries the reason')
})

test('GET returns the snapshot and POST enforces the policy', async () => {
  const dir = await workdir()
  const { instance } = controller({ path: join(dir, 'prompt.json') })
  instance.start()

  const get = response()
  await instance.handle(request({}, 'GET'), get)
  assert.equal(get.statusCode, 200)
  assert.equal(JSON.parse(get.body).prompt, BUILTIN)
  assert.equal(get.headers['cache-control'], 'no-store')

  const blocked = response()
  await instance.handle(request({ 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }), blocked)
  assert.equal(blocked.statusCode, 403)
  assert.equal(JSON.parse(blocked.body).error, 'cross_site')

  const wrong = response()
  await instance.handle(request({}, 'PUT'), wrong)
  assert.equal(wrong.statusCode, 405)

  const invalidJson = { method: 'POST', headers: { host: 'h', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from('{oops') } }
  const bad = response()
  await instance.handle(invalidJson, bad)
  assert.equal(bad.statusCode, 400)
  assert.equal(JSON.parse(bad.body).error, 'invalid_json')
})


test('disposing after an update revokes the newest section, not the first', async () => {
  const dir = await workdir()
  const { instance, sections } = controller({ path: join(dir, 'prompt.json') })
  const dispose = instance.start()
  await instance.update({ prompt: 'second generation' })
  assert.deepEqual(sections, ['second generation'])
  dispose()
  assert.deepEqual(sections, [], 'no section survives the plugin')
})

test('a late hydrate cannot register after the plugin is gone', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'from last time')
  const { instance, sections } = controller({ path })
  const dispose = instance.start()
  const pending = instance.hydrate()
  dispose()
  await pending
  assert.deepEqual(sections, [], 'hydrate resolved after disposal and stayed quiet')
})

test('a save wins over a hydrate that resolves later', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'stale')
  const { instance } = controller({ path })
  instance.start()
  const pending = instance.hydrate()
  await instance.update({ prompt: 'fresh' })
  await pending
  assert.equal(instance.snapshot().prompt, 'fresh', 'the saved text is not clobbered by the load')
})

test('an update after disposal is refused instead of registering again', async () => {
  const dir = await workdir()
  const { instance, sections } = controller({ path: join(dir, 'prompt.json') })
  const dispose = instance.start()
  dispose()
  const result = await instance.update({ prompt: 'too late' })
  assert.equal(result.status, 503)
  assert.equal(result.body.error, 'inactive')
  assert.deepEqual(sections, [])
})

test('reads are refused from a foreign origin and the snapshot carries no Host path', async () => {
  const dir = await workdir()
  const { instance } = controller({ path: join(dir, 'prompt.json') })
  instance.start()
  assert.equal(crossSiteError(request({ 'sec-fetch-site': 'cross-site' }, 'GET')), 'cross_site')
  assert.equal(crossSiteError(request({ origin: 'http://evil.example' }, 'GET')), 'cross_site')
  assert.equal(crossSiteError(request({}, 'GET')), undefined)
  const get = response()
  await instance.handle(request({ 'sec-fetch-site': 'cross-site' }, 'GET'), get)
  assert.equal(get.statusCode, 403)
  assert.equal('path' in instance.snapshot(), false, 'absolute file paths stay in the Host')
})

test('concurrent saves leave state and disk agreeing', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  const { instance } = controller({ path })
  instance.start()
  await Promise.all([instance.update({ prompt: 'first' }), instance.update({ prompt: 'second' })])
  assert.equal(instance.snapshot().prompt, instance.snapshot().prompt.trim())
  assert.equal((await readPromptFile(path)).prompt, 'second', 'writes are serialized in call order')
})


test('a corrupt override is reported instead of silently ignored, and the file is kept', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeFile(path, '{ this is not json', 'utf8')
  assert.deepEqual(await readPromptFile(path), { error: 'corrupt' })
  assert.equal((await readPromptFile(path)).prompt, undefined)
  assert.equal((await readFile(path, 'utf8')).includes('not json'), true, 'the user file survives')
  const { instance } = controller({ path })
  instance.start()
  await instance.hydrate()
  assert.equal(instance.snapshot().readError, 'corrupt')
  assert.equal(instance.snapshot().source, 'builtin', 'the plugin keeps working on the built-in text')
})

test('an unreadable override reports its own reason', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'secret')
  await chmod(path, 0o000)
  try {
    assert.deepEqual(await readPromptFile(path), { error: 'unreadable' })
  } finally {
    await chmod(path, 0o600)
  }
  assert.equal((await readPromptFile(path)).prompt, 'secret', 'permissions restored, content intact')
})

test('a successful write is atomic: no temp files linger and the old value is replaced', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'first')
  await writeStoredPrompt(path, 'second')
  const entries = await readdir(dir)
  assert.deepEqual(entries.filter((name) => name.endsWith('.tmp')), [], 'temp files are cleaned up')
  assert.equal((await readPromptFile(path)).prompt, 'second')
  assert.equal((await stat(path)).mode & 0o777, 0o600, 'the override is owner-only')
})

test('a failed publish leaves the previous file intact', async () => {
  const dir = await workdir()
  const path = join(dir, 'prompt.json')
  await writeStoredPrompt(path, 'keep me')
  // Renaming onto a non-empty directory fails; the file must stay untouched.
  const blocked = join(dir, 'blocked')
  await mkdir(blocked, { recursive: true })
  await writeFile(join(blocked, 'child'), 'x')
  const result = await writeStoredPrompt(blocked, 'nope')
  assert.equal(result.persisted, false)
  assert.ok(result.reason)
  assert.equal((await readPromptFile(path)).prompt, 'keep me')
})
