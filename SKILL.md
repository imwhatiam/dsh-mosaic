---
name: mosaic
description: Use Mosaic when a visual component makes a DeepSeek Harness answer easier to scan: dsh-view components, local-first interactions, diagrams, and sandboxed HTML/JS widgets. It is optional; prose is fine when no component helps.
---

# Mosaic — compact visual answers

Mosaic is optional. Use it when a component makes the answer easier to scan; plain prose is fine. Do not add UI just because the answer has structure or numbers.

Mosaic renders a small declarative component tree inside a `dsh-view` fence, or as a `render_view` tool card. Use the smallest format that fits; do not decorate an answer that a sentence already explains.

## Fence

````text
```dsh-view
{"title":"Ops snapshot","gap":12,"items":[
  {"type":"stat","label":"Uptime","value":"99.96%","delta":"+0.02%"},
  {"type":"callout","content":"No incidents in the last 7 days."}
]}
```
````

Rules:

- Put the fence in the reply body, never in reasoning. The opening tag must be exactly `dsh-view`; a `json`/`text`/unlabelled fence normally stays a code block. The client has a narrow legacy fallback for a complete spec in an assistant row, but never rely on it.
- Keep the JSON strict; no comments, trailing commas, or Markdown inside text fields.
- Prefer one focal component; do not repeat the same data as both a table and a chart.
- For files or Office documents, use a `link` card. Mosaic does not read local files or render Office; those open in the host app.
- Media (`image`, `video`, `audio`, `pdf`) accepts an `http(s)` URL or a root-relative path.
- `validate_view` is available for a preflight check on complex specs. For a flowchart longer than 6 nodes, prefer `direction: "TB"`; a long `LR` diagram scrolls horizontally.

## Components

### Layout

- `text`: `{content, size?: "display|h1|h2|h3|body|muted|caption", align?: "left|center|right", tone?: "danger|success|warning|info|muted", mono?: true}`
- `row`: `{items, gap?, align?: "start|center|end|between", wrap?}`
- `col`: `{items, gap?, width?: 1-100}`
- `grid`: `{cols: 1-6, items, gap?}`; a child can carry `"span": 2` for a bento layout
- `card`: `{items, title?, eyebrow?, tone?: "info|success|warning|danger", flat?}`
- `divider`: `{label?}`
- `spacer`: `{}`

### Display

- `stat`: `{label, value, delta?, spark?: [number, ...]}` — delta starting with `+` is green, `-` is red; spark is a micro trend line (2–20 points).
- `badge`: `{label, tone?: "success|warn|danger|accent"}`
- `progress`: `{value: 0-100, label?, valueLabel?, variant?: "bar|ring", target?}`
- `table`: `{columns: string[], rows: (string|number)[][], types?: ("text|num|delta|bar|badge")[], total?, export?, filter?: field-id, sort?: field-id}`
  - Header click sorts locally (asc → desc → off). `types` controls right alignment, signed colors, bars, badges.
  - `filter` binds to an `input`/`select` with that `id`; typing filters rows locally.
  - `sort` binds a `select` whose value is a column name.
  - `export:true` adds copy-as-Markdown / copy-as-CSV chips.
  - `total:true` appends a numeric total row.
- `list`: `{items: string[] | {title, desc}[] | nodes[], filter?: field-id}`
- `keyvalue`: `{pairs: [{key, value}]}`
- `steps`: `{steps: [{title, desc?}], current?: number}`
- `callout`: `{content, title?, tone?: "info|success|warning|error"}`
- `code`: `{code, lang?}`
- `diff`: `{diffs: [{path, newText, oldText?}]}`
- `chart`: `{kind: "bars|line|donut", data?: [{label, value}], series?: [{label, data: [{label, value}]}], stacked?, title?}`
  - `donut` is single-series; use `data` only.
  - For grouped bars or multi-line, use `series`.
  - Keep it to 40 points and 8 series.
- `diagram`: `{kind: "flowchart|sequence|timeline|layers", title?, direction?: "TB|LR", ...}` — see the section below.

### Diagram

When you show a flow, sequence, timeline, or layered architecture, use `diagram`. It is plain JSON; do not hand-write Mermaid markup for these unless the content needs a real Mermaid engine inside a widget. Flowchart and sequence nodes are rendered through a lazy-loaded Mermaid engine; timeline and layers use the built-in renderer. Every diagram card also has a `drawio` download button.

- `flowchart`: `nodes: [{id, label, sub?, tone?: "accent|success|warning|danger|muted", shape?: "box|round|diamond"}], edges: [{from, to, label?, kind?: "solid|dashed|accent"}], direction?: "TB|LR"`
- `sequence`: `participants: [{id, label}], messages: [{from, to, label, kind?: "sync|return|async"}]`
- `timeline`: `items: [{title, desc?, time?}]`
- `layers`: `layers: [{title, items: string[]}]`

A single `diagram` node fragment (this is not a complete fence; wrap it in `{"items":[…]}` under a `dsh-view` tag):

```text
{"type":"diagram","kind":"flowchart","direction":"TB","nodes":[
  {"id":"start","label":"收到请求","tone":"accent"},
  {"id":"check","label":"缓存命中？","shape":"diamond"},
  {"id":"hit","label":"返回缓存","tone":"success"},
  {"id":"miss","label":"回源计算","tone":"warning"}
],"edges":[
  {"from":"start","to":"check"},
  {"from":"check","to":"hit","label":"是","kind":"accent"},
  {"from":"check","to":"miss","label":"否"}
]}
```

Keep a flowchart to 12 nodes / 20 edges; sequence to 8 participants / 20 messages; timeline to 12 items; layers to 8 layers.

### Media and links

- `image`: `{src, alt?, caption?}`
- `video`: `{src, poster?, aspect?: "16:9|4:3|1:1|9:16", caption?}`
- `audio`: `{src, caption?}`
- `pdf`: `{src, title?}`
- `link`: `{label, href, description?}` — `http(s)` or `mailto`; for a local file/Office document, point at the host URL or describe where to open it.

Images can be expanded to a full-screen lightbox; video/audio use the browser's native controls.

### Interactive

- `button`: `{label, action?, local?, text?, url?, tone?: "primary|danger|success|ghost", full?}`
  - `action` sends `[mosaic-action]` to the model.
  - `local` runs in the browser: `reset`, `copy` (needs `text`), `open` (needs `url`), `fullscreen`.
  - No `action` and no `local` renders a disabled control.
- `input`: `{id?, label?, placeholder?, value?, action?}` — Enter or blur sends when `action` is set; `id` makes the value available to a sibling table/list filter and to a submit-style action.
- `select`: `{options: string[], id?, label?, selected?, action?}`
- `slider`: `{min?, max?, value?, step?, id?, label?, action?}` — drag is debounced; local value updates immediately.
- `tabs`: `{tabs: [{label, items}]}`
- `quiz`: `{question, options: [{label, correct?, feedback?}], explanation?}` — local grading, no model round trip; retry is built in.

### Sandboxed widget

`widget`: `{code, height?: 80-900, title?, caption?}`

A widget is for content the fixed components cannot express: a game, a physics/math simulator, a Web Audio instrument, a map, or a custom canvas. `code` is an HTML fragment or a complete document. It runs in an iframe with:

- `sandbox="allow-scripts allow-forms allow-popups"` (opaque origin; no `allow-same-origin`)
- CSP: no network; inline scripts/styles and `data:`/`blob:` images or media only
- no access to the host page, cookies, or local storage

Inside the widget:

```js
window.mosaic.action('apply', { value: 42 })
window.mosaic.resize()
```

The parent passes theme variables as CSS custom properties: `--mosaic-bg`, `--mosaic-text`, `--mosaic-muted`, `--mosaic-border`, `--mosaic-accent`, `--mosaic-success`, `--mosaic-warn`, `--mosaic-danger`, `--mosaic-card`. Use these instead of hard-coded colors.

A visible title and a short caption make the widget easier to scan. Prefer fixed components when a table, chart, or callout expresses the content.

## Actions

A component action sends one user message:

```text
[mosaic-action] refresh。用户刚刚在界面中触发了动作 "refresh"，请根据组件数据更新回答，并用 dsh-view 输出更新后的界面。 组件数据: {...}
```

After an action, update the existing view instead of restating the whole answer. Only send an action for work that needs the model or a tool. Sorting, filtering, tabs, quiz grading, copy, and full-screen are local.

## Presentation guidance (optional)

- Use Mosaic when a component makes the answer easier to scan; prose is fine when it does not.
- Choose the smallest component that carries the structure; avoid decorative cards, repeated summaries, and nested scrolling.
- Keep the tree under 80 nodes and 6 levels.
- A malformed fence falls back to the original code block; a widget that fails to boot shows its source and an error strip.
