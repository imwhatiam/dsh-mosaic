import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWidgetDocument, widgetBridgeSource } from '../lib/widget.js'

const theme = { bg: '#ffffff', text: '#111111', border: '#dddddd', accent: '#3b82f6' }

test('wraps a fragment in a full sandbox document', () => {
  const html = buildWidgetDocument('<p>hello</p>', { nonce: 'n-1', theme })
  assert.match(html, /^<!doctype html>/i)
  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /sandbox/)
  assert.match(html, /<p>hello<\/p>/)
  assert.match(html, /n-1/)
})

test('injects into an existing full document', () => {
  const html = buildWidgetDocument('<!doctype html><html><head><title>x</title></head><body><b>ok</b></body></html>', { nonce: 'n-2', theme })
  assert.equal((html.match(/<html/gi) ?? []).length, 1)
  assert.match(html, /<title>x<\/title>/)
  assert.match(html, /n-2/)
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('</head>'))
})

test('uses the bridge to report height and accept actions', () => {
  const bridge = widgetBridgeSource('n-3')
  assert.match(bridge, /mosaic:height/)
  assert.match(bridge, /mosaic:action/)
  assert.match(bridge, /mosaic:ready/)
  assert.match(bridge, /n-3/)
})

test('rejects oversized widget code', () => {
  assert.throws(() => buildWidgetDocument('x'.repeat(20001), { nonce: 'n', theme }), /20000/)
})