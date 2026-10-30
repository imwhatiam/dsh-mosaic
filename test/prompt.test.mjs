import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolvePrompt, MOSAIC_SECTION_TEXT } from '../lib/index.js'

test('an absent or empty config keeps the built-in prompt', () => {
  for (const config of [undefined, null, {}, { prompt: '' }, { prompt: '   ' }, { prompt: 42 }, { prompt: null }]) {
    assert.equal(resolvePrompt(config), MOSAIC_SECTION_TEXT)
  }
})

test('a row config.prompt overrides the built-in text and is trimmed', () => {
  assert.equal(resolvePrompt({ prompt: '\n  Only answer in tables. \n' }), 'Only answer in tables.')
})

test('an oversized prompt falls back instead of bloating every request', () => {
  assert.equal(resolvePrompt({ prompt: 'x'.repeat(128 * 1024 + 10) }), MOSAIC_SECTION_TEXT)
})

test('the built-in prompt stays optional-first and names the fence', () => {
  assert.match(MOSAIC_SECTION_TEXT, /Mosaic is optional/)
  assert.match(MOSAIC_SECTION_TEXT, /fenced `dsh-view`/)
  assert.doesNotMatch(MOSAIC_SECTION_TEXT, /AUTO-ON|must always|every substantive/)
})
