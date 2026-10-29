/**
 * Sandboxed widget document builder.
 *
 * The iframe is opaque-origin (`sandbox="allow-scripts allow-forms
 * allow-popups"`, no `allow-same-origin`), so the guest cannot read the host
 * page, cookies, or storage. The CSP removes network access and only allows the
 * inline/bootstrap script the widget needs. The host verifies both the message
 * source and the per-mount nonce before accepting anything.
 */

export const WIDGET_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob:",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "media-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

export const WIDGET_MAX_CODE = 20000

const DEFAULT_THEME = {
  bg: 'transparent',
  text: 'CanvasText',
  muted: 'GrayText',
  border: 'rgba(127,127,127,.35)',
  accent: '#3b82f6',
  success: '#16a34a',
  warn: '#d97706',
  danger: '#dc2626',
  card: 'rgba(127,127,127,.08)',
}

function fontStack() {
  return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
}

function widgetStyle(theme) {
  return `<style>
:root{
  --mosaic-bg:${theme.bg};
  --mosaic-text:${theme.text};
  --mosaic-muted:${theme.muted};
  --mosaic-border:${theme.border};
  --mosaic-accent:${theme.accent};
  --mosaic-success:${theme.success};
  --mosaic-warn:${theme.warn};
  --mosaic-danger:${theme.danger};
  --mosaic-card:${theme.card};
  color-scheme:${theme.dark ? 'dark' : 'light'};
}
html,body{margin:0;padding:0;background:transparent;color:var(--mosaic-text);font-family:${fontStack()};font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
*,*::before,*::after{box-sizing:border-box}
a{color:var(--mosaic-accent)}
</style>`
}

/** The bridge has no literal closing script tag, so it can be embedded safely. */
export function widgetBridgeSource(nonce) {
  const id = JSON.stringify(String(nonce))
  return `(function(){
  var nonce=${id};
  var lastHeight=-1;
  var send=function(message){try{parent.postMessage(Object.assign({nonce:nonce},message),'*')}catch(error){}};
  var height=function(){
    var root=document.documentElement;
    var body=document.body;
    return Math.max(
      root?root.scrollHeight:0,
      body?body.scrollHeight:0,
      root?root.offsetHeight:0,
      body?body.offsetHeight:0
    );
  };
  var report=function(){
    var next=Math.max(80,Math.min(1200,Math.ceil(height())));
    if(next===lastHeight)return;
    lastHeight=next;
    send({type:'mosaic:height',height:next});
  };
  var schedule=function(){requestAnimationFrame(report)};
  window.mosaic={
    action:function(name,payload){send({type:'mosaic:action',action:String(name||'action'),payload:payload&&typeof payload==='object'?payload:{}})},
    resize:report,
    theme:function(next){if(!next||typeof next!=='object')return;Object.keys(next).forEach(function(key){document.documentElement.style.setProperty('--mosaic-'+key,String(next[key]))})}
  };
  window.addEventListener('message',function(event){
    var data=event&&event.data;
    if(!data||typeof data!=='object'||data.type!=='mosaic:theme')return;
    if(data.nonce!==undefined&&data.nonce!==nonce)return;
    try{
      if(data.theme&&typeof data.theme==='object'){
        Object.keys(data.theme).forEach(function(key){
          document.documentElement.style.setProperty('--mosaic-'+key,String(data.theme[key]));
        });
      }
      if(data.colorScheme)document.documentElement.style.colorScheme=data.colorScheme;
      report();
    }catch(error){}
  },false);
  window.addEventListener('load',function(){schedule();setTimeout(schedule,120);setTimeout(schedule,600)});
  if(typeof ResizeObserver==='function'){
    try{new ResizeObserver(schedule).observe(document.documentElement)}catch(error){}
    if(document.body){try{new ResizeObserver(schedule).observe(document.body)}catch(error){}}
  }
  if(document.body&&typeof MutationObserver==='function'){
    try{new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true})}catch(error){}
  }
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(schedule).catch(function(){})}
  send({type:'mosaic:ready'});
  schedule();
})();`
}

function stripConflictingMeta(code) {
  return code
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '')
}

function headMarkup(nonce, theme) {
  return `<!-- dsh-mosaic sandbox: opaque origin, no network -->
<meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">
<meta name="color-scheme" content="${theme.dark ? 'dark light' : 'light dark'}">
${widgetStyle(theme)}
<script>${widgetBridgeSource(nonce)}</script>
`
}

/**
 * Build a complete sandboxed document for a widget.
 *
 * A fragment is wrapped in a minimal document; a complete document keeps its
 * markup but receives the CSP, theme variables, and bridge before `</head>`.
 * Existing CSP/base tags are removed so the injected policy is authoritative.
 *
 * @param {string} code HTML/CSS/JS authored by the model or user.
 * @param {{ nonce: string, theme?: Record<string, string> }} options
 * @returns {string}
 */
export function buildWidgetDocument(code, options = {}) {
  if (typeof code !== 'string') throw new TypeError('widget code must be a string')
  if (code.length > WIDGET_MAX_CODE) throw new RangeError(`widget code exceeds ${WIDGET_MAX_CODE} characters`)
  const nonce = options.nonce === undefined ? '' : String(options.nonce)
  const theme = { ...DEFAULT_THEME, ...(options.theme && typeof options.theme === 'object' ? options.theme : {}) }
  const safeCode = stripConflictingMeta(code)
  const injection = headMarkup(nonce, theme)

  if (/<html[\s>]/i.test(safeCode)) {
    if (/<head[\s>]/i.test(safeCode)) {
      if (/<\/head>/i.test(safeCode)) return safeCode.replace(/<\/head>/i, `${injection}</head>`)
      if (/<body[\s>]/i.test(safeCode)) return safeCode.replace(/<body[\s>]/i, `${injection}<body`)
      return safeCode.replace(/<head[^>]*>/i, (match) => `${match}${injection}`)
    }
    return safeCode.replace(/<html[^>]*>/i, (match) => `${match}<head>${injection}</head>`)
  }

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${injection}
</head>
<body>${safeCode}</body>
</html>`
}