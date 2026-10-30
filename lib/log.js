/**
 * The plugin's own diagnostic log.
 *
 * One JSON object per line, one file per day, under `<DSH_HOME>/logs/dsh-mosaic/`.
 * A plugin that misbehaves should be diagnosable from this file alone, so every
 * lifecycle step, route decision and tool execution is recorded; user text never is.
 *
 * Design rules, in order of importance:
 *  1. Never throw. Logging must not be able to break the plugin.
 *  2. Never record secrets or user content: strings are truncated, prompt-like fields
 *     are replaced by their length.
 *  3. Bounded: a size cap rotates the current day's file, and old days are deleted.
 *  4. Cheap: writes are queued on one promise chain, so callers never await disk IO.
 */
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const LOG_RETENTION_DAYS = 7
export const LOG_MAX_BYTES_PER_FILE = 2 * 1024 * 1024
export const LOG_MAX_STRING = 300
export const LOG_LEVELS = ['debug', 'info', 'warn', 'error']

/** Field names whose value may be user content or a secret; only their size is kept. */
const REDACTED_FIELD = /^(prompt|text|code|content|secret|token|password|apiKey)$/i

/**
 * Resolve the log directory for this Host.
 *
 * @param {Record<string, string | undefined>} [env] - process environment.
 * @returns {string} absolute directory path.
 */
export function logDirectory(env = process.env) {
  const home = typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'logs', 'dsh-mosaic')
}

/** `YYYY-MM-DD` in local time, so a day boundary matches the operator's clock. */
export function dayStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Make a value safe for a log line: bounded depth, bounded strings, no user content.
 *
 * @param {unknown} value - any structured value.
 * @param {number} [depth] - remaining nesting budget.
 * @returns {unknown} a JSON-safe projection.
 */
export function sanitizeForLog(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return value.length > LOG_MAX_STRING ? `${value.slice(0, LOG_MAX_STRING)}…(${value.length})` : value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Error) return describeError(value)
  if (depth >= 4) return '[depth]'
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((item) => sanitizeForLog(item, depth + 1))
    return value.length > 20 ? [...items, `…(${value.length})`] : items
  }
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (REDACTED_FIELD.test(key) && typeof child === 'string') {
      out[`${key}Chars`] = child.length
      continue
    }
    const safe = sanitizeForLog(child, depth + 1)
    if (safe !== undefined) out[key] = safe
  }
  return out
}

/**
 * Describe an error without leaking payloads.
 *
 * @param {unknown} error - thrown value.
 * @returns {{ name: string, message: string, code?: string, stack?: string }} fields.
 */
export function describeError(error) {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error).slice(0, LOG_MAX_STRING) }
  const code = typeof error.code === 'string' ? error.code : undefined
  return {
    name: error.name,
    message: error.message.slice(0, LOG_MAX_STRING),
    ...code === undefined ? {} : { code },
    ...typeof error.stack === 'string' ? { stack: error.stack.split('\n').slice(0, 6).join('\n') } : {},
  }
}

/**
 * Create the plugin log.
 *
 * @param {object} [options] - wiring.
 * @param {object} [options.ctx] - plugin context; `ctx.logger` mirrors warnings upward.
 * @param {string} [options.dir] - override directory (tests).
 * @param {() => Date} [options.now] - clock (tests).
 * @param {string} [options.level] - minimum level to record, from `config.logLevel`.
 * @param {number} [options.retentionDays] - files older than this are deleted.
 * @param {number} [options.maxBytes] - rotate the daily file past this size.
 */
export function createLog(options = {}) {
  const {
    ctx,
    dir = logDirectory(),
    now = () => new Date(),
    level = 'info',
    retentionDays = LOG_RETENTION_DAYS,
    maxBytes = LOG_MAX_BYTES_PER_FILE,
  } = options
  const threshold = LOG_LEVELS.includes(level) ? LOG_LEVELS.indexOf(level) : LOG_LEVELS.indexOf('info')
  const state = { disabled: false, warned: false, queue: Promise.resolve(), swept: false, file: undefined }

  const currentFile = () => join(dir, `${dayStamp(now())}.jsonl`)

  async function sweep() {
    if (state.swept) return
    state.swept = true
    const cutoff = now().getTime() - retentionDays * 24 * 60 * 60 * 1000
    try {
      for (const name of await readdir(dir)) {
        if (!name.endsWith('.jsonl')) continue
        const path = join(dir, name)
        const info = await stat(path).catch(() => undefined)
        if (info !== undefined && info.mtimeMs < cutoff) await unlink(path).catch(() => {})
      }
    } catch {
      // A missing or unreadable directory is not an error: the first write creates it.
    }
  }

  async function rotateIfNeeded(path) {
    const info = await stat(path).catch(() => undefined)
    if (info === undefined || info.size < maxBytes) return
    await rename(path, join(dir, `${basename(path, '.jsonl')}.1.jsonl`)).catch(() => {})
  }

  function mirror(entry) {
    if (entry.level !== 'warn' && entry.level !== 'error') return
    const logger = ctx?.logger
    const method = entry.level === 'error' ? 'error' : 'warn'
    try {
      logger?.[method]?.(`mosaic: ${entry.event}`)
    } catch {
      // Logging upward must never fail the plugin either.
    }
  }

  function write(levelName, event, fields, error) {
    const index = LOG_LEVELS.indexOf(levelName)
    if (index < threshold) return
    const entry = {
      ts: now().toISOString(),
      level: levelName,
      event: String(event).slice(0, 80),
      ...sanitizeForLog(fields) ?? {},
      ...error === undefined ? {} : { error: describeError(error) },
    }
    mirror(entry)
    if (state.disabled) return
    const line = `${JSON.stringify(entry)}\n`
    state.queue = state.queue
      .then(async () => {
        await mkdir(dir, { recursive: true, mode: 0o700 })
        const file = currentFile()
        state.file = file
        await sweep()
        await rotateIfNeeded(file)
        await appendFile(file, line, { mode: 0o600 })
      })
      .catch(() => {
        // One warning upward, then stay quiet so a broken disk cannot flood anything.
        if (state.disabled) return
        state.disabled = true
        if (!state.warned) {
          state.warned = true
          try {
            ctx?.logger?.warn?.('mosaic: diagnostic log is unwritable; continuing without it')
          } catch {}
        }
      })
  }

  return {
    dir,
    level: LOG_LEVELS[threshold] ?? 'info',
    /** Path of the file currently being written, once known. */
    get file() {
      return state.file ?? currentFile()
    },
    /** Whether the directory accepted writes so far. */
    get writable() {
      return !state.disabled
    },
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, error, fields) => write('error', event, fields, error),
    /** Wait for queued lines; used by tests and by the dispose path. */
    async flush() {
      try {
        await state.queue
      } catch {}
    },
    /** Stable short fingerprint, for correlating two log lines without logging content. */
    fingerprint(text) {
      return createHash('sha256').update(String(text)).digest('hex').slice(0, 12)
    },
  }
}
