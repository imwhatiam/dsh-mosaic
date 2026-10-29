/**
 * The `render_view` tool: a model-facing channel that renders a compact
 * `dsh-view` spec as an interactive card in the conversation tool row.
 *
 * The tool returns a short protocol string for the model and carries the
 * repaired spec in `presentationMeta`; the browser toolview reads that meta.
 */
import { describeFailure, isRenderable, jsonSafe, normalizeView } from './validate.js'

const PARAMETERS = {
  type: 'object',
  properties: {
    spec: {
      type: 'object',
      description: [
        'Render a compact visual answer in the tool row. Use it when a structured view materially helps: a dashboard, a comparison table, a chart, a checklist, a quiz, or a sandboxed interactive widget.',
        'The vocabulary is the same as the dsh-view fence. Prefer the fence when the UI belongs inline in the reply; use this tool when the deliverable is a self-contained card.',
        'Pass spec as a JSON object, never as a serialized string.',
      ].join(' '),
      properties: {
        title: { type: 'string', description: 'Short card title.' },
        gap: { type: 'number', description: 'Vertical gap between root items in px (0-48).' },
        items: {
          type: 'array',
          description: 'Root component list (see the mosaic skill for fields).',
          items: { type: 'object' },
        },
      },
    },
  },
  required: ['spec'],
  additionalProperties: false,
}

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

function titleOf(args) {
  const result = normalizeView(specOf(args))
  if (!isRenderable(result)) return undefined
  return `渲染界面：${result.spec.title ?? '未命名'}`
}

function formatProtocol(result) {
  if (!isRenderable(result)) {
    return [
      '[mosaic-render]',
      'status=invalid',
      'error=invalid_spec',
      `detail=${JSON.stringify(describeFailure(result))}`,
      'next=fix_and_retry',
      'reply_language=conversation',
    ].join('\n')
  }
  return [
    '[mosaic-render]',
    'status=rendered',
    ...(result.spec.title === undefined ? [] : [`title=${JSON.stringify(result.spec.title)}`]),
    `rendered=${result.spec.items.length}`,
    'action_feedback=[mosaic-action]',
    'reply_language=conversation',
  ].join('\n')
}

export function createRenderViewTool() {
  return {
    name: 'render_view',
    description:
      'Render a compact visual answer as an interactive card in the conversation tool row. '
      + 'Apply this automatically on substantive answers when a structured view helps; do not wait for the user to ask. '
      + 'Use it for a dashboard, comparison table, chart, diagram, checklist, quiz, media card, or a sandboxed HTML/JS widget. '
      + 'The vocabulary is the same as the dsh-view fence; use the fence for inline UI and this tool for a self-contained card. '
      + 'Components with an action send [mosaic-action] back to you; components without one stay local.',
    parameters: PARAMETERS,
    output: {
      schema: { type: 'string', description: 'One-line render summary for the model.' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
      presentationMeta(args) {
        const result = normalizeView(specOf(args))
        return isRenderable(result) ? jsonSafe(result.spec) : null
      },
    },
    async execute(args) {
      return formatProtocol(normalizeView(specOf(args)))
    },
    presentCall(args) {
      const title = titleOf(args)
      return title === undefined ? undefined : { card: 'generic', title, kind: 'other' }
    },
    presentResult(args) {
      const title = titleOf(args)
      return title === undefined ? undefined : { card: 'generic', title }
    },
  }
}