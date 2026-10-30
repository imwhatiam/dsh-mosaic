import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderViewTool } from '../lib/render-tool.js'
import { createValidateViewTool } from '../lib/validate-tool.js'

const render = createRenderViewTool()
const validate = createValidateViewTool()

test('render_view returns a declared JSON value, not prose', async () => {
  const value = await render.execute({ spec: { items: [{ type: 'stat', label: 'Uptime', value: '99.9%' }] } })
  assert.equal(value.status, 'rendered')
  assert.equal(value.rendered, 1)
  assert.deepEqual(value.spec.items[0], { type: 'stat', label: 'Uptime', value: '99.9%' })
  assert.equal('errors' in value, false)
})

test('render_view renders the model protocol from that value', async () => {
  const value = await render.execute({ spec: { title: 'Ops', items: [{ type: 'text', content: 'hi' }] } })
  const text = render.output.render({}, value)[0].text
  assert.match(text, /^\[mosaic-render\]\nstatus=rendered\ntitle="Ops"\nrendered=1/)
  assert.match(text, /reply_language=conversation/)
})

test('the card projects from the canonical value, not a re-parsed argument', async () => {
  const value = await render.execute({ spec: { title: 'Ops', items: [{ type: 'text', content: 'hi' }] } })
  const meta = render.output.presentationMeta({ spec: { items: [{ type: 'not-a-component' }] } }, value)
  assert.equal(meta.title, 'Ops')
  assert.equal(meta.items[0].type, 'text')
})

test('presentationMeta stays lossless JSON and drops undefined keys', async () => {
  const value = await render.execute({ spec: { items: [{ type: 'widget', code: '<b>x</b>', height: 180 }] } })
  const meta = render.output.presentationMeta({}, value)
  assert.deepEqual(Object.keys(meta), ['items'])
  assert.equal(JSON.stringify(meta), JSON.stringify(JSON.parse(JSON.stringify(meta))))
  assert.equal(meta.items[0].height, 180)
})

test('an unusable spec is a structured invalid value with a fix path', async () => {
  const value = await render.execute({ spec: { items: [{ type: 'hologram' }] } })
  assert.equal(value.status, 'invalid')
  assert.ok(value.errors.length > 0)
  const text = render.output.render({}, value)[0].text
  assert.match(text, /status=invalid/)
  assert.match(text, /error=invalid_spec/)
  assert.match(text, /next=fix_and_retry/)
  assert.equal(render.output.presentationMeta({}, value), undefined, 'no card for a failed call')
})

test('a raw tool owns its argument validation', async () => {
  for (const args of [undefined, 'not json', { spec: 'not json' }, {}, { spec: {} }]) {
    await assert.rejects(() => render.execute(args), /invalid arguments/)
  }
})

test('tool schemas stay inside the enforced JSON Schema subset', () => {
  for (const node of [render.parameters, render.output.schema, validate.parameters, validate.output.schema]) {
    assert.equal(node.type, 'object')
    assert.equal(node.additionalProperties, false)
    assert.doesNotMatch(JSON.stringify(node), /"(minimum|maximum|pattern|format|nullable)":/)
  }
  assert.deepEqual(render.output.schema.required, ['status'])
  assert.deepEqual(validate.output.schema.required, ['status', 'next'])
})

test('validate_view reports a valid fence as data', async () => {
  const value = await validate.execute({ spec: '{"title":"t","items":[{"type":"callout","content":"ok"}]}' })
  assert.equal(value.status, 'valid')
  assert.equal(value.rendered, 1)
  assert.equal(value.next, 'emit_fence')
  assert.match(validate.output.render({}, value)[0].text, /\[mosaic-validation\][\s\S]*status=valid/)
})

test('validate_view localizes a broken fence with bracket facts', async () => {
  const value = await validate.execute({ spec: '{"items":[{"type":"text","content":"x"}' })
  assert.equal(value.status, 'invalid')
  assert.equal(value.error, 'invalid_json')
  assert.equal(value.next, 'fix_and_revalidate')
  assert.ok(Number.isInteger(value.braceDelta))
  assert.ok(Number.isInteger(value.bracketDelta))
  assert.deepEqual(value.likelyCauses, ['unbalanced_delimiters', 'trailing_comma', 'unescaped_quote'])
})

test('presenters are pure, provider-neutral and free of product copy', () => {
  assert.deepEqual(
    render.presentCall({ spec: { title: 'Ops', items: [] } }),
    { card: 'generic', title: 'Render view: Ops', kind: 'other' },
  )
  assert.deepEqual(render.presentCall({}), { card: 'generic', title: 'Render view', kind: 'other' })
  assert.equal(render.presentResult({}, { status: 'rendered', title: 'Ops' }).card, 'generic')
  assert.match(validate.presentResult({}, { status: 'valid' }).title, /^Validate dsh-view/)
  assert.doesNotMatch(render.presentCall({}).title, /[一-鿿]/)
  assert.doesNotMatch(validate.presentCall().title, /[一-鿿]/)
})
