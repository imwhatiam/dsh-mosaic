# Publishing dsh-mosaic

## Before the first public release

1. Create the GitHub repository. Add the topic `dsh-plugin`; the catalog's automated check looks for it.
2. Fill `repository`, `homepage`, and `bugs` in `package.json` after the repository URL exists.
3. Keep at least one version published on npm before submitting to the catalog. `npm pack --dry-run` must include `lib/assets/mermaid.js`, `screenshots.json`, and `assets/screenshots/`.
4. Add the repository to the catalog with `docs/catalog-entry.example.yml` copied to `data/plugins/imwhatiam__dsh-mosaic.yml` in `awesome-dsh-plugin/awesome-dsh-plugin`. One entry per PR; the repo must be at least one day old.
5. Add real screenshots under `assets/screenshots/` and list them in `screenshots.json` (1–8 images). dsh-market and the catalog site read this file directly; relative paths break visibly if a file is renamed.
6. The catalog `icon` must be a GitHub-hosted raster image. This repo ships `assets/icon-180.png`; SVG is rejected by the catalog.
7. Do not edit the generated catalog README by hand. Change only your YAML entry.
8. README screenshots use relative paths so GitHub renders them. npm may not resolve relative README images; once the owner is known, use `https://raw.githubusercontent.com/imwhatiam/dsh-mosaic/main/assets/screenshots/...` in the README for the npm page. dsh-market does not use README images; it reads `screenshots.json`.

## Repository hygiene

- Do not commit `node_modules/`, `.pnpm-store/`, `tests/`, `.DS_Store`, or build/tarball artifacts. `.gitignore` covers the usual cases.
- Keep `LICENSE`, `THIRD_PARTY_NOTICES.md`, and the Mermaid asset attribution in the repository.
- The bundle patch disables `dsh-genui` to avoid two visual fence languages. Document this; users who want both can remove that row.
- The Mermaid asset is a lazy 3.2 MB JavaScript file. It is included in the npm tarball but not requested until a flowchart or sequence appears.
- The widget is an opaque-origin sandbox with no network. Do not add a network-backed script to it.

## Release checks

```sh
npm test
npm pack --dry-run
```

The package is unscoped `dsh-mosaic`; npm returned 404 for that name on 2026-10-29, but recheck before publishing. If it is taken, use your npm scope and update the install command in the README and the catalog entry.
