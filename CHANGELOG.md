# Changelog

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
