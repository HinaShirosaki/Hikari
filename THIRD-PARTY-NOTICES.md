# Third-Party Notices

Hikari bundles the open-source software, fonts, icons, and reference data listed
below. Each entry names the licence and where its full text ships. Nothing in
this file changes the terms of those licences.

Regenerate the npm table with:

```sh
npm ls --omit=dev --all --parseable | while read -r p; do node -e "const p=require('$p/package.json');if(p.name!=='hikari')console.log('| '+p.name+' | '+p.version+' | '+(p.license?.type||p.license)+' |')"; done | sort -u
```

## Runtime platform

| Component | Licence | Full text |
| --- | --- | --- |
| Electron | MIT | `LICENSE` next to the packaged app |
| Chromium and its bundled libraries | Various (see file) | `LICENSES.chromium.html` next to the packaged app |
| Node.js | MIT | Included in `LICENSES.chromium.html` |

## Vendored libraries

Files under `vendor/` and `src/plugins/gel/vendor/` are unmodified upstream
builds. Minified bundles keep their upstream licence header inside the file.

| Library | Version | Licence | Copyright | Full text |
| --- | --- | --- | --- | --- |
| pdf.js | 5.5.207 | Apache-2.0 | Mozilla Foundation | `vendor/pdfjs/LICENSE` |
| ↳ Foxit standard fonts | — | Foxit / PDFium licence | PDFium Authors | `vendor/pdfjs/web/standard_fonts/LICENSE_FOXIT` |
| ↳ Liberation fonts | — | SIL OFL 1.1 | Google Corporation, Red Hat | `vendor/pdfjs/web/standard_fonts/LICENSE_LIBERATION` |
| ↳ Adobe CMap resources | — | BSD-style | Adobe Systems Incorporated | `vendor/pdfjs/web/cmaps/LICENSE` |
| ↳ ICC profiles | — | CC0 1.0 | — | `vendor/pdfjs/web/iccs/LICENSE` |
| ↳ OpenJPEG (wasm) | — | BSD-2-Clause | OpenJPEG contributors; Mozilla Foundation | `vendor/pdfjs/web/wasm/LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG` |
| ↳ JBIG2 decoder (wasm) | — | BSD-3-Clause (PDFium) / Apache-2.0 | PDFium Authors; Mozilla Foundation | `vendor/pdfjs/web/wasm/LICENSE_JBIG2`, `LICENSE_PDFJS_JBIG2` |
| ↳ qcms (wasm) | — | MIT | Mozilla Corporation; Mozilla Foundation | `vendor/pdfjs/web/wasm/LICENSE_QCMS`, `LICENSE_PDFJS_QCMS` |
| sql.js (SQLite 3.49.1 compiled to wasm) | — | MIT; SQLite is public domain | sql.js authors | `vendor/sqljs/LICENSE.sqljs` |
| Tabulator | 6.2.4 | MIT | Oli Folkerd | `vendor/tabulator/LICENSE`, `src/plugins/gel/vendor/tabulator/LICENSE` |
| Cropper.js | 1.6.2 | MIT | Chen Fengyuan | Headers of `vendor/cropperjs/cropper.min.js`, `src/plugins/gel/vendor/cropperjs/cropper.min.js`, and `plugins/scientific-illustration/vendor/cropperjs/cropper.min.js` |
| jsPDF (and the libraries it bundles) | 4.2.0 | MIT | James Hall, yWorks GmbH, Lukas Holländer, contributors | Header of `vendor/jspdf.umd.min.js` |
| Plotly.js (and the libraries it bundles) | 3.6.0 | MIT | Plotly, Inc. | Header of `vendor/plotly/plotly.min.js` |
| ONNX Runtime Web | 1.26.0 | MIT | Microsoft Corporation | `vendor/onnxruntime/README.md`, header of `ort.wasm.min.mjs` |
| UTIF.js | — | MIT | Photopea | `vendor/utif/LICENSE`, `src/plugins/gel/vendor/utif/LICENSE` |
| PptxGenJS (bundles JSZip, MIT) | 4.0.1 | MIT | Brent Ely | `src/plugins/gel/vendor/pptxgenjs/LICENSE`, `plugins/scientific-illustration/vendor/pptxgenjs/LICENSE` |

## Fonts

| Font | Licence | Copyright | Full text |
| --- | --- | --- | --- |
| Inter | SIL OFL 1.1 | The Inter Project Authors | `assets/fonts/Inter-LICENSE.txt` |
| IBM Plex Sans | SIL OFL 1.1 | IBM Corp., Reserved Font Name "Plex" | `assets/fonts/IBMPlexSans-LICENSE.txt` |

## Icons

| Icon set | Licence | Attribution | Full text |
| --- | --- | --- | --- |
| Lucide 1.17.0 (module and dock glyphs) | ISC | Lucide Contributors | `assets/icons/LUCIDE-LICENSE.txt` |

## npm packages shipped inside the app

Each package's own `LICENSE` file is packaged with it under `node_modules/`
inside the app bundle.

| Package | Version | Licence |
| --- | --- | --- |
| @hono/node-server | 1.19.14 | MIT |
| @modelcontextprotocol/sdk | 1.29.0 | MIT |
| accepts | 2.0.0 | MIT |
| ajv | 8.18.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| body-parser | 2.2.2 | MIT |
| bytes | 3.1.2 | MIT |
| call-bind-apply-helpers | 1.0.2 | MIT |
| call-bound | 1.0.4 | MIT |
| content-disposition | 1.1.0 | MIT |
| content-type | 1.0.5 | MIT |
| content-type | 2.0.0 | MIT |
| cookie | 0.7.2 | MIT |
| cookie-signature | 1.2.2 | MIT |
| cors | 2.8.6 | MIT |
| cross-spawn | 7.0.6 | MIT |
| debug | 2.6.9 | MIT |
| debug | 4.4.3 | MIT |
| depd | 2.0.0 | MIT |
| dunder-proto | 1.0.1 | MIT |
| ee-first | 1.1.1 | MIT |
| electron-squirrel-startup | 1.0.1 | Apache-2.0 |
| encodeurl | 2.0.0 | MIT |
| es-define-property | 1.0.1 | MIT |
| es-errors | 1.3.0 | MIT |
| es-object-atoms | 1.1.1 | MIT |
| escape-html | 1.0.3 | MIT |
| etag | 1.8.1 | MIT |
| eventsource | 3.0.7 | MIT |
| eventsource-parser | 3.0.8 | MIT |
| express | 5.2.1 | MIT |
| express-rate-limit | 8.5.2 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-uri | 3.1.0 | BSD-3-Clause |
| finalhandler | 2.1.1 | MIT |
| forwarded | 0.2.0 | MIT |
| fresh | 2.0.0 | MIT |
| function-bind | 1.1.2 | MIT |
| get-intrinsic | 1.3.0 | MIT |
| get-proto | 1.0.1 | MIT |
| gopd | 1.2.0 | MIT |
| has-symbols | 1.1.0 | MIT |
| hasown | 2.0.2 | MIT |
| hono | 4.12.18 | MIT |
| http-errors | 2.0.1 | MIT |
| iconv-lite | 0.7.2 | MIT |
| inherits | 2.0.4 | ISC |
| ip-address | 10.2.0 | MIT |
| ipaddr.js | 1.9.1 | MIT |
| is-promise | 4.0.0 | MIT |
| isexe | 2.0.0 | ISC |
| jose | 6.2.3 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| json-schema-typed | 8.0.2 | BSD-2-Clause |
| math-intrinsics | 1.1.0 | MIT |
| media-typer | 1.1.0 | MIT |
| merge-descriptors | 2.0.0 | MIT |
| mime-db | 1.54.0 | MIT |
| mime-types | 3.0.2 | MIT |
| ms | 2.0.0 | MIT |
| ms | 2.1.3 | MIT |
| negotiator | 1.0.0 | MIT |
| object-assign | 4.1.1 | MIT |
| object-inspect | 1.13.4 | MIT |
| on-finished | 2.4.1 | MIT |
| once | 1.4.0 | ISC |
| parseurl | 1.3.3 | MIT |
| path-key | 3.1.1 | MIT |
| path-to-regexp | 8.4.2 | MIT |
| pkce-challenge | 5.0.1 | MIT |
| proxy-addr | 2.0.7 | MIT |
| qs | 6.15.1 | BSD-3-Clause |
| range-parser | 1.2.1 | MIT |
| raw-body | 3.0.2 | MIT |
| require-from-string | 2.0.2 | MIT |
| router | 2.2.0 | MIT |
| safer-buffer | 2.1.2 | MIT |
| send | 1.2.1 | MIT |
| serve-static | 2.2.1 | MIT |
| setprototypeof | 1.2.0 | ISC |
| shebang-command | 2.0.0 | MIT |
| shebang-regex | 3.0.0 | MIT |
| side-channel | 1.1.0 | MIT |
| side-channel-list | 1.0.1 | MIT |
| side-channel-map | 1.0.1 | MIT |
| side-channel-weakmap | 1.0.2 | MIT |
| statuses | 2.0.2 | MIT |
| toidentifier | 1.0.1 | MIT |
| type-is | 2.1.0 | MIT |
| unpipe | 1.0.0 | MIT |
| vary | 1.1.2 | MIT |
| which | 2.0.2 | ISC |
| wrappy | 1.0.2 | ISC |
| zod | 3.25.76 | MIT |
| zod-to-json-schema | 3.25.2 | ISC |

## Reference data

**Restriction enzymes.** The catalog in
`src/renderer/modules/sequence-viewer/data/commercial-restriction-enzymes.json`
lists enzymes gathered from the New England Biolabs and Thermo Fisher Scientific
product catalogs. Recognition sites and cut positions follow REBASE notation
(`allenz` release 603). REBASE is a free and independent resource, copyright
Dr. Richard J. Roberts; you are not being charged for any REBASE data. Please
cite: Roberts RJ, Vincze T, Posfai J, Macelis D. *REBASE — a database for DNA
restriction and modification: enzymes, genes and genomes.* Nucleic Acids Res.
2015;43:D298–D299. <https://rebase.neb.com/>

**Nearest-neighbor thermodynamic parameters.** Oligo melting temperatures and
secondary-structure folding use published parameter sets: SantaLucia J Jr.
*A unified view of polymer, dumbbell, and oligonucleotide DNA nearest-neighbor
thermodynamics.* Proc Natl Acad Sci USA. 1998;95:1460–1465; and Turner DH,
Mathews DH. *NNDB: the nearest neighbor parameter database for predicting
stability of nucleic acid secondary structure.* Nucleic Acids Res.
2010;38:D280–D282. <https://rna.urmc.rochester.edu/NNDB/>

## External services (not bundled)

Optional features call services you configure or already have installed: the
OpenAI `codex` CLI (installed and signed in by you; Apache-2.0), NCBI E-utilities
and BLAST, UniProt (data licensed CC BY 4.0), Europe PMC, PubMed Central, and
Crossref. Their terms of use apply to those requests.

## Trademarks

Google Drive and its product logo are trademarks of Google LLC. The Dropbox name
and glyph are trademarks of Dropbox, Inc. Hikari uses these marks to identify
the corresponding cloud-drive integrations. See the
[Google Drive branding guide](https://developers.google.com/workspace/drive/api/guides/branding)
and [Dropbox developer branding guide](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/branding-guide).

Product and company names are used only to describe compatibility and are the
property of their respective owners. In particular: Gibson Assembly® and Q5® are
registered trademarks of New England Biolabs, Inc.; In-Fusion® is a registered
trademark of Takara Bio Inc.; TOPO® is a registered trademark of Thermo Fisher
Scientific Inc.; QuikChange® is a registered trademark of Agilent Technologies,
Inc.; Precision Plus Protein™ and Kaleidoscope™ are trademarks of Bio-Rad
Laboratories, Inc.; PageRuler™, GeneRuler™, RiboRuler™, and Spectra™ are
trademarks of Thermo Fisher Scientific Inc. Hikari is not affiliated with or endorsed by
any of these companies.
