/**
 * The `render_view` tool: a model-facing channel that renders a compact
 * `dsh-view` spec as an interactive card in the conversation tool row.
 *
 * `execute` returns the canonical JSON value the Session persists; `output.render`
 * turns that value into the protocol text the model reads, and
 * `output.presentationMeta` projects the card data from the same value, so a replay
 * renders identically without re-deriving anything from the arguments.
 */
import { isRenderable, jsonSafe, normalizeView } from './validate.js'

/** One normalized view spec, as the browser renders it. */
const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short card title.' },
    gap: { type: 'integer', description: 'Vertical gap between root items in px (0-48).' },
    items: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'Root component list (see the mosaic skill for fields).',
    },
  },
  required: ['items'],
  additionalProperties: false,
}

const PARAMETERS = {
  type: 'object',
  properties: {
    spec: {
      ...SPEC_SCHEMA,
      description: [
        'Render a compact visual answer in the tool row. Use it when a structured view materially helps: a dashboard, a comparison table, a chart, a checklist, a quiz, or a sandboxed interactive widget.',
        'The vocabulary is the same as the dsh-view fence. Prefer the fence when the UI belongs inline in the reply; use this tool when the deliverable is a self-contained card.',
        'Pass spec as a JSON object, never as a serialized string.',
      ].join(' '),
    },
  },
  required: ['spec'],
  additionalProperties: false,
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['rendered', 'invalid'] },
    title: { type: 'string' },
    rendered: { type: 'integer' },
    spec: SPEC_SCHEMA,
    errors: { type: 'array', items: { type: 'string' } },
  },
  required: ['status'],
  additionalProperties: false,
}

/** Unwrap the shapes a model call or a session replay may hand to this tool. */
function unwrap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if ('spec' in value) return unwrap(value.spec)
  if ('arguments' in value) return unwrap(value.arguments)
  return value
}

function specOf(args) {
  if (typeof args === 'string') {
    try {
      return unwrap(JSON.parse(args))
    } catch {
      return undefined
    }
  }
  if (!args || typeof args !== 'object') return undefined
  return unwrap(args)
}

/**
 * A raw JSON-Schema tool owns its input validation: a call whose arguments are not the
 * declared object fails the call instead of reporting a card that can never render.
 */
function assertArguments(args) {
  const spec = specOf(args)
  if (spec === undefined || spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('invalid arguments: expected { spec: { items: [...] } } with spec as a JSON object')
  }
  if (!Array.isArray(spec.items) && typeof spec.type !== 'string') {
    throw new Error('invalid arguments: spec must carry an `items` array (one component object is also accepted)')
  }
  return spec
}

/** The canonical value: declared JSON data, never prose a caller must parse. */
function canonicalValue(args) {
  const result = normalizeView(assertArguments(args))
  if (!isRenderable(result)) return { status: 'invalid', errors: result.errors }
  const spec = result.spec
  return {
    status: 'rendered',
    ...typeof spec.title === 'string' ? { title: spec.title } : {},
    rendered: spec.items.length,
    spec: jsonSafe(spec),
  }
}

/** Model-facing summary of one canonical value. */
function protocolOf(value) {
  if (value.status === 'invalid') {
    return [
      '[mosaic-render]',
      'status=invalid',
      'error=invalid_spec',
      `detail=${JSON.stringify((value.errors ?? []).join('; '))}`,
      'next=fix_and_retry',
      'reply_language=conversation',
    ].join('\n')
  }
  return [
    '[mosaic-render]',
    'status=rendered',
    ...(typeof value.title === 'string' ? [`title=${JSON.stringify(value.title)}`] : []),
    `rendered=${value.rendered}`,
    'action_feedback=[mosaic-action]',
    'reply_language=conversation',
  ].join('\n')
}

function titleOf(value) {
  return typeof value?.title === 'string' ? `Render view: ${value.title}` : 'Render view'
}

export function createRenderViewTool() {
  return {
    name: 'render_view',
    description:
      'Render a compact visual answer as an interactive card in the conversation tool row. '
      + 'Use it when a structured view materially helps; plain prose is enough otherwise. '
      + 'Use it for a dashboard, comparison table, chart, diagram, checklist, quiz, media card, or a sandboxed HTML/JS widget. '
      + 'The vocabulary is the same as the dsh-view fence; use the fence for inline UI and this tool for a self-contained card. '
      + 'Components with an action send [mosaic-action] back to you; components without one stay local.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: protocolOf(value) }]
      },
      presentationMeta(_args, value) {
        return value.status === 'rendered' ? jsonSafe(value.spec) : undefined
      },
    },
    async execute(args) {
      return canonicalValue(args)
    },
    presentCall(args) {
      const spec = specOf(args)
      const title = spec && typeof spec === 'object' && typeof spec.title === 'string' ? spec.title : undefined
      return { card: 'generic', title: title ? `Render view: ${title}` : 'Render view', kind: 'other' }
    },
    presentResult(_args, value) {
      return { card: 'generic', title: titleOf(value) }
    },
  }
}
