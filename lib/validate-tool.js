/**
 * The `validate_view` tool: a preflight check for the dsh-view fence.
 * It parses the exact JSON body the model is about to emit and returns a
 * stable protocol with path-level diagnostics.
 */
import { describeFailure, isRenderable, normalizeView } from './validate.js'

const PARAMETERS = {
  type: 'object',
  properties: {
    spec: {
      oneOf: [
        { type: 'string', description: 'The exact JSON text of the dsh-view fence body.' },
        { type: 'object', description: 'The spec object (serialized before validation).' },
      ],
      description: 'Pass the exact fence body as a string for an exact check, or the spec object.',
    },
  },
  required: ['spec'],
  additionalProperties: false,
}

function rawOf(args) {
  if (typeof args === 'string') return args
  if (!args || typeof args !== 'object') return null
  const value = 'spec' in args ? args.spec : 'arguments' in args ? args.arguments : undefined
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value)
  return null
}

function bracketDiagnostic(raw) {
  let braces = 0
  let brackets = 0
  let inString = false
  let escaped = false
  for (const character of raw) {
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') inString = true
    else if (character === '{') braces += 1
    else if (character === '}') braces -= 1
    else if (character === '[') brackets += 1
    else if (character === ']') brackets -= 1
  }
  return [
    `brace_delta=${braces}`,
    `bracket_delta=${brackets}`,
    ...(braces === 0 && brackets === 0 ? [] : ['likely_causes=unbalanced_delimiters,trailing_comma,unescaped_quote']),
  ]
}

function protocol(lines) {
  return ['[mosaic-validation]', ...lines, 'reply_language=conversation'].join('\n')
}

export function createValidateViewTool() {
  return {
    name: 'validate_view',
    description:
      'Validate a dsh-view fence body before emitting it. Use it for non-trivial specs (>=3 components or containing a table/widget/diagram). '
      + 'Returns a [mosaic-validation] block with status, path-level diagnostics, and next action. '
      + 'When invalid JSON is caused by a trailing comma or an unescaped quote, fix it and validate again.',
    parameters: PARAMETERS,
    output: {
      schema: { type: 'string', description: 'Validation verdict for the model.' },
      render(_args, value) {
        return [{ type: 'text', text: String(value) }]
      },
    },
    async execute(args) {
      const raw = rawOf(args)
      if (raw === null || raw.trim() === '') return protocol(['status=invalid', 'error=missing_spec', 'next=provide_spec'])

      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        return protocol([
          'status=invalid',
          'error=invalid_json',
          `detail=${JSON.stringify(error instanceof Error ? error.message : String(error))}`,
          ...bracketDiagnostic(raw),
          'next=fix_and_revalidate',
        ])
      }

      const result = normalizeView(parsed)
      if (!isRenderable(result)) {
        return protocol([
          'status=invalid',
          'error=invalid_spec',
          `detail=${JSON.stringify(describeFailure(result))}`,
          'next=fix_and_revalidate',
        ])
      }
      return protocol([
        'status=valid',
        `rendered=${result.spec.items.length}`,
        'next=emit_fence',
      ])
    },
    presentCall() {
      return { card: 'generic', title: '验证 dsh-view', kind: 'other' }
    },
    presentResult() {
      return { card: 'generic', title: '验证 dsh-view' }
    },
  }
}