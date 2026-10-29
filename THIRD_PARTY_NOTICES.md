# Third-party notices

## Mermaid

The lazy `lib/assets/mermaid.js` bundle contains [Mermaid](https://github.com/mermaid-js/mermaid), licensed under the MIT License.

The bundle wrapper is derived from the Mermaid lazy asset shipped by `@changfenhuang/dsh-genui` (MIT), adapted to register the engine on `window.__GenuiAssets__.mermaid`.

## draw.io / maxGraph

No draw.io or maxGraph runtime is bundled. The optional `.drawio` export emits the standard mxGraph XML format so the file can be opened in [draw.io](https://www.drawio.com/) (Apache-2.0).
