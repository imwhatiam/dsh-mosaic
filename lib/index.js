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
import { createRenderViewTool } from './render-tool.js'
import { createValidateViewTool } from './validate-tool.js'

export const name = 'dsh-mosaic'
export const inject = ['systemPrompt']

/* ------------------------------------------------------------------ */
/* lazy Mermaid engine                                                 */
/* ------------------------------------------------------------------ */

const ASSET_ROUTE_PATH = '/plugins/dsh-mosaic/assets'
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

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
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
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

const BUNDLED_SKILL_PROVIDER = 'dsh-mosaic'
const BUNDLED_SKILL_NAME = 'mosaic'
const BUNDLED_SKILL_RANK = 550
const BUNDLED_SKILL_INVOCATION = { modelInvocable: true, userInvocable: true }

function frontmatterField(front, key) {
  const match = new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'mu').exec(front)
  return match?.[1]?.replace(/^['"]|['"]$/gu, '')
}

function bundledSkillProvider() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const path = resolve(moduleDirectory, '../SKILL.md')
  const raw = readFileSync(path, 'utf8')
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) throw new Error('mosaic SKILL.md has invalid frontmatter')
  const description = frontmatterField(raw.slice(4, end), 'description')
  if (description === undefined) throw new Error('mosaic SKILL.md frontmatter has no description')
  const common = {
    name: BUNDLED_SKILL_NAME,
    description,
    invocation: BUNDLED_SKILL_INVOCATION,
    source: 'bundled',
    provider: BUNDLED_SKILL_PROVIDER,
    path,
    resourceBase: { kind: 'directory', path: dirname(path) },
    rank: BUNDLED_SKILL_RANK,
    locator: path,
  }
  return {
    name: BUNDLED_SKILL_PROVIDER,
    list: () => Promise.resolve([common]),
    get: () => Promise.resolve({ ...common, content: raw.slice(end + 5) }),
  }
}

/**
 * Register the Mosaic prompt section, tools, and skill.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'mosaic:view',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: MOSAIC_SECTION_TEXT,
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
    skillCtx.skills.registerProvider(() => bundledSkillProvider())
  })

  // Mermaid is a lazy standalone asset, served from this package's own route.
  // A host without a webserver keeps the built-in SVG fallback.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.reflect.get('webServer')
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveMosaicAsset }),
      'dsh-mosaic: asset route',
    )
  })
}