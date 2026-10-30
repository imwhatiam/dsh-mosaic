# dsh-mosaic

Mosaic 是一个轻量的 DeepSeek Harness 可视化回答插件。它把模型的回答从纯文本升级为**紧凑的原生 React 组件**，并保留一个受控的**沙箱 HTML/JS 逃生舱**，用来承载固定组件做不了的游戏、模拟器、音频、地图或自定义画布。

它是**可选增强**，不强制每个回答都带 UI：当指标、对比、流程或交互用组件更容易扫读时，模型可以输出 `dsh-view`；纯文字回答同样有效，不需要为了“用插件”而加组件。

它刻意不追求“什么都能画”：

- 主包没有 ECharts / Three.js；flowchart / sequence 用官方 Mermaid 发行包，作为懒加载资产，只在出现 diagram 时下载（原始 5.5 MB，gzip 后约 1.3 MB，带版本号可长期缓存）。
- 每个 diagram 卡片右上角有 `drawio` 按钮，可导出标准 mxGraph XML，在 draw.io 里继续编辑。
- 组件目录保持精简，字段、校验、提示词来自同一份定义。
- 普通文件/Office 只给链接，不在聊天里硬解。
- 交互默认在本地完成；只有声明了 `action` 的组件才回模型。

## 预览

实际 DSH Web 页面渲染：

![Mosaic 预览](https://raw.githubusercontent.com/imwhatiam/dsh-mosaic/main/assets/screenshots/preview.jpg)

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

## 一套视觉风格 + 可覆盖的模型 Prompt

界面只有一套轻卡片风格，颜色全部取自主题令牌（`--dsw-alias-*`），因此自动跟随 DSH 的浅色/深色与字号，不再有主题切换器。

插件向模型贡献一段说明可视化能力的 Prompt，默认是包内文本。

**Settings → Mosaic** 就是这段文本的编辑页：打开即显示当前生效的内容（默认就是内置文案），可以直接改、点「保存」，随时点「恢复默认」回到插件自带文案。保存后从下一轮模型请求开始生效，所有浏览器看到的是同一份，重启也在。

生效顺序是「你保存的覆盖 > 配置文件里的 `config.prompt` > 内置文本」。想在 profile 里批量固定一份基线，仍然可以在 `cordis.patch.yml` 给 mosaic 行加 `config.prompt`；留空、类型不对或超过 128 KB 会回落。

覆盖内容存在 Host 数据目录的 `mosaic/prompt.json`，不进 profile 的组合文件，所以升级、换浏览器都不丢。写入是原子的（临时文件 + fsync + rename，权限 `0600`），失败时旧内容保持原样；写不进去时页面会明确提示「本次仅在进程内生效」。文件如果损坏或读不出来，页面同样会提示，并按内置内容运行、保留原文件供你修复。

读写接口都只接受**同源**请求（核对浏览器的 `Sec-Fetch-Site` 与 `Origin`），写请求还要求 `content-type: application/json`；响应里不带 Host 的绝对路径。跨站页面既读不到也改不了这段文本。渲染出的卡片右上角另有「复制 JSON」，用于取回该块的围栏文本。

## 组件

- 布局：`text` `row` `col` `grid` `card` `divider` `spacer`
- 展示：`stat` `badge` `progress` `list` `table` `keyvalue` `steps` `callout` `code` `diff` `chart` `diagram`
- 媒体：`image` `video` `audio` `pdf` `link`
- 交互：`button` `input` `select` `slider` `tabs` `quiz`
- 高级：`widget`

`diff` 带行号和 `-`/`+` gutter，长行自动换行。

完整字段见 [`SKILL.md`](./SKILL.md)。

## 日志

插件会把自己的运行情况写进一个 JSONL 文件，出问题时优先看它：

```
$DSH_HOME/logs/dsh-mosaic/YYYY-MM-DD.jsonl   # 未设置 DSH_HOME 时是 ~/.dsh/logs/dsh-mosaic/
```

- 一行一个 JSON 对象，字段固定：`ts`、`level`（debug/info/warn/error）、`event`，其余按事件附带（如 `tool`、`ms`、`status`、`route`、`source`、`reason`）。
- 记录什么：激活/停用、Prompt 的读取与保存（来源、字符数、是否落盘）、工具执行（名称、结果状态、耗时）、路由请求（方法、状态码、耗时）、技能被读取、以及浏览器侧上报的失败（`client.` 前缀：围栏解析失败、Mermaid 失败、Prompt 读写失败、Widget 动作被限流/超限丢弃）。
- 不记录什么：Prompt 正文、组件 JSON、任何文本字段的内容。字段名为 `prompt`/`text`/`code`/`content`/`secret`/`token`/`password`/`apiKey` 时只写字符数；其它字符串超过 300 字符会被截断。
- 体积：单文件超过 2 MB 滚动为 `<日期>.1.jsonl`；超过 7 天的文件在下次启动时删除；文件权限 `0600`。写不进去时不会影响插件，只在宿主日志里告警一次。
- 浏览器侧的失败通过同源 `POST /dsh-mosaic/log` 上报（请求体上限 4 KB，跨站 403，客户端每分钟最多 20 条）。
- 默认级别 `info`；想要更细可以给 mosaic 行加 `config.logLevel: debug`（或 `warn` 减少噪音）。

排查示例：

```bash
# 只看错误
grep -h '"level":"error"' "$DSH_HOME"/logs/dsh-mosaic/*.jsonl
# 看最近一次激活和 Prompt 来源
grep -h '"event":"plugin.activate"\|"event":"prompt.hydrate"' "$DSH_HOME"/logs/dsh-mosaic/*.jsonl | tail -5
# 统计工具失败次数
grep -c '"event":"tool.failed"' "$DSH_HOME"/logs/dsh-mosaic/*.jsonl
```

## 已知边界

- 版本号跟随「最近一次验证通过的 DeepSeek Harness 版本」：当前是 `0.2.1`（实测 rc.3、rc.5）。同一 Harness 版本下的插件修复递增补丁号；换到新 Harness 版本验证后再把版本号对齐过去。
- 围栏渲染靠扫描页面里的代码块实现：0.2.1 全系列（实测 rc.3 与 rc.5，master 同样）都没有给插件开放「渲染 fenced code block」的扩展点。工具通道 `render_view` + `tool.call.toolview` 是原生做法，围栏是它的补充。
- 从 0.2.1 起代码块由 Shiki 渲染，`<code>` 上**没有** `language-*` 类；识别靠「代码块位于 assistant 行内 + 正文能解析成合法视图 spec」这条路径，用户消息、工具结果、推理块里的代码块都被排除。
- `widget` 里调用 `window.mosaic.action()` 只有**真实用户手势**之后才会把动作发回模型（用浏览器的 `navigator.userActivation` 判断，Widget 自己伪造不了）；确实需要自行提交的 Widget 要在节点上写 `actions: "programmatic"`，并且仍受「每分钟 10 次、单次 16 KB」的限制。
- `widget` 是 iframe，拿不到宿主的 `ctx.locale`，因此内部文案由调用方自己写；主题靠宿主令牌值传入。围栏是独立的 React root，切换外观不会触发它重渲染，所以 widget 会观察 `body[data-ds-dark-theme]` 这一个外观属性并在变化时重发令牌——这是插件唯一读取的宿主属性。
- Mermaid 资产走包内私有路由 `/dsh-mosaic/assets`；没有 Web 服务时 diagram 回落到内置 SVG 布局。
- bundle patch 只插入 Mosaic 自己这一行，不改动任何其他插件。若你还装了别的围栏类插件，两者可以对同一段围栏各显一套，按需在 profile 里关掉其中一个即可。
- 持久化只用「Host 数据目录里的一个 JSON 文件」，没有走 DSH 的 storageDomain。实测（rc.5）：`storageDomain` 可用，但记录校验只在**重新打开**时执行（`put` 不校验）；`single` 布局遇到版本变化会直接拒绝打开，`compatibleVersions` 也不适用。对一份 Prompt 来说这些能力换不来收益，反而多一个依赖和三条失败分支。
- Prompt 编辑页是对平台形态的**补充，不是平台标准做法**。DSH 把 Prompt 视为 composition 配置（system-prompt 的 README 明确写着没有终端用户编辑 Prompt 的 API），标准平面是 `Config` + `cordis.patch.yml`，客户端改值应走 `@Remote`，插件自有数据应走存储服务。这里为了「只装一个包、不引入 peer 依赖」，写入用了自建的同源校验路由、持久化用了自建的 `mosaic/prompt.json`。将来宿主提供多行配置表单或标准 Remote 时，这块应当迁移过去。

## 本地优先

表格排序/筛选/导出、tabs、quiz 判题、输入值、slider 拖动都在浏览器内完成。`button` 的 `local` 支持 `reset`、`copy`、`open`、`fullscreen`；只有 `action` 会把一条 `[mosaic-action]` 用户消息发回模型。

状态按「会话 + 槽位 + 内容指纹」写入 `localStorage`，最多保留 100 块，刷新或重开会话时恢复。界面文案（按钮、提示、诊断）走 DSH 的 Client locale 服务，内置 `en` 与 `zh` 两套。

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

安装后重启或刷新 DSH Web，新会话即可使用。bundle patch 只插入本插件一行，不会关闭或覆盖别人的插件。

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