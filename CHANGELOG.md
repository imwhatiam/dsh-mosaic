# Changelog

> 版本规则：插件版本与**最近一次验证通过的 DeepSeek Harness 版本**保持一致。当前对齐 `0.2.1`（实测 rc.3 与 rc.5）。
> 同一 Harness 版本下的插件自身修复按补丁号递增（`0.2.1` → `0.2.2` ……）；一旦换到新的 Harness 版本验证通过，版本号立即改成该 Harness 版本。

## 0.2.1


- Prompt 注册的生命周期修正：更新或读取覆盖之后，插件卸载会撤销**当前**的 section（此前留下的是第一个）；异步读取在卸载后不再注册。
- Prompt 读取接口也做同源校验；响应不再包含 Host 绝对路径；并发保存串行化，磁盘与状态不会再分叉。
- 覆盖文件改为原子写入：同目录独占临时文件 + `fsync` + `rename` + 目录同步，权限 `0600`；失败时旧文件保持原样，临时文件清理。
- 读取覆盖时区分「文件不存在」「内容损坏」「不可读」：后两种会在设置页提示并按内置内容运行，原文件保留以便修复。
- Widget 动作三重限制：默认要求真实用户手势（`navigator.userActivation`）、每分钟最多 10 次、单次 payload 不超过 16 KB；需要自动提交时在节点上显式写 `actions: "programmatic"`。
- `SKILL.md` 的 frontmatter 描述加上引号，成为合法 YAML。
- 删除仅被测试引用的 `lib/widget.js`（与客户端沙箱文档重复且已分叉）。
- 新增诊断日志：`$DSH_HOME/logs/dsh-mosaic/<日期>.jsonl`，一行一个结构化事件（激活/停用、Prompt 生命周期、工具执行、路由、技能、浏览器侧失败），按天分文件、2 MB 滚动、保留 7 天、权限 `0600`；用户内容只记长度不记正文；`config.logLevel` 可调级别。

## 0.4.1

- Mermaid now ships as the unmodified official 12.2.0 distribution
  (`lib/assets/mermaid.min.js`, MIT) instead of a wrapper derived from another
  plugin. Rendering, theme mapping and SVG sanitizing are this package's own code.
- The lazy asset URL is versioned (`?v=…`) and answered with an immutable cache entry;
  the client asks the Host for the URL first and keeps one literal fallback.
- `THIRD_PARTY_NOTICES.md` lists every dependency bundled inside the Mermaid build with
  its license, and the license texts ship under `lib/assets/licenses/`.
- The bundle patch no longer disables another plugin: it only inserts this package's
  row.

## 0.4.0

- One visual style: the three-theme system (编辑 / 卡片 / 玻璃), its picker, tokens and
  stored keys are removed.
- The model prompt is editable again, this time properly: the settings page shows the
  effective text (the built-in prompt by default), saves an override, and restores the
  default. Precedence is user override > `config.prompt` > built-in; the override lives
  in the Host data directory, and the write route accepts same-origin JSON only.
- Visible UI copy moved to the Client locale service with `en` and `zh` dictionaries.
- Styles are tagged with this package's identity so the client module system can reclaim
  them; resources register through named effects.
- The fullscreen surface renders through a portal inside its own component instead of a
  second React root on `document.body`.
- The lazy Mermaid asset moved to the package-private `/dsh-mosaic/assets` route and
  registers on `window.__MosaicAssets__`.
- Theme values come from host tokens only; the plugin no longer guesses light/dark.
- The settings page is a localized explanation of the config key; copying a block's JSON
  moved into the block header.
