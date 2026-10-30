# Publishing dsh-mosaic

## Before the first public release

1. Create the GitHub repository. Add the topic `dsh-plugin`; the catalog's automated check looks for it.
2. Fill `repository`, `homepage`, and `bugs` in `package.json` after the repository URL exists.
3. Keep at least one version published on npm before submitting to the catalog. `npm pack --dry-run` must include `lib/assets/mermaid.js`, `screenshots.json`, and `assets/screenshots/`.
4. Add the repository to the catalog with `docs/catalog-entry.example.yml` copied to `data/plugins/imwhatiam__dsh-mosaic.yml` in `awesome-dsh-plugin/awesome-dsh-plugin`. One entry per PR; the repo must be at least one day old.
5. Add real screenshots under `assets/screenshots/` and list them in `screenshots.json`. Verified against installed DSH 0.2.1-rc.3: the Plugins page reads only `meta.title`, `meta.description` and the icon, so `screenshots.json` is a **catalog/community** convention, not a DSH one. Keep the paths inside the package and in sync with the filenames.
6. The catalog `icon` must be a GitHub-hosted raster image. This repo ships `assets/icon-180.png`; SVG is rejected by the catalog.
7. Do not edit the generated catalog README by hand. Change only your YAML entry.
8. The README preview uses an absolute `raw.githubusercontent.com` URL because npm does not resolve relative images. In-app detail documents (`meta.detail` + `docs/DETAIL.md`) are a newer-host feature and are deliberately not declared for 0.2.1-rc.3.

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
