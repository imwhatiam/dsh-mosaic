# Third-party notices

dsh-mosaic itself is released under the MIT License; see [`LICENSE`](./LICENSE).

## Mermaid

`lib/assets/mermaid.min.js` is the **unmodified** official distribution build of
[Mermaid](https://github.com/mermaid-js/mermaid) **12.2.0**, taken from the npm
package `mermaid@12.2.0`, file `dist/mermaid.min.js`.

| | |
| --- | --- |
| Upstream | https://github.com/mermaid-js/mermaid |
| Package | https://www.npmjs.com/package/mermaid/v/12.2.0 |
| License | MIT |
| SHA-256 | `a8a6a6f805b074a8261a2825c86f99c8054acb3b35f50bb7e24a4f9f2c3c3b9f` |
| Local changes | none (byte-identical to the published file) |

The MIT text shipped with that release is in
[`lib/assets/licenses/mermaid.LICENSE`](./lib/assets/licenses/mermaid.LICENSE).

Mosaic only calls the public `globalThis.mermaid` API (`initialize`, `render`) and
sanitizes the returned SVG before it enters the page; the rendering adapter is this
package's own source, not part of the bundled file.

## Dependencies bundled inside that Mermaid build

The official build embeds Mermaid's runtime dependencies. All of them are permissive
except the three marked below; the license text of each ships under
`lib/assets/licenses/`, so a redistribution carries every required notice.

| Package | Version | License |
| --- | --- | --- |
| @braintree/sanitize-url | 7.1.2 | MIT |
| @iconify/utils | 3.1.7 | MIT |
| @mermaid-js/parser | 2.0.1 | MIT |
| @types/d3 | 7.4.3 | MIT |
| @upsetjs/venn.js | 2.0.0 | MIT |
| chevrotain | 13.2.0 | **Apache-2.0** |
| cytoscape | 3.34.4 | MIT |
| cytoscape-cose-bilkent | 4.1.0 | MIT |
| cytoscape-fcose | 2.2.0 | MIT |
| d3 | 7.9.0 | ISC |
| d3-sankey | 0.12.3 | BSD-3-Clause |
| dagre-d3-es | 7.0.14 | MIT |
| dayjs | 1.11.23 | MIT |
| dompurify | 3.4.17 | **MPL-2.0 OR Apache-2.0** (used as Apache-2.0) |
| elkjs | 0.12.1 | **EPL-2.0 OR GPL-3.0-or-later** (used as EPL-2.0) |
| es-toolkit | 1.53.0 | MIT |
| katex | 0.19.1 | MIT |
| khroma | 2.1.0 | MIT |
| marked | 18.1.2 | MIT |
| roughjs | 4.6.6 | MIT |
| stylis | 4.4.0 | MIT |
| ts-dedent | 2.3.0 | MIT |
| uuid | 14.0.3 | MIT |

What those three obligations mean here:

- **chevrotain (Apache-2.0)** — the Apache text ships and the file is redistributed
  unmodified, so the NOTICE requirement is met by that text plus the attribution above.
- **dompurify (MPL-2.0 OR Apache-2.0)** — the Apache-2.0 option is taken; its text ships.
- **elkjs (EPL-2.0)** — weak, file-level copyleft. The bundled copy is unmodified and
  its source is available upstream (https://github.com/kieler/elkjs); the EPL text
  ships. Nothing in this repository incorporates elkjs source, so the MIT license of
  dsh-mosaic is unaffected.

## Icons and screenshots

`assets/icon.svg`, `assets/icon-180.png` and `assets/screenshots/preview.jpg` were made
for this project and ship under the same MIT license as the package. The preview image
is a screenshot of this plugin running in DeepSeek Harness and contains no third-party
artwork.

## draw.io / maxGraph

No draw.io or maxGraph runtime is bundled. The optional `.drawio` export writes the
standard mxGraph XML format, so the file opens in [draw.io](https://www.drawio.com/)
(Apache-2.0). Nothing from those projects is required for the export to work.
