window.__ModuleLoader__.load({
  id: 'dsh-mosaic',
  factory(require) {
    const React = require('react')
    const ReactDOMClient = require('react-dom/client')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const {
      useState, useEffect, useMemo, useRef, useCallback, createContext, useContext, Fragment,
    } = React

    const PLUGIN_ID = 'dsh-mosaic'
    const STYLE_CSS_ID = 'dsh-mosaic/client.css'
    const STORE_KEY = 'mosaic.state.v1'
    const MAX_STORED = 100
    // Client diagnostics are forwarded to the Host log; failures are what matter here,
    // so the reporter is best-effort, capped, and never throws.
    const LOG_URL = '/dsh-mosaic/log'
    const LOG_REPORTS_PER_WINDOW = 20
    const LOG_WINDOW_MS = 60000
    let logWindow = []

    function reportLog(level, event, detail) {
      try {
        const now = Date.now()
        logWindow = logWindow.filter((at) => now - at < LOG_WINDOW_MS)
        if (logWindow.length >= LOG_REPORTS_PER_WINDOW) return
        logWindow.push(now)
        fetch(LOG_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level, event, detail: detail ?? {} }),
        }).catch(() => {})
      } catch {
        // Diagnostics must never affect rendering.
      }
    }
    const MAX_NODES = 80
    const MAX_DEPTH = 6

    // Visible copy belongs to the Client locale service: both shipped locales are
    // registered as one namespace and every component reads it through `t`.
    const NS = 'mosaic'
    const dictionaries = {
      zh: {
        copy: '复制',
        copied: '已复制',
        copyMarkdown: '复制 Markdown',
        copyCsv: '复制 CSV',
        total: '合计',
        grandTotal: '总计',
        added: '（新增）',
        openPdf: '打开 PDF 原文件',
        selectPlaceholder: '请选择…',
        answered: '已作答',
        answerCorrect: '回答正确',
        answerWrong: '回答不正确',
        tryAgain: '再试一次',
        code: '代码',
        preview: '预览',
        reload: '重载',
        fullscreen: '全屏',
        close: '关闭',
        drawio: '下载 draw.io 文件',
        mermaidFallback: 'Mermaid 渲染失败，已使用内置布局：{message}',
        parseFailed: 'dsh-view 解析失败：{detail}（已保留代码块）',
        actionNotice: '用户刚刚在界面中触发了动作 "{action}"，请根据组件数据更新回答，并用 dsh-view 输出更新后的界面。组件数据:',
        settingsTitle: 'Mosaic',
        promptDesc: '插件会向模型贡献一段说明可视化能力的 Prompt。默认使用内置内容；你可以改成自己的写法，也可以随时恢复默认。',
        promptLabel: 'Prompt 内容',
        promptHint: '只影响能力说明，不规定回答内容；保存后从下一轮模型请求开始生效。',
        promptSave: '保存',
        promptSaving: '保存中…',
        promptReset: '恢复默认',
        promptSaved: '已保存。',
        promptResetDone: '已恢复插件内置内容。',
        promptDirty: '有未保存的修改',
        promptChars: '{count} / {limit} 字符',
        promptSourceUser: '已自定义',
        promptSourceConfig: '来自配置文件',
        promptSourceBuiltin: '内置默认',
        promptLoadFailed: '读取失败：{reason}',
        promptSaveFailed: '保存失败：{reason}',
        promptMemoryOnly: '未能写入 Host 数据目录，本次仅在进程内生效。',
        promptReadCorrupt: '保存的内容无法解析，已按内置内容运行；原文件已保留，可手工修复。',
        promptReadUnreadable: '保存的内容读取失败（权限或路径问题），已按内置内容运行。',
        copyJson: '复制 JSON',
      },
      en: {
        copy: 'Copy',
        copied: 'Copied',
        copyMarkdown: 'Copy Markdown',
        copyCsv: 'Copy CSV',
        total: 'Total',
        grandTotal: 'Total',
        added: '(added)',
        openPdf: 'Open the original PDF',
        selectPlaceholder: 'Select…',
        answered: 'Answered',
        answerCorrect: 'Correct',
        answerWrong: 'Not correct',
        tryAgain: 'Try again',
        code: 'Code',
        preview: 'Preview',
        reload: 'Reload',
        fullscreen: 'Fullscreen',
        close: 'Close',
        drawio: 'Download a draw.io file',
        mermaidFallback: 'Mermaid rendering failed; the built-in layout was used: {message}',
        parseFailed: 'dsh-view could not be parsed: {detail} (the code block is kept)',
        actionNotice: 'The user just triggered the action "{action}" in the interface above. Update the answer from its data and reply with an updated dsh-view fence. Data:',
        settingsTitle: 'Mosaic',
        promptDesc: "This plugin contributes a prompt that explains its visualization to the model. The built-in text is used by default; you can replace it with your own wording and restore the default later.",
        promptLabel: 'Prompt',
        promptHint: 'This only shapes capability guidance, never the answer; a saved change applies from the next model request.',
        promptSave: 'Save',
        promptSaving: 'Saving…',
        promptReset: 'Restore default',
        promptSaved: 'Saved.',
        promptResetDone: 'Restored the built-in prompt.',
        promptDirty: 'Unsaved changes',
        promptChars: '{count} / {limit} characters',
        promptSourceUser: 'Customized',
        promptSourceConfig: 'From the config file',
        promptSourceBuiltin: 'Built-in default',
        promptLoadFailed: 'Could not read the prompt: {reason}',
        promptSaveFailed: 'Could not save: {reason}',
        promptMemoryOnly: 'Could not write the Host data directory, so this change only lives in this process.',
        promptReadCorrupt: 'The saved override is not valid JSON, so the built-in text is used. The file was kept for manual repair.',
        promptReadUnreadable: 'The saved override could not be read (permissions or path), so the built-in text is used.', 
        copyJson: 'Copy JSON',
      },
    }

    // Safe before the dictionary registers; keys never disappear.
    let translate = (key, vars) => {
      let text = dictionaries.zh[key] ?? key
      if (vars) for (const name of Object.keys(vars)) text = text.replace(`{${name}}`, String(vars[name]))
      return text
    }

    function clearLegacyStorage() {
      try {
        localStorage.removeItem('dsh-mosaic.theme.v1')
        localStorage.removeItem('mosaic.theme.v1')
        localStorage.removeItem('dsh-mosaic.prompt.v1')
      } catch {}
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                             */
    /* ------------------------------------------------------------------ */

    const CSS = `
.mosaic-fence{margin:16px 0;min-width:0}
.mosaic-root,.mosaic-overlay{
  --m-bg:var(--dsw-alias-bg-layer-1);
  --m-bg2:var(--dsw-alias-bg-layer-2);
  --m-text:var(--dsw-alias-label-primary);
  --m-muted:var(--dsw-alias-label-secondary);
  --m-border:var(--dsw-alias-border-l1);
  --m-accent:var(--dsw-alias-brand-primary);
  --m-success:var(--dsw-alias-state-success-primary);
  --m-warn:var(--dsw-alias-state-warn-primary);
  --m-danger:var(--dsw-alias-state-error-primary);
  --m-series-1:#4f6bed;
  --m-series-2:#1f9d8b;
  --m-series-3:#d99a2b;
  --m-series-4:#d35d5d;
  --m-series-5:#8a63d2;
  --m-radius:12px;
  --m-card-bg:var(--m-bg);
  --m-card-border:var(--m-border);
  --m-card-shadow:0 1px 2px rgba(15,23,42,.04);
  --m-card-padding:16px 18px;
  color:var(--m-text);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  font-size:14px;
  line-height:1.55;
  min-width:0;
}
.mosaic-root *,.mosaic-root *::before,.mosaic-root *::after{box-sizing:border-box}
.mosaic-root a{color:var(--m-accent)}
.mosaic-banner{font-size:12px;font-weight:600;color:var(--m-muted);letter-spacing:.02em;margin:0 0 8px}
.mosaic-head{display:flex;align-items:flex-start;gap:8px;margin:0 0 8px;position:relative}
.mosaic-head .mosaic-banner{flex:1;min-width:0;margin:0}
.mosaic-settings{flex-direction:column;gap:14px;width:100%;display:flex}
.mosaic-settings-desc{color:var(--dsw-alias-label-secondary);margin:0;font-size:14px;line-height:22px}
.mosaic-prompt-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.mosaic-prompt-label{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
.mosaic-prompt-meta{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.mosaic-prompt-field{box-sizing:border-box;width:100%;min-height:240px;resize:vertical;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:10px 12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.7;tab-size:2}
.mosaic-prompt-field:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.mosaic-prompt-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mosaic-prompt-hint{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;flex:1;min-width:220px}
.mosaic-prompt-reset,.mosaic-prompt-save{border-radius:var(--dsw-radius-md,8px);height:32px;padding:0 12px;font:inherit;font-size:13px;line-height:18px;cursor:pointer;flex:none}
.mosaic-prompt-reset{border:.5px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary)}
.mosaic-prompt-reset:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}
.mosaic-prompt-save{border:0;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)}
.mosaic-prompt-save:hover:enabled{opacity:.88}
.mosaic-prompt-reset:disabled,.mosaic-prompt-save:disabled{opacity:.45;cursor:not-allowed}
.mosaic-prompt-reset:focus-visible,.mosaic-prompt-save:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.mosaic-prompt-warn{color:var(--dsw-alias-state-warn-primary);margin:0;font-size:12px;line-height:18px}
.mosaic-prompt-notice{margin:0;font-size:12px;line-height:18px}
.mosaic-prompt-notice.is-ok{color:var(--dsw-alias-state-success-primary)}
.mosaic-prompt-notice.is-error{color:var(--dsw-alias-state-error-primary)}
.mosaic-json-copy{box-sizing:border-box;border:0;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;height:28px;color:var(--dsw-alias-label-secondary);background:transparent;flex:none;margin-left:auto;padding:0 8px;font-family:inherit;font-size:12px;line-height:18px;display:inline-flex;align-items:center}
.mosaic-json-copy:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.mosaic-json-copy:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.mosaic-col{display:flex;flex-direction:column;min-width:0}
.mosaic-row{display:flex;gap:12px;min-width:0;align-items:stretch}
.mosaic-row-wrap{flex-wrap:wrap}
.mosaic-grid{display:grid;gap:12px;min-width:0}
.mosaic-grid-item{min-width:0}
.mosaic-card{background:var(--m-card-bg);border:1px solid var(--m-card-border);border-radius:var(--m-radius);padding:var(--m-card-padding);min-width:0;box-shadow:var(--m-card-shadow)}
.mosaic-card-flat{box-shadow:none;background:var(--m-bg2)}
.mosaic-card-info{background:color-mix(in srgb,var(--m-accent) 8%,var(--m-bg));border-color:color-mix(in srgb,var(--m-accent) 26%,var(--m-border))}
.mosaic-card-success{background:color-mix(in srgb,var(--m-success) 8%,var(--m-bg));border-color:color-mix(in srgb,var(--m-success) 26%,var(--m-border))}
.mosaic-card-warning{background:color-mix(in srgb,var(--m-warn) 9%,var(--m-bg));border-color:color-mix(in srgb,var(--m-warn) 28%,var(--m-border))}
.mosaic-card-danger{background:color-mix(in srgb,var(--m-danger) 8%,var(--m-bg));border-color:color-mix(in srgb,var(--m-danger) 26%,var(--m-border))}
.mosaic-eyebrow{font-size:10.5px;font-weight:650;letter-spacing:.08em;text-transform:uppercase;color:var(--m-muted);margin:0 0 3px}
.mosaic-card-title{font-size:15px;font-weight:650;line-height:1.3;margin:0 0 10px}
.mosaic-text{white-space:pre-wrap;overflow-wrap:anywhere;margin:0}
.mosaic-display{font-size:30px;line-height:1.18;font-weight:650;letter-spacing:-.022em}
.mosaic-h1{font-size:24px;line-height:1.2;font-weight:650;letter-spacing:-.015em}
.mosaic-h2{font-size:19px;line-height:1.25;font-weight:650;letter-spacing:-.01em}
.mosaic-h3{font-size:16px;line-height:1.3;font-weight:650}
.mosaic-muted{color:var(--m-muted)}
.mosaic-caption{font-size:12px;color:var(--m-muted)}
.mosaic-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mosaic-tone-danger{color:var(--m-danger)}
.mosaic-tone-success{color:var(--m-success)}
.mosaic-tone-warning{color:var(--m-warn)}
.mosaic-tone-info{color:var(--m-accent)}
.mosaic-tone-muted{color:var(--m-muted)}
.mosaic-center{text-align:center}
.mosaic-right{text-align:right}
.mosaic-divider{display:flex;align-items:center;gap:10px;color:var(--m-muted);font-size:11px;margin:4px 0}
.mosaic-divider::before,.mosaic-divider::after{content:"";flex:1;height:1px;background:var(--m-border)}
.mosaic-spacer{height:8px}
.mosaic-stat{display:flex;flex-direction:column;gap:4px;min-width:0}
.mosaic-stat-label{font-size:12px;color:var(--m-muted);line-height:1.35}
.mosaic-stat-value{font-size:26px;line-height:1.15;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.mosaic-stat-foot{display:flex;align-items:center;gap:8px;min-width:0}
.mosaic-delta{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums}
.mosaic-delta-pos{color:var(--m-success)}
.mosaic-delta-neg{color:var(--m-danger)}
.mosaic-delta-flat{color:var(--m-muted)}
.mosaic-spark{width:84px;height:22px;flex:none;margin-left:4px}
.mosaic-badge{display:inline-flex;align-items:center;align-self:flex-start;gap:4px;max-width:100%;padding:2px 7px;border-radius:999px;font-size:11.5px;line-height:1.5;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mosaic-badge-success{background:color-mix(in srgb,var(--m-success) 14%,transparent);color:var(--m-success)}
.mosaic-badge-warn{background:color-mix(in srgb,var(--m-warn) 16%,transparent);color:var(--m-warn)}
.mosaic-badge-danger{background:color-mix(in srgb,var(--m-danger) 14%,transparent);color:var(--m-danger)}
.mosaic-badge-accent{background:color-mix(in srgb,var(--m-accent) 14%,transparent);color:var(--m-accent)}
.mosaic-progress{display:flex;flex-direction:column;gap:6px;min-width:0}
.mosaic-progress-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;color:var(--m-muted)}
.mosaic-progress-head b{color:var(--m-text);font-size:13px;font-variant-numeric:tabular-nums}
.mosaic-track{position:relative;height:7px;border-radius:999px;background:var(--m-bg2);overflow:hidden}
.mosaic-fill{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:var(--m-series-1)}
.mosaic-target{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--m-text);opacity:.55}
.mosaic-ring{display:flex;align-items:center;gap:12px}
.mosaic-ring svg{width:64px;height:64px;flex:none}
.mosaic-table-wrap{overflow-x:auto;border:1px solid var(--m-card-border);border-radius:var(--m-radius);background:var(--m-card-bg);box-shadow:var(--m-card-shadow)}
.mosaic-table{width:100%;border-collapse:collapse;font-size:12.5px;min-width:0}
.mosaic-table th,.mosaic-table td{padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid var(--m-border);overflow-wrap:anywhere}
.mosaic-table tr:last-child td{border-bottom:0}
.mosaic-table tbody tr:hover td{background:color-mix(in srgb,var(--m-accent) 3%,var(--m-bg))}
.mosaic-table th{position:sticky;top:0;background:var(--m-bg2);z-index:1;font-size:11.5px;font-weight:650;color:var(--m-muted);letter-spacing:.02em;white-space:nowrap}
/* From four columns on, auto layout lets the longest cell decide the width and the
   card starts scrolling sideways; equal shares keep every column readable instead. */
.mosaic-table-dense{table-layout:fixed}
.mosaic-table-dense th{white-space:normal}
.mosaic-table-dense td.num{white-space:normal}
.mosaic-table th button{all:unset;cursor:pointer;display:inline-flex;gap:4px;align-items:center;color:inherit;font:inherit}
.mosaic-table th button:focus-visible{outline:2px solid var(--m-accent);outline-offset:2px;border-radius:4px}
.mosaic-table td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.mosaic-table td.delta-pos{color:var(--m-success)}
.mosaic-table td.delta-neg{color:var(--m-danger)}
.mosaic-table tr.total td{font-weight:650;background:var(--m-bg2)}
.mosaic-table-tools{display:flex;justify-content:flex-end;gap:6px;margin:0 0 6px}
.mosaic-table-tools button,.mosaic-copy{all:unset;cursor:pointer;font-size:11px;color:var(--m-muted);border:1px solid var(--m-border);border-radius:6px;padding:2px 7px}
.mosaic-table-tools button:hover,.mosaic-copy:hover{color:var(--m-text);border-color:var(--m-muted)}
.mosaic-cell-bar{display:block;height:5px;border-radius:999px;background:var(--m-bg2);overflow:hidden;min-width:56px}
.mosaic-cell-bar span{display:block;height:100%;border-radius:inherit;background:var(--m-series-1)}
.mosaic-list{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none}
.mosaic-list-item{display:flex;gap:8px;align-items:flex-start;min-width:0}
.mosaic-list-dot{width:5px;height:5px;border-radius:50%;background:var(--m-accent);margin-top:8px;flex:none}
.mosaic-list-title{font-weight:550}
.mosaic-list-desc{color:var(--m-muted);font-size:12.5px}
.mosaic-kv{display:grid;grid-template-columns:minmax(90px,auto) 1fr;gap:6px 16px;font-size:13px}
.mosaic-kv-key{color:var(--m-muted)}
.mosaic-kv-value{min-width:0;overflow-wrap:anywhere}
.mosaic-steps{display:flex;flex-direction:column;gap:10px;margin:0;padding:0;list-style:none}
.mosaic-step{display:flex;gap:10px;min-width:0}
.mosaic-step-index{width:22px;height:22px;border-radius:50%;border:1px solid var(--m-border);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:650;flex:none;color:var(--m-muted)}
.mosaic-step-active .mosaic-step-index{background:var(--m-accent);border-color:var(--m-accent);color:#fff}
.mosaic-step-title{font-weight:600;line-height:1.35}
.mosaic-step-desc{color:var(--m-muted);font-size:12.5px;margin-top:2px}
.mosaic-callout{position:relative;border:1px solid color-mix(in srgb,var(--m-accent) 22%,var(--m-border));background:color-mix(in srgb,var(--m-accent) 5%,var(--m-bg));border-radius:calc(var(--m-radius) - 2px);padding:11px 13px}
.mosaic-callout-success{border-color:color-mix(in srgb,var(--m-success) 24%,var(--m-border));background:color-mix(in srgb,var(--m-success) 6%,var(--m-bg))}
.mosaic-callout-warning{border-color:color-mix(in srgb,var(--m-warn) 24%,var(--m-border));background:color-mix(in srgb,var(--m-warn) 7%,var(--m-bg))}
.mosaic-callout-error{border-color:color-mix(in srgb,var(--m-danger) 24%,var(--m-border));background:color-mix(in srgb,var(--m-danger) 6%,var(--m-bg))}
.mosaic-callout-title{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--m-accent);margin-bottom:4px}
.mosaic-callout-title::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.mosaic-callout-success .mosaic-callout-title{color:var(--m-success)}
.mosaic-callout-warning .mosaic-callout-title{color:var(--m-warn)}
.mosaic-callout-error .mosaic-callout-title{color:var(--m-danger)}
.mosaic-code{position:relative;background:var(--m-bg2);border:1px solid var(--m-border);border-radius:10px;padding:10px 12px;overflow:auto;font-size:12px;line-height:1.55}
.mosaic-code pre{margin:0;white-space:pre;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mosaic-code .mosaic-copy{position:absolute;top:6px;right:6px;background:var(--m-bg)}
.mosaic-inline-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;background:var(--m-bg2);border:1px solid var(--m-border);border-radius:4px;padding:0 3px}
.mosaic-diff{display:flex;flex-direction:column;gap:8px}
.mosaic-diff-file{font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--m-muted)}
.mosaic-diff-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mosaic-diff-side{border:1px solid var(--m-border);border-radius:8px;padding:0;overflow:auto;font-size:12px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.mosaic-diff-line{display:grid;grid-template-columns:14px 30px minmax(0,1fr);gap:4px;padding:1px 8px;min-height:18px}
.mosaic-diff-gutter{color:var(--m-muted);text-align:center;user-select:none}
.mosaic-diff-num{color:var(--m-muted);text-align:right;user-select:none;font-variant-numeric:tabular-nums}
.mosaic-diff-text{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.mosaic-diff-old{background:color-mix(in srgb,var(--m-danger) 7%,var(--m-bg))}
.mosaic-diff-new{background:color-mix(in srgb,var(--m-success) 7%,var(--m-bg))}
.mosaic-chart{width:100%;height:auto;display:block;overflow:visible}
.mosaic-chart text{font-size:10px;fill:var(--m-muted)}
.mosaic-chart .mosaic-chart-title{font-size:12px;font-weight:600;fill:var(--m-text)}
.mosaic-chart .mosaic-axis{stroke:var(--m-border);stroke-width:1}
.mosaic-chart .mosaic-axis-label{font-size:9px;fill:var(--m-muted);font-variant-numeric:tabular-nums}
.mosaic-chart .mosaic-grid-line{stroke:var(--m-border);stroke-width:1;opacity:.45}
.mosaic-chart .mosaic-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.mosaic-chart .mosaic-dot{stroke:var(--m-bg);stroke-width:1.5}
.mosaic-chart .mosaic-bar{shape-rendering:geometricPrecision}
.mosaic-chart .mosaic-donut-label{font-size:11px;fill:var(--m-text)}
.mosaic-diagram-wrap{max-width:100%;max-height:560px;overflow:auto;padding-bottom:2px}
.mosaic-diagram{display:block;width:auto;max-width:none;height:auto;margin:0 auto;overflow:visible}
.mosaic-mermaid{max-width:100%;max-height:560px;overflow:auto;padding:2px 0}
.mosaic-mermaid svg{display:block;max-width:100%;height:auto;margin:0 auto}
.mosaic-mermaid .labelBkg{background:var(--m-bg)!important;color:var(--m-text)!important;padding:0 3px;border-radius:3px}
.mosaic-mermaid .edgeLabel{color:var(--m-text)!important}
.mosaic-diagram-head{display:flex;align-items:center;gap:8px;margin:0 0 6px}
.mosaic-diagram-export{margin-left:auto;border:1px solid var(--m-border);background:var(--m-bg);color:var(--m-muted);font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 7px;border-radius:5px;cursor:pointer}
.mosaic-diagram-export:hover{color:var(--m-text);border-color:var(--m-accent)}
.mosaic-diagram .diagram-node{stroke-width:1.2}
.mosaic-diagram .diagram-node-label{font-size:12px;font-weight:600;fill:var(--m-text)}
.mosaic-diagram .diagram-node-sub{font-size:10px;fill:var(--m-muted)}
.mosaic-diagram .diagram-edge{fill:none;stroke:var(--m-muted);stroke-width:1.4}
.mosaic-diagram .diagram-edge-accent{stroke:var(--m-accent);stroke-width:1.8}
.mosaic-diagram .diagram-edge-dashed{stroke-dasharray:5 4}
.mosaic-diagram .diagram-edge-label{font-size:10px;fill:var(--m-muted);paint-order:stroke;stroke:var(--m-bg);stroke-width:3;stroke-linejoin:round}
.mosaic-diagram .diagram-lifeline{stroke:var(--m-border);stroke-width:1;stroke-dasharray:3 4}
.mosaic-diagram .diagram-participant{fill:var(--m-bg2);stroke:var(--m-border);stroke-width:1}
.mosaic-diagram .diagram-participant-label{font-size:11px;font-weight:600;fill:var(--m-text)}
.mosaic-diagram .diagram-message{stroke:var(--m-text);stroke-width:1.2;fill:none}
.mosaic-diagram .diagram-message-return{stroke:var(--m-muted);stroke-dasharray:4 3}
.mosaic-diagram .diagram-message-async{stroke:var(--m-accent);stroke-dasharray:2 3}
.mosaic-diagram .diagram-msg-label{font-size:10.5px;fill:var(--m-text);paint-order:stroke;stroke:var(--m-bg);stroke-width:3;stroke-linejoin:round}
.mosaic-timeline{list-style:none;margin:0;padding:0 0 0 14px;position:relative;display:flex;flex-direction:column;gap:14px}
.mosaic-timeline::before{content:"";position:absolute;left:4px;top:4px;bottom:4px;width:1px;background:var(--m-border)}
.mosaic-timeline-item{position:relative;padding-left:12px;min-width:0}
.mosaic-timeline-dot{position:absolute;left:-13px;top:5px;width:7px;height:7px;border-radius:50%;background:var(--m-accent);box-shadow:0 0 0 3px var(--m-bg)}
.mosaic-timeline-time{font-size:10.5px;color:var(--m-muted);margin-bottom:2px}
.mosaic-timeline-title{font-weight:600;line-height:1.35}
.mosaic-timeline-desc{font-size:12.5px;color:var(--m-muted);margin-top:2px}
.mosaic-layers{display:flex;flex-direction:column;gap:7px}
.mosaic-layer{border:1px solid var(--m-border);border-radius:9px;background:var(--m-bg);padding:8px 10px}
.mosaic-layer-title{font-size:12px;font-weight:650;color:var(--m-text);margin-bottom:3px}
.mosaic-layer-items{margin:0;padding-left:16px;color:var(--m-muted);font-size:12.5px;line-height:1.5}
.mosaic-caption-line{font-size:12px;color:var(--m-muted);margin-top:5px}
.mosaic-media{display:flex;flex-direction:column;gap:5px;min-width:0}
.mosaic-image{display:block;max-width:100%;max-height:520px;border-radius:10px;border:1px solid var(--m-border);cursor:zoom-in;object-fit:contain;background:var(--m-bg2)}
.mosaic-video{display:block;width:100%;border-radius:10px;background:#000;border:1px solid var(--m-border)}
.mosaic-audio{display:block;width:100%}
.mosaic-pdf{display:block;width:100%;height:480px;border:1px solid var(--m-border);border-radius:10px;background:var(--m-bg)}
.mosaic-link{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--m-border);border-radius:10px;text-decoration:none;color:var(--m-text);background:var(--m-bg)}
.mosaic-link:hover{border-color:var(--m-accent)}
.mosaic-link-icon{width:28px;height:28px;border-radius:7px;background:var(--m-bg2);display:flex;align-items:center;justify-content:center;color:var(--m-accent);flex:none;font-size:14px}
.mosaic-link-label{font-weight:600;overflow-wrap:anywhere}
.mosaic-link-desc{font-size:12px;color:var(--m-muted);margin-top:2px;overflow-wrap:anywhere}
.mosaic-button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 13px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-bg);color:var(--m-text);font:inherit;font-size:13px;font-weight:550;cursor:pointer}
.mosaic-button:hover{border-color:var(--m-muted)}
.mosaic-button:focus-visible{outline:2px solid var(--m-accent);outline-offset:2px}
.mosaic-button:disabled,.mosaic-button[aria-disabled="true"]{opacity:.5;cursor:not-allowed}
.mosaic-button-primary{background:var(--m-accent);border-color:var(--m-accent);color:#fff}
.mosaic-button-primary:hover{filter:brightness(.95);border-color:var(--m-accent)}
.mosaic-button-danger{background:var(--m-danger);border-color:var(--m-danger);color:#fff}
.mosaic-button-success{background:var(--m-success);border-color:var(--m-success);color:#fff}
.mosaic-button-ghost{background:transparent}
.mosaic-button-full{width:100%}
.mosaic-form{display:flex;flex-direction:column;gap:5px;min-width:0}
.mosaic-field-label{font-size:12px;color:var(--m-muted)}
.mosaic-input,.mosaic-select{width:100%;min-height:34px;padding:6px 9px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-bg);color:var(--m-text);font:inherit;font-size:13px}
.mosaic-input:focus,.mosaic-select:focus{outline:2px solid var(--m-accent);outline-offset:1px;border-color:var(--m-accent)}
.mosaic-slider-row{display:flex;align-items:center;gap:10px}
.mosaic-slider{flex:1;min-width:0;accent-color:var(--m-accent)}
.mosaic-slider-value{font-size:12px;color:var(--m-muted);font-variant-numeric:tabular-nums;min-width:34px;text-align:right}
.mosaic-tabs{display:flex;flex-direction:column;gap:10px;min-width:0}
.mosaic-tabbar{display:flex;gap:2px;border-bottom:1px solid var(--m-border);overflow-x:auto}
.mosaic-tab{border:0;background:transparent;color:var(--m-muted);font:inherit;font-size:12.5px;font-weight:600;padding:7px 10px;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.mosaic-tab:hover{color:var(--m-text)}
.mosaic-tab-active{color:var(--m-text);border-bottom-color:var(--m-accent)}
.mosaic-tab:focus-visible{outline:2px solid var(--m-accent);outline-offset:-2px}
.mosaic-tab-body{min-width:0}
.mosaic-quiz{display:flex;flex-direction:column;gap:10px;min-width:0}
.mosaic-quiz-question{font-size:15px;font-weight:650;line-height:1.4}
.mosaic-quiz-options{display:flex;flex-direction:column;gap:6px}
.mosaic-quiz-option{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--m-border);border-radius:8px;background:var(--m-bg);color:var(--m-text);font:inherit;font-size:13px;text-align:left;cursor:pointer}
.mosaic-quiz-option:hover{border-color:var(--m-muted)}
.mosaic-quiz-option:disabled{cursor:default}
.mosaic-quiz-correct{border-color:var(--m-success);background:color-mix(in srgb,var(--m-success) 8%,var(--m-bg))}
.mosaic-quiz-wrong{border-color:var(--m-danger);background:color-mix(in srgb,var(--m-danger) 8%,var(--m-bg))}
.mosaic-quiz-mark{font-weight:700;flex:none}
.mosaic-quiz-feedback{font-size:12px;color:var(--m-muted);margin-top:2px}
.mosaic-quiz-result{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 11px;border-radius:8px;background:var(--m-bg2);font-weight:600}
.mosaic-quiz-result.ok{color:var(--m-success)}
.mosaic-quiz-result.no{color:var(--m-danger)}
.mosaic-widget{border:1px solid var(--m-border);border-radius:12px;overflow:hidden;background:var(--m-bg);min-width:0}
.mosaic-widget-head{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--m-border);background:var(--m-bg2);min-width:0}
.mosaic-widget-title{font-size:12px;font-weight:650;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mosaic-widget-actions{margin-left:auto;display:flex;gap:4px;flex:none}
.mosaic-widget-action{border:0;background:transparent;color:var(--m-muted);font:inherit;font-size:11px;cursor:pointer;padding:2px 5px;border-radius:5px}
.mosaic-widget-action:hover{color:var(--m-text);background:var(--m-border)}
.mosaic-widget-iframe{display:block;width:100%;border:0;background:transparent}
.mosaic-widget-code{margin:0;padding:10px 12px;max-height:380px;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre;background:var(--m-bg2)}
.mosaic-widget-caption{font-size:12px;color:var(--m-muted);margin-top:5px}
.mosaic-tool-fallback{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--m-border);border-radius:8px;color:var(--m-muted);font-size:12px}
.mosaic-tool-fallback b{color:var(--m-text);font-weight:600}
.mosaic-overlay-host{position:fixed;inset:0;z-index:2147483000}
.mosaic-overlay{position:fixed;inset:0;outline:none;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;z-index:2147483000}
.mosaic-overlay-body{position:relative;width:min(1120px,96vw);max-height:92vh;overflow:auto;background:var(--m-bg);color:var(--m-text);border:1px solid var(--m-border);border-radius:14px;padding:16px;box-shadow:0 24px 70px rgba(0,0,0,.35)}
.mosaic-overlay-close{position:sticky;top:0;float:right;z-index:2;border:1px solid var(--m-border);background:var(--m-bg);color:var(--m-text);border-radius:8px;width:30px;height:30px;font-size:18px;line-height:1;cursor:pointer}
.mosaic-overlay-close:hover{background:var(--m-bg2)}
.mosaic-overlay-image{display:block;max-width:100%;max-height:76vh;margin:0 auto;border-radius:10px;object-fit:contain}
.mosaic-diagnostic{margin:0 0 6px;padding:6px 10px;border:1px solid color-mix(in srgb,var(--m-danger) 40%,transparent);border-radius:7px;background:color-mix(in srgb,var(--m-danger) 10%,transparent);color:var(--m-danger);font-size:12px;line-height:1.5;white-space:pre-wrap}
.mosaic-error{margin:8px 0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--m-danger) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--m-danger) 8%,var(--m-bg));color:var(--m-danger);font-size:12px}
.mosaic-skeleton{display:flex;flex-direction:column;gap:8px;padding:10px 0}
.mosaic-skeleton span{display:block;height:10px;border-radius:5px;background:var(--m-bg2);animation:mosaic-pulse 1.2s ease-in-out infinite}
.mosaic-skeleton span:nth-child(2){width:70%}
.mosaic-skeleton span:nth-child(3){width:45%}
@keyframes mosaic-pulse{0%,100%{opacity:.5}50%{opacity:1}}
@media (max-width:640px){
  .mosaic-row{flex-wrap:wrap}
  .mosaic-diff-pair{grid-template-columns:1fr}
  .mosaic-kv{grid-template-columns:1fr}
  .mosaic-table th,.mosaic-table td{padding:7px 8px}
}
@media (prefers-reduced-motion:reduce){
  .mosaic-skeleton span{animation:none}
}
`

    function ensureStyles() {
      if (typeof document === 'undefined') return () => {}
      // Tagged with this package's identity so the client module system's owned-style
      // cleanup (`removeOwnedStyles`) can reclaim it when the entry is replaced or pruned,
      // and so this generation always owns the disposer it returns.
      for (const stale of document.querySelectorAll(`style[data-plugin-css=${JSON.stringify(STYLE_CSS_ID)}]`)) stale.remove()
      const style = document.createElement('style')
      style.dataset.plugin = PLUGIN_ID
      style.dataset.pluginCss = STYLE_CSS_ID
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }

    /* ------------------------------------------------------------------ */
    /* tiny utilities                                                      */
    /* ------------------------------------------------------------------ */

    function fingerprint(text) {
      let hash = 5381
      for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
      }
      return hash.toString(36)
    }

    function safeUrl(value, media = false) {
      if (typeof value !== 'string') return undefined
      const url = value.trim()
      if (url === '' || url.length > 2048) return undefined
      if (/^https?:\/\//i.test(url)) return url
      if (!media && /^mailto:[^@\s]+@[^@\s]+$/i.test(url)) return url
      if (url.startsWith('/') && !url.startsWith('//')) return url
      if (url.startsWith('./') || url.startsWith('../')) return url
      return undefined
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    function asString(value, cap = 2000) {
      return typeof value === 'string' ? value.slice(0, cap) : undefined
    }

    function asNumber(value) {
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    }

    function readStore() {
      try {
        const raw = localStorage.getItem(STORE_KEY)
        if (!raw) return { order: [], blocks: {} }
        const parsed = JSON.parse(raw)
        if (!parsed || !Array.isArray(parsed.order) || !parsed.blocks || typeof parsed.blocks !== 'object') {
          return { order: [], blocks: {} }
        }
        return { order: parsed.order.filter((key) => typeof key === 'string'), blocks: parsed.blocks }
      } catch {
        return { order: [], blocks: {} }
      }
    }

    function writeStore(store) {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(store))
      } catch {
        // Quota/privacy failures are non-fatal.
      }
    }

    function loadState(key) {
      if (!key) return null
      return readStore().blocks[key] ?? null
    }

    function saveState(key, value) {
      if (!key) return
      const store = readStore()
      const order = store.order.filter((entry) => entry !== key)
      order.unshift(key)
      const blocks = { ...store.blocks, [key]: value }
      while (order.length > MAX_STORED) {
        const evicted = order.pop()
        if (evicted) delete blocks[evicted]
      }
      writeStore({ order, blocks })
    }

    function clearState(key) {
      if (!key) return
      const store = readStore()
      if (!(key in store.blocks)) return
      const blocks = { ...store.blocks }
      delete blocks[key]
      writeStore({ order: store.order.filter((entry) => entry !== key), blocks })
    }

    const PROMPT_URL = '/dsh-mosaic/prompt'
    const PROMPT_LIMIT = 128 * 1024

    /**
     * The model prompt, editable in place. The Host owns the value and persists it, so
     * the same text is used by every browser and survives a restart; this page only
     * reads it, posts a change, and shows which source is active.
     */
    function MosaicSettings({ t }) {
      const alive = useRef(true)
      const [state, setState] = useState({ loading: true, text: '', saved: '', info: null, notice: null, saving: false })
      useEffect(() => () => { alive.current = false }, [])
      const reason = (error) => (error instanceof Error ? error.message : String(error))

      useEffect(() => {
        let current = true
        fetch(PROMPT_URL, { headers: { accept: 'application/json' } })
          .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then((data) => {
            if (!current) return
            const text = typeof data.prompt === 'string' ? data.prompt : ''
            setState({ loading: false, text, saved: text, info: data, notice: null, saving: false })
          })
          .catch((error) => {
            if (!current) return
            reportLog('warn', 'prompt.load-failed', { reason: reason(error).slice(0, 200) })
            setState((previous) => ({ ...previous, loading: false, notice: { kind: 'error', text: t('promptLoadFailed', { reason: reason(error) }) } }))
          })
        return () => { current = false }
      }, [t])

      const submit = useCallback(async (body) => {
        setState((previous) => ({ ...previous, saving: true, notice: null }))
        try {
          const response = await fetch(PROMPT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const data = await response.json().catch(() => ({}))
          if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
          if (!alive.current) return
          const text = typeof data.prompt === 'string' ? data.prompt : ''
          setState({
            loading: false,
            text,
            saved: text,
            info: data,
            saving: false,
            notice: { kind: 'ok', text: body.reset === true ? t('promptResetDone') : t('promptSaved') },
          })
        } catch (error) {
          if (!alive.current) return
          reportLog('warn', 'prompt.save-failed', { reason: reason(error).slice(0, 200) })
          setState((previous) => ({ ...previous, saving: false, notice: { kind: 'error', text: t('promptSaveFailed', { reason: reason(error) }) } }))
        }
      }, [t])

      const info = state.info
      const dirty = !state.loading && state.text !== state.saved
      const sourceLabel = info?.source === 'user'
        ? t('promptSourceUser')
        : info?.source === 'config' ? t('promptSourceConfig') : t('promptSourceBuiltin')
      const meta = [sourceLabel, dirty ? t('promptDirty') : '', state.loading ? '' : t('promptChars', { count: state.text.length, limit: PROMPT_LIMIT })]
        .filter(Boolean)
        .join(' · ')

      return h('div', { className: 'mosaic-root mosaic-settings', 'data-mosaic-root': '' },
        h('p', { className: 'mosaic-settings-desc' }, t('promptDesc')),
        h('div', { className: 'mosaic-prompt-head' },
          h('span', { className: 'mosaic-prompt-label' }, t('promptLabel')),
          h('span', { className: 'mosaic-prompt-meta' }, meta)),
        h('textarea', {
          className: 'mosaic-prompt-field',
          value: state.text,
          rows: 14,
          spellCheck: false,
          'aria-label': t('promptLabel'),
          placeholder: state.loading ? t('promptSaving') : '',
          onChange: (event) => setState((previous) => ({ ...previous, text: event.target.value, notice: null })),
        }),
        info && info.source === 'user' && info.persisted === false
          ? h('p', { className: 'mosaic-prompt-warn' }, t('promptMemoryOnly'))
          : null,
        info?.readError === 'corrupt'
          ? h('p', { className: 'mosaic-prompt-warn' }, t('promptReadCorrupt'))
          : null,
        info?.readError === 'unreadable'
          ? h('p', { className: 'mosaic-prompt-warn' }, t('promptReadUnreadable'))
          : null,
        h('div', { className: 'mosaic-prompt-actions' },
          h('span', { className: 'mosaic-prompt-hint' }, t('promptHint')),
          h('button', {
            type: 'button',
            className: 'mosaic-prompt-reset',
            disabled: state.loading || state.saving || info?.source !== 'user',
            onClick: () => submit({ reset: true }),
          }, t('promptReset')),
          h('button', {
            type: 'button',
            className: 'mosaic-prompt-save',
            disabled: !dirty || state.saving || state.text.trim() === '',
            onClick: () => submit({ prompt: state.text }),
          }, state.saving ? t('promptSaving') : t('promptSave'))),
        state.notice
          ? h('p', {
            className: `mosaic-prompt-notice ${state.notice.kind === 'error' ? 'is-error' : 'is-ok'}`,
            role: 'status',
          }, state.notice.text)
          : null)
    }

    function currentSessionId(ctx) {
      try {
        const list = ctx.sessions?.list?.getSnapshot?.()
        if (!list || !Array.isArray(list.ids)) return undefined
        return list.ids.find((id) => {
          const snapshot = ctx.sessions?.retainInfo?.(id)?.getSnapshot?.()
          return (snapshot?.retainedBy?.mainView ?? 0) > 0
        })
      } catch {
        return undefined
      }
    }

    // The context stays in the apply closure; components only receive this callback.
    function makeSender(ctx) {
      return function sendAction(sessionId, action, payload) {
        if (!sessionId) return
        try {
          const scoped = ctx.sessions?.scope?.(sessionId)
          const conversation = scoped?.get?.('conversation')
          if (!conversation?.send) return
          const text = `[mosaic-action] ${translate('actionNotice', { action })} ${JSON.stringify(payload ?? {})}`
          Promise.resolve(conversation.send(text)).catch(() => {})
        } catch {
          // A gone session or busy agent drops the action; the UI stays live.
        }
      }
    }

    /**
     * Resolve the host theme tokens for the sandboxed widget document. The plugin
     * owns no theme state and guesses no light/dark mode: the iframe declares
     * `color-scheme: light dark`, and a token that is absent simply keeps the
     * neutral value the widget document already falls back to.
     */
    function themeSnapshot(host) {
      if (typeof window === 'undefined') return {}
      const target = host instanceof Element ? host : (document.body ?? document.documentElement)
      const style = getComputedStyle(target)
      const tokens = {
        bg: '--dsw-alias-bg-layer-1',
        text: '--dsw-alias-label-primary',
        muted: '--dsw-alias-label-secondary',
        border: '--dsw-alias-border-l1',
        accent: '--dsw-alias-brand-primary',
        success: '--dsw-alias-state-success-primary',
        warn: '--dsw-alias-state-warn-primary',
        danger: '--dsw-alias-state-error-primary',
        card: '--dsw-alias-bg-layer-2',
      }
      const snapshot = {}
      for (const name of Object.keys(tokens)) {
        const value = style.getPropertyValue(tokens[name]).trim()
        if (value !== '') snapshot[name] = value
      }
      return snapshot
    }

    /* ------------------------------------------------------------------ */
    /* partial JSON parser                                                 */
    /* ------------------------------------------------------------------ */

    function tryPartial(text) {
      const stack = []
      const candidates = []
      let inString = false
      let escaped = false
      const push = (end, suffix) => {
        if (candidates.length >= 24) candidates.shift()
        candidates.push({ end, suffix })
      }
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index]
        if (inString) {
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === '"') inString = false
          continue
        }
        if (character === '"') {
          inString = true
          continue
        }
        if (character === '{' || character === '[') {
          stack.push(character)
          continue
        }
        if (character === '}' || character === ']') {
          const expected = character === '}' ? '{' : '['
          if (stack.pop() !== expected) break
          if (character === '}' && stack.length === 2 && stack[0] === '{' && stack[1] === '[') {
            push(index + 1, ']}')
          }
          if (stack.length === 0) push(index + 1, '')
        }
      }
      candidates.sort((a, b) => b.end - a.end)
      const seen = new Set()
      for (const candidate of candidates) {
        const key = `${candidate.end}:${candidate.suffix}`
        if (seen.has(key)) continue
        seen.add(key)
        try {
          const value = JSON.parse(text.slice(0, candidate.end) + candidate.suffix)
          if (value && typeof value === 'object') return value
        } catch {
          // Try the next candidate.
        }
      }
      return null
    }

    function parseView(raw) {
      const text = String(raw ?? '').trim()
      if (!text) return null
      let value
      try {
        value = JSON.parse(text)
      } catch {
        value = tryPartial(text)
      }
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value)
        } catch {
          return null
        }
      }
      if (Array.isArray(value)) value = { items: value }
      if (!value || typeof value !== 'object') return null
      if (!Array.isArray(value.items)) {
        if (typeof value.type === 'string') value = { items: [value] }
        else return null
      }
      const items = value.items.slice(0, MAX_NODES).map((node) => coerceNode(node, 0)).filter(Boolean)
      if (items.length === 0) return null
      return {
        title: typeof value.title === 'string' ? value.title.slice(0, 2000) : undefined,
        gap: typeof value.gap === 'number' && Number.isFinite(value.gap) ? clamp(value.gap, 0, 48) : undefined,
        items,
      }
    }

    function coerceItems(value, depth) {
      if (!Array.isArray(value)) return []
      return value.slice(0, MAX_NODES).map((node) => coerceNode(node, depth + 1)).filter(Boolean)
    }

    function coerceNode(raw, depth) {
      if (depth > MAX_DEPTH || !raw || typeof raw !== 'object' || Array.isArray(raw)) return null
      const type = typeof raw.type === 'string' ? raw.type : undefined
      if (!type) return null
      const out = { ...raw, type }
      const text = (value, cap = 2000) => asString(value, cap)
      switch (type) {
        case 'text':
          out.content = text(raw.content ?? raw.text)
          if (!out.content) return null
          break
        case 'callout': {
          out.content = text(raw.content ?? raw.text ?? raw.body ?? raw.desc)
          if (!out.content) return null
          if (raw.tone === 'danger') out.tone = 'error'
          if (raw.tone === 'warn') out.tone = 'warning'
          break
        }
        case 'table': {
          let columns = Array.isArray(raw.columns) ? raw.columns.slice(0, 8).map((column) => text(column, 256) ?? '') : undefined
          let rows = Array.isArray(raw.rows) ? raw.rows : Array.isArray(raw.data) ? raw.data : []
          if (rows.length > 0 && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
            const keys = columns && columns.length ? columns : Object.keys(rows[0])
            rows = rows.map((row) => keys.map((key) => row?.[key]))
            if (!columns || columns.length === 0) columns = keys
          }
          if ((!columns || columns.length === 0) && rows.length > 0 && Array.isArray(rows[0])) {
            columns = rows[0].map((cell) => String(cell ?? ''))
            rows = rows.slice(1)
          }
          if (!columns || columns.length === 0) return null
          out.columns = columns
          out.rows = rows.slice(0, 40).map((row) => Array.isArray(row) ? row.slice(0, 8).map((cell) => typeof cell === 'number' ? cell : String(cell ?? '')) : [])
          break
        }
        case 'list':
          out.items = Array.isArray(raw.items) ? raw.items.slice(0, 30).map((item) => {
            if (typeof item === 'string') return item.slice(0, 2000)
            if (item && typeof item.type === 'string') return coerceNode(item, depth + 1)
            if (item && typeof item === 'object') {
              const title = text(item.title ?? item.label ?? item.name)
              if (!title) return null
              return { title, desc: text(item.desc ?? item.description ?? item.content ?? item.text) }
            }
            return null
          }).filter(Boolean) : []
          if (out.items.length === 0) return null
          break
        case 'chart': {
          out.kind = ['bars', 'line', 'donut'].includes(raw.kind) ? raw.kind : 'bars'
          out.data = Array.isArray(raw.data) ? raw.data.slice(0, 40).map((datum) => ({
            label: text(datum?.label, 128) ?? '',
            value: asNumber(datum?.value) ?? 0,
          })).filter((datum) => datum.label !== '') : []
          out.series = Array.isArray(raw.series) ? raw.series.slice(0, 8).map((series) => ({
            label: text(series?.label, 128) ?? '',
            data: Array.isArray(series?.data) ? series.data.slice(0, 40).map((datum) => ({
              label: text(datum?.label, 128) ?? '',
              value: asNumber(datum?.value) ?? 0,
            })).filter((datum) => datum.label !== '') : [],
          })).filter((series) => series.label !== '') : []
          if (out.data.length === 0 && out.series.length === 0) return null
          if (out.kind === 'donut') out.series = []
          break
        }
        case 'progress':
          out.value = clamp(asNumber(raw.value) ?? 0, 0, 100)
          break
        case 'stat':
          if (!text(raw.label ?? raw.title) || !text(raw.value, 128)) return null
          out.label = text(raw.label ?? raw.title)
          out.value = text(raw.value, 128)
          out.spark = Array.isArray(raw.spark) ? raw.spark.filter((n) => typeof n === 'number' && Number.isFinite(n)).slice(0, 20) : undefined
          break
        case 'badge':
          out.label = text(raw.label ?? raw.text)
          if (!out.label) return null
          break
        case 'keyvalue':
          out.pairs = Array.isArray(raw.pairs) ? raw.pairs.slice(0, 20).map((pair) => ({
            key: text(pair?.key ?? pair?.label, 256) ?? '',
            value: text(pair?.value, 2000) ?? '',
          })).filter((pair) => pair.key !== '') : []
          if (out.pairs.length === 0) return null
          break
        case 'steps':
          out.steps = Array.isArray(raw.steps) ? raw.steps.slice(0, 12).map((step) => ({
            title: text(step?.title, 256) ?? '',
            desc: text(step?.desc, 2000),
          })).filter((step) => step.title !== '') : []
          if (out.steps.length === 0) return null
          out.current = Number.isFinite(raw.current) ? clamp(Math.trunc(raw.current), 0, out.steps.length) : undefined
          break
        case 'code':
          out.code = text(raw.code, 12000)
          if (!out.code) return null
          break
        case 'diff':
          out.diffs = Array.isArray(raw.diffs) ? raw.diffs.slice(0, 8).map((diff) => ({
            path: text(diff?.path, 512) ?? '',
            newText: text(diff?.newText, 12000) ?? '',
            oldText: typeof diff?.oldText === 'string' ? diff.oldText.slice(0, 12000) : null,
          })).filter((diff) => diff.path !== '') : []
          if (out.diffs.length === 0) return null
          break
        case 'image':
        case 'video':
        case 'audio':
        case 'pdf': {
          const src = safeUrl(raw.src ?? raw.url, true)
          if (!src) return null
          out.src = src
          if (type === 'video' && raw.poster !== undefined) {
            const poster = safeUrl(raw.poster, true)
            if (poster) out.poster = poster
            else delete out.poster
          }
          break
        }
        case 'link': {
          const href = safeUrl(raw.href ?? raw.url)
          const label = text(raw.label ?? raw.text)
          if (!href || !label) return null
          out.href = href
          out.label = label
          break
        }
        case 'button':
          out.label = text(raw.label ?? raw.text)
          if (!out.label) return null
          if (raw.action !== undefined && typeof raw.action !== 'string') delete out.action
          if (raw.local !== undefined && !['reset', 'copy', 'open', 'fullscreen'].includes(raw.local)) delete out.local
          break
        case 'input':
        case 'select':
        case 'slider':
          out.id = text(raw.id, 128)
          break
        case 'tabs':
          out.tabs = Array.isArray(raw.tabs) ? raw.tabs.slice(0, 8).map((tab) => ({
            label: text(tab?.label, 128) ?? '',
            items: coerceItems(tab?.items ?? [], depth + 1),
          })).filter((tab) => tab.label !== '') : []
          if (out.tabs.length === 0) return null
          break
        case 'quiz':
          out.question = text(raw.question)
          out.options = Array.isArray(raw.options) ? raw.options.slice(0, 6).map((option) => {
            if (typeof option === 'string') return { label: option.slice(0, 512) }
            return {
              label: text(option?.label, 512) ?? '',
              correct: option?.correct === true,
              feedback: text(option?.feedback),
            }
          }).filter((option) => option.label !== '') : []
          if (!out.question || out.options.length < 2) return null
          break
        case 'widget':
          out.code = text(raw.code, 20000)
          if (!out.code) return null
          out.height = clamp(asNumber(raw.height) ?? 320, 80, 900)
          break
        case 'diagram': {
          const inferred = raw.kind === undefined
            ? (Array.isArray(raw.nodes) || Array.isArray(raw.edges) ? 'flowchart'
              : Array.isArray(raw.participants) || Array.isArray(raw.messages) ? 'sequence'
                : Array.isArray(raw.layers) ? 'layers'
                  : Array.isArray(raw.items) ? 'timeline' : undefined)
            : undefined
          const kind = ['flowchart', 'sequence', 'timeline', 'layers'].includes(raw.kind) ? raw.kind : inferred
          if (!kind) return null
          out.kind = kind
          out.title = text(raw.title, 256)
          if (kind === 'flowchart') {
            const ids = new Set()
            out.nodes = (Array.isArray(raw.nodes) ? raw.nodes : []).slice(0, 12).map((node) => {
              const id = text(node?.id, 64)
              const label = text(node?.label, 128)
              if (!id || !label || ids.has(id)) return null
              ids.add(id)
              return {
                id,
                label,
                sub: text(node?.sub, 128),
                tone: ['accent', 'success', 'warning', 'danger', 'muted'].includes(node?.tone) ? node.tone : undefined,
                shape: ['box', 'round', 'diamond'].includes(node?.shape) ? node.shape : undefined,
              }
            }).filter(Boolean)
            if (out.nodes.length === 0) return null
            out.edges = (Array.isArray(raw.edges) ? raw.edges : []).slice(0, 20).map((edge) => {
              const from = text(edge?.from, 64)
              const to = text(edge?.to, 64)
              if (!from || !to || !ids.has(from) || !ids.has(to)) return null
              return {
                from,
                to,
                label: text(edge?.label, 64),
                kind: ['solid', 'dashed', 'accent'].includes(edge?.kind) ? edge.kind : undefined,
              }
            }).filter(Boolean)
            out.direction = raw.direction === 'LR' ? 'LR' : 'TB'
          } else if (kind === 'sequence') {
            const ids = new Set()
            out.participants = (Array.isArray(raw.participants) ? raw.participants : []).slice(0, 8).map((participant) => {
              const id = text(participant?.id, 64)
              const label = text(participant?.label, 128)
              if (!id || !label || ids.has(id)) return null
              ids.add(id)
              return { id, label }
            }).filter(Boolean)
            if (out.participants.length === 0) return null
            out.messages = (Array.isArray(raw.messages) ? raw.messages : []).slice(0, 20).map((message) => {
              const from = text(message?.from, 64)
              const to = text(message?.to, 64)
              const label = text(message?.label, 128)
              if (!from || !to || !label || !ids.has(from) || !ids.has(to)) return null
              return {
                from,
                to,
                label,
                kind: ['sync', 'return', 'async'].includes(message?.kind) ? message.kind : undefined,
              }
            }).filter(Boolean)
            if (out.messages.length === 0) return null
          } else if (kind === 'timeline') {
            out.items = (Array.isArray(raw.items) ? raw.items : []).slice(0, 12).map((item) => {
              const itemTitle = text(item?.title, 256)
              if (!itemTitle) return null
              return { title: itemTitle, desc: text(item?.desc), time: text(item?.time, 64) }
            }).filter(Boolean)
            if (out.items.length === 0) return null
          } else {
            out.layers = (Array.isArray(raw.layers) ? raw.layers : []).slice(0, 8).map((layer) => {
              const layerTitle = text(layer?.title, 128)
              const layerItems = Array.isArray(layer?.items)
                ? layer.items.slice(0, 6).map((item) => text(item, 256)).filter(Boolean)
                : []
              if (!layerTitle || layerItems.length === 0) return null
              return { title: layerTitle, items: layerItems }
            }).filter(Boolean)
            if (out.layers.length === 0) return null
          }
          break
        }
        case 'row':
        case 'col':
        case 'grid':
        case 'card':
          out.items = coerceItems(raw.items ?? [], depth + 1)
          if (out.items.length === 0) return null
          break
        case 'divider':
        case 'spacer':
          break
        default:
          return null
      }
      if (raw.span !== undefined && asNumber(raw.span) !== undefined) out.span = clamp(Math.trunc(raw.span), 1, 6)
      return out
    }

    function describeParse(raw) {
      try {
        JSON.parse(String(raw ?? ''))
        return 'JSON parsed but the root has no usable items'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }

    /* ------------------------------------------------------------------ */
    /* rich text                                                           */
    /* ------------------------------------------------------------------ */

    const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\s]+\)|\r?\n)/g

    function renderRich(value, allowLinks = true, depth = 0) {
      if (typeof value !== 'string' || value === '' || depth > 4) return value
      const out = []
      let last = 0
      let key = 0
      for (const match of value.matchAll(INLINE)) {
        const index = match.index ?? 0
        const token = match[0]
        if (index > last) out.push(value.slice(last, index))
        if (token === '\n' || token === '\r\n') {
          out.push('\n')
        } else if (token.startsWith('`')) {
          out.push(h('code', { key: key += 1, className: 'mosaic-inline-code' }, token.slice(1, -1)))
        } else if (token.startsWith('**')) {
          out.push(h('strong', { key: key += 1 }, renderRich(token.slice(2, -2), allowLinks, depth + 1)))
        } else {
          const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)
          const href = parts ? safeUrl(parts[2]) : undefined
          if (parts && href && allowLinks) {
            out.push(h('a', {
              key: key += 1,
              href,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, renderRich(parts[1], false, depth + 1)))
          } else if (parts) {
            out.push(renderRich(parts[1], false, depth + 1))
          } else {
            out.push(token)
          }
        }
        last = index + token.length
      }
      if (last < value.length) out.push(value.slice(last))
      return out.length === 0 ? value : out
    }

    /* ------------------------------------------------------------------ */
    /* local state                                                         */
    /* ------------------------------------------------------------------ */

    const ViewContext = createContext(null)

    function useView() {
      return useContext(ViewContext)
    }

    function useDebouncedAction() {
      const timer = useRef(null)
      useEffect(() => () => {
        if (timer.current) clearTimeout(timer.current)
      }, [])
      return useCallback((fn) => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(fn, 300)
      }, [])
    }

    function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(text).catch(() => {})
          return
        }
      } catch {
        // Fall through to the legacy path.
      }
      try {
        const area = document.createElement('textarea')
        area.value = text
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        document.execCommand('copy')
        area.remove()
      } catch {
        // Clipboard unavailable; nothing to do.
      }
    }

    /* ------------------------------------------------------------------ */
    /* atomic renderers                                                    */
    /* ------------------------------------------------------------------ */

    function Sparkline({ values }) {
      const points = values.slice(0, 20)
      if (points.length < 2) return null
      const width = 84
      const height = 22
      const min = Math.min(...points)
      const max = Math.max(...points)
      const span = max - min || 1
      const step = (width - 4) / (points.length - 1)
      const coords = points.map((value, index) => [2 + index * step, height - 2 - ((value - min) / span) * (height - 4)])
      const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
      return h('svg', { className: 'mosaic-spark', viewBox: `0 0 ${width} ${height}`, 'aria-hidden': true }, h('polyline', {
        points: line,
        fill: 'none',
        stroke: 'var(--m-series-1)',
        strokeWidth: 1.5,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      }))
    }

    function deltaClass(value) {
      if (typeof value !== 'string') return ''
      if (value.trim().startsWith('+')) return 'mosaic-delta-pos'
      if (value.trim().startsWith('-')) return 'mosaic-delta-neg'
      return 'mosaic-delta-flat'
    }

    function TextNode({ node }) {
      const size = ['display', 'h1', 'h2', 'h3', 'body', 'muted', 'caption'].includes(node.size) ? node.size : 'body'
      const align = ['left', 'center', 'right'].includes(node.align) ? node.align : undefined
      const tone = ['danger', 'success', 'warning', 'info', 'muted'].includes(node.tone) ? node.tone : undefined
      return h('div', {
        className: [
          'mosaic-text',
          size === 'body' ? '' : `mosaic-${size}`,
          align ? `mosaic-${align}` : '',
          tone ? `mosaic-tone-${tone}` : '',
          node.mono ? 'mosaic-mono' : '',
        ].filter(Boolean).join(' '),
      }, renderRich(node.content))
    }

    function StatNode({ node }) {
      return h('div', { className: 'mosaic-stat' },
        h('div', { className: 'mosaic-stat-label' }, renderRich(node.label)),
        h('div', { className: 'mosaic-stat-value' }, renderRich(node.value)),
        (node.delta || (node.spark && node.spark.length >= 2))
          ? h('div', { className: 'mosaic-stat-foot' },
            node.delta ? h('span', { className: `mosaic-delta ${deltaClass(node.delta)}` }, node.delta) : null,
            node.spark && node.spark.length >= 2 ? h(Sparkline, { values: node.spark }) : null)
          : null)
    }

    function BadgeNode({ node }) {
      return h('span', { className: `mosaic-badge mosaic-badge-${node.tone ?? 'accent'}` }, renderRich(node.label))
    }

    function ProgressNode({ node }) {
      const value = clamp(Number(node.value) || 0, 0, 100)
      if (node.variant === 'ring') {
        const radius = 24
        const circumference = 2 * Math.PI * radius
        const dash = (value / 100) * circumference
        return h('div', { className: 'mosaic-ring' },
          h('svg', { viewBox: '0 0 64 64', role: 'img', 'aria-label': `${value}%` },
            h('circle', { cx: 32, cy: 32, r: radius, fill: 'none', stroke: 'var(--m-bg2)', strokeWidth: 6 }),
            h('circle', {
              cx: 32, cy: 32, r: radius, fill: 'none', stroke: 'var(--m-series-1)', strokeWidth: 6,
              strokeLinecap: 'round', strokeDasharray: `${dash} ${circumference - dash}`,
              transform: 'rotate(-90 32 32)',
            }),
            h('text', { x: 32, y: 36, textAnchor: 'middle', style: { fontSize: 12, fontWeight: 650, fill: 'var(--m-text)' } }, `${Math.round(value)}%`)),
          h('div', { className: 'mosaic-progress' },
            node.label ? h('div', { className: 'mosaic-stat-label' }, renderRich(node.label)) : null,
            node.valueLabel ? h('b', null, node.valueLabel) : null))
      }
      return h('div', { className: 'mosaic-progress' },
        (node.label || node.valueLabel)
          ? h('div', { className: 'mosaic-progress-head' },
            h('span', null, node.label ? renderRich(node.label) : ''),
            h('b', null, node.valueLabel ?? `${Math.round(value)}%`))
          : null,
        h('div', { className: 'mosaic-track', role: 'progressbar', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100 },
          h('span', { className: 'mosaic-fill', style: { width: `${value}%` } }),
          node.target !== undefined ? h('span', { className: 'mosaic-target', style: { left: `${clamp(Number(node.target) || 0, 0, 100)}%` } }) : null))
    }

    function KeyValueNode({ node }) {
      return h('div', { className: 'mosaic-kv' }, node.pairs.flatMap((pair, index) => [
        h('div', { key: `k${index}`, className: 'mosaic-kv-key' }, renderRich(pair.key)),
        h('div', { key: `v${index}`, className: 'mosaic-kv-value' }, renderRich(pair.value)),
      ]))
    }

    function StepsNode({ node }) {
      return h('ol', { className: 'mosaic-steps' }, node.steps.map((step, index) => {
        const active = node.current !== undefined && index <= node.current
        return h('li', { key: index, className: `mosaic-step${active ? ' mosaic-step-active' : ''}` },
          h('span', { className: 'mosaic-step-index' }, String(index + 1)),
          h('div', null,
            h('div', { className: 'mosaic-step-title' }, renderRich(step.title)),
            step.desc ? h('div', { className: 'mosaic-step-desc' }, renderRich(step.desc)) : null))
      }))
    }

    function CalloutNode({ node }) {
      return h('div', { className: `mosaic-callout${node.tone ? ` mosaic-callout-${node.tone}` : ''}` },
        node.title ? h('div', { className: 'mosaic-callout-title' }, renderRich(node.title)) : null,
        h('div', null, renderRich(node.content)))
    }

    function CodeNode({ node }) {
      return h('div', { className: 'mosaic-code' },
        h('button', { type: 'button', className: 'mosaic-copy', onClick: () => copyText(node.code) }, translate('copy')),
        h('pre', null, h('code', null, node.code)))
    }

    function DiffSide({ text, kind }) {
      const lines = String(text ?? '').split('\n')
      return h('div', { className: `mosaic-diff-side mosaic-diff-${kind}` },
        lines.map((line, index) => h('div', { className: 'mosaic-diff-line', key: index },
          h('span', { className: 'mosaic-diff-gutter' }, kind === 'old' ? '-' : '+'),
          h('span', { className: 'mosaic-diff-num' }, String(index + 1)),
          h('span', { className: 'mosaic-diff-text' }, line === '' ? ' ' : line))))
    }

    function DiffNode({ node }) {
      return h('div', { className: 'mosaic-diff' }, node.diffs.map((diff, index) => h('div', { key: index },
        h('div', { className: 'mosaic-diff-file' }, diff.path),
        h('div', { className: 'mosaic-diff-pair' },
          h(DiffSide, { text: diff.oldText ?? translate('added'), kind: 'old' }),
          h(DiffSide, { text: diff.newText ?? '', kind: 'new' })))))
    }

    function DividerNode({ node }) {
      return h('div', { className: 'mosaic-divider' }, node.label ? h('span', null, renderRich(node.label)) : null)
    }

    function SpacerNode() {
      return h('div', { className: 'mosaic-spacer' })
    }function numberValue(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const text = String(value ?? '').trim().replace(/[,$£€¥%]/g, '')
      if (text === '') return null
      const match = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*(k|m|b|万|亿)?$/i.exec(text)
      if (!match) return null
      const base = Number(match[1])
      if (!Number.isFinite(base)) return null
      const unit = (match[2] ?? '').toLowerCase()
      const factor = unit === 'k' ? 1e3 : unit === 'm' ? 1e6 : unit === 'b' ? 1e9 : unit === '万' ? 1e4 : unit === '亿' ? 1e8 : 1
      return base * factor
    }

    function tableMarkdown(columns, rows) {
      const escape = (cell) => String(cell ?? '').replace(/\|/g, '\\|')
      return [
        `| ${columns.map(escape).join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${columns.map((_, index) => escape(row[index])).join(' | ')} |`),
      ].join('\n')
    }

    function tableCsv(rows) {
      return rows.map((row) => row.map((cell) => {
        const text = String(cell ?? '')
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
      }).join(',')).join('\n')
    }

    function TableNode({ node }) {
      const view = useView()
      const [sort, setSort] = useState(null)
      const columns = Array.isArray(node.columns) ? node.columns : []
      const rows = Array.isArray(node.rows) ? node.rows : []
      const types = Array.isArray(node.types) ? node.types : []
      const filterValue = node.filter && view ? (view.state.fields[node.filter] ?? '') : ''
      const boundSort = node.sort && view ? view.state.fields[node.sort] : undefined
      const filtered = filterValue.trim() === ''
        ? rows.map((row, index) => ({ row, index }))
        : rows.map((row, index) => ({ row, index })).filter(({ row }) => row.some((cell) => String(cell ?? '').toLowerCase().includes(filterValue.trim().toLowerCase())))
      const boundColumn = boundSort ? columns.indexOf(boundSort) : -1
      const effectiveSort = sort
        ?? (boundColumn >= 0 ? { column: boundColumn, direction: 1 } : null)
      const sorted = effectiveSort
        ? [...filtered].sort((left, right) => {
          const a = left.row[effectiveSort.column]
          const b = right.row[effectiveSort.column]
          const na = numberValue(a)
          const nb = numberValue(b)
          const order = na !== null && nb !== null ? na - nb : String(a ?? '').localeCompare(String(b ?? ''), 'zh-CN')
          return order * effectiveSort.direction
        })
        : filtered
      const totals = columns.map((_, index) => {
        const values = rows.map((row) => numberValue(row[index])).filter((value) => value !== null)
        return values.length === rows.length && values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null
      })

      const toggleSort = (column) => {
        setSort((current) => {
          if (!current || current.column !== column) return { column, direction: 1 }
          if (current.direction === 1) return { column, direction: -1 }
          return null
        })
      }

      const cell = (value, column) => {
        const type = types[column] ?? 'text'
        if (type === 'bar') {
          const numeric = clamp(numberValue(value) ?? 0, 0, 100)
          return h('span', { className: 'mosaic-cell-bar', title: `${numeric}%` }, h('span', { style: { width: `${numeric}%` } }))
        }
        if (type === 'badge') return h('span', { className: 'mosaic-badge mosaic-badge-accent' }, renderRich(String(value ?? '')))
        if (type === 'num') return h('span', null, renderRich(String(value ?? '')))
        if (type === 'delta') return h('span', { className: deltaClass(String(value ?? '')) }, renderRich(String(value ?? '')))
        return renderRich(String(value ?? ''))
      }

      const header = h('thead', null, h('tr', null, columns.map((column, index) => h('th', {
        key: index,
        'aria-sort': effectiveSort?.column === index ? (effectiveSort.direction === 1 ? 'ascending' : 'descending') : 'none',
      }, h('button', { type: 'button', onClick: () => toggleSort(index) },
        renderRich(column),
        effectiveSort?.column === index ? h('span', { 'aria-hidden': true }, effectiveSort.direction === 1 ? '▲' : '▼') : null)))))

      const bodyRows = sorted.map(({ row, index }) => h('tr', { key: index }, columns.map((column, columnIndex) => h('td', {
        key: columnIndex,
        className: types[columnIndex] === 'num' ? 'num' : types[columnIndex] === 'delta' ? deltaClass(String(row[columnIndex] ?? '')) : '',
      }, cell(row[columnIndex], columnIndex)))))

      const totalText = (value) => {
        if (typeof value !== 'number') return String(value)
        if (Number.isInteger(value)) return String(value)
        return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
      }
      const totalRow = node.total && totals.some((value) => value !== null)
        ? h('tr', { className: 'total' }, columns.map((column, index) => h('td', {
          key: index,
          className: types[index] === 'num' || totals[index] !== null ? 'num' : '',
        }, totals[index] === null ? (index === 0 ? translate('total') : '') : totalText(totals[index]))))
        : null

      return h('div', null,
        node.export ? h('div', { className: 'mosaic-table-tools' },
          h('button', { type: 'button', onClick: () => copyText(tableMarkdown(columns, rows)) }, translate('copyMarkdown')),
          h('button', { type: 'button', onClick: () => copyText(tableCsv(rows)) }, translate('copyCsv'))) : null,
        h('div', { className: 'mosaic-table-wrap' },
          h('table', { className: columns.length >= 4 ? 'mosaic-table mosaic-table-dense' : 'mosaic-table' },
            header,
            h('tbody', null, bodyRows, totalRow))))
    }

    function ListNode({ node }) {
      const view = useView()
      const filterId = node.filter
      const filterValue = filterId && view ? (view.state.fields[filterId] ?? '') : ''
      const needle = filterValue.trim().toLowerCase()
      const items = needle === '' ? node.items : node.items.filter((item) => {
        if (typeof item === 'string') return item.toLowerCase().includes(needle)
        if (item && typeof item.type === 'string') return false
        return `${item?.title ?? ''} ${item?.desc ?? ''}`.toLowerCase().includes(needle)
      })
      return h('ul', { className: 'mosaic-list' }, items.map((item, index) => {
        if (typeof item === 'string') {
          return h('li', { key: index, className: 'mosaic-list-item' }, h('span', { className: 'mosaic-list-dot' }), h('div', null, renderRich(item)))
        }
        if (item && typeof item.type === 'string') {
          return h('li', { key: index, className: 'mosaic-list-item' }, h(NodeView, { node: item, path: `list[${index}]`, depth: 1 }))
        }
        return h('li', { key: index, className: 'mosaic-list-item' },
          h('span', { className: 'mosaic-list-dot' }),
          h('div', null,
            h('div', { className: 'mosaic-list-title' }, renderRich(item?.title ?? '')),
            item?.desc ? h('div', { className: 'mosaic-list-desc' }, renderRich(item.desc)) : null))
      }))
    }

    /**
     * Run `callback` when the host appearance changes.
     *
     * A fence lives in its own React root, so host theme state never reaches it; this
     * observes the one documented signal and is the only place the client reads it.
     * Components that copy resolved tokens (the sandboxed widget, the Mermaid diagram)
     * use this to refresh themselves.
     *
     * @param {() => void} callback - invoked at most once per 80 ms burst.
     * @returns {() => void} unsubscribe.
     */
    function onAppearanceChange(callback) {
      if (typeof MutationObserver !== 'function' || typeof document === 'undefined') return () => {}
      let pending = null
      const observer = new MutationObserver(() => {
        if (pending !== null) clearTimeout(pending)
        pending = setTimeout(callback, 80)
      })
      for (const target of [document.documentElement, document.body]) {
        if (target) observer.observe(target, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class', 'style'] })
      }
      return () => {
        if (pending !== null) clearTimeout(pending)
        observer.disconnect()
      }
    }

    function chartPalette(index) {
      return [
        'var(--m-series-1)',
        'var(--m-series-2)',
        'var(--m-series-3)',
        'var(--m-series-4)',
        'var(--m-series-5)',
      ][index % 5]
    }

    function ChartNode({ node }) {
      const kind = node.kind
      const data = Array.isArray(node.data) ? node.data : []
      const series = Array.isArray(node.series) ? node.series : []
      const labels = series.length > 0
        ? (series.find((entry) => entry.data.length > 0)?.data ?? []).map((point) => point.label)
        : data.map((point) => point.label)
      // Measure the card instead of scaling one fixed viewBox: a `width:100%` SVG
      // with a fixed viewBox grows every glyph with the card, which made a chart on a
      // wide window several times too tall with 15-20px axis text.
      const wrapRef = useRef(null)
      const [boxWidth, setBoxWidth] = useState(680)
      useEffect(() => {
        const element = wrapRef.current
        if (!element || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const next = Math.max(320, Math.round(entries[0].contentRect.width))
          setBoxWidth((current) => (Math.abs(current - next) < 2 ? current : next))
        })
        observer.observe(element)
        return () => observer.disconnect()
      }, [])
      const width = boxWidth
      const height = 250
      const pad = { top: 18, right: 16, bottom: 34, left: 42 }
      const plotW = width - pad.left - pad.right
      const plotH = height - pad.top - pad.bottom
      const aria = node.title ?? `${kind} chart`

      if (kind === 'donut') {
        const total = data.reduce((sum, point) => sum + Math.max(0, point.value), 0)
        const radius = 64
        const circumference = 2 * Math.PI * radius
        let offset = 0
        return h('div', { ref: wrapRef, style: { width: '100%' } },
          node.title ? h('div', { className: 'mosaic-stat-label' }, renderRich(node.title)) : null,
          h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 18 } },
            h('svg', { viewBox: '0 0 200 200', width: 200, height: 200, role: 'img', 'aria-label': aria },
              h('circle', { cx: 100, cy: 100, r: radius, fill: 'none', stroke: 'var(--m-bg2)', strokeWidth: 24 }),
              data.map((point, index) => {
                const fraction = total <= 0 ? 0 : Math.max(0, point.value) / total
                const dash = fraction * circumference
                const segment = h('circle', {
                  key: index,
                  cx: 100, cy: 100, r: radius, fill: 'none',
                  stroke: chartPalette(index), strokeWidth: 24,
                  strokeDasharray: `${dash} ${circumference - dash}`,
                  strokeDashoffset: -offset,
                  transform: 'rotate(-90 100 100)',
                })
                offset += dash
                return segment
              }),
              h('text', { x: 100, y: 96, textAnchor: 'middle', style: { fontSize: 18, fontWeight: 650, fill: 'var(--m-text)' } }, String(Math.round(total))),
              h('text', { x: 100, y: 116, textAnchor: 'middle', style: { fontSize: 10, fill: 'var(--m-muted)' } }, translate('grandTotal'))),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 5, minWidth: 160 } },
              data.map((point, index) => h('div', { key: index, style: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 } },
                h('span', { style: { width: 8, height: 8, borderRadius: 2, background: chartPalette(index), flex: 'none' } }),
                h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, point.label),
                h('b', { style: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' } }, String(point.value)))))))
      }

      const multipSeries = series.length > 0
      const valuesForLabel = (label) => {
        if (multipSeries) return series.map((entry) => entry.data.find((point) => point.label === label)?.value ?? 0)
        return [data.find((point) => point.label === label)?.value ?? 0]
      }
      const max = Math.max(1, ...labels.flatMap((label) => {
        const values = valuesForLabel(label)
        return node.stacked ? [values.reduce((sum, value) => sum + value, 0)] : values
      }))
      const y = (value) => pad.top + plotH - (value / max) * plotH
      const tickText = (value) => {
        if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`
        return Number.isInteger(value) ? String(value) : value.toFixed(1)
      }
      const grid = [0, 1, 2, 3, 4].map((index) => pad.top + (plotH / 4) * index)
      const gridNode = (gy, index) => h('g', { key: `g${index}` },
        h('line', { x1: pad.left, x2: width - pad.right, y1: gy, y2: gy, className: 'mosaic-grid-line' }),
        h('text', { x: pad.left - 8, y: gy + 3, textAnchor: 'end', className: 'mosaic-axis-label' }, tickText(max * ((4 - index) / 4))))
      const labelStep = Math.max(1, Math.ceil(labels.length / 8))

      if (kind === 'line') {
        const lines = multipSeries ? series : [{ label: node.title ?? 'value', data }]
        return h('div', { ref: wrapRef, style: { width: '100%' } },
          node.title ? h('div', { className: 'mosaic-stat-label' }, renderRich(node.title)) : null,
          h('svg', { className: 'mosaic-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': aria },
            grid.map((gy, index) => gridNode(gy, index)),
            h('line', { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), className: 'mosaic-axis' }),
            lines.map((line, lineIndex) => {
              const points = labels.map((label, index) => {
                const value = line.data.find((point) => point.label === label)?.value ?? 0
                const x = pad.left + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW)
                return [x, y(value)]
              })
              return h('g', { key: lineIndex },
                h('polyline', { points: points.map(([x, py]) => `${x.toFixed(1)},${py.toFixed(1)}`).join(' '), className: 'mosaic-line', stroke: chartPalette(lineIndex) }),
                points.map(([x, py], index) => h('circle', { key: index, cx: x, cy: py, r: 3, fill: chartPalette(lineIndex), className: 'mosaic-dot' })))
            }),
            labels.map((label, index) => index % labelStep === 0
              ? h('text', { key: `l${index}`, x: pad.left + (labels.length <= 1 ? plotW / 2 : (index / (labels.length - 1)) * plotW), y: height - 12, textAnchor: 'middle' }, label.slice(0, 10))
              : null)))
      }

      const groupWidth = labels.length === 0 ? 0 : plotW / labels.length
      const seriesCount = multipSeries ? Math.max(1, series.length) : 1
      const barWidth = Math.max(3, (groupWidth * 0.68) / seriesCount)
      return h('div', { ref: wrapRef, style: { width: '100%' } },
        node.title ? h('div', { className: 'mosaic-stat-label' }, renderRich(node.title)) : null,
        h('svg', { className: 'mosaic-chart', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': aria },
          grid.map((gy, index) => gridNode(gy, index)),
          h('line', { x1: pad.left, x2: width - pad.right, y1: y(0), y2: y(0), className: 'mosaic-axis' }),
          labels.map((label, labelIndex) => {
            const values = valuesForLabel(label)
            const groupX = pad.left + labelIndex * groupWidth + groupWidth * 0.16
            let accumulated = 0
            return h('g', { key: labelIndex },
              values.map((value, seriesIndex) => {
                const barHeight = Math.max(1, (Math.max(0, value) / max) * plotH)
                const x = node.stacked
                  ? groupX
                  : groupX + seriesIndex * barWidth
                const py = node.stacked
                  ? y(accumulated + Math.max(0, value))
                  : y(Math.max(0, value))
                if (node.stacked) accumulated += Math.max(0, value)
                return h('rect', {
                  key: seriesIndex,
                  x, y: py, width: node.stacked ? groupWidth * 0.68 : barWidth,
                  height: barHeight, rx: 2,
                  fill: chartPalette(seriesIndex),
                  className: 'mosaic-bar',
                })
              }),
              labelIndex % labelStep === 0
                ? h('text', { x: pad.left + labelIndex * groupWidth + groupWidth / 2, y: height - 12, textAnchor: 'middle' }, label.slice(0, 10))
                : null)
          })))
    }

    function ImageNode({ node }) {
      const view = useView()
      return h('figure', { className: 'mosaic-media', style: { margin: 0 } },
        h('img', {
          className: 'mosaic-image',
          src: node.src,
          alt: node.alt ?? node.caption ?? '',
          loading: 'lazy',
          onClick: () => view?.openOverlay(h('div', { className: 'mosaic-media' },
            h('img', { className: 'mosaic-overlay-image', src: node.src, alt: node.alt ?? '' }),
            node.caption ? h('figcaption', { className: 'mosaic-caption-line' }, renderRich(node.caption)) : null)),
        }),
        node.caption ? h('figcaption', { className: 'mosaic-caption-line' }, renderRich(node.caption)) : null)
    }

    function VideoNode({ node }) {
      return h('figure', { className: 'mosaic-media', style: { margin: 0 } },
        h('video', {
          className: 'mosaic-video',
          src: node.src,
          poster: node.poster,
          controls: true,
          playsInline: true,
          preload: 'metadata',
          style: node.aspect ? { aspectRatio: node.aspect.replace(':', ' / ') } : undefined,
        }),
        node.caption ? h('figcaption', { className: 'mosaic-caption-line' }, renderRich(node.caption)) : null)
    }

    function AudioNode({ node }) {
      return h('figure', { className: 'mosaic-media', style: { margin: 0 } },
        h('audio', { className: 'mosaic-audio', src: node.src, controls: true, preload: 'metadata' }),
        node.caption ? h('figcaption', { className: 'mosaic-caption-line' }, renderRich(node.caption)) : null)
    }

    function PdfNode({ node }) {
      return h('div', { className: 'mosaic-media' },
        h('iframe', { className: 'mosaic-pdf', src: node.src, title: node.title ?? 'PDF' }),
        h('a', { href: node.src, target: '_blank', rel: 'noreferrer noopener', className: 'mosaic-caption-line' }, translate('openPdf')))
    }

    function LinkNode({ node }) {
      return h('a', {
        className: 'mosaic-link',
        href: node.href,
        target: '_blank',
        rel: 'noreferrer noopener',
      },
      h('span', { className: 'mosaic-link-icon', 'aria-hidden': true }, '↗'),
      h('span', { style: { minWidth: 0 } },
        h('span', { className: 'mosaic-link-label' }, renderRich(node.label)),
        node.description ? h('span', { className: 'mosaic-link-desc' }, renderRich(node.description)) : null))
    }

    function ButtonNode({ node }) {
      const view = useView()
      const action = typeof node.action === 'string' && node.action.trim() !== '' ? node.action : undefined
      const local = ['reset', 'copy', 'open', 'fullscreen'].includes(node.local) ? node.local : undefined
      const blocked = action !== undefined && view !== null && view?.canAct === false
      const disabled = blocked || (action === undefined && local === undefined)
      const activate = () => {
        if (action !== undefined) {
          view?.action(action, { type: 'button', label: node.label })
          return
        }
        if (local === 'reset') view?.reset()
        else if (local === 'copy') copyText(node.text ?? node.label)
        else if (local === 'open') {
          const href = safeUrl(node.url)
          if (href) window.open(href, '_blank', 'noopener,noreferrer')
        } else if (local === 'fullscreen') {
          view?.openOverlay(h('pre', { className: 'mosaic-widget-code' }, node.text ?? node.label))
        }
      }
      return h('button', {
        type: 'button',
        className: [
          'mosaic-button',
          node.tone ? `mosaic-button-${node.tone}` : '',
          node.full ? 'mosaic-button-full' : '',
        ].filter(Boolean).join(' '),
        disabled,
        'aria-disabled': disabled ? 'true' : undefined,
        onClick: disabled ? undefined : activate,
      }, renderRich(node.label))
    }

    function InputNode({ node, path }) {
      const view = useView()
      const key = node.id ?? path
      const [local, setLocal] = useState(node.value ?? '')
      const stored = node.id && view?.state.fields[node.id] !== undefined ? view.state.fields[node.id] : undefined
      const value = stored !== undefined ? stored : local
      const lastSent = useRef(value)
      const update = (next) => {
        setLocal(next)
        if (node.id) view?.setField(node.id, next)
      }
      const send = () => {
        if (!node.action || !view) return
        if (lastSent.current === value) return
        lastSent.current = value
        view.action(node.action, { type: 'input', id: node.id ?? key, value })
      }
      return h('label', { className: 'mosaic-form' },
        node.label ? h('span', { className: 'mosaic-field-label' }, renderRich(node.label)) : null,
        h('input', {
          className: 'mosaic-input',
          value,
          placeholder: node.placeholder ?? '',
          onChange: (event) => update(event.target.value),
          onKeyDown: (event) => { if (event.key === 'Enter') send() },
          onBlur: send,
        }))
    }

    function SelectNode({ node }) {
      const view = useView()
      const key = node.id ?? 'select'
      const selected = node.id && view?.state.fields[node.id] !== undefined
        ? view.state.fields[node.id]
        : (typeof node.selected === 'string' && node.options.includes(node.selected)
          ? node.selected
          : (node.options[node.selected ?? -1] ?? ''))
      const update = (value) => {
        if (node.id) view?.setField(node.id, value)
        if (node.action && view) view.action(node.action, { type: 'select', id: node.id ?? key, value })
      }
      return h('label', { className: 'mosaic-form' },
        node.label ? h('span', { className: 'mosaic-field-label' }, renderRich(node.label)) : null,
        h('select', { className: 'mosaic-select', value: selected, onChange: (event) => update(event.target.value) },
          h('option', { value: '' }, translate('selectPlaceholder')),
          node.options.map((option, index) => h('option', { key: index, value: option }, option))))
    }

    function SliderNode({ node }) {
      const view = useView()
      const key = node.id ?? 'slider'
      const initial = node.id && view?.state.fields[node.id] !== undefined
        ? Number(view.state.fields[node.id])
        : (node.value ?? node.min ?? 0)
      const [value, setValue] = useState(Number.isFinite(initial) ? initial : 0)
      const debounce = useDebouncedAction()
      const update = (next) => {
        setValue(next)
        if (node.id) view?.setField(node.id, String(next))
        if (node.action && view) debounce(() => view.action(node.action, { type: 'slider', id: node.id ?? key, value: next }))
      }
      return h('label', { className: 'mosaic-form' },
        node.label ? h('span', { className: 'mosaic-field-label' }, renderRich(node.label)) : null,
        h('div', { className: 'mosaic-slider-row' },
          h('input', {
            className: 'mosaic-slider',
            type: 'range',
            min: node.min ?? 0,
            max: node.max ?? 100,
            step: node.step ?? 1,
            value,
            onChange: (event) => update(Number(event.target.value)),
          }),
          h('span', { className: 'mosaic-slider-value' }, String(value))))
    }

    function TabsNode({ node, path }) {
      const view = useView()
      const active = clamp(view?.state.tabs[path] ?? 0, 0, node.tabs.length - 1)
      return h('div', { className: 'mosaic-tabs' },
        h('div', { className: 'mosaic-tabbar', role: 'tablist' }, node.tabs.map((tab, index) => h('button', {
          key: index,
          type: 'button',
          role: 'tab',
          'aria-selected': active === index,
          className: `mosaic-tab${active === index ? ' mosaic-tab-active' : ''}`,
          onClick: () => view?.setTab(path, index),
        }, renderRich(tab.label)))),
        h('div', { className: 'mosaic-tab-body', role: 'tabpanel' }, (node.tabs[active]?.items ?? []).map((item, index) => h(NodeView, {
          key: index,
          node: item,
          path: `${path}.tabs[${active}].items[${index}]`,
          depth: 1,
        }))))
    }

    function QuizNode({ node }) {
      const [selected, setSelected] = useState(null)
      const [submitted, setSubmitted] = useState(false)
      const correct = node.options.findIndex((option) => option.correct === true)
      const choose = (index) => {
        if (submitted) return
        setSelected(index)
        setSubmitted(true)
      }
      const reset = () => {
        setSelected(null)
        setSubmitted(false)
      }
      const selection = selected === null ? null : node.options[selected]
      return h('div', { className: 'mosaic-quiz' },
        h('div', { className: 'mosaic-quiz-question' }, renderRich(node.question)),
        h('div', { className: 'mosaic-quiz-options' }, node.options.map((option, index) => {
          const isSelected = selected === index
          const isCorrect = submitted && correct === index
          const isWrong = submitted && isSelected && correct >= 0 && correct !== index
          return h('button', {
            key: index,
            type: 'button',
            disabled: submitted,
            className: `mosaic-quiz-option${isCorrect ? ' mosaic-quiz-correct' : ''}${isWrong ? ' mosaic-quiz-wrong' : ''}`,
            onClick: () => choose(index),
          },
          h('span', { className: 'mosaic-quiz-mark' }, isCorrect ? '✓' : isWrong ? '✗' : String.fromCharCode(65 + index)),
          h('span', null,
            renderRich(option.label),
            submitted && isSelected && option.feedback ? h('span', { className: 'mosaic-quiz-feedback' }, renderRich(option.feedback)) : null))
        })),
        submitted
          ? h('div', null,
            h('div', { className: `mosaic-quiz-result ${correct < 0 ? '' : selected === correct ? 'ok' : 'no'}` },
              h('span', null, correct < 0 ? translate('answered') : selected === correct ? translate('answerCorrect') : translate('answerWrong')),
              h('button', { type: 'button', className: 'mosaic-button mosaic-button-ghost', onClick: reset }, translate('tryAgain'))),
            node.explanation ? h('div', { className: 'mosaic-caption-line' }, renderRich(node.explanation)) : null)
          : null)
    }

    /* ------------------------------------------------------------------ */
    /* sandboxed widget                                                    */
    /* ------------------------------------------------------------------ */

    const WIDGET_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:;; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

    function widgetBridge(nonce, policy) {
      return `(function(){
  var nonce=${JSON.stringify(String(nonce))};
  var policy=${JSON.stringify(policy === 'programmatic' ? 'programmatic' : 'user')};
  var last=-1;
  var send=function(message){try{parent.postMessage(Object.assign({nonce:nonce},message),'*')}catch(error){}};
  var height=function(){var root=document.documentElement;var body=document.body;return Math.max(root?root.scrollHeight:0,body?body.scrollHeight:0,root?root.offsetHeight:0,body?body.offsetHeight:0)};
  var report=function(){var next=Math.max(80,Math.min(1200,Math.ceil(height())));if(next===last)return;last=next;send({type:'mosaic:height',height:next})};
  var schedule=function(){requestAnimationFrame(report)};
  // A browser-verified gesture, not a widget-supplied flag: userActivation cannot be forged
  // by page script, so an auto-firing widget is refused unless it opted into programmatic.
  var activated=function(){var ua=navigator.userActivation;return ua===undefined||ua.isActive===true};
  window.mosaic={action:function(name,payload){if(policy!=='programmatic'&&!activated())return;send({type:'mosaic:action',action:String(name||'action'),payload:payload&&typeof payload==='object'?payload:{}})},resize:report};
  window.addEventListener('message',function(event){var data=event&&event.data;if(!data||typeof data!=='object'||data.type!=='mosaic:theme')return;if(data.nonce!==undefined&&data.nonce!==nonce)return;try{if(data.theme&&typeof data.theme==='object'){Object.keys(data.theme).forEach(function(key){document.documentElement.style.setProperty('--mosaic-'+key,String(data.theme[key]))})}report()}catch(error){}},false);
  window.addEventListener('load',function(){schedule();setTimeout(schedule,120);setTimeout(schedule,600)});
  if(typeof ResizeObserver==='function'){try{new ResizeObserver(schedule).observe(document.documentElement)}catch(error){}if(document.body){try{new ResizeObserver(schedule).observe(document.body)}catch(error){}}}
  if(document.body&&typeof MutationObserver==='function'){try{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true})}catch(error){}}
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(schedule).catch(function(){})}
  send({type:'mosaic:ready'});schedule();
})();`
    }

    function widgetDocument(code, nonce, theme, policy) {
      const safe = String(code).slice(0, 20000)
        .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, '')
        .replace(/<base\b[^>]*>/gi, '')
      const style = `<style>:root{${Object.keys(theme).map((key) => `--mosaic-${key}:${theme[key]};`).join('')}color-scheme:light dark}html,body{margin:0;padding:0;background:var(--mosaic-bg,transparent);color:var(--mosaic-text,canvastext);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.55}*,*::before,*::after{box-sizing:border-box}a{color:var(--mosaic-accent)}</style>`
      const head = `<!-- dsh-mosaic sandbox --><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">${style}<script>${widgetBridge(nonce, policy)}</script>`
      if (/<html[\s>]/i.test(safe)) {
        if (/<head[\s>]/i.test(safe)) {
          if (/<\/head>/i.test(safe)) return safe.replace(/<\/head>/i, `${head}</head>`)
          if (/<body[\s>]/i.test(safe)) return safe.replace(/<body[\s>]/i, `${head}<body`)
          return safe.replace(/<head[^>]*>/i, (match) => `${match}${head}`)
        }
        return safe.replace(/<html[^>]*>/i, (match) => `${match}<head>${head}</head>`)
      }
      return `<!doctype html><html lang="${(typeof document !== 'undefined' && document.documentElement.lang) || 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${safe}</body></html>`
    }

    /** One widget may send this many actions per window; larger payloads are dropped. */
    const WIDGET_ACTIONS_PER_WINDOW = 10
    const WIDGET_ACTION_WINDOW_MS = 60000
    const WIDGET_ACTION_MAX_CHARS = 16384

    function WidgetFrame({ node, onAction, onFullscreen, fullscreen = false }) {
      const [height, setHeight] = useState(node.height ?? 320)
      const [showCode, setShowCode] = useState(false)
      const [reload, setReload] = useState(0)
      const iframeRef = useRef(null)
      const nonce = useMemo(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, [reload])
      // The initial theme is embedded once; later changes ride postMessage so a
      // theme refresh cannot reload the iframe through a changed srcDoc.
      const initialTheme = useMemo(() => themeSnapshot(iframeRef.current?.parentElement), [])
      const policy = node.actions === 'programmatic' ? 'programmatic' : 'user'
      const html = useMemo(() => widgetDocument(node.code, nonce, initialTheme, policy), [node.code, nonce, initialTheme, policy])
      const actionTimes = useRef([])
      const sendTheme = useCallback(() => {
        const next = themeSnapshot(iframeRef.current?.parentElement)
        iframeRef.current?.contentWindow?.postMessage({ type: 'mosaic:theme', nonce, theme: next }, '*')
      }, [nonce])
      useEffect(() => {
        const onMessage = (event) => {
          if (event.source !== iframeRef.current?.contentWindow) return
          const data = event.data
          if (!data || typeof data !== 'object' || data.nonce !== nonce) return
          if (data.type === 'mosaic:height') {
            setHeight(clamp(Number(data.height) || 320, 120, 900))
          } else if (data.type === 'mosaic:action') {
            const now = Date.now()
            const recent = actionTimes.current.filter((at) => now - at < WIDGET_ACTION_WINDOW_MS)
            actionTimes.current = recent
            if (recent.length >= WIDGET_ACTIONS_PER_WINDOW) {
              reportLog('warn', 'widget.action-dropped', { reason: 'rate', action: String(data.action ?? '').slice(0, 64) })
              return
            }
            const payload = data.payload && typeof data.payload === 'object' ? data.payload : {}
            let serialized
            try {
              serialized = JSON.stringify(payload)
            } catch {
              return
            }
            if (serialized.length > WIDGET_ACTION_MAX_CHARS) {
              reportLog('warn', 'widget.action-dropped', { reason: 'size', chars: serialized.length })
              return
            }
            recent.push(now)
            onAction?.(String(data.action || 'action').slice(0, 64), payload)
          }
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [nonce, onAction])
      useEffect(() => {
        const timer = setTimeout(sendTheme, 80)
        // A fence lives in its own React root, so a host appearance change does not
        // re-render it; the iframe copies resolved tokens and needs the update posted.
        // `body[data-ds-dark-theme]` is the documented signal the theme sets, and this
        // is the only host attribute the plugin reads.
        const stopWatching = onAppearanceChange(sendTheme)
        return () => {
          clearTimeout(timer)
          stopWatching()
        }
      }, [sendTheme])
      return h('div', { className: 'mosaic-widget' },
        h('div', { className: 'mosaic-widget-head' },
          h('span', { className: 'mosaic-widget-title' }, renderRich(node.title ?? 'Interactive widget')),
          h('span', { className: 'mosaic-widget-actions' },
            h('button', { type: 'button', className: 'mosaic-widget-action', onClick: () => setShowCode((value) => !value) }, showCode ? translate('preview') : translate('code')),
            h('button', { type: 'button', className: 'mosaic-widget-action', onClick: () => setReload((value) => value + 1) }, translate('reload')),
            !fullscreen && onFullscreen ? h('button', { type: 'button', className: 'mosaic-widget-action', onClick: onFullscreen }, translate('fullscreen')) : null)),
        showCode
          ? h('pre', { className: 'mosaic-widget-code' }, node.code)
          : h('iframe', {
            key: reload,
            ref: iframeRef,
            className: 'mosaic-widget-iframe',
            sandbox: 'allow-scripts allow-forms allow-popups',
            referrerPolicy: 'no-referrer',
            srcDoc: html,
            title: node.title ?? 'Interactive widget',
            style: { height: fullscreen ? 'calc(86vh - 90px)' : `${height}px` },
            onLoad: sendTheme,
          }),
        node.caption ? h('div', { className: 'mosaic-widget-caption' }, renderRich(node.caption)) : null)
    }

    /* ------------------------------------------------------------------ */
    /* layout + dispatcher                                                 */
    /* ------------------------------------------------------------------ */

    function GridItem({ node, path, depth }) {
      return h('div', {
        className: 'mosaic-grid-item',
        style: node.span ? { gridColumn: `span ${node.span}` } : undefined,
      }, h(NodeView, { node, path, depth }))
    }

    // Where this package's assets live. The Host publishes the current URL on the
    // prompt endpoint, so a moved route never strands a browser that loaded an older
    // bundle; the literal path is the fallback when the endpoint is unreachable.
    const MERMAID_ROUTE = '/dsh-mosaic/assets/mermaid.min.js'
    const MERMAID_TIMEOUT_MS = 20000
    let mermaidAssetPromise = null
    let mermaidThemeKey = null

    /**
     * Ask the Host for its asset URL, then append the built-in fallback.
     *
     * @returns {Promise<string[]>} candidate script URLs, in the order to try them.
     */
    function mermaidCandidates() {
      const fromHost = fetch(PROMPT_URL, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => (data && data.assets && typeof data.assets.mermaid === 'string' ? [data.assets.mermaid] : []))
        .catch(() => [])
      return fromHost.then((list) => [...new Set([...list, MERMAID_ROUTE])])
    }

    /**
     * Load one script and resolve with the engine it registers.
     *
     * @param {string} src - absolute same-origin URL.
     * @returns {Promise<object>} the Mermaid API.
     */
    function injectMermaidScript(src) {
      return new Promise((resolve, reject) => {
        const script = document.createElement('script')
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error(`timed out after ${MERMAID_TIMEOUT_MS} ms`))
        }, MERMAID_TIMEOUT_MS)
        function cleanup() {
          clearTimeout(timer)
          script.onload = null
          script.onerror = null
          script.remove()
        }
        script.src = src
        script.async = true
        script.onload = () => {
          const api = window.mermaid
          cleanup()
          if (!api || typeof api.render !== 'function') reject(new Error(`${src} did not expose the Mermaid API`))
          else resolve(api)
        }
        script.onerror = () => {
          cleanup()
          reject(new Error(`${src} could not be loaded`))
        }
        document.head.appendChild(script)
      })
    }

    function loadMermaidAsset() {
      const existing = window.mermaid
      if (existing && typeof existing.render === 'function') return Promise.resolve(existing)
      if (mermaidAssetPromise !== null) return mermaidAssetPromise
      mermaidAssetPromise = mermaidCandidates()
        .then(async (candidates) => {
          const failures = []
          for (const candidate of candidates) {
            try {
              return await injectMermaidScript(candidate)
            } catch (error) {
              failures.push(error instanceof Error ? error.message : String(error))
            }
          }
          throw new Error(`Mermaid asset failed to load: ${failures.join('; ')}`)
        })
        .catch((error) => {
          // Let a later diagram retry instead of caching the failure for the session.
          mermaidAssetPromise = null
          throw error
        })
      return mermaidAssetPromise
    }

    /** Resolved host tokens mapped onto Mermaid's base theme. */
    function mermaidThemeVariables(host) {
      const theme = themeSnapshot(host)
      return {
        background: theme.bg ?? 'transparent',
        primaryColor: theme.card ?? theme.bg ?? 'transparent',
        primaryTextColor: theme.text ?? 'canvastext',
        primaryBorderColor: theme.border ?? 'currentColor',
        lineColor: theme.muted ?? theme.border ?? 'currentColor',
        secondaryColor: theme.card ?? theme.bg ?? 'transparent',
        tertiaryColor: theme.bg ?? 'transparent',
        fontFamily: 'inherit',
        fontSize: '12px',
      }
    }

    /**
     * Strip anything active from the SVG Mermaid produced before it reaches the page.
     *
     * Mermaid runs with `securityLevel: 'strict'` and `htmlLabels: false`, so this is a
     * second, independent gate against scripts, event handlers, script-bearing URLs and
     * remote stylesheet imports.
     *
     * @param {string} markup - the SVG string returned by `mermaid.render`.
     * @returns {string} sanitized SVG markup.
     */
    function sanitizeMermaidSvg(markup) {
      const parsed = new DOMParser().parseFromString(String(markup), 'image/svg+xml')
      const root = parsed.documentElement
      if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
        throw new Error('Mermaid returned malformed SVG')
      }
      for (const element of [...root.querySelectorAll('script, foreignObject, iframe, object, embed')]) element.remove()
      for (const element of [root, ...root.querySelectorAll('*')]) {
        for (const attribute of [...element.attributes]) {
          const name = attribute.name.toLowerCase()
          if (name.startsWith('on')) {
            element.removeAttribute(attribute.name)
            continue
          }
          const scriptable = /^\s*(javascript|vbscript|data:text\/html)/i.test(attribute.value)
          if ((name === 'href' || name === 'xlink:href' || name === 'src') && scriptable) element.removeAttribute(attribute.name)
          if (name === 'style' && /javascript:|expression\(/i.test(attribute.value)) element.removeAttribute(attribute.name)
        }
      }
      for (const style of [...root.querySelectorAll('style')]) {
        if (/@import|url\(\s*["']?https?:/i.test(style.textContent ?? '')) style.remove()
      }
      return new XMLSerializer().serializeToString(root)
    }

    /**
     * Render one diagram with the official Mermaid build.
     *
     * @param {string} source - Mermaid source generated from a diagram node.
     * @param {Element | null} container - the card being rendered, for theme tokens.
     * @returns {Promise<string>} sanitized SVG markup.
     */
    async function renderMermaid(source, container) {
      const api = await loadMermaidAsset()
      const host = container instanceof Element ? container : document.body
      // Mermaid resolves its theme once per initialize, so a new appearance has to
      // re-initialize before the next diagram can look right.
      const variables = mermaidThemeVariables(host)
      const themeKey = `${variables.background}|${variables.primaryColor}|${variables.primaryTextColor}`
      if (mermaidThemeKey !== themeKey) {
        api.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          htmlLabels: false,
          suppressErrorRendering: true,
          theme: 'base',
          themeVariables: variables,
        })
        mermaidThemeKey = themeKey
      }
      const id = `mosaic-mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      const rendered = await api.render(id, String(source))
      return sanitizeMermaidSvg(rendered.svg)
    }

    function mermaidLabel(value) {
      return String(value ?? '')
        .replace(/\s+/g, ' ')
        .replace(/"/g, '#quot;')
        .replace(/\|/g, '#124;')
        .trim()
    }

    /** Parse a token colour into `[r, g, b]`; `undefined` when it is not a plain colour. */
    function parseColor(value) {
      const text = String(value ?? '').trim()
      const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
      if (hex) {
        const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
        return [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16))
      }
      const rgb = /^rgba?\(([^)]+)\)$/i.exec(text)
      if (rgb) {
        const parts = rgb[1].split(',').slice(0, 3).map((part) => Number.parseFloat(part))
        if (parts.every((part) => Number.isFinite(part))) return parts.map((part) => Math.max(0, Math.min(255, Math.round(part))))
      }
      return undefined
    }

    /** Mix `color` over `base` by `weight` (0..1) and return a hex string. */
    function tint(color, base, weight) {
      const front = parseColor(color)
      const back = parseColor(base) ?? [255, 255, 255]
      if (!front) return undefined
      const mixed = front.map((channel, index) => Math.round(channel * weight + back[index] * (1 - weight)))
      return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    }

    /**
     * Resolve the card's tokens into the literal colours Mermaid's style parser accepts.
     *
     * Mermaid rejects `var(...)` and `rgba(...)` in `classDef`, so the source has to
     * carry resolved hex values; diagrams re-render when the appearance changes.
     *
     * @param {Element | null} host - the card being rendered.
     * @returns {{base: object, tones: Record<string, object>}} node styles.
     */
    function mermaidPalette(host) {
      const theme = themeSnapshot(host)
      const bg = theme.bg ?? '#ffffff'
      const card = theme.card ?? bg
      const text = theme.text ?? '#111111'
      const border = theme.border ?? '#999999'
      const node = (stroke) => ({
        fill: tint(stroke, card, 0.12) ?? card,
        stroke,
        color: text,
      })
      return {
        base: { fill: card, stroke: border, color: text },
        tones: {
          accent: node(theme.accent ?? border),
          success: node(theme.success ?? border),
          warning: node(theme.warn ?? border),
          danger: node(theme.danger ?? border),
          muted: node(theme.muted ?? border),
        },
      }
    }

    function toMermaid(node, palette) {
      if (node.kind === 'sequence') {
        const participants = Array.isArray(node.participants) ? node.participants : []
        const messages = Array.isArray(node.messages) ? node.messages : []
        const idOf = new Map(participants.map((participant, index) => [participant.id, `p${index}`]))
        const lines = ['sequenceDiagram']
        participants.forEach((participant) => {
          lines.push(`  participant ${idOf.get(participant.id)} as ${mermaidLabel(participant.label)}`)
        })
        messages.forEach((message) => {
          const from = idOf.get(message.from)
          const to = idOf.get(message.to)
          if (!from || !to) return
          const arrow = message.kind === 'return' ? '-->>' : message.kind === 'async' ? '-)' : '->>'
          lines.push(`  ${from}${arrow}${to}: ${mermaidLabel(message.label)}`)
        })
        return lines.join('\n')
      }
      const nodes = Array.isArray(node.nodes) ? node.nodes : []
      const edges = Array.isArray(node.edges) ? node.edges : []
      const idOf = new Map(nodes.map((entry, index) => [entry.id, `n${index}`]))
      const styleOf = (style) => `fill:${style.fill},stroke:${style.stroke},color:${style.color}`
      const tones = palette?.tones ?? {}
      const baseStyle = palette?.base ? styleOf(palette.base) : undefined
      const usedTones = new Set()
      const lines = [`flowchart ${node.direction === 'LR' ? 'LR' : 'TB'}`]
      nodes.forEach((entry) => {
        const label = mermaidLabel(entry.label)
        const withSub = entry.sub ? `${label}<br/>${mermaidLabel(entry.sub)}` : label
        const id = idOf.get(entry.id)
        if (entry.shape === 'diamond') lines.push(`  ${id}{${withSub}}`)
        else if (entry.shape === 'round') lines.push(`  ${id}(${withSub})`)
        else lines.push(`  ${id}[${withSub}]`)
        if (entry.tone === undefined && baseStyle !== undefined) lines.push(`  class ${id} mosaic_base`)
        if (tones[entry.tone]) {
          usedTones.add(entry.tone)
          lines.push(`  class ${id} mosaic_${entry.tone}`)
        }
      })
      edges.forEach((edge) => {
        const from = idOf.get(edge.from)
        const to = idOf.get(edge.to)
        if (!from || !to) return
        const arrow = edge.kind === 'dashed' ? '-.->' : edge.kind === 'accent' ? '==>' : '-->'
        const label = edge.label ? `|${mermaidLabel(edge.label)}|` : ''
        lines.push(`  ${from} ${arrow}${label} ${to}`)
      })
      if (baseStyle !== undefined) lines.push(`  classDef mosaic_base ${baseStyle}`)
      for (const tone of usedTones) lines.push(`  classDef mosaic_${tone} ${styleOf(tones[tone])}`)
      return lines.join('\n')
    }

    function escapeXml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
    }

    function drawioTone(tone) {
      if (tone === 'accent') return 'fillColor=#dae8fc;strokeColor=#6c8ebf;'
      if (tone === 'success') return 'fillColor=#d5e8d4;strokeColor=#82b366;'
      if (tone === 'warning') return 'fillColor=#fff2cc;strokeColor=#d6b656;'
      if (tone === 'danger') return 'fillColor=#f8cecc;strokeColor=#b85450;'
      if (tone === 'muted') return 'fillColor=#f5f5f5;strokeColor=#999999;'
      return 'fillColor=#ffffff;strokeColor=#999999;'
    }

    /**
     * Build a portable draw.io (mxGraph XML) file from a diagram node.
     * Positions are deliberately simple: the file is for opening and
     * polishing in draw.io, where the user can run its own layout.
     */
    function drawioXml(node) {
      const cells = []
      let index = 0
      const nextId = (prefix) => `${prefix}${index += 1}`
      const vertex = (id, value, style, x, y, w, h) => {
        cells.push(`<mxCell id="${escapeXml(id)}" value="${escapeXml(value)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`)
      }
      const edge = (id, from, to, label, style) => {
        cells.push(`<mxCell id="${escapeXml(id)}" value="${escapeXml(label ?? '')}" style="${style}" edge="1" parent="1" source="${escapeXml(from)}" target="${escapeXml(to)}"><mxGeometry relative="1" as="geometry"/></mxCell>`)
      }
      const baseStyle = 'whiteSpace=wrap;html=1;rounded=1;'
      const edgeStyle = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;'

      if (node.kind === 'sequence') {
        const ids = new Map()
        ;(node.participants ?? []).forEach((participant, i) => {
          const id = nextId('p')
          ids.set(participant.id, id)
          vertex(id, participant.label, `${baseStyle}fillColor=#dae8fc;strokeColor=#6c8ebf;`, 40 + i * 210, 40, 160, 44)
        })
        ;(node.messages ?? []).forEach((message) => {
          const from = ids.get(message.from)
          const to = ids.get(message.to)
          if (!from || !to) return
          edge(nextId('e'), from, to, message.label, `${edgeStyle}${message.kind === 'return' ? 'dashed=1;' : ''}`)
        })
      } else if (node.kind === 'timeline') {
        ;(node.items ?? []).forEach((item, i) => {
          vertex(nextId('t'), `${item.time ? `${item.time} · ` : ''}${item.title}${item.desc ? `<br/>${item.desc}` : ''}`, `${baseStyle}fillColor=#ffffff;strokeColor=#999999;`, 40, 40 + i * 86, 420, 64)
        })
      } else if (node.kind === 'layers') {
        ;(node.layers ?? []).forEach((layer, i) => {
          vertex(nextId('l'), `${layer.title}<br/>${(layer.items ?? []).join(' · ')}`, `${baseStyle}fillColor=#f5f5f5;strokeColor=#999999;`, 40, 40 + i * 96, 460, 70)
        })
      } else {
        const ids = new Map()
        ;(node.nodes ?? []).forEach((entry, i) => {
          const id = nextId('n')
          ids.set(entry.id, id)
          const x = 40 + (i % 3) * 220
          const y = 40 + Math.floor(i / 3) * 100
          const style = `${baseStyle}${drawioTone(entry.tone)}${entry.shape === 'diamond' ? 'rhombus;' : ''}`
          vertex(id, `${entry.label}${entry.sub ? `<br/>${entry.sub}` : ''}`, style, x, y, 170, 60)
        })
        ;(node.edges ?? []).forEach((entry) => {
          const from = ids.get(entry.from)
          const to = ids.get(entry.to)
          if (!from || !to) return
          const style = `${edgeStyle}${entry.kind === 'dashed' ? 'dashed=1;' : ''}${entry.kind === 'accent' ? 'strokeColor=#3b82f6;strokeWidth=2;' : ''}`
          edge(nextId('e'), from, to, entry.label, style)
        })
      }

      const name = node.title ?? 'Mosaic diagram'
      return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net" agent="dsh-mosaic" version="24.7.17">
  <diagram id="mosaic-${Date.now().toString(36)}" name="${escapeXml(name)}">
    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="827" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        ${cells.join('\n        ')}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`
    }

    function downloadDrawio(node) {
      const xml = drawioXml(node)
      const blob = new Blob([xml], { type: 'application/vnd.jgraph.mxfile' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${(node.title ?? 'mosaic-diagram').replace(/[\\/:*?"<>|]+/g, '-')}.drawio`
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    function MermaidDiagram({ node, fallback }) {
      const containerRef = useRef(null)
      const [state, setState] = useState({ status: 'loading', svg: '' })
      const [revision, setRevision] = useState(0)
      // A fence lives in its own root, so an appearance switch would otherwise leave
      // the diagram in the previous palette. Only this component re-renders; widgets
      // keep their iframe and state.
      useEffect(() => onAppearanceChange(() => setRevision((value) => value + 1)), [])
      useEffect(() => {
        let alive = true
        setState({ status: 'loading', svg: '' })
        const source = toMermaid(node, mermaidPalette(containerRef.current ?? document.body))
        renderMermaid(source, containerRef.current)
          .then((svg) => { if (alive) setState({ status: 'ready', svg }) })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            reportLog('warn', 'mermaid.failed', { message: message.slice(0, 200) })
            if (alive) setState({ status: 'error', svg: '', message })
          })
        return () => { alive = false }
      }, [node, revision])
      if (state.status === 'ready') {
        return h('div', {
          ref: containerRef,
          className: 'mosaic-mermaid',
          'data-diagram-engine': 'mermaid',
          // The string already passed sanitizeMermaidSvg; Mermaid itself runs with
          // securityLevel 'strict' and htmlLabels off.
          dangerouslySetInnerHTML: { __html: state.svg },
        })
      }
      if (state.status === 'error') {
        return h('div', null, fallback, h('div', { className: 'mosaic-caption-line' }, translate('mermaidFallback', { message: state.message })))
      }
      return h('div', { className: 'mosaic-skeleton', 'data-diagram-engine': 'mermaid' }, h('span'), h('span'), h('span'))
    }

    function shorten(text, max) {
      const value = String(text ?? '')
      return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value
    }

    function diagramTone(tone) {
      if (tone === 'accent') return { fill: 'color-mix(in srgb,var(--m-accent) 12%,var(--m-bg))', stroke: 'var(--m-accent)' }
      if (tone === 'success') return { fill: 'color-mix(in srgb,var(--m-success) 12%,var(--m-bg))', stroke: 'var(--m-success)' }
      if (tone === 'warning') return { fill: 'color-mix(in srgb,var(--m-warn) 12%,var(--m-bg))', stroke: 'var(--m-warn)' }
      if (tone === 'danger') return { fill: 'color-mix(in srgb,var(--m-danger) 12%,var(--m-bg))', stroke: 'var(--m-danger)' }
      if (tone === 'muted') return { fill: 'var(--m-bg2)', stroke: 'var(--m-border)' }
      return { fill: 'var(--m-bg)', stroke: 'var(--m-border)' }
    }

    function diagramDisplaySize(width, height) {
      const scale = Math.min(1, 560 / Math.max(1, height))
      return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
    }

    function FlowchartDiagram({ node }) {
      const layout = useMemo(() => {
        const nodes = Array.isArray(node.nodes) ? node.nodes : []
        const edges = Array.isArray(node.edges) ? node.edges : []
        const direction = node.direction === 'LR' ? 'LR' : 'TB'
        const byId = new Map(nodes.map((entry) => [entry.id, entry]))
        const next = new Map(nodes.map((entry) => [entry.id, []]))
        const incoming = new Map(nodes.map((entry) => [entry.id, 0]))
        for (const edge of edges) {
          if (!byId.has(edge.from) || !byId.has(edge.to)) continue
          next.get(edge.from).push(edge.to)
          incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1)
        }
        const layer = new Map()
        const roots = nodes.filter((entry) => (incoming.get(entry.id) ?? 0) === 0).map((entry) => entry.id)
        const queue = [...roots]
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          const id = queue[cursor]
          if (!layer.has(id)) layer.set(id, 0)
          for (const child of next.get(id) ?? []) {
            layer.set(child, Math.max(layer.get(child) ?? 0, (layer.get(id) ?? 0) + 1))
            incoming.set(child, (incoming.get(child) ?? 1) - 1)
            if ((incoming.get(child) ?? 0) === 0) queue.push(child)
          }
        }
        // Kahn's pass cannot rank nodes behind a cycle (for example a cache
        // backfill edge). Walk from every root once, ignoring back edges, so
        // those nodes still get a rank instead of collapsing onto layer 0.
        const visited = new Set()
        const visit = (id, depth) => {
          if (depth > nodes.length) return
          layer.set(id, Math.max(layer.get(id) ?? 0, depth))
          if (visited.has(id)) return
          visited.add(id)
          for (const child of next.get(id) ?? []) {
            if (!visited.has(child)) visit(child, depth + 1)
          }
        }
        for (const id of roots) visit(id, 0)
        for (const entry of nodes) if (!visited.has(entry.id)) visit(entry.id, 0)
        for (const entry of nodes) if (!layer.has(entry.id)) layer.set(entry.id, 0)
        const maxLayer = Math.max(0, ...layer.values())
        const groups = Array.from({ length: maxLayer + 1 }, () => [])
        for (const entry of nodes) groups[layer.get(entry.id) ?? 0].push(entry)
        const NODE_W = 150
        const NODE_H = 48
        const GAP_X = 28
        const GAP_Y = 54
        const maxCount = Math.max(1, ...groups.map((group) => group.length))
        const width = direction === 'TB'
          ? maxCount * NODE_W + (maxCount - 1) * GAP_X
          : (maxLayer + 1) * NODE_W + maxLayer * GAP_Y
        const height = direction === 'TB'
          ? (maxLayer + 1) * NODE_H + maxLayer * GAP_Y
          : maxCount * NODE_H + (maxCount - 1) * GAP_X
        const positions = new Map()
        groups.forEach((group, layerIndex) => {
          const groupWidth = group.length * NODE_W + (group.length - 1) * GAP_X
          const groupHeight = group.length * NODE_H + (group.length - 1) * GAP_X
          group.forEach((entry, index) => {
            const x = direction === 'TB'
              ? (width - groupWidth) / 2 + index * (NODE_W + GAP_X)
              : layerIndex * (NODE_W + GAP_Y)
            const y = direction === 'TB'
              ? layerIndex * (NODE_H + GAP_Y)
              : (height - groupHeight) / 2 + index * (NODE_H + GAP_X)
            positions.set(entry.id, { x, y, w: NODE_W, h: NODE_H })
          })
        })
        const paths = []
        let maxX = width
        let maxY = height
        const layerStep = NODE_H + GAP_Y
        const rankStep = NODE_W + GAP_Y
        for (const edge of edges) {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) continue
          let path
          let labelX
          let labelY
          if (direction === 'TB') {
            const x1 = from.x + from.w / 2
            const y1 = from.y + from.h
            const x2 = to.x + to.w / 2
            const y2 = to.y
            if (to.y - from.y > layerStep * 1.5) {
              // A skip edge is routed around the right side so it does not
              // pass through the nodes on the intermediate layers.
              const lane = Math.max(from.x + from.w, to.x + to.w) + 24
              path = `M ${x1} ${y1} L ${lane} ${y1} L ${lane} ${y2} L ${x2} ${y2}`
              labelX = lane + 10
              labelY = (y1 + y2) / 2
              maxX = Math.max(maxX, lane + 52)
            } else if (to.y > from.y) {
              path = `M ${x1} ${y1} L ${x2} ${y2}`
              labelX = (x1 + x2) / 2
              labelY = (y1 + y2) / 2
            } else {
              const bend = Math.max(from.x + from.w, to.x + to.w) + 28
              path = `M ${x1} ${y1} C ${bend} ${y1 + 18}, ${bend} ${y2 - 18}, ${x2} ${y2}`
              labelX = (x1 + x2) / 2
              labelY = (y1 + y2) / 2
              maxX = Math.max(maxX, bend + 34)
            }
          } else {
            const x1 = from.x + from.w
            const y1 = from.y + from.h / 2
            const x2 = to.x
            const y2 = to.y + to.h / 2
            if (to.x - from.x > rankStep * 1.5) {
              const lane = Math.max(from.y + from.h, to.y + to.h) + 24
              path = `M ${x1} ${y1} L ${x1} ${lane} L ${x2} ${lane} L ${x2} ${y2}`
              labelX = (x1 + x2) / 2
              labelY = lane + 14
              maxY = Math.max(maxY, lane + 42)
            } else if (to.x > from.x) {
              path = `M ${x1} ${y1} L ${x2} ${y2}`
              labelX = (x1 + x2) / 2
              labelY = (y1 + y2) / 2 - 5
            } else {
              const bend = Math.max(from.y + from.h, to.y + to.h) + 28
              path = `M ${x1} ${y1} C ${x1 + 18} ${bend}, ${x2 - 18} ${bend}, ${x2} ${y2}`
              labelX = (x1 + x2) / 2
              labelY = (y1 + y2) / 2 - 5
              maxY = Math.max(maxY, bend + 34)
            }
          }
          paths.push({ ...edge, path, labelX, labelY })
        }
        return { nodes, positions, paths, width: maxX, height: maxY }
      }, [node.nodes, node.edges, node.direction])

      const display = diagramDisplaySize(layout.width, layout.height)
      return h('svg', {
        className: 'mosaic-diagram',
        width: display.width,
        height: display.height,
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        style: { maxWidth: 'none', height: 'auto' },
        role: 'img',
        'aria-label': node.title ?? 'flowchart',
      },
      h('defs', null,
        h('marker', { id: 'mosaic-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--m-muted)' })),
        h('marker', { id: 'mosaic-arrow-accent', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--m-accent)' }))),
      layout.paths.map((edge, index) => h('path', {
        key: `e${index}`,
        d: edge.path,
        className: `diagram-edge${edge.kind === 'accent' ? ' diagram-edge-accent' : ''}${edge.kind === 'dashed' ? ' diagram-edge-dashed' : ''}`,
        markerEnd: edge.kind === 'accent' ? 'url(#mosaic-arrow-accent)' : 'url(#mosaic-arrow)',
      })),
      layout.paths.map((edge, index) => edge.label
        ? h('text', { key: `l${index}`, x: edge.labelX, y: edge.labelY, textAnchor: 'middle', className: 'diagram-edge-label' }, shorten(edge.label, 16))
        : null),
      layout.nodes.map((entry) => {
        const position = layout.positions.get(entry.id)
        if (!position) return null
        const tone = diagramTone(entry.tone)
        const shape = entry.shape ?? 'box'
        const centerX = position.x + position.w / 2
        const centerY = position.y + position.h / 2
        const labelY = entry.sub ? centerY - 4 : centerY + 4
        return h('g', { key: entry.id },
          shape === 'diamond'
            ? h('polygon', {
              className: 'diagram-node',
              points: `${centerX},${position.y} ${position.x + position.w},${centerY} ${centerX},${position.y + position.h} ${position.x},${centerY}`,
              fill: tone.fill, stroke: tone.stroke,
            })
            : h('rect', {
              className: 'diagram-node',
              x: position.x, y: position.y, width: position.w, height: position.h,
              rx: shape === 'round' ? position.h / 2 : 8,
              fill: tone.fill, stroke: tone.stroke,
            }),
          h('text', { x: centerX, y: labelY, textAnchor: 'middle', className: 'diagram-node-label' }, shorten(entry.label, 20)),
          entry.sub ? h('text', { x: centerX, y: centerY + 13, textAnchor: 'middle', className: 'diagram-node-sub' }, shorten(entry.sub, 22)) : null)
      }))
    }

    function SequenceDiagram({ node }) {
      const layout = useMemo(() => {
        const participants = Array.isArray(node.participants) ? node.participants : []
        const messages = Array.isArray(node.messages) ? node.messages : []
        const column = 160
        const width = Math.max(360, participants.length * column)
        const height = 80 + messages.length * 36 + 20
        const xOf = (id) => {
          const index = participants.findIndex((entry) => entry.id === id)
          return index < 0 ? 0 : 80 + index * column
        }
        return { participants, messages, width, height, xOf }
      }, [node.participants, node.messages])
      const display = diagramDisplaySize(layout.width, layout.height)
      return h('svg', {
        className: 'mosaic-diagram',
        width: display.width,
        height: display.height,
        viewBox: `0 0 ${layout.width} ${layout.height}`,
        style: { maxWidth: 'none', height: 'auto' },
        role: 'img',
        'aria-label': node.title ?? 'sequence diagram',
      },
      h('defs', null,
        h('marker', { id: 'mosaic-seq-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--m-text)' })),
        h('marker', { id: 'mosaic-seq-arrow-muted', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--m-muted)' })),
        h('marker', { id: 'mosaic-seq-arrow-accent', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' },
          h('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--m-accent)' }))),
      layout.participants.map((participant) => {
        const x = layout.xOf(participant.id)
        return h('g', { key: participant.id },
          h('rect', { className: 'diagram-participant', x: x - 65, y: 8, width: 130, height: 30, rx: 8 }),
          h('text', { x, y: 27, textAnchor: 'middle', className: 'diagram-participant-label' }, shorten(participant.label, 16)),
          h('line', { className: 'diagram-lifeline', x1: x, y1: 38, x2: x, y2: layout.height - 12 }))
      }),
      layout.messages.map((message, index) => {
        const x1 = layout.xOf(message.from)
        const x2 = layout.xOf(message.to)
        const y = 78 + index * 36
        const marker = message.kind === 'return'
          ? 'url(#mosaic-seq-arrow-muted)'
          : message.kind === 'async' ? 'url(#mosaic-seq-arrow-accent)' : 'url(#mosaic-seq-arrow)'
        return h('g', { key: index },
          x1 === x2
            ? h('path', {
              className: `diagram-message${message.kind === 'return' ? ' diagram-message-return' : ''}${message.kind === 'async' ? ' diagram-message-async' : ''}`,
              d: `M ${x1} ${y} C ${x1 + 34} ${y - 14}, ${x1 + 34} ${y + 14}, ${x1} ${y + 12}`,
              markerEnd: marker,
            })
            : h('line', {
              className: `diagram-message${message.kind === 'return' ? ' diagram-message-return' : ''}${message.kind === 'async' ? ' diagram-message-async' : ''}`,
              x1, y1: y, x2, y2: y, markerEnd: marker,
            }),
          h('text', { x: (x1 + x2) / 2, y: y - 6, textAnchor: 'middle', className: 'diagram-msg-label' }, shorten(message.label, 26)))
      }))
    }

    function TimelineDiagram({ node }) {
      return h('ol', { className: 'mosaic-timeline' }, (node.items ?? []).map((item, index) => h('li', { key: index, className: 'mosaic-timeline-item' },
        h('span', { className: 'mosaic-timeline-dot', 'aria-hidden': true }),
        item.time ? h('div', { className: 'mosaic-timeline-time' }, renderRich(item.time)) : null,
        h('div', { className: 'mosaic-timeline-title' }, renderRich(item.title)),
        item.desc ? h('div', { className: 'mosaic-timeline-desc' }, renderRich(item.desc)) : null)))
    }

    function LayersDiagram({ node }) {
      return h('div', { className: 'mosaic-layers' }, (node.layers ?? []).map((layer, index) => h('div', { key: index, className: 'mosaic-layer' },
        h('div', { className: 'mosaic-layer-title' }, renderRich(layer.title)),
        h('ul', { className: 'mosaic-layer-items' }, (layer.items ?? []).map((item, itemIndex) => h('li', { key: itemIndex }, renderRich(item)))))))
    }

    function DiagramNode({ node }) {
      const title = node.title ? h('div', { className: 'mosaic-stat-label' }, renderRich(node.title)) : null
      const head = h('div', { className: 'mosaic-diagram-head' },
        title ?? h('span'),
        h('button', {
          type: 'button',
          className: 'mosaic-diagram-export',
          title: translate('drawio'),
          onClick: () => downloadDrawio(node),
        }, 'drawio'))
      if (node.kind === 'sequence') {
        return h('div', null, head, h(MermaidDiagram, {
          node,
          fallback: h('div', { className: 'mosaic-diagram-wrap' }, h(SequenceDiagram, { node })),
        }))
      }
      if (node.kind === 'timeline') return h('div', null, head, h(TimelineDiagram, { node }))
      if (node.kind === 'layers') return h('div', null, head, h(LayersDiagram, { node }))
      return h('div', null, head, h(MermaidDiagram, {
        node,
        fallback: h('div', { className: 'mosaic-diagram-wrap' }, h(FlowchartDiagram, { node })),
      }))
    }

    function NodeView({ node, path = 'items[0]', depth = 0 }) {
      if (!node || depth > MAX_DEPTH) return null
      const view = useView()
      switch (node.type) {
        case 'text': return h(TextNode, { node })
        case 'row':
          return h('div', {
            className: `mosaic-row${node.wrap ? ' mosaic-row-wrap' : ''}`,
            style: {
              gap: node.gap !== undefined ? `${node.gap}px` : undefined,
              justifyContent: node.align === 'center' ? 'center' : node.align === 'end' ? 'flex-end' : node.align === 'between' ? 'space-between' : undefined,
            },
          }, node.items.map((child, index) => h(GridItem, { key: index, node: child, path: `${path}.items[${index}]`, depth: depth + 1 })))
        case 'col':
          return h('div', {
            className: 'mosaic-col',
            style: {
              gap: node.gap !== undefined ? `${node.gap}px` : undefined,
              ...(node.width ? { width: `${node.width}%`, flex: '0 0 auto' } : { flex: '1 1 0' }),
            },
          }, node.items.map((child, index) => h(NodeView, { key: index, node: child, path: `${path}.items[${index}]`, depth: depth + 1 })))
        case 'grid':
          return h('div', {
            className: 'mosaic-grid',
            style: {
              gridTemplateColumns: `repeat(${node.cols ?? 2}, minmax(0, 1fr))`,
              gap: node.gap !== undefined ? `${node.gap}px` : undefined,
            },
          }, node.items.map((child, index) => h(GridItem, { key: index, node: child, path: `${path}.items[${index}]`, depth: depth + 1 })))
        case 'card':
          return h('div', { className: `mosaic-card${node.flat ? ' mosaic-card-flat' : ''}${node.tone ? ` mosaic-card-${node.tone}` : ''}` },
            node.eyebrow ? h('div', { className: 'mosaic-eyebrow' }, renderRich(node.eyebrow)) : null,
            node.title ? h('div', { className: 'mosaic-card-title' }, renderRich(node.title)) : null,
            h('div', { className: 'mosaic-col', style: { gap: '10px' } },
              node.items.map((child, index) => h(NodeView, { key: index, node: child, path: `${path}.items[${index}]`, depth: depth + 1 }))))
        case 'divider': return h(DividerNode, { node })
        case 'spacer': return h(SpacerNode, { node })
        case 'stat': return h(StatNode, { node })
        case 'badge': return h(BadgeNode, { node })
        case 'progress': return h(ProgressNode, { node })
        case 'table': return h(TableNode, { node })
        case 'list': return h(ListNode, { node })
        case 'keyvalue': return h(KeyValueNode, { node })
        case 'steps': return h(StepsNode, { node })
        case 'callout': return h(CalloutNode, { node })
        case 'code': return h(CodeNode, { node })
        case 'diff': return h(DiffNode, { node })
        case 'chart': return h(ChartNode, { node })
        case 'diagram': return h(DiagramNode, { node })
        case 'image': return h(ImageNode, { node })
        case 'video': return h(VideoNode, { node })
        case 'audio': return h(AudioNode, { node })
        case 'pdf': return h(PdfNode, { node })
        case 'link': return h(LinkNode, { node })
        case 'button': return h(ButtonNode, { node })
        case 'input': return h(InputNode, { node, path })
        case 'select': return h(SelectNode, { node })
        case 'slider': return h(SliderNode, { node })
        case 'tabs': return h(TabsNode, { node, path })
        case 'quiz': return h(QuizNode, { key: `quiz-${view?.state.round ?? 0}`, node })
        case 'widget':
          return h(WidgetFrame, {
            node,
            onAction: (action, payload) => view?.action(action, payload),
            onFullscreen: view ? () => view.openOverlay(h(WidgetFrame, {
              node,
              fullscreen: true,
              onAction: (action, payload) => view.action(action, payload),
            })) : undefined,
          })
        default: return null
      }
    }

    function Block({ spec, stateKey, onAgentAction, sessionId, sourceJson }) {
      const [state, setState] = useState(() => {
        const base = { fields: {}, tabs: {}, round: 0 }
        if (!stateKey) return base
        const stored = loadState(stateKey)
        return stored ? { ...base, ...stored } : base
      })
      const [fullscreen, setFullscreen] = useState(null)
      const [copiedJson, setCopiedJson] = useState(false)
      const copyTimer = useRef(null)
      const closeOverlay = useCallback(() => setFullscreen(null), [])
      const openOverlay = useCallback((node) => setFullscreen(node), [])
      const copyJson = useCallback(() => {
        if (!sourceJson) return
        Promise.resolve(copyText(sourceJson)).then(() => {
          setCopiedJson(true)
          if (copyTimer.current) clearTimeout(copyTimer.current)
          copyTimer.current = setTimeout(() => setCopiedJson(false), 1600)
        })
      }, [sourceJson])
      useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])
      useEffect(() => {
        if (!stateKey) return
        const timer = setTimeout(() => saveState(stateKey, state), 300)
        return () => clearTimeout(timer)
      }, [stateKey, state])
      const setField = useCallback((id, value) => {
        setState((current) => current.fields[id] === value ? current : { ...current, fields: { ...current.fields, [id]: value } })
      }, [])
      const setTab = useCallback((key, index) => {
        setState((current) => ({ ...current, tabs: { ...current.tabs, [key]: index } }))
      }, [])
      const reset = useCallback(() => {
        setState((current) => ({ fields: {}, tabs: {}, round: (current.round ?? 0) + 1 }))
        if (stateKey) clearState(stateKey)
      }, [stateKey])
      const action = useCallback((name, payload) => {
        if (sessionId === undefined) return
        onAgentAction?.(name, payload)
      }, [onAgentAction, sessionId])
      const api = useMemo(() => ({
        state,
        setField,
        setTab,
        reset,
        action,
        canAct: sessionId !== undefined,
        openOverlay,
      }), [state, setField, setTab, reset, action, sessionId, openOverlay])
      // The fullscreen surface stays inside this component tree and enters the page
      // through a portal, so it owns no extra root and unmounts with the block.
      return h(Fragment, null,
        h(ViewContext.Provider, { value: api },
          h('div', { className: 'mosaic-root', 'data-mosaic-root': '' },
            h('div', { className: 'mosaic-head' },
              spec.title ? h('div', { className: 'mosaic-banner' }, renderRich(spec.title)) : h('span', { className: 'mosaic-banner' }),
              sourceJson ? h('button', {
                type: 'button',
                className: 'mosaic-json-copy',
                title: translate('copyJson'),
                onClick: copyJson,
              }, copiedJson ? translate('copied') : translate('copyJson')) : null),
            h('div', { className: 'mosaic-col', style: { gap: `${spec.gap ?? 12}px` } },
              spec.items.map((node, index) => h(NodeView, {
                key: index,
                node,
                path: `items[${index}]`,
                depth: 0,
              })))))
        , fullscreen !== null ? ReactDOM.createPortal(
          h(Overlay, { onClose: closeOverlay }, fullscreen),
          document.body,
        ) : null)
    }

    function Overlay({ children, onClose }) {
      const panel = useRef(null)
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        const previous = document.activeElement
        panel.current?.focus()
        return () => {
          document.removeEventListener('keydown', onKey)
          if (previous instanceof HTMLElement) previous.focus()
        }
      }, [onClose])
      return h('div', {
        ref: panel,
        tabIndex: -1,
        className: 'mosaic-overlay',
        role: 'dialog',
        'aria-modal': 'true',
        onMouseDown: (event) => { if (event.target === event.currentTarget) onClose() },
      }, h('div', { className: 'mosaic-overlay-body' },
        h('button', { type: 'button', className: 'mosaic-overlay-close', onClick: onClose, 'aria-label': translate('close') }, '×'),
        children))
    }

    /* ------------------------------------------------------------------ */
    /* fence + tool view + apply                                           */
    /* ------------------------------------------------------------------ */

    function FenceView({ raw, settled, fenceKey, sessionId, onAgentAction }) {
      const spec = useMemo(() => parseView(raw), [raw])
      if (!spec) return h('div', { className: 'mosaic-skeleton' }, h('span'), h('span'), h('span'))
      const stateKey = settled && sessionId
        ? `mosaic:f:${sessionId}:${fenceKey}:${fingerprint(raw)}`
        : undefined
      return h(Block, {
        key: stateKey ?? 'stream',
        spec,
        stateKey,
        sessionId,
        onAgentAction,
        sourceJson: raw,
      })
    }

    function ToolFallback({ toolName, callId }) {
      return h('div', { className: 'mosaic-tool-fallback' },
        h('b', null, toolName || 'render_view'),
        h('span', null, callId || 'replayed call has no presentation meta'))
    }

    function ToolView(props) {
      const block = props.block
      const meta = block && typeof block === 'object' && 'meta' in block ? block.meta : undefined
      const spec = meta && typeof meta === 'object' && Array.isArray(meta.items) && meta.items.length > 0 ? meta : null
      if (!spec) return h(ToolFallback, { toolName: props.toolName, callId: block?.callId })
      const sessionId = props.sessionId
      const stateKey = sessionId && block?.callId ? `mosaic:t:${sessionId}:${block.callId}` : undefined
      return h(Block, {
        spec,
        stateKey,
        sessionId,
        onAgentAction: (action, payload) => props.sendAction(sessionId, action, payload),
      })
    }

    function blockOf(pre) {
      if (!(pre instanceof Element)) return null
      // Prefer the outer code-block surface: the host nests the content holder
      // (`[data-code-block-content]`) inside the banner-bearing `.md-code-block`.
      let surface = pre.closest('.md-code-block, .code-block, .code-block-small')
      if (!surface) {
        const content = pre.closest('[data-code-block-content]')
        surface = content?.parentElement
          ?? (pre.parentElement && pre.parentElement.querySelectorAll('pre').length === 1 ? pre.parentElement : null)
        for (let hops = 0; surface && hops < 3; hops += 1) {
          if (surface.querySelector('[data-code-block-banner]')
            || surface.matches('.md-code-block, .code-block, .code-block-small')) break
          surface = surface.parentElement
        }
      }
      if (!surface) return null
      if (surface.closest('.mosaic-fence, .mosaic-overlay-host, [data-chat-group-part="reasoning"], [data-tool], [data-sidebar-chat], [data-sidebar-right-session], [data-sidebar-right-panel], [data-panel-conversation], [data-plugin-panel]')) return null
      if (surface.querySelectorAll('pre').length !== 1) return null
      for (const element of surface.querySelectorAll('p, ul, ol, dl, table, h1, h2, h3, h4, h5, h6, blockquote, hr, img, figure')) {
        if (!pre.contains(element)) return null
      }
      return surface
    }

    const VIEW_TYPES = new Set([
      'text', 'row', 'col', 'grid', 'card', 'divider', 'spacer',
      'stat', 'badge', 'progress', 'list', 'table', 'keyvalue', 'steps',
      'callout', 'code', 'diff', 'chart', 'diagram',
      'image', 'video', 'audio', 'pdf', 'link',
      'button', 'input', 'select', 'slider', 'tabs', 'quiz', 'widget',
    ])

    function looksLikeViewBody(raw) {
      const spec = parseView(raw)
      return spec !== null && spec.items.some((node) => node && typeof node.type === 'string' && VIEW_TYPES.has(node.type))
    }

    function languageOf(surface, pre) {
      const code = pre.querySelector('code')
      const className = typeof code?.className === 'string' ? code.className : ''
      if (/(?:^|\s)language-dsh-view(?:\s|$)/.test(className)) return 'dsh-view'
      for (const element of surface.querySelectorAll('*')) {
        if (pre.contains(element)) continue
        const text = (element.textContent ?? '').trim()
        if (text === 'dsh-view' && element.childElementCount === 0) return 'dsh-view'
      }
      const dataLanguage = pre.getAttribute('data-language') ?? code?.getAttribute('data-language')
      if (dataLanguage === 'dsh-view') return 'dsh-view'
      const jsonTagged = /(?:^|\s)language-jsonc?(?:\s|$)/.test(className)
        || dataLanguage === 'json'
        || Array.from(surface.querySelectorAll('*')).some((element) => !pre.contains(element)
          && element.childElementCount === 0
          && element.textContent.trim() === 'json')
      // The model sometimes labels the fence ```json even though the body is a
      // complete dsh-view spec. Render it only in an assistant row, and only
      // when the body actually contains a known Mosaic component.
      if ((jsonTagged || className === '')
        && surface.closest('[data-chat-flow-kind="assistant-step"]') !== null
        && looksLikeViewBody(rawOf(pre))) return 'dsh-view'
      return null
    }

    function rawOf(pre) {
      const code = pre.querySelector('code')
      return (code ? code.textContent : pre.textContent ?? '').replace(/\n$/, '')
    }

    function installFenceRenderer(ctx, sendAction) {
      if (typeof document === 'undefined') return () => {}
      const mounts = new Map()
      const diagnostics = new Map()
      const ids = new WeakMap()
      let nextId = 1
      let timer = null
      let disposed = false

      const sessionId = () => currentSessionId(ctx)

      function idOf(block) {
        if (!ids.has(block)) ids.set(block, nextId += 1)
        return ids.get(block)
      }

      function showDiagnostic(block, raw) {
        const existing = diagnostics.get(block)
        if (existing && existing.raw === raw) return
        const reason = describeParse(raw)
        reportLog('warn', 'fence.parse-failed', { chars: String(raw ?? '').length, reason })
        const text = translate('parseFailed', { detail: reason })
        const sibling = block.previousElementSibling
        if (sibling?.classList.contains('mosaic-diagnostic')) {
          sibling.textContent = text
          diagnostics.set(block, { strip: sibling, raw })
          return
        }
        if (existing) clearDiagnostic(block)
        const strip = document.createElement('div')
        strip.className = 'mosaic-diagnostic'
        strip.setAttribute('role', 'alert')
        strip.textContent = text
        block.before(strip)
        diagnostics.set(block, { strip, raw })
      }

      function clearDiagnostic(block) {
        const existing = diagnostics.get(block)
        if (!existing) return
        existing.strip.remove()
        diagnostics.delete(block)
      }

      function unmount(block) {
        const mount = mounts.get(block)
        if (!mount) return
        mounts.delete(block)
        try { mount.root.unmount() } catch {}
        mount.container.remove()
        block.style.display = ''
        block.removeAttribute('data-mosaic-rendered')
        clearDiagnostic(block)
      }

      function mount(block, raw, settled) {
        // Another observer generation may already own this block. The marker
        // is shared in the DOM, so a duplicate apply cannot stack fences.
        if (block.hasAttribute('data-mosaic-rendered')) return
        const spec = parseView(raw)
        if (!spec) {
          if (settled) showDiagnostic(block, raw)
          return
        }
        clearDiagnostic(block)
        const container = document.createElement('div')
        container.className = 'mosaic-fence'
        block.after(container)
        const root = ReactDOMClient.createRoot(container)
        const fenceSession = sessionId()
        const render = (nextRaw, nextSettled) => root.render(h(FenceView, {
          raw: nextRaw,
          settled: nextSettled,
          fenceKey: idOf(block),
          sessionId: fenceSession,
          onAgentAction: (action, payload) => sendAction(fenceSession, action, payload),
        }))
        try {
          render(raw, settled)
        } catch {
          try { root.unmount() } catch {}
          container.remove()
          return
        }
        block.style.display = 'none'
        block.setAttribute('data-mosaic-rendered', '')
        mounts.set(block, { container, root, raw, settled, render })
      }

      function update(block, raw, settled) {
        const mount = mounts.get(block)
        if (!mount) return
        const spec = parseView(raw)
        if (!spec) {
          if (!settled) return
          unmount(block)
          showDiagnostic(block, raw)
          return
        }
        mount.raw = raw
        mount.settled = settled
        // A host re-render can restore the original block's display without
        // touching structure; re-apply the surgery before the next paint.
        block.style.display = 'none'
        block.setAttribute('data-mosaic-rendered', '')
        try {
          mount.render(raw, settled)
        } catch {
          unmount(block)
        }
      }

      function scan() {
        if (disposed) return
        const seen = new Set()
        for (const pre of document.querySelectorAll('pre')) {
          const block = blockOf(pre)
          if (!block || seen.has(block)) continue
          seen.add(block)
          if (languageOf(block, pre) !== 'dsh-view') {
            if (mounts.has(block)) unmount(block)
            continue
          }
          const raw = rawOf(pre)
          if (raw.trim() === '') continue
          const settled = pre.closest('[data-streaming]') === null
          const existing = mounts.get(block)
          if (existing && (!existing.container.isConnected || !block.isConnected)) {
            unmount(block)
          }
          if (mounts.has(block)) update(block, raw, settled)
          else if (!block.hasAttribute('data-mosaic-rendered')) mount(block, raw, settled)
        }
        for (const block of [...mounts.keys()]) {
          if (!block.isConnected) unmount(block)
        }
        for (const block of [...diagnostics.keys()]) {
          if (!block.isConnected) clearDiagnostic(block)
        }
      }

      function schedule() {
        if (disposed || timer !== null) return
        timer = setTimeout(() => {
          timer = null
          scan()
        }, 40)
      }

      const onLocale = () => {
        for (const mount of mounts.values()) {
          try { mount.render(mount.raw, mount.settled) } catch {}
        }
      }
      const unsubscribeLocale = ctx.locale.subscribe(onLocale)
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'data-streaming'],
      })
      scan()

      return () => {
        disposed = true
        unsubscribeLocale()
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
        for (const block of [...mounts.keys()]) unmount(block)
        for (const block of [...diagnostics.keys()]) clearDiagnostic(block)
      }
    }

    function apply(ctx) {
      clearLegacyStorage()
      ctx.effect(ensureStyles, 'dsh-mosaic: styles')
      ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-mosaic: dictionaries')
      // A bound translate keeps its identity and resolves the active language per
      // call, so a component can hold it without subscribing on its own.
      translate = ctx.locale.bind(NS)
      const sendAction = makeSender(ctx)
      ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
        name: 'tool.call.toolview',
        key: 'render_view',
        locale: NS,
        inject: () => ({ sendAction }),
      }, ToolView))
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'mosaic',
        order: 30,
        label: () => translate('settingsTitle'),
        locale: NS,
      }, MosaicSettings))
      ctx.effect(() => installFenceRenderer(ctx, sendAction), 'dsh-mosaic: fence')
      console.info('[mosaic] client active; fence=dsh-view')
    }

    return { inject: ['slots', 'sessions', 'locale'], apply }
  },
})