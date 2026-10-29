import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderViewTool } from '../lib/render-tool.js'
import { createValidateViewTool } from '../lib/validate-tool.js'

test('render_view returns a rendered protocol and a spec in presentationMeta', async () => {
  const tool = createRenderViewTool()
  const args = { spec: { title: 'Ops', items: [{ type: 'stat', label: 'Uptime', value: '99.9%' }] } }
  const value = await tool.execute(args)
  assert.match(String(value), /^\[mosaic-render\]/)
  assert.match(String(value), /status=rendered/)
  const meta = tool.output.presentationMeta(args)
  assert.equal(meta.title, 'Ops')
  assert.equal(meta.items[0].type, 'stat')
})

test('render_view returns an invalid protocol for a bad spec', async () => {
  const tool = createRenderViewTool()
  const value = await tool.execute({ spec: { items: [{ type: 'hologram' }] } })
  assert.match(String(value), /status=invalid/)
  assert.match(String(value), /invalid_spec/)
})

test('validate_view accepts a valid fence body', async () => {
  const tool = createValidateViewTool()
  const value = await tool.execute({ spec: '{"items":[{"type":"callout","text":"ok"}]}' })
  assert.match(String(value), /status=valid/)
  assert.match(String(value), /rendered=1/)
})

test('validate_view reports bracket deltas for broken JSON', async () => {
  const tool = createValidateViewTool()
  const value = await tool.execute({ spec: '{"items":[{"type":"text","content":"x"}' })
  assert.match(String(value), /status=invalid/)
  assert.match(String(value), /error=invalid_json/)
  assert.match(String(value), /brace_delta=/)
})
test('render_view presentationMeta is lossless JSON and drops undefined keys', () => {
  const tool = createRenderViewTool()
  const meta = tool.output.presentationMeta({ spec: { items: [{ type: 'text', content: 'x' }] } })
  assert.deepEqual(Object.keys(meta), ['items'])
  assert.equal(JSON.stringify(meta), JSON.stringify(JSON.parse(JSON.stringify(meta))))
  const widget = tool.output.presentationMeta({ spec: { title: 'W', items: [{ type: 'widget', code: '<b>x</b>', height: 180 }] } })
  assert.equal(JSON.stringify(widget), JSON.stringify(JSON.parse(JSON.stringify(widget))))
  assert.equal(widget.items[0].height, 180)
})
