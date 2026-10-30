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

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['valid', 'invalid'] },
    error: { type: 'string' },
    detail: { type: 'string' },
    rendered: { type: 'integer' },
    next: { type: 'string' },
    braceDelta: { type: 'integer' },
    bracketDelta: { type: 'integer' },
    likelyCauses: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'next'],
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

/** The canonical value: declared JSON, so a caller never parses prose for a verdict. */
function verdictOf(lines) {
  const value = { status: 'invalid', next: 'fix_and_revalidate' }
  for (const line of lines) {
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index)
    const rest = line.slice(index + 1)
    if (key === 'status') value.status = rest
    else if (key === 'error') value.error = rest
    else if (key === 'detail') value.detail = rest
    else if (key === 'next') value.next = rest
    else if (key === 'rendered') value.rendered = Number(rest)
    else if (key === 'brace_delta') value.braceDelta = Number(rest)
    else if (key === 'bracket_delta') value.bracketDelta = Number(rest)
    else if (key === 'likely_causes') value.likelyCauses = rest.split(',')
  }
  return value
}

function protocolOf(value) {
  const lines = ['[mosaic-validation]', `status=${value.status}`]
  if (value.error) lines.push(`error=${value.error}`)
  if (value.detail) lines.push(`detail=${JSON.stringify(value.detail)}`)
  if (value.rendered !== undefined) lines.push(`rendered=${value.rendered}`)
  if (value.braceDelta !== undefined) lines.push(`brace_delta=${value.braceDelta}`, `bracket_delta=${value.bracketDelta}`)
  if (value.likelyCauses) lines.push(`likely_causes=${value.likelyCauses.join(',')}`)
  lines.push(`next=${value.next}`, 'reply_language=conversation')
  return lines.join('\n')
}

function isValid(value) {
  return value.status === 'valid'
}

export function createValidateViewTool() {
  return {
    name: 'validate_view',
    description:
      'Validate a dsh-view fence body before emitting it. Useful for non-trivial specs (>=3 components or containing a table/widget/diagram). '
      + 'Returns a [mosaic-validation] block with status, path-level diagnostics, and next action. '
      + 'When invalid JSON is caused by a trailing comma or an unescaped quote, fix it and validate again.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: protocolOf(value) }]
      },
    },
    async execute(args) {
      const raw = rawOf(args)
      if (raw === null || raw.trim() === '') return verdictOf(['status=invalid', 'error=missing_spec', 'next=provide_spec'])

      let parsed
      try {
        parsed = JSON.parse(raw)
      } catch (error) {
        return verdictOf([
          'status=invalid',
          'error=invalid_json',
          `detail=${error instanceof Error ? error.message : String(error)}`,
          ...bracketDiagnostic(raw),
          'next=fix_and_revalidate',
        ])
      }

      const result = normalizeView(parsed)
      if (!isRenderable(result)) {
        return verdictOf([
          'status=invalid',
          'error=invalid_spec',
          `detail=${describeFailure(result)}`,
          'next=fix_and_revalidate',
        ])
      }
      return verdictOf(['status=valid', `rendered=${result.spec.items.length}`, 'next=emit_fence'])
    },
    presentCall() {
      return { card: 'generic', title: 'Validate dsh-view', kind: 'other' }
    },
    presentResult(_args, value) {
      return { card: 'generic', title: isValid(value) ? 'Validate dsh-view: valid' : 'Validate dsh-view: invalid' }
    },
  }
}