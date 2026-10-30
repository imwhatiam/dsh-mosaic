/**
 * dsh-mosaic host half.
 *
 * Adds a compact visual-answer section to the system prompt, two model tools
 * (`render_view`, `validate_view`), and a bundled `mosaic` skill with the full
 * field reference. The browser half renders the `dsh-view` fence and the
 * `render_view` tool card; it ships no heavy chart or diagram engines.
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPromptController, PROMPT_ROUTE } from './prompt-store.js'
import { createRenderViewTool } from './render-tool.js'
import { createValidateViewTool } from './validate-tool.js'

export const name = 'dsh-mosaic'
export const inject = ['systemPrompt']

/* ------------------------------------------------------------------ */
/* lazy Mermaid engine                                                 */
/* ------------------------------------------------------------------ */

// `/plugins` belongs to the client module system, so a plugin asset route keeps to a
// package-private prefix and never shadows or collides with it.
const ASSET_ROUTE_PATH = '/dsh-mosaic/assets'
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/
// The unmodified official Mermaid distribution; see THIRD_PARTY_NOTICES.md.
const MERMAID_ASSET_FILE = 'mermaid.min.js'
const MERMAID_VERSION = '12.2.0'

/**
 * Resolve the prompt this plugin contributes to the system prompt. The row's
 * `config.prompt` overrides the built-in text; an absent, blank, oversized, or
 * non-string value falls back to it, so a malformed patch can never silence the
 * visualization guidance.
 *
 * @param {unknown} config - the Loader row's config.
 * @returns {string} the prompt to contribute.
 */
export function resolvePrompt(config) {
  const prompt = config !== null && typeof config === 'object' ? config.prompt : undefined
  if (typeof prompt !== 'string') return MOSAIC_SECTION_TEXT
  const trimmed = prompt.trim()
  if (trimmed === '' || Buffer.byteLength(trimmed, 'utf8') > 128 * 1024) return MOSAIC_SECTION_TEXT
  return trimmed
}

async function serveMosaicAsset(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  if (!pathname.startsWith(`${ASSET_ROUTE_PATH}/`)) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = pathname.slice(ASSET_ROUTE_PATH.length + 1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url))
    const body = await readFile(resolve(moduleDirectory, 'assets', file))
    const versioned = new URL(req.url ?? '/', 'http://x').searchParams.has('v')
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      // The client appends ?v=<version>, so a versioned URL can be cached for good;
      // anything else keeps revalidating.
      'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

export const MOSAIC_SECTION_TEXT = `Render a visual answer with a fenced \`dsh-view\` JSON block, or with the \`render_view\` tool when a self-contained card is useful.

\`\`\`dsh-view
{"title":"Ops snapshot","gap":12,"items":[{"type":"stat","label":"Uptime","value":"99.96%"}]}
\`\`\`

Mosaic is optional. Use it when a component makes the answer easier to scan; plain prose is fine. Do not add a component just to satisfy a format. When you do use one, prefer a single focal component and do not repeat the same data as both a table and a chart.

Components (fields in the \`mosaic\` skill):
- Layout: text · row · col · grid · card · divider · spacer
- Display: stat · badge · progress · list · table · keyvalue · steps · callout · code · diff · chart · diagram
- Media: image · video · audio · pdf · link
- Interactive: button · input · select · slider · tabs · quiz
- Advanced: widget (HTML/CSS/JS in an opaque-origin, no-network sandbox iframe)

Rules:
- Put \`dsh-view\` in the reply body, never in reasoning. JSON must be strict.
- The opening fence tag MUST be exactly \`dsh-view\`. Never use \`\`\`json, \`\`\`text, or an unlabelled fence for a full spec; a \`json\` fence is at best a legacy fallback and may not render.
- Files and Office documents: use a \`link\` card. Mosaic does not read local files or render Office; the host app opens them.
- Media accepts an http(s) or root-relative URL.
- Interactions are local by default. A button \`action\` sends \`[mosaic-action]\`; \`local\` supports reset/copy/open/fullscreen. A button with neither is disabled.
- When you show a flow, sequence, or layered architecture, use \`diagram\` (\`flowchart\`, \`sequence\`, \`timeline\`, \`layers\`); do not hand-write Mermaid unless it is inside a widget. For a long flowchart (more than 6 nodes), prefer \`direction:"TB"\`; \`LR\` becomes horizontally scrollable.
- Limits: 80 nodes, depth 6, table 40×8, chart 40 points, diagram 12 nodes/20 edges, widget code 20k. \`validate_view\` is available for a preflight check on complex specs.

Field quick reference:
- text {content, size, align, tone, mono}
- stat {label, value, delta, spark:[numbers]}
- table {columns:[strings], rows:[[cells]], types:[text|num|delta|bar|badge], total, export, filter:<field id>, sort:<field id>}
- chart {kind:bars|line|donut, data:[{label,value}], series:[{label,data:[{label,value}]}], stacked}
- diagram {kind:flowchart|sequence|timeline|layers, direction:TB|LR, nodes:[{id,label,sub,tone,shape}], edges:[{from,to,label,kind}], participants:[{id,label}], messages:[{from,to,label,kind}], items:[{title,desc,time}], layers:[{title,items}]}
- callout {content, title, tone:info|success|warning|error}
- list {items: strings | {title,desc} | components}
- button {label, action | local:reset|copy|open|fullscreen, text, url, tone}
- input/select/slider {id, label, ...}; table/list filter binds to an input/select id
- quiz {question, options:[{label,correct,feedback}], explanation}
- widget {code, height, title, caption}
- link {label, href, description}; image/video/audio/pdf {src, ...}

The \`mosaic\` skill carries the full component table, examples, and the widget bridge (\`window.mosaic.action\`, \`window.mosaic.resize\`).`

/**
 * Externally chosen finite order: `getSectionOrder(name)` resolves centrally allocated
 * positions reserved for repository-owned contributors, so a plugin names its own slot.
 * 9800 sits after the deliverable guidance and before the structured-output section.
 */
const PROMPT_SECTION_ORDER = 9800

function registerPromptSection(ctx, text) {
  return ctx.systemPrompt.section({
    name: 'mosaic:view',
    order: PROMPT_SECTION_ORDER,
    text,
    interpolate: false,
  })
}

const BUNDLED_SKILL_PROVIDER = 'dsh-mosaic'
const BUNDLED_SKILL_NAME = 'mosaic'
// Lower than the packaged-skill standard rank (600) on purpose: a user-installed skill
// named `mosaic` should win over this plugin's guidance copy.
const MOSAIC_SKILL_RANK = 550
const BUNDLED_SKILL_INVOCATION = { modelInvocable: true, userInvocable: true }

function frontmatterField(front, key) {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'mu').exec(front)
  return match?.[1]?.replace(/^['"]|['"]$/gu, '')
}

function bundledSkillProvider() {
  const skill = bundledSkill()
  return {
    name: BUNDLED_SKILL_PROVIDER,
    // A missing or malformed SKILL.md reports an incomplete catalog instead of
    // throwing at plugin activation, so the fence and tool channels keep working.
    list: () => Promise.resolve({
      candidates: skill === undefined ? [] : [skillEntry(skill)],
      complete: skill !== undefined,
    }),
    get: (candidate) => {
      if (candidate === undefined) return Promise.resolve(undefined)
      const current = bundledSkill()
      if (current === undefined) return Promise.resolve(undefined)
      return Promise.resolve({ ...skillEntry(current), content: current.raw.slice(current.end + 5) })
    },
  }
}

/** Read the bundled skill, or `undefined` when it cannot be used. */
function bundledSkill() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const path = resolve(moduleDirectory, '../SKILL.md')
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) return undefined
  const description = frontmatterField(raw.slice(4, end), 'description')
  if (description === undefined) return undefined
  return { path, raw, end, description }
}

/** One catalog entry; `locator` is the opaque handle this provider owns. */
function skillEntry(skill) {
  return {
    name: BUNDLED_SKILL_NAME,
    description: skill.description,
    invocation: BUNDLED_SKILL_INVOCATION,
    source: 'bundled',
    provider: BUNDLED_SKILL_PROVIDER,
    path: skill.path,
    resourceBase: { kind: 'directory', path: dirname(skill.path) },
    rank: MOSAIC_SKILL_RANK,
    locator: skill.path,
  }
}
/**
 * Register the Mosaic prompt section, tools, and skill.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx, config) {
  // The effective prompt is the user's saved override, then the row's `config.prompt`,
  // then the built-in text. The controller owns re-registration on every change, so the
  // settings page and the profile patch both take effect without a reload.
  const prompts = createPromptController({
    ctx,
    config,
    builtin: MOSAIC_SECTION_TEXT,
    resolveConfigPrompt: resolvePrompt,
    registerSection: registerPromptSection,
    // A version query lets the asset route answer with an immutable cache entry.
    assets: { mermaid: `${ASSET_ROUTE_PATH}/${MERMAID_ASSET_FILE}?v=${MERMAID_VERSION}` },
  })
  ctx.effect(() => prompts.start(), 'dsh-mosaic: prompt section')
  prompts.hydrate().catch((error) => {
    ctx.logger?.warn?.('dsh-mosaic: could not read the saved prompt: %s', error instanceof Error ? error.message : String(error))
  })

  // Tools are optional: a host without a tool registry keeps the fence channel.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(function* () {
      yield toolsCtx.tools.register(createRenderViewTool())
      yield toolsCtx.tools.register(createValidateViewTool())
    }, 'dsh-mosaic: tools')
  })

  // The skill is optional too; the compact prompt section remains usable.
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(
      () => skillCtx.skills.registerProvider(() => bundledSkillProvider()),
      'dsh-mosaic: skill provider',
    )
  })

  // Mermaid is a lazy standalone asset, served from this package's own route.
  // A host without a webserver keeps the built-in SVG fallback.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.webServer
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveMosaicAsset }),
      'dsh-mosaic: asset route',
    )
    // The settings page reads and writes the prompt here. State-changing requests are
    // same-origin only; see requestPolicyError for the exact checks.
    webCtx.effect(
      () => webServer.register({ kind: 'exact', path: PROMPT_ROUTE, handler: (req, res) => prompts.handle(req, res) }),
      'dsh-mosaic: prompt route',
    )
  })
}