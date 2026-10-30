/**
 * The model prompt the plugin contributes, and the routes the settings page uses to
 * read and change it.
 *
 * Precedence: the user's saved override, then the row's `config.prompt`, then the text
 * built into this package. The override lives in the Host's own data directory as one
 * small JSON file, so it survives restarts without touching the profile's composition.
 *
 * The routes are plugin-owned, and `/api` does not cover them, so this module enforces
 * its own policy: a state-changing request must be same-origin, JSON, and confirmable
 * by the browser's `Sec-Fetch-Site` header.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PROMPT_ROUTE = '/dsh-mosaic/prompt'
export const PROMPT_LIMIT_BYTES = 128 * 1024

/** Where the override lives: the Host data directory this process already owns. */
export function promptStorePath(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'mosaic', 'prompt.json')
}

/**
 * Read the saved override, or `undefined` when there is none.
 *
 * @param {string} path - absolute file path.
 * @returns {Promise<string | undefined>} the saved prompt.
 */
export async function readStoredPrompt(path) {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const prompt = parsed && typeof parsed.prompt === 'string' ? parsed.prompt.trim() : ''
    return prompt === '' ? undefined : prompt
  } catch {
    return undefined
  }
}

/**
 * Persist one override, or clear it when `prompt` is `undefined`.
 *
 * @param {string} path - absolute file path.
 * @param {string | undefined} prompt - the text to store, or `undefined` to clear.
 * @returns {Promise<{ persisted: boolean, reason?: string }>} whether it reached disk.
 */
export async function writeStoredPrompt(path, prompt) {
  try {
    await mkdir(join(path, '..'), { recursive: true })
    const body = prompt === undefined
      ? { prompt: '', updatedAt: new Date().toISOString() }
      : { prompt, updatedAt: new Date().toISOString() }
    await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, 'utf8')
    return { persisted: true }
  } catch (error) {
    return { persisted: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Accept only a plausible prompt body; anything else is a client bug. */
export function parsePromptBody(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid_body' }
  if (body.reset === true) return { ok: true, reset: true }
  if (typeof body.prompt !== 'string') return { ok: false, error: 'prompt_required' }
  const prompt = body.prompt.trim()
  if (prompt === '') return { ok: false, error: 'prompt_required' }
  if (Buffer.byteLength(prompt, 'utf8') > PROMPT_LIMIT_BYTES) return { ok: false, error: 'prompt_too_large' }
  return { ok: true, prompt }
}

/**
 * Reject a state-changing request that a foreign page could have triggered.
 *
 * `Sec-Fetch-Site` is sent by the browser and cannot be forged by page script; a
 * foreign origin also fails the `Origin` comparison, and a JSON content type forces a
 * preflight that this route never approves.
 *
 * @param {import('node:http').IncomingMessage} req - the request under test.
 * @returns {string | undefined} a rejection reason, or `undefined` when allowed.
 */
export function requestPolicyError(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return 'cross_site'
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '') {
    let host
    try {
      host = new URL(origin).host
    } catch {
      return 'invalid_origin'
    }
    if (host !== req.headers.host) return 'cross_site'
  }
  const type = req.headers['content-type']
  if (typeof type !== 'string' || !type.toLowerCase().startsWith('application/json')) return 'json_required'
  return undefined
}

/** Read a small JSON request body. */
export async function readJsonBody(req, limit = PROMPT_LIMIT_BYTES + 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > limit) throw new Error('body_too_large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

function sendJson(res, status, body) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
  }
  res.statusCode = status
  res.end(JSON.stringify(body))
}

/**
 * Own the effective prompt: resolve its source, re-register the prompt section on every
 * change, and answer the two routes the settings page calls.
 *
 * @param {object} options - wiring.
 * @param {object} options.ctx - the plugin context (provides `systemPrompt`).
 * @param {unknown} options.config - the Loader row's config.
 * @param {(config: unknown) => string} options.resolveConfigPrompt - config precedence.
 * @param {string} options.builtin - the text shipped in this package.
 * @param {(ctx: object, text: string) => () => void} options.registerSection - registers
 *   the prompt section and returns its disposer.
 * @param {string} [options.path] - override file path; defaults to the Host data dir.
 */
export function createPromptController(options) {
  const { ctx, config, resolveConfigPrompt, builtin, registerSection } = options
  const path = options.path ?? promptStorePath()
  // The Host owns its route layout; publishing the asset URL here keeps an older
  // browser half working after a route change.
  const assets = options.assets ?? {}

  const state = {
    /** Saved by the user in this profile, or `undefined`. */
    user: undefined,
    /** From the row's `config.prompt`, or `undefined`. */
    configured: resolveConfigPrompt(config) === builtin ? undefined : resolveConfigPrompt(config),
    /** Whether the last write reached disk. */
    persisted: false,
    /** Why the last write failed, when it did. */
    persistenceError: undefined,
    path,
    dispose: undefined,
  }

  const effective = () => state.user ?? state.configured ?? builtin
  const source = () => (state.user !== undefined ? 'user' : state.configured !== undefined ? 'config' : 'builtin')

  function snapshot() {
    return {
      prompt: effective(),
      defaultPrompt: builtin,
      configuredPrompt: state.configured,
      customized: source() !== 'builtin',
      source: source(),
      persisted: state.persisted,
      ...state.persistenceError === undefined ? {} : { persistenceError: state.persistenceError },
      path: state.path,
      assets,
    }
  }

  function applySection() {
    if (typeof state.dispose === 'function') {
      try {
        state.dispose()
      } catch {}
    }
    state.dispose = registerSection(ctx, effective())
    return state.dispose
  }

  return {
    path,
    snapshot,
    /** Register the initial section (called once during activation). */
    start() {
      const dispose = applySection()
      return () => {
        try {
          dispose()
        } catch {}
      }
    },
    /** Pick up a saved override on activation. */
    async hydrate() {
      const stored = await readStoredPrompt(state.path)
      if (stored === undefined) return snapshot()
      state.user = stored
      state.persisted = true
      applySection()
      return snapshot()
    },
    /** Apply one accepted body and persist it. */
    async update(body) {
      const parsed = parsePromptBody(body)
      if (!parsed.ok) return { status: 400, body: { error: parsed.error } }
      if (parsed.reset) {
        state.user = undefined
        const write = await writeStoredPrompt(state.path, undefined)
        state.persisted = write.persisted
        state.persistenceError = write.reason
        applySection()
        return { status: 200, body: snapshot() }
      }
      state.user = parsed.prompt
      const write = await writeStoredPrompt(state.path, parsed.prompt)
      state.persisted = write.persisted
      state.persistenceError = write.reason
      applySection()
      return { status: 200, body: snapshot() }
    },
    /**
     * One HTTP handler for both methods.
     *
     * @param {import('node:http').IncomingMessage} req - request.
     * @param {import('node:http').ServerResponse} res - response.
     */
    async handle(req, res) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        sendJson(res, 200, snapshot())
        return
      }
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method_not_allowed' })
        return
      }
      const policy = requestPolicyError(req)
      if (policy !== undefined) {
        sendJson(res, 403, { error: policy })
        return
      }
      let body
      try {
        body = await readJsonBody(req)
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === 'body_too_large'
        sendJson(res, tooLarge ? 413 : 400, { error: tooLarge ? 'body_too_large' : 'invalid_json' })
        return
      }
      const result = await this.update(body)
      sendJson(res, result.status, result.body)
    },
  }
}
