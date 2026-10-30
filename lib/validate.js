/**
 * dsh-mosaic spec validation and deterministic repair.
 *
 * The validator is intentionally small: it keeps a compact component
 * vocabulary, drops invalid nodes with a path, and returns a spec only when
 * every node is safe to render. The browser partial parser is more forgiving;
 * this module is the preflight / tool-call authority.
 */

export const LIMITS = {
  maxNodes: 80,
  maxDepth: 6,
  maxString: 2000,
  maxCode: 12000,
  maxWidget: 20000,
  maxTableRows: 40,
  maxTableCols: 8,
  maxChartPoints: 40,
  maxSeries: 8,
  maxListItems: 30,
  maxTabs: 8,
  maxQuizOptions: 6,
}

const TEXT_SIZES = new Set(['display', 'h1', 'h2', 'h3', 'body', 'muted', 'caption'])
const TEXT_TONES = new Set(['danger', 'success', 'warning', 'info', 'muted'])
const TEXT_ALIGNS = new Set(['left', 'center', 'right'])
const CARD_TONES = new Set(['info', 'success', 'warning', 'danger'])
const CALLOUT_TONES = new Set(['info', 'success', 'warning', 'error'])
const BADGE_TONES = new Set(['success', 'warn', 'danger', 'accent'])
const BUTTON_TONES = new Set(['primary', 'danger', 'success', 'ghost'])
const CHART_KINDS = new Set(['bars', 'line', 'donut'])
const DIAGRAM_KINDS = new Set(['flowchart', 'sequence', 'timeline', 'layers'])
const DIAGRAM_DIRECTIONS = new Set(['TB', 'LR'])
const DIAGRAM_TONES = new Set(['accent', 'success', 'warning', 'danger', 'muted'])
const DIAGRAM_SHAPES = new Set(['box', 'round', 'diamond'])
const DIAGRAM_EDGE_KINDS = new Set(['solid', 'dashed', 'accent'])
const SEQUENCE_MESSAGE_KINDS = new Set(['sync', 'return', 'async'])
const ASPECTS = new Set(['16:9', '4:3', '1:1', '9:16'])
const LOCAL_ACTIONS = new Set(['reset', 'copy', 'open', 'fullscreen'])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value, cap = LIMITS.maxString) {
  return typeof value === 'string' ? value.slice(0, cap) : undefined
}

function asNumber(value, min = -Infinity, max = Infinity) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : undefined
}

function asInteger(value, min = -Infinity, max = Infinity) {
  const n = asNumber(value, min, max)
  return n === undefined ? undefined : Math.trunc(n)
}

function asEnum(value, values) {
  return typeof value === 'string' && values.has(value) ? value : undefined
}

function asBoolean(value) {
  return typeof value === 'boolean' ? value : undefined
}

function looksLikeSpec(value) {
  return isRecord(value) && Array.isArray(value.items)
}

function looksLikeNode(value) {
  return isRecord(value) && typeof value.type === 'string'
}

/**
 * Keep only browser-reachable http(s), mailto, or root-relative targets.
 * `data:`, `blob:`, `file:`, `javascript:` and protocol-relative URLs are
 * rejected; widgets are the only arbitrary-code escape hatch.
 */
export function safeUrl(value, { media = false } = {}) {
  const raw = asString(value, 2048)
  if (raw === undefined) return undefined
  const url = raw.trim()
  if (url === '') return undefined
  if (/^https?:\/\//i.test(url)) return url
  if (!media && /^mailto:[^@\s]+@[^@\s]+$/i.test(url)) return url
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (url.startsWith('./') || url.startsWith('../')) return url
  return undefined
}

function fail(state, path, message) {
  state.errors.push(`${path}: ${message}`)
}

function takeString(state, path, value, cap = LIMITS.maxString) {
  const result = asString(value, cap)
  if (result === undefined) fail(state, path, 'must be a string')
  return result
}

function takeOptionalNumber(state, path, value, min, max) {
  if (value === undefined) return undefined
  const result = asNumber(value, min, max)
  if (result === undefined) fail(state, path, 'must be a finite number')
  return result
}

function takeOptionalInteger(state, path, value, min, max) {
  if (value === undefined) return undefined
  const result = asInteger(value, min, max)
  if (result === undefined) fail(state, path, 'must be an integer')
  return result
}

function takeNodeList(state, path, value, depth) {
  if (!Array.isArray(value)) {
    fail(state, path, 'must be an array')
    return undefined
  }
  const out = []
  for (let index = 0; index < value.length; index += 1) {
    const node = repairNode(state, value[index], `${path}[${index}]`, depth + 1)
    if (node !== null) out.push(node)
  }
  return out
}

function takeStringList(state, path, value, cap = LIMITS.maxString, maxItems = LIMITS.maxListItems) {
  if (!Array.isArray(value)) {
    fail(state, path, 'must be an array')
    return undefined
  }
  const out = []
  for (let index = 0; index < value.length && out.length < maxItems; index += 1) {
    const item = asString(value[index], cap)
    if (item === undefined) {
      fail(state, `${path}[${index}]`, 'must be a string')
      continue
    }
    out.push(item)
  }
  return out
}

function normalizeListItems(state, path, value, depth) {
  if (!Array.isArray(value)) {
    fail(state, path, 'must be an array')
    return undefined
  }
  const out = []
  for (let index = 0; index < value.length && out.length < LIMITS.maxListItems; index += 1) {
    const item = value[index]
    const at = `${path}[${index}]`
    if (typeof item === 'string') {
      out.push(item.slice(0, LIMITS.maxString))
      continue
    }
    if (looksLikeNode(item)) {
      const node = repairNode(state, item, at, depth + 1)
      if (node !== null) out.push(node)
      continue
    }
    if (!isRecord(item)) {
      fail(state, at, 'must be a string, record, or component')
      continue
    }
    const title = asString(item.title ?? item.label ?? item.name, LIMITS.maxString)
    if (title === undefined) {
      fail(state, at, 'record needs a title')
      continue
    }
    out.push({
      title,
      ...(asString(item.desc ?? item.description ?? item.content ?? item.text, LIMITS.maxString) === undefined
        ? {}
        : { desc: asString(item.desc ?? item.description ?? item.content ?? item.text, LIMITS.maxString) }),
    })
  }
  return out
}

function normalizeTable(state, path, value) {
  let columnsRaw = value.columns ?? value.headers
  let rowsRaw = value.rows ?? value.data

  if (rowsRaw !== undefined && !Array.isArray(rowsRaw)) {
    fail(state, `${path}.rows`, 'must be an array')
    return null
  }

  // Object rows: use the declared columns or the first row's keys.
  if (Array.isArray(rowsRaw) && rowsRaw.length > 0 && isRecord(rowsRaw[0])) {
    const keys = Array.isArray(columnsRaw) && columnsRaw.every((column) => typeof column === 'string')
      ? columnsRaw
      : Object.keys(rowsRaw[0])
    rowsRaw = rowsRaw.map((row) => keys.map((key) => (isRecord(row) ? row[key] : undefined)))
    if (!Array.isArray(columnsRaw)) columnsRaw = keys
  }

  // 2D rows: derive the header from the leading row when columns are absent.
  if ((!Array.isArray(columnsRaw) || columnsRaw.length === 0)
    && Array.isArray(rowsRaw) && rowsRaw.length > 0 && Array.isArray(rowsRaw[0])) {
    columnsRaw = rowsRaw[0]
    rowsRaw = rowsRaw.slice(1)
  }

  const columns = takeStringList(state, `${path}.columns`, columnsRaw, 256, LIMITS.maxTableCols)
  if (columns === undefined || columns.length === 0) {
    if (columns !== undefined) fail(state, `${path}.columns`, 'must not be empty')
    return null
  }

  if (!Array.isArray(rowsRaw)) {
    fail(state, `${path}.rows`, 'must be an array')
    return null
  }

  const rows = []
  for (let rowIndex = 0; rowIndex < rowsRaw.length && rows.length < LIMITS.maxTableRows; rowIndex += 1) {
    const row = rowsRaw[rowIndex]
    if (!Array.isArray(row)) {
      fail(state, `${path}.rows[${rowIndex}]`, 'must be an array')
      continue
    }
    const cells = []
    for (let cellIndex = 0; cellIndex < row.length && cellIndex < columns.length; cellIndex += 1) {
      const cell = row[cellIndex]
      if (typeof cell === 'string') cells.push(cell.slice(0, 512))
      else if (typeof cell === 'number' && Number.isFinite(cell)) cells.push(cell)
      else if (cell === null) cells.push('')
      else fail(state, `${path}.rows[${rowIndex}][${cellIndex}]`, 'must be a string, number, or null')
    }
    rows.push(cells)
  }

  const types = Array.isArray(value.types)
    ? columns.map((_, index) => {
      const type = value.types[index]
      return typeof type === 'string' && ['text', 'num', 'delta', 'bar', 'badge'].includes(type) ? type : 'text'
    })
    : undefined

  return {
    type: 'table',
    columns,
    rows,
    ...(types === undefined ? {} : { types }),
    ...(asBoolean(value.total) === true ? { total: true } : {}),
    ...(asBoolean(value.export) === true ? { export: true } : {}),
    ...(asString(value.filter, 200) === undefined ? {} : { filter: asString(value.filter, 200) }),
    ...(asString(value.sort, 200) === undefined ? {} : { sort: asString(value.sort, 200) }),
  }
}

function normalizeChart(state, path, value) {
  const kind = value.kind === undefined ? 'bars' : asEnum(value.kind, CHART_KINDS)
  if (kind === undefined) {
    fail(state, `${path}.kind`, 'must be bars, line, or donut')
    return null
  }
  const data = Array.isArray(value.data)
    ? value.data.slice(0, LIMITS.maxChartPoints).flatMap((datum, index) => {
      if (!isRecord(datum)) {
        fail(state, `${path}.data[${index}]`, 'must be an object')
        return []
      }
      const label = asString(datum.label, 128)
      const number = asNumber(datum.value)
      if (label === undefined || number === undefined) {
        fail(state, `${path}.data[${index}]`, 'needs label (string) and value (finite number)')
        return []
      }
      return [{ label, value: number }]
    })
    : undefined

  const series = Array.isArray(value.series)
    ? value.series.slice(0, LIMITS.maxSeries).flatMap((entry, index) => {
      if (!isRecord(entry)) {
        fail(state, `${path}.series[${index}]`, 'must be an object')
        return []
      }
      const label = asString(entry.label, 128)
      if (label === undefined) {
        fail(state, `${path}.series[${index}].label`, 'must be a string')
        return []
      }
      const points = Array.isArray(entry.data)
        ? entry.data.slice(0, LIMITS.maxChartPoints).flatMap((point, pointIndex) => {
          if (!isRecord(point)) {
            fail(state, `${path}.series[${index}].data[${pointIndex}]`, 'must be an object')
            return []
          }
          const pointLabel = asString(point.label, 128)
          const pointValue = asNumber(point.value)
          if (pointLabel === undefined || pointValue === undefined) {
            fail(state, `${path}.series[${index}].data[${pointIndex}]`, 'needs label and value')
            return []
          }
          return [{ label: pointLabel, value: pointValue }]
        })
        : []
      return [{ label, data: points }]
    })
    : undefined

  if ((data === undefined || data.length === 0) && (series === undefined || series.length === 0)) {
    fail(state, path, 'requires data or series')
    return null
  }
  if (kind === 'donut' && (data === undefined || data.length === 0)) {
    fail(state, `${path}.data`, 'is required for donut')
    return null
  }
  if (kind === 'donut' && series !== undefined) {
    fail(state, `${path}.series`, 'is not supported for donut')
    return null
  }

  return {
    type: 'chart',
    kind,
    ...(data === undefined ? {} : { data }),
    ...(series === undefined ? {} : { series }),
    ...(asBoolean(value.stacked) === true ? { stacked: true } : {}),
    ...(asString(value.title, LIMITS.maxString) === undefined ? {} : { title: asString(value.title, LIMITS.maxString) }),
  }
}

function normalizeWidget(state, path, value) {
  const code = asString(value.code, LIMITS.maxWidget)
  if (code === undefined) {
    fail(state, `${path}.code`, 'must be a string')
    return null
  }
  return {
    type: 'widget',
    code,
    height: asInteger(value.height, 80, 900) ?? 320,
    ...(asString(value.title, 256) === undefined ? {} : { title: asString(value.title, 256) }),
    ...(asString(value.caption, LIMITS.maxString) === undefined ? {} : { caption: asString(value.caption, LIMITS.maxString) }),
    // Widgets may only call the model without a fresh user gesture when they opt in.
    ...(value.actions === 'programmatic' ? { actions: 'programmatic' } : {}),
  }
}

/**
 * Normalize a small structured diagram: flowchart, sequence, timeline, or
 * layered stack. All members are plain JSON so the client can lay them out
 * without a diagram engine.
 */
function normalizeDiagram(state, path, raw) {
  const inferred = raw.kind === undefined
    ? (Array.isArray(raw.nodes) || Array.isArray(raw.edges) ? 'flowchart'
      : Array.isArray(raw.participants) || Array.isArray(raw.messages) ? 'sequence'
        : Array.isArray(raw.layers) ? 'layers'
          : Array.isArray(raw.items) ? 'timeline' : undefined)
    : undefined
  const kind = raw.kind === undefined ? inferred : asEnum(raw.kind, DIAGRAM_KINDS)
  if (kind === undefined) {
    fail(state, `${path}.kind`, 'must be flowchart, sequence, timeline, or layers')
    return null
  }
  const title = asString(raw.title, 256)
  const common = { type: 'diagram', kind, ...(title === undefined ? {} : { title }) }

  if (kind === 'flowchart') {
    if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
      fail(state, `${path}.nodes`, 'flowchart requires a non-empty nodes array')
      return null
    }
    const nodes = []
    const ids = new Set()
    for (let index = 0; index < raw.nodes.length && nodes.length < 12; index += 1) {
      const node = raw.nodes[index]
      const at = `${path}.nodes[${index}]`
      if (!isRecord(node)) {
        fail(state, at, 'must be an object')
        continue
      }
      const id = asString(node.id, 64)
      const label = asString(node.label, 128)
      if (id === undefined || label === undefined) {
        fail(state, at, 'requires id and label strings')
        continue
      }
      if (ids.has(id)) {
        fail(state, at, `duplicate node id '${id}'`)
        continue
      }
      ids.add(id)
      nodes.push({
        id,
        label,
        ...(asString(node.sub, 128) === undefined ? {} : { sub: asString(node.sub, 128) }),
        ...(asEnum(node.tone, DIAGRAM_TONES) === undefined ? {} : { tone: asEnum(node.tone, DIAGRAM_TONES) }),
        ...(asEnum(node.shape, DIAGRAM_SHAPES) === undefined ? {} : { shape: asEnum(node.shape, DIAGRAM_SHAPES) }),
      })
    }
    if (nodes.length === 0) return null
    const edges = []
    if (raw.edges !== undefined) {
      if (!Array.isArray(raw.edges)) {
        fail(state, `${path}.edges`, 'must be an array')
        return null
      }
      for (let index = 0; index < raw.edges.length && edges.length < 20; index += 1) {
        const edge = raw.edges[index]
        const at = `${path}.edges[${index}]`
        if (!isRecord(edge)) {
          fail(state, at, 'must be an object')
          continue
        }
        const from = asString(edge.from, 64)
        const to = asString(edge.to, 64)
        if (from === undefined || to === undefined) {
          fail(state, at, 'requires from and to strings')
          continue
        }
        if (!ids.has(from) || !ids.has(to)) {
          fail(state, at, `unknown endpoint ${!ids.has(from) ? from : to}`)
          continue
        }
        edges.push({
          from,
          to,
          ...(asString(edge.label, 64) === undefined ? {} : { label: asString(edge.label, 64) }),
          ...(asEnum(edge.kind, DIAGRAM_EDGE_KINDS) === undefined ? {} : { kind: asEnum(edge.kind, DIAGRAM_EDGE_KINDS) }),
        })
      }
    }
    return {
      ...common,
      direction: asEnum(raw.direction, DIAGRAM_DIRECTIONS) ?? 'TB',
      nodes,
      edges,
    }
  }

  if (kind === 'sequence') {
    if (!Array.isArray(raw.participants) || raw.participants.length === 0) {
      fail(state, `${path}.participants`, 'sequence requires a non-empty participants array')
      return null
    }
    const participants = []
    const ids = new Set()
    for (let index = 0; index < raw.participants.length && participants.length < 8; index += 1) {
      const participant = raw.participants[index]
      const at = `${path}.participants[${index}]`
      if (!isRecord(participant)) {
        fail(state, at, 'must be an object')
        continue
      }
      const id = asString(participant.id, 64)
      const label = asString(participant.label, 128)
      if (id === undefined || label === undefined) {
        fail(state, at, 'requires id and label strings')
        continue
      }
      if (ids.has(id)) {
        fail(state, at, `duplicate participant id '${id}'`)
        continue
      }
      ids.add(id)
      participants.push({ id, label })
    }
    if (participants.length === 0) return null
    if (!Array.isArray(raw.messages) || raw.messages.length === 0) {
      fail(state, `${path}.messages`, 'sequence requires a non-empty messages array')
      return null
    }
    const messages = []
    for (let index = 0; index < raw.messages.length && messages.length < 20; index += 1) {
      const message = raw.messages[index]
      const at = `${path}.messages[${index}]`
      if (!isRecord(message)) {
        fail(state, at, 'must be an object')
        continue
      }
      const from = asString(message.from, 64)
      const to = asString(message.to, 64)
      const label = asString(message.label, 128)
      if (from === undefined || to === undefined || label === undefined) {
        fail(state, at, 'requires from, to, and label strings')
        continue
      }
      if (!ids.has(from) || !ids.has(to)) {
        fail(state, at, `unknown participant ${!ids.has(from) ? from : to}`)
        continue
      }
      messages.push({
        from,
        to,
        label,
        ...(asEnum(message.kind, SEQUENCE_MESSAGE_KINDS) === undefined ? {} : { kind: asEnum(message.kind, SEQUENCE_MESSAGE_KINDS) }),
      })
    }
    if (messages.length === 0) return null
    return { ...common, participants, messages }
  }

  if (kind === 'timeline') {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      fail(state, `${path}.items`, 'timeline requires a non-empty items array')
      return null
    }
    const items = []
    for (let index = 0; index < raw.items.length && items.length < 12; index += 1) {
      const item = raw.items[index]
      const at = `${path}.items[${index}]`
      if (!isRecord(item)) {
        fail(state, at, 'must be an object')
        continue
      }
      const itemTitle = asString(item.title, 256)
      if (itemTitle === undefined) {
        fail(state, at, 'requires a title string')
        continue
      }
      items.push({
        title: itemTitle,
        ...(asString(item.desc, LIMITS.maxString) === undefined ? {} : { desc: asString(item.desc, LIMITS.maxString) }),
        ...(asString(item.time, 64) === undefined ? {} : { time: asString(item.time, 64) }),
      })
    }
    return items.length === 0 ? null : { ...common, items }
  }

  if (!Array.isArray(raw.layers) || raw.layers.length === 0) {
    fail(state, `${path}.layers`, 'layers requires a non-empty layers array')
    return null
  }
  const layers = []
  for (let index = 0; index < raw.layers.length && layers.length < 8; index += 1) {
    const layer = raw.layers[index]
    const at = `${path}.layers[${index}]`
    if (!isRecord(layer)) {
      fail(state, at, 'must be an object')
      continue
    }
    const layerTitle = asString(layer.title, 128)
    if (layerTitle === undefined) {
      fail(state, at, 'requires a title string')
      continue
    }
    const items = takeStringList(state, `${at}.items`, layer.items, 256, 6)
    if (items === undefined || items.length === 0) {
      fail(state, `${at}.items`, 'must be a non-empty string array')
      continue
    }
    layers.push({ title: layerTitle, items })
  }
  return layers.length === 0 ? null : { ...common, layers }
}

/**
 * Repair one node. Returns a JSON-safe node or null after pushing an error.
 */
function repairNode(state, raw, path, depth) {
  if (depth > LIMITS.maxDepth) {
    fail(state, path, `exceeds max depth ${LIMITS.maxDepth}`)
    return null
  }
  if (state.count >= LIMITS.maxNodes) {
    fail(state, path, `exceeds max nodes ${LIMITS.maxNodes}`)
    return null
  }
  if (!isRecord(raw)) {
    fail(state, path, 'must be an object')
    return null
  }
  if (typeof raw.type !== 'string') {
    fail(state, path, 'missing string type')
    return null
  }
  state.count += 1
  const type = raw.type

  switch (type) {
    case 'text': {
      const content = asString(raw.content ?? raw.text, LIMITS.maxString)
      if (content === undefined) {
        fail(state, `${path}.content`, 'must be a string')
        return null
      }
      return {
        type: 'text',
        content,
        ...(asEnum(raw.size, TEXT_SIZES) === undefined ? {} : { size: asEnum(raw.size, TEXT_SIZES) }),
        ...(asEnum(raw.align, TEXT_ALIGNS) === undefined ? {} : { align: asEnum(raw.align, TEXT_ALIGNS) }),
        ...(asEnum(raw.tone, TEXT_TONES) === undefined ? {} : { tone: asEnum(raw.tone, TEXT_TONES) }),
        ...(asBoolean(raw.mono) === true ? { mono: true } : {}),
      }
    }
    case 'row': {
      const items = takeNodeList(state, `${path}.items`, raw.items, depth)
      if (items === undefined || items.length === 0) return null
      return {
        type: 'row',
        items,
        ...(raw.gap === undefined ? {} : { gap: takeOptionalNumber(state, `${path}.gap`, raw.gap, 0, 48) }),
        ...(raw.align === undefined ? {} : { align: asEnum(raw.align, new Set(['start', 'center', 'end', 'between'])) }),
        ...(asBoolean(raw.wrap) === true ? { wrap: true } : {}),
      }
    }
    case 'col': {
      const items = takeNodeList(state, `${path}.items`, raw.items, depth)
      if (items === undefined || items.length === 0) return null
      return {
        type: 'col',
        items,
        ...(raw.gap === undefined ? {} : { gap: takeOptionalNumber(state, `${path}.gap`, raw.gap, 0, 48) }),
        ...(raw.width === undefined ? {} : { width: takeOptionalInteger(state, `${path}.width`, raw.width, 1, 100) }),
      }
    }
    case 'grid': {
      const items = takeNodeList(state, `${path}.items`, raw.items, depth)
      if (items === undefined || items.length === 0) return null
      return {
        type: 'grid',
        cols: asInteger(raw.cols, 1, 6) ?? 2,
        items,
        ...(raw.gap === undefined ? {} : { gap: takeOptionalNumber(state, `${path}.gap`, raw.gap, 0, 48) }),
      }
    }
    case 'card': {
      const items = takeNodeList(state, `${path}.items`, raw.items, depth)
      if (items === undefined || items.length === 0) return null
      return {
        type: 'card',
        items,
        ...(asString(raw.title, LIMITS.maxString) === undefined ? {} : { title: asString(raw.title, LIMITS.maxString) }),
        ...(asString(raw.eyebrow, 128) === undefined ? {} : { eyebrow: asString(raw.eyebrow, 128) }),
        ...(asEnum(raw.tone, CARD_TONES) === undefined ? {} : { tone: asEnum(raw.tone, CARD_TONES) }),
        ...(asBoolean(raw.flat) === true ? { flat: true } : {}),
      }
    }
    case 'divider':
      return { type: 'divider', ...(asString(raw.label, 128) === undefined ? {} : { label: asString(raw.label, 128) }) }
    case 'spacer':
      return { type: 'spacer' }
    case 'stat': {
      const label = asString(raw.label ?? raw.title, LIMITS.maxString)
      const value = asString(raw.value, 128)
      if (label === undefined || value === undefined) {
        fail(state, path, 'stat requires label and value')
        return null
      }
      const spark = Array.isArray(raw.spark)
        ? raw.spark.slice(0, 20).filter((n) => typeof n === 'number' && Number.isFinite(n))
        : undefined
      return {
        type: 'stat',
        label,
        value,
        ...(asString(raw.delta, 64) === undefined ? {} : { delta: asString(raw.delta, 64) }),
        ...(spark !== undefined && spark.length >= 2 ? { spark } : {}),
      }
    }
    case 'badge': {
      const label = asString(raw.label ?? raw.text, LIMITS.maxString)
      if (label === undefined) {
        fail(state, `${path}.label`, 'must be a string')
        return null
      }
      return { type: 'badge', label, ...(asEnum(raw.tone, BADGE_TONES) === undefined ? {} : { tone: asEnum(raw.tone, BADGE_TONES) }) }
    }
    case 'progress': {
      const number = asNumber(raw.value, 0, 100)
      if (number === undefined) {
        fail(state, `${path}.value`, 'must be a number from 0 to 100')
        return null
      }
      return {
        type: 'progress',
        value: number,
        ...(asString(raw.label, LIMITS.maxString) === undefined ? {} : { label: asString(raw.label, LIMITS.maxString) }),
        ...(asString(raw.valueLabel, 64) === undefined ? {} : { valueLabel: asString(raw.valueLabel, 64) }),
        ...(asEnum(raw.variant, new Set(['bar', 'ring'])) === undefined ? {} : { variant: asEnum(raw.variant, new Set(['bar', 'ring'])) }),
        ...(asNumber(raw.target, 0, 100) === undefined ? {} : { target: asNumber(raw.target, 0, 100) }),
      }
    }
    case 'list': {
      const items = normalizeListItems(state, `${path}.items`, raw.items, depth)
      if (items === undefined || items.length === 0) return null
      return { type: 'list', items, ...(asString(raw.filter, 200) === undefined ? {} : { filter: asString(raw.filter, 200) }) }
    }
    case 'table': {
      const table = normalizeTable(state, path, raw)
      return table
    }
    case 'keyvalue': {
      if (!Array.isArray(raw.pairs)) {
        fail(state, `${path}.pairs`, 'must be an array')
        return null
      }
      const pairs = raw.pairs.slice(0, 20).flatMap((pair, index) => {
        if (!isRecord(pair)) {
          fail(state, `${path}.pairs[${index}]`, 'must be an object')
          return []
        }
        const key = asString(pair.key ?? pair.label, 256)
        const value = asString(pair.value, LIMITS.maxString)
        if (key === undefined || value === undefined) {
          fail(state, `${path}.pairs[${index}]`, 'needs key and value strings')
          return []
        }
        return [{ key, value }]
      })
      if (pairs.length === 0) return null
      return { type: 'keyvalue', pairs }
    }
    case 'steps': {
      if (!Array.isArray(raw.steps)) {
        fail(state, `${path}.steps`, 'must be an array')
        return null
      }
      const steps = raw.steps.slice(0, 12).flatMap((step, index) => {
        if (!isRecord(step)) {
          fail(state, `${path}.steps[${index}]`, 'must be an object')
          return []
        }
        const title = asString(step.title, 256)
        if (title === undefined) {
          fail(state, `${path}.steps[${index}].title`, 'must be a string')
          return []
        }
        return [{ title, ...(asString(step.desc, LIMITS.maxString) === undefined ? {} : { desc: asString(step.desc, LIMITS.maxString) }) }]
      })
      if (steps.length === 0) return null
      return {
        type: 'steps',
        steps,
        ...(asInteger(raw.current, 0, steps.length) === undefined ? {} : { current: asInteger(raw.current, 0, steps.length) }),
      }
    }
    case 'callout': {
      const content = asString(raw.content ?? raw.text ?? raw.body ?? raw.desc, LIMITS.maxString)
      if (content === undefined) {
        fail(state, `${path}.content`, 'must be a string')
        return null
      }
      const toneRaw = raw.tone ?? raw.kind
      const tone = toneRaw === 'danger' ? 'error' : toneRaw === 'warn' ? 'warning' : asEnum(toneRaw, CALLOUT_TONES)
      return {
        type: 'callout',
        content,
        ...(tone === undefined ? {} : { tone }),
        ...(asString(raw.title, LIMITS.maxString) === undefined ? {} : { title: asString(raw.title, LIMITS.maxString) }),
      }
    }
    case 'code': {
      const code = asString(raw.code, LIMITS.maxCode)
      if (code === undefined) {
        fail(state, `${path}.code`, 'must be a string')
        return null
      }
      return { type: 'code', code, ...(asString(raw.lang, 32) === undefined ? {} : { lang: asString(raw.lang, 32) }) }
    }
    case 'diff': {
      if (!Array.isArray(raw.diffs)) {
        fail(state, `${path}.diffs`, 'must be an array')
        return null
      }
      const diffs = raw.diffs.slice(0, 8).flatMap((diff, index) => {
        if (!isRecord(diff)) {
          fail(state, `${path}.diffs[${index}]`, 'must be an object')
          return []
        }
        const file = asString(diff.path, 512)
        const newText = asString(diff.newText, LIMITS.maxCode)
        if (file === undefined || newText === undefined) {
          fail(state, `${path}.diffs[${index}]`, 'needs path and newText')
          return []
        }
        return [{
          path: file,
          newText,
          oldText: typeof diff.oldText === 'string' ? diff.oldText.slice(0, LIMITS.maxCode) : null,
        }]
      })
      if (diffs.length === 0) return null
      return { type: 'diff', diffs }
    }
    case 'chart':
      return normalizeChart(state, path, raw)
    case 'image': {
      const src = safeUrl(raw.src ?? raw.url, { media: true })
      if (src === undefined) {
        fail(state, `${path}.src`, 'must be an http(s) or relative URL')
        return null
      }
      return {
        type: 'image',
        src,
        ...(asString(raw.alt, LIMITS.maxString) === undefined ? {} : { alt: asString(raw.alt, LIMITS.maxString) }),
        ...(asString(raw.caption, LIMITS.maxString) === undefined ? {} : { caption: asString(raw.caption, LIMITS.maxString) }),
      }
    }
    case 'video': {
      const src = safeUrl(raw.src ?? raw.url, { media: true })
      if (src === undefined) {
        fail(state, `${path}.src`, 'must be an http(s) or relative URL')
        return null
      }
      const poster = raw.poster === undefined ? undefined : safeUrl(raw.poster, { media: true })
      if (raw.poster !== undefined && poster === undefined) {
        fail(state, `${path}.poster`, 'must be a safe media URL')
        return null
      }
      return {
        type: 'video',
        src,
        ...(poster === undefined ? {} : { poster }),
        ...(asEnum(raw.aspect, ASPECTS) === undefined ? {} : { aspect: asEnum(raw.aspect, ASPECTS) }),
        ...(asString(raw.caption, LIMITS.maxString) === undefined ? {} : { caption: asString(raw.caption, LIMITS.maxString) }),
      }
    }
    case 'audio': {
      const src = safeUrl(raw.src ?? raw.url, { media: true })
      if (src === undefined) {
        fail(state, `${path}.src`, 'must be an http(s) or relative URL')
        return null
      }
      return {
        type: 'audio',
        src,
        ...(asString(raw.caption, LIMITS.maxString) === undefined ? {} : { caption: asString(raw.caption, LIMITS.maxString) }),
      }
    }
    case 'pdf': {
      const src = safeUrl(raw.src ?? raw.url, { media: true })
      if (src === undefined) {
        fail(state, `${path}.src`, 'must be an http(s) or relative URL')
        return null
      }
      return {
        type: 'pdf',
        src,
        ...(asString(raw.title, 256) === undefined ? {} : { title: asString(raw.title, 256) }),
      }
    }
    case 'link': {
      const label = asString(raw.label ?? raw.text, LIMITS.maxString)
      const href = safeUrl(raw.href ?? raw.url)
      if (label === undefined || href === undefined) {
        fail(state, path, 'link requires label and an http(s)/mailto href')
        return null
      }
      return {
        type: 'link',
        label,
        href,
        ...(asString(raw.description, LIMITS.maxString) === undefined ? {} : { description: asString(raw.description, LIMITS.maxString) }),
      }
    }
    case 'button': {
      const label = asString(raw.label ?? raw.text, LIMITS.maxString)
      if (label === undefined) {
        fail(state, `${path}.label`, 'must be a string')
        return null
      }
      const action = asString(raw.action, 200)
      const local = asEnum(raw.local, LOCAL_ACTIONS)
      if (local === 'copy' && typeof raw.text !== 'string') {
        fail(state, `${path}.text`, 'is required for local copy')
        return null
      }
      if (local === 'open' && safeUrl(raw.url) === undefined) {
        fail(state, `${path}.url`, 'is required for local open')
        return null
      }
      return {
        type: 'button',
        label,
        ...(action === undefined ? {} : { action }),
        ...(local === undefined ? {} : { local }),
        ...(raw.text === undefined ? {} : { text: asString(raw.text, LIMITS.maxCode) }),
        ...(raw.url === undefined ? {} : { url: asString(raw.url, 2048) }),
        ...(asEnum(raw.tone, BUTTON_TONES) === undefined ? {} : { tone: asEnum(raw.tone, BUTTON_TONES) }),
        ...(asBoolean(raw.full) === true ? { full: true } : {}),
      }
    }
    case 'input': {
      return {
        type: 'input',
        ...(asString(raw.id, 128) === undefined ? {} : { id: asString(raw.id, 128) }),
        ...(asString(raw.label, LIMITS.maxString) === undefined ? {} : { label: asString(raw.label, LIMITS.maxString) }),
        ...(asString(raw.placeholder, LIMITS.maxString) === undefined ? {} : { placeholder: asString(raw.placeholder, LIMITS.maxString) }),
        ...(asString(raw.value, LIMITS.maxString) === undefined ? {} : { value: asString(raw.value, LIMITS.maxString) }),
        ...(asString(raw.action, 200) === undefined ? {} : { action: asString(raw.action, 200) }),
      }
    }
    case 'select': {
      const options = takeStringList(state, `${path}.options`, raw.options, 256, 20)
      if (options === undefined || options.length === 0) return null
      return {
        type: 'select',
        options,
        ...(asString(raw.id, 128) === undefined ? {} : { id: asString(raw.id, 128) }),
        ...(asString(raw.label, LIMITS.maxString) === undefined ? {} : { label: asString(raw.label, LIMITS.maxString) }),
        ...(asInteger(raw.selected, 0, options.length - 1) === undefined ? {} : { selected: asInteger(raw.selected, 0, options.length - 1) }),
        ...(asString(raw.action, 200) === undefined ? {} : { action: asString(raw.action, 200) }),
      }
    }
    case 'slider': {
      const min = asNumber(raw.min, -1e9, 1e9) ?? 0
      const max = asNumber(raw.max, -1e9, 1e9) ?? 100
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      return {
        type: 'slider',
        min: lo,
        max: hi,
        value: asNumber(raw.value, lo, hi) ?? lo,
        ...(asNumber(raw.step, 1e-9, Math.max(hi - lo, 1e-9)) === undefined ? {} : { step: asNumber(raw.step, 1e-9, Math.max(hi - lo, 1e-9)) }),
        ...(asString(raw.id, 128) === undefined ? {} : { id: asString(raw.id, 128) }),
        ...(asString(raw.label, LIMITS.maxString) === undefined ? {} : { label: asString(raw.label, LIMITS.maxString) }),
        ...(asString(raw.action, 200) === undefined ? {} : { action: asString(raw.action, 200) }),
      }
    }
    case 'tabs': {
      if (!Array.isArray(raw.tabs)) {
        fail(state, `${path}.tabs`, 'must be an array')
        return null
      }
      const tabs = raw.tabs.slice(0, LIMITS.maxTabs).flatMap((tab, index) => {
        if (!isRecord(tab)) {
          fail(state, `${path}.tabs[${index}]`, 'must be an object')
          return []
        }
        const label = asString(tab.label, 128)
        if (label === undefined) {
          fail(state, `${path}.tabs[${index}].label`, 'must be a string')
          return []
        }
        const items = takeNodeList(state, `${path}.tabs[${index}].items`, tab.items ?? [], depth)
        return [{ label, items: items ?? [] }]
      })
      if (tabs.length === 0) return null
      return { type: 'tabs', tabs }
    }
    case 'quiz': {
      const question = asString(raw.question, LIMITS.maxString)
      if (question === undefined || !Array.isArray(raw.options)) {
        fail(state, path, 'quiz requires question and options')
        return null
      }
      const options = raw.options.slice(0, LIMITS.maxQuizOptions).flatMap((option, index) => {
        if (typeof option === 'string') return [{ label: option.slice(0, 512) }]
        if (!isRecord(option)) {
          fail(state, `${path}.options[${index}]`, 'must be a string or object')
          return []
        }
        const label = asString(option.label, 512)
        if (label === undefined) {
          fail(state, `${path}.options[${index}].label`, 'must be a string')
          return []
        }
        return [{
          label,
          ...(asBoolean(option.correct) === true ? { correct: true } : {}),
          ...(asString(option.feedback, LIMITS.maxString) === undefined ? {} : { feedback: asString(option.feedback, LIMITS.maxString) }),
        }]
      })
      if (options.length < 2) {
        fail(state, `${path}.options`, 'needs at least two options')
        return null
      }
      return {
        type: 'quiz',
        question,
        options,
        ...(asString(raw.explanation, LIMITS.maxString) === undefined ? {} : { explanation: asString(raw.explanation, LIMITS.maxString) }),
      }
    }
    case 'widget':
      return normalizeWidget(state, path, raw)
    case 'diagram':
      return normalizeDiagram(state, path, raw)
    default:
      fail(state, `${path}.type`, `unknown component type '${type}'`)
      return null
  }
}

/**
 * Validate and repair a raw view spec.
 *
 * @param {unknown} value Raw spec (object, JSON string, or single component).
 * @returns {{ spec: object | null, errors: string[], warnings: string[] }}
 */
export function normalizeView(value) {
  const state = { count: 0, errors: [], warnings: [] }
  let root = value
  if (typeof root === 'string') {
    try {
      root = JSON.parse(root)
    } catch (error) {
      return { spec: null, errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`], warnings: [] }
    }
  }
  if (Array.isArray(root)) root = { items: root }
  if (looksLikeNode(root)) root = { items: [root] }
  if (!isRecord(root)) {
    return { spec: null, errors: ['spec root must be an object'], warnings: [] }
  }
  if (!Array.isArray(root.items)) {
    return { spec: null, errors: ['spec.items must be an array'], warnings: [] }
  }

  const items = []
  for (let index = 0; index < root.items.length; index += 1) {
    const node = repairNode(state, root.items[index], `items[${index}]`, 0)
    if (node !== null) items.push(node)
  }

  const spec = state.errors.length === 0 && items.length > 0
    ? {
      ...(asString(root.title, LIMITS.maxString) === undefined ? {} : { title: asString(root.title, LIMITS.maxString) }),
      ...(asNumber(root.gap, 0, 48) === undefined ? {} : { gap: asNumber(root.gap, 0, 48) }),
      items,
    }
    : null

  return { spec, errors: state.errors, warnings: state.warnings }
}

/**
 * Deep-copy a value into lossless JSON: drops undefined/function/symbol
 * properties and non-finite numbers. The Harness rejects a tool
 * `presentationMeta` that is not lossless JSON, so root and nested optional
 * fields must never carry `undefined` keys.
 */
export function jsonSafe(value) {
  if (value === null) return null
  if (Array.isArray(value)) {
    const out = []
    for (const item of value) {
      const safe = jsonSafe(item)
      if (safe !== undefined) out.push(safe)
    }
    return out
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue
      const safe = jsonSafe(child)
      if (safe !== undefined) out[key] = safe
    }
    return out
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined
  return value
}

/** Whether a normalized result can be rendered. */
export function isRenderable(result) {
  return result.spec !== null && result.errors.length === 0 && result.spec.items.length > 0
}

/** A compact human-readable failure for a tool protocol. */
export function describeFailure(result) {
  return result.errors.length > 0 ? result.errors.join('; ') : 'empty spec'
}