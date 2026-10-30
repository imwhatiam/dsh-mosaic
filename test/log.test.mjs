import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { createLog, dayStamp, logDirectory, sanitizeForLog } from '../lib/log.js'

const dirs = []
async function workdir() {
  const dir = await mkdtemp(join(tmpdir(), 'mosaic-log-'))
  dirs.push(dir)
  return dir
}
after(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
})

const readAll = async (dir) => {
  const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')).sort()
  const lines = []
  for (const name of files) {
    for (const line of (await readFile(join(dir, name), 'utf8')).split('\n')) {
      if (line.trim() !== '') lines.push(JSON.parse(line))
    }
  }
  return lines
}

test('one JSON object per line, with the documented fields', async () => {
  const dir = await workdir()
  const log = createLog({ dir, level: 'debug' })
  log.info('plugin.activate', { version: '0.0.0', logFile: '/tmp/x' })
  log.debug('detail', { ms: 12 })
  await log.flush()
  const lines = await readAll(dir)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].event, 'plugin.activate')
  assert.equal(lines[0].level, 'info')
  assert.equal(lines[0].version, '0.0.0')
  assert.match(lines[0].ts, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(lines[1].ms, 12)
})

test('the configured level filters quieter events', async () => {
  const dir = await workdir()
  const log = createLog({ dir, level: 'warn' })
  log.info('noisy', {})
  log.warn('kept', {})
  await log.flush()
  assert.deepEqual((await readAll(dir)).map((line) => line.event), ['kept'])
})

test('user content never reaches the file', async () => {
  const dir = await workdir()
  const log = createLog({ dir })
  log.warn('probe', { source: 'client', prompt: 'SECRET', text: 'x'.repeat(1000), note: 'ok' })
  await log.flush()
  const raw = await readFile(join(dir, (await readdir(dir))[0]), 'utf8')
  assert.doesNotMatch(raw, /SECRET/)
  assert.match(raw, /"promptChars":6/)
  assert.match(raw, /"textChars":1000/)
  const long = sanitizeForLog('y'.repeat(400))
  assert.match(long, /…\(400\)$/)
})

test('an error keeps name, message, code and a bounded stack', async () => {
  const dir = await workdir()
  const log = createLog({ dir })
  const error = Object.assign(new Error('boom '.repeat(100)), { code: 'E_TEST' })
  log.error('tool.failed', error, { tool: 'render_view' })
  await log.flush()
  const [line] = await readAll(dir)
  assert.equal(line.level, 'error')
  assert.equal(line.tool, 'render_view')
  assert.equal(line.error.name, 'Error')
  assert.equal(line.error.code, 'E_TEST')
  assert.ok(line.error.message.length <= 302)
  assert.ok(line.error.stack.split('\n').length <= 6)
})

test('the daily file rotates once it passes the size cap', async () => {
  const dir = await workdir()
  const log = createLog({ dir, maxBytes: 200 })
  for (let index = 0; index < 6; index += 1) log.info('event', { index, padding: 'x'.repeat(60) })
  await log.flush()
  const names = (await readdir(dir)).sort()
  assert.ok(names.includes(`${dayStamp()}.1.jsonl`), `expected a rotated file, got ${names.join(',')}`)
})

test('files older than the retention window are removed on first write', async () => {
  const dir = await workdir()
  const stale = join(dir, '2000-01-01.jsonl')
  await writeFile(stale, '{}\n', 'utf8')
  await utimes(stale, new Date('2000-01-02'), new Date('2000-01-02'))
  const log = createLog({ dir, retentionDays: 7 })
  log.info('event', {})
  await log.flush()
  const names = await readdir(dir)
  assert.equal(names.includes('2000-01-01.jsonl'), false)
})

test('an unwritable directory disables the file and warns once, without throwing', async () => {
  const dir = await workdir()
  const blocker = join(dir, 'not-a-dir')
  await writeFile(blocker, 'x', 'utf8')
  const warnings = []
  const ctx = { logger: { warn: (message) => warnings.push(message) } }
  const log = createLog({ ctx, dir: join(blocker, 'nested') })
  log.info('event', {})
  log.info('event', {})
  await log.flush()
  assert.equal(log.writable, false)
  assert.equal(warnings.length, 1, 'one warning, not a flood')
})

test('warnings and errors are mirrored to ctx.logger', async () => {
  const dir = await workdir()
  const seen = []
  const ctx = { logger: { warn: (m) => seen.push(['warn', m]), error: (m) => seen.push(['error', m]) } }
  const log = createLog({ ctx, dir })
  log.info('quiet', {})
  log.warn('noted', {})
  log.error('broke', new Error('x'))
  await log.flush()
  assert.deepEqual(seen.map(([level]) => level), ['warn', 'error'])
})

test('the directory follows DSH_HOME and fingerprints are stable', () => {
  assert.equal(logDirectory({ DSH_HOME: '/srv/dsh' }), join('/srv/dsh', 'logs', 'dsh-mosaic'))
  const log = createLog({ dir: '/tmp/ignored' })
  assert.match(log.fingerprint('abc'), /^[0-9a-f]{12}$/)
  assert.equal(log.fingerprint('abc'), log.fingerprint('abc'))
  assert.notEqual(log.fingerprint('abc'), log.fingerprint('abd'))
})
