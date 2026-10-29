# dsh-mosaic

Mosaic 是一个轻量的 DeepSeek Harness 可视化回答插件。它把模型的回答从纯文本升级为**紧凑的原生 React 组件**，并保留一个受控的**沙箱 HTML/JS 逃生舱**，用来承载固定组件做不了的游戏、模拟器、音频、地图或自定义画布。

它是**默认开启**的：模型在每次实质性回答前先做格式检查，有结构、数字、对比、流程或交互就自动输出 `dsh-view`，不需要用户先要求 UI。纯问候、一句话确认和没有结构的散文仍然保持文字。

它刻意不追求“什么都能画”：

- 主包没有 ECharts / Three.js；flowchart / sequence 的 Mermaid 引擎是懒加载资产，只在出现 diagram 时下载约 3 MB。
- 每个 diagram 卡片右上角有 `drawio` 按钮，可导出标准 mxGraph XML，在 draw.io 里继续编辑。
- 组件目录保持精简，字段、校验、提示词来自同一份定义。
- 普通文件/Office 只给链接，不在聊天里硬解。
- 交互默认在本地完成；只有声明了 `action` 的组件才回模型。

## 预览

三种可选视觉方向，均来自实际 DSH Web 页面渲染：

<table>
  <tr>
    <td><img src="https://raw.githubusercontent.com/imwhatiam/dsh-mosaic/main/assets/screenshots/theme-cards.jpg" alt="卡片主题"></td>
    <td><img src="https://raw.githubusercontent.com/imwhatiam/dsh-mosaic/main/assets/screenshots/theme-editorial.jpg" alt="编辑主题"></td>
    <td><img src="https://raw.githubusercontent.com/imwhatiam/dsh-mosaic/main/assets/screenshots/theme-glass.jpg" alt="玻璃主题"></td>
  </tr>
  <tr>
    <td align="center"><sub>卡片 · 默认</sub></td>
    <td align="center"><sub>编辑</sub></td>
    <td align="center"><sub>玻璃</sub></td>
  </tr>
</table>

## 两个通道

**正文围栏**：在回答里写 `dsh-view` JSON。围栏标记必须正好是 `dsh-view`；如果模型误用 `json`，客户端在 assistant 行内有一层兼容识别，但不要依赖它。

````text
```dsh-view
{"title":"Ops snapshot","items":[
  {"type":"stat","label":"Uptime","value":"99.96%","delta":"+0.02%"},
  {"type":"callout","content":"No incidents in the last 7 days."}
]}
```
````

**工具卡片**：模型调用 `render_view`，适合独立面板、表格、图表或小组件。另有 `validate_view` 做发出前校验。

## 视觉风格

每个 Mosaic 回答右上角有「风格」按钮，可在三种视觉方向之间切换：

- **编辑**：Claude 风格，衬线标题、纸面感、无卡片边框。
- **卡片**：ChatGPT 风格，白卡片、蓝色强调、轻阴影；默认。
- **玻璃**：WorkBuddy 风格，青绿色强调、半透明表面、柔和阴影。

选择会保存在 `localStorage` 的 `dsh-mosaic.theme.v1`，对当前浏览器里的所有 Mosaic 回答生效。

## 组件

- 布局：`text` `row` `col` `grid` `card` `divider` `spacer`
- 展示：`stat` `badge` `progress` `list` `table` `keyvalue` `steps` `callout` `code` `diff` `chart` `diagram`
- 媒体：`image` `video` `audio` `pdf` `link`
- 交互：`button` `input` `select` `slider` `tabs` `quiz`
- 高级：`widget`

完整字段见 [`SKILL.md`](./SKILL.md)。

## 本地优先

表格排序/筛选/导出、tabs、quiz 判题、输入值、slider 拖动都在浏览器内完成。`button` 的 `local` 支持 `reset`、`copy`、`open`、`fullscreen`；只有 `action` 会把一条 `[mosaic-action]` 用户消息发回模型。

状态按「会话 + 槽位 + 内容指纹」写入 `localStorage`，最多保留 100 块，刷新或重开会话时恢复。

## 沙箱 widget

`widget.code` 是 HTML 片段或完整文档，渲染在：

```html
<iframe sandbox="allow-scripts allow-forms allow-popups" srcDoc="..."></iframe>
```

- 不透明源（没有 `allow-same-origin`），读不到宿主页面、cookie、storage。
- CSP：没有网络；脚本仅内联/eval/blob；图片和媒体只允许 `data:`/`blob:`。
- 宿主校验 `event.source` 和每次挂载的 nonce。
- 主题通过 `--mosaic-*` CSS 变量注入；widget 用 `window.mosaic.action(name, payload)` 回传动作，用 `window.mosaic.resize()` 主动报高度。
- 外部 CDN 脚本会被 CSP 拦掉；需要库时把代码内联进 widget。

## 安装

在 DSH Plugin Manager 中安装本插件，或使用命令行：

```bash
# 发布到 npm 后（普通 dsh web profile）
dsh plugin --profile web add dsh-mosaic

# 本地开发目录
dsh plugin --profile desktop add link:/absolute/path/to/dsh-mosaic
```

安装后重启或刷新 DSH Web，新会话即可使用。插件会通过 bundle patch 关闭旧的 `dsh-genui` 行，避免两套围栏语言同时出现；想并存就把 `cordis.patch.yml` 里的 `- id: genui` 删掉。

## 限制

- 80 节点、6 层嵌套、表格 40×8、图表 40 点、diagram 12 节点/20 边、widget 代码 20k。
- 不读本地文件、不渲染 docx/pptx/xlsx；这些用 `link` 卡片交给宿主打开。
- 不内置数学公式排版；公式可以放在 `code` 或普通文本里。
- 围栏渲染依赖 DSH 当前的代码块 DOM；宿主结构变化时可能需要适配。

## 开发

```bash
node --test test/*.test.mjs
node --check lib/index.js
node --check lib/client.js
```

## License

MIT