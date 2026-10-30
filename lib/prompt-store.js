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
import { randomBytes } from 'node:crypto'
import { mkdir, open as openFile, readFile, rename, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

export const PROMPT_ROUTE = '/dsh-mosaic/prompt'
export const PROMPT_LIMIT_BYTES = 128 * 1024

/** Where the override lives: the Host data directory this process already owns. */
export function promptStorePath(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'mosaic', 'prompt.json')
}

/**
 * Read the saved override and say why it was unusable, if it was.
 *
 * @param {string} path - absolute file path.
 * @returns {Promise<{ prompt?: string, error?: 'corrupt' | 'unreadable' }>} the saved
 *   prompt, or the reason there is none. A missing file is not an error.
 */
export async function readPromptFile(path) {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    return error && error.code === 'ENOENT' ? {} : { error: 'unreadable' }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'corrupt' }
  }
  const prompt = parsed !== null && typeof parsed === 'object' && typeof parsed.prompt === 'string'
    ? parsed.prompt.trim()
    : ''
  // An empty override is how a reset is stored, so it is not an error.
  return prompt === '' ? {} : { prompt }
}

/**
 * Persist one override, or clear it when `prompt` is `undefined`.
 *
 * @param {string} path - absolute file path.
 * @param {string | undefined} prompt - the text to store, or `undefined` to clear.
 * @returns {Promise<{ persisted: boolean, reason?: string }>} whether it reached disk.
 */
export async function writeStoredPrompt(path, prompt) {
  const body = `${JSON.stringify({
    prompt: prompt === undefined ? '' : prompt,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`
  const directory = dirname(path)
  const temp = join(directory, `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`)
  let handle
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // Same-directory exclusive temp file, fsync, then rename: a crash leaves either the
    // old file or the new one, never a half-written prompt.
    handle = await openFile(temp, 'wx', 0o600)
    await handle.writeFile(body, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, path)
    await syncDirectory(directory)
    return { persisted: true }
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch {}
    }
    try {
      await unlink(temp)
    } catch {}
    return { persisted: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Make a renamed entry crash-durable where the platform supports it. */
async function syncDirectory(directory) {
  if (process.platform === 'win32') return
  let handle
  try {
    handle = await openFile(directory, 'r')
    await handle.sync()
  } catch {
    // Directory fsync is best effort; the rename itself already succeeded.
  } finally {
    if (handle !== undefined) {
      try {
        await handle.close()
      } catch {}
    }
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
export function crossSiteError(req) {
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
  return undefined
}

/** Policy for a state-changing request: same-origin plus a JSON body. */
export function requestPolicyError(req) {
  const crossSite = crossSiteError(req)
  if (crossSite !== undefined) return crossSite
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
  // A logger is optional so the controller stays testable without one.
  const log = options.log ?? { info() {}, warn() {}, error() {} }
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
    /** Why the saved override could not be used, when it could not. */
    readError: undefined,
    path,
    /** Disposer of the currently registered section. */
    dispose: undefined,
    /** False after the owning plugin is disposed; no registration may happen then. */
    active: false,
  }

  // Prompt writes are serialized so the file always ends with the last accepted value.
  let writes = Promise.resolve()

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
      ...state.readError === undefined ? {} : { readError: state.readError },
      assets,
    }
  }

  function applySection() {
    if (!state.active) return
    if (typeof state.dispose === 'function') {
      try {
        state.dispose()
      } catch {}
    }
    state.dispose = registerSection(ctx, effective())
  }

  return {
    path,
    snapshot,
    /** Register the initial section; the returned disposer revokes whatever is live. */
    start() {
      state.active = true
      applySection()
      return () => {
        if (!state.active) return
        state.active = false
        const dispose = state.dispose
        state.dispose = undefined
        if (typeof dispose === 'function') {
          try {
            dispose()
          } catch {}
        }
      }
    },
    /** Pick up a saved override on activation. */
    async hydrate() {
      const stored = await readPromptFile(state.path)
      // A `start()` may have been revoked, or a save may have landed first.
      if (!state.active || state.user !== undefined) return snapshot()
      if (stored.error !== undefined) {
        // Keep the file: the user may want to recover it, and a later save overwrites it.
        state.readError = stored.error
        log.warn('prompt.read-failed', { reason: stored.error })
        return snapshot()
      }
      if (stored.prompt === undefined) {
        log.info('prompt.hydrate', { source: source(), stored: false })
        return snapshot()
      }
      state.user = stored.prompt
      state.persisted = true
      applySection()
      log.info('prompt.hydrate', { source: source(), stored: true, chars: stored.prompt.length })
      return snapshot()
    },
    /** Apply one accepted body and persist it. */
    async update(body) {
      if (!state.active) {
        log.warn('prompt.update-rejected', { reason: 'inactive' })
        return { status: 503, body: { error: 'inactive' } }
      }
      const parsed = parsePromptBody(body)
      if (!parsed.ok) {
        log.warn('prompt.update-rejected', { reason: parsed.error })
        return { status: 400, body: { error: parsed.error } }
      }
      const next = parsed.reset ? undefined : parsed.prompt
      state.user = next
      const write = await (writes = writes.then(() => writeStoredPrompt(state.path, next)))
      if (!state.active) return { status: 503, body: { error: 'inactive' } }
      state.persisted = write.persisted
      state.persistenceError = write.reason
      state.readError = undefined
      applySection()
      if (write.persisted) {
        log.info('prompt.update', { reset: next === undefined, source: source(), chars: next === undefined ? 0 : next.length })
      } else {
        log.warn('prompt.persist-failed', { reason: write.reason })
      }
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
        const readPolicy = crossSiteError(req)
        if (readPolicy !== undefined) {
          sendJson(res, 403, { error: readPolicy })
          return
        }
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
