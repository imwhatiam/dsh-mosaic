import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeView, isRenderable } from '../lib/validate.js'

test('accepts a minimal text view', () => {
  const result = normalizeView({ items: [{ type: 'text', content: 'hello' }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items.length, 1)
  assert.equal(result.spec.items[0].type, 'text')
  assert.equal(isRenderable(result), true)
})

test('normalizes callout aliases', () => {
  const result = normalizeView({ items: [{ type: 'callout', text: 'careful', kind: 'danger' }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].content, 'careful')
  assert.equal(result.spec.items[0].tone, 'error')
})

test('derives table columns from a 2D body', () => {
  const result = normalizeView({ items: [{ type: 'table', rows: [['name', 'score'], ['Ada', 9]] }] })
  assert.equal(result.errors.length, 0)
  assert.deepEqual(result.spec.items[0].columns, ['name', 'score'])
  assert.deepEqual(result.spec.items[0].rows, [['Ada', 9]])
})

test('drops unknown component types with an error', () => {
  const result = normalizeView({ items: [{ type: 'hologram', content: 'x' }] })
  assert.equal(result.spec, null)
  assert.ok(result.errors.some((error) => error.includes('hologram')))
  assert.equal(isRenderable(result), false)
})

test('enforces the node budget', () => {
  const items = Array.from({ length: 81 }, (_, index) => ({ type: 'text', content: String(index) }))
  const result = normalizeView({ items })
  assert.equal(result.spec, null)
  assert.ok(result.errors.some((error) => error.includes('max nodes')))
})

test('rejects unsafe media and link URLs', () => {
  const result = normalizeView({ items: [
    { type: 'image', src: 'javascript:alert(1)' },
    { type: 'link', label: 'bad', href: 'javascript:alert(1)' },
  ] })
  assert.equal(result.spec, null)
  assert.ok(result.errors.some((error) => error.includes('src')))
  assert.ok(result.errors.some((error) => error.includes('href')))
})

test('wraps a single component root', () => {
  const result = normalizeView({ type: 'stat', label: 'Revenue', value: '$12k' })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].type, 'stat')
})

test('keeps a button without an action as a disabled control', () => {
  const result = normalizeView({ items: [{ type: 'button', label: 'Later' }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].type, 'button')
  assert.equal(result.spec.items[0].action, undefined)
})

test('rejects an invalid chart kind', () => {
  const result = normalizeView({ items: [{ type: 'chart', kind: 'radar', data: [{ label: 'A', value: 1 }] }] })
  assert.equal(result.spec, null)
  assert.ok(result.errors.some((error) => error.includes('kind')))
})

test('keeps widget code and clamps its height', () => {
  const result = normalizeView({ items: [{ type: 'widget', code: '<b>hi</b>', height: 5000 }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].code, '<b>hi</b>')
  assert.equal(result.spec.items[0].height, 900)
})
test('accepts a flowchart diagram with nodes and edges', () => {
  const result = normalizeView({ items: [{
    type: 'diagram',
    kind: 'flowchart',
    direction: 'TB',
    nodes: [
      { id: 'start', label: 'Start', tone: 'accent' },
      { id: 'check', label: 'Valid?', shape: 'diamond' },
      { id: 'done', label: 'Done', tone: 'success' },
    ],
    edges: [
      { from: 'start', to: 'check' },
      { from: 'check', to: 'done', label: 'yes', kind: 'accent' },
    ],
  }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].type, 'diagram')
  assert.equal(result.spec.items[0].nodes.length, 3)
  assert.equal(result.spec.items[0].edges[1].label, 'yes')
})

test('rejects a flowchart edge with an unknown endpoint', () => {
  const result = normalizeView({ items: [{
    type: 'diagram', kind: 'flowchart',
    nodes: [{ id: 'a', label: 'A' }],
    edges: [{ from: 'a', to: 'ghost' }],
  }] })
  assert.equal(result.spec, null)
  assert.ok(result.errors.some((error) => error.includes('ghost')))
})

test('accepts a sequence diagram', () => {
  const result = normalizeView({ items: [{
    type: 'diagram', kind: 'sequence',
    participants: [{ id: 'u', label: 'User' }, { id: 's', label: 'Server' }],
    messages: [
      { from: 'u', to: 's', label: 'request' },
      { from: 's', to: 'u', label: 'response', kind: 'return' },
    ],
  }] })
  assert.equal(result.errors.length, 0)
  assert.equal(result.spec.items[0].messages.length, 2)
})

test('accepts timeline and layers diagrams', () => {
  const timeline = normalizeView({ items: [{ type: 'diagram', kind: 'timeline', items: [{ title: 'v0.1', time: '今天' }] }] })
  assert.equal(timeline.errors.length, 0)
  const layers = normalizeView({ items: [{ type: 'diagram', kind: 'layers', layers: [{ title: 'UI', items: ['React', 'CSS'] }] }] })
  assert.equal(layers.errors.length, 0)
})


test('a widget keeps only the programmatic action opt-in', () => {
  const base = { type: 'widget', code: '<b>x</b>' }
  assert.equal(normalizeView({ items: [base] }).spec.items[0].actions, undefined)
  assert.equal(normalizeView({ items: [{ ...base, actions: 'programmatic' }] }).spec.items[0].actions, 'programmatic')
  assert.equal(normalizeView({ items: [{ ...base, actions: 'auto' }] }).spec.items[0].actions, undefined, 'only the documented value survives')
})
