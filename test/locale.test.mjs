import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** Keys of one locale block inside `const dictionaries = { … }`. */
function localeKeys(locale) {
  const block = source.match(new RegExp(`\\n {6}${locale}: \\{([\\s\\S]*?)\\n {6}\\},`))
  assert.ok(block, `${locale} dictionary parsed`)
  return [...block[1].matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*): /gm)].map((match) => match[1])
}

/** Keys the components ask the locale service for. */
function usedKeys() {
  const translate = [...source.matchAll(/translate\('([A-Za-z][A-Za-z0-9]*)'/g)].map((match) => match[1])
  const injected = [...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/g)].map((match) => match[1])
  return [...new Set([...translate, ...injected])].sort()
}

const zhKeys = localeKeys('zh')
const enKeys = localeKeys('en')
const used = usedKeys()

test('the plugin registers both shipped locales with the same keys', () => {
  assert.ok(zhKeys.length > 20, 'the zh dictionary parsed')
  assert.deepEqual(enKeys, zhKeys)
})

test('every string a component asks for is declared, and no key is dead copy', () => {
  assert.deepEqual(used.filter((key) => !zhKeys.includes(key)), [], 'no missing keys')
  assert.deepEqual(zhKeys.filter((key) => !used.includes(key)), [], 'no unused keys')
})

test('copy registers through the Client locale service as one namespace', () => {
  assert.match(source, /const NS = 'mosaic'/)
  assert.match(source, /ctx\.locale\.register\(NS, dictionaries\)/)
  assert.match(source, /ctx\.locale\.bind\(NS\)/)
  assert.match(source, /locale: NS,/, 'slot registrations receive t')
})

test('visible UI copy is not hardcoded outside the dictionaries', () => {
  const dictionaries = source.match(/\n {4}const dictionaries = \{[\s\S]*?\n {4}\}\n/)?.[0] ?? ''
  assert.ok(dictionaries.length > 500, 'dictionary block located')
  const outside = source.replace(dictionaries, '')
  const offenders = outside
    .split('\n')
    .filter((line) => /[一-鿿]/.test(line) && !/^\s*(\/\/|\*)/.test(line))
  // 万/亿 are parsed from model-authored numbers, never rendered as copy.
  assert.deepEqual(offenders.filter((line) => !/万|亿/.test(line)), [])
})

test('the client owns no theme state, no invented route, and no extra root per block', () => {
  assert.doesNotMatch(source, /__GenuiAssets__|data-mosaic-theme|MOSAIC_THEMES|ThemePicker|clearLegacyThemeStorage/)
  assert.doesNotMatch(source, /matchMedia/, 'no OS colour-scheme sniffing')
  // The ONLY host attribute the client reads: the documented dark-theme signal, used
  // to forward resolved tokens into a sandboxed widget that cannot inherit them.
  assert.match(source, /attributeFilter: \['data-ds-dark-theme', 'class', 'style'\]/)
  const attributeUses = source
    .split('\n')
    .filter((line) => line.includes('data-ds-dark-theme') && !line.trimStart().startsWith('//'))
  assert.equal(attributeUses.length, 1, 'the theme signal is observed in exactly one place')
  assert.doesNotMatch(source, /\/plugins\/dsh-mosaic|PROMPT_ENDPOINT/)
  assert.equal((source.match(/createRoot\(/g) ?? []).length, 1, 'one fence root per mounted block')
  assert.match(source, /ReactDOM\.createPortal\(/)
  assert.match(source, /ctx\.effect\(ensureStyles/)
  assert.match(source, /ctx\.effect\(\(\) => installFenceRenderer/)
  assert.match(source, /dataset\.plugin = PLUGIN_ID/)
  assert.match(source, /dataset\.pluginCss = STYLE_CSS_ID/)
})
