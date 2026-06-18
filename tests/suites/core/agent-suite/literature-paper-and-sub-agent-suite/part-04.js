module.exports = function registerAgentLiteraturePaperAndSubAgentSuitePart04(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('paper download runtime extracts PDF candidates and streams direct download progress into paper storage', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-direct-'));
      const progressEvents = [];
      let releaseSecondChunk = null;
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-direct-1',
          onJobUpdate: (job) => {
            progressEvents.push({
              status: job.status,
              progress_ratio: job.progress_ratio,
              received_bytes: job.received_bytes,
              total_bytes: job.total_bytes
            });
          },
          fetch: async () => ({
            ok: true,
            status: 200,
            headers: {
              get(name) {
                const normalized = String(name || '').toLowerCase();
                if (normalized === 'content-type') {
                  return 'application/pdf';
                }
                if (normalized === 'content-length') {
                  return '21';
                }
                return '';
              }
            },
            body: {
              async *[Symbol.asyncIterator]() {
                yield Buffer.from('%PDF-1.7\n123');
                await new Promise((resolve) => {
                  releaseSecondChunk = resolve;
                });
                yield Buffer.from('4567890tail');
              }
            }
          })
        });

        const extraction = agentPaperDownload.extractPaperDownloadTargets({
          page_url: 'https://example.org/article',
          page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
          message: 'Mirror link: https://cdn.example.org/paper-copy.pdf'
        });
        assert.equal(extraction.selected_pdf_url, 'https://example.org/downloads/paper.pdf');
        assert.equal(extraction.candidate_pdf_urls.includes('https://cdn.example.org/paper-copy.pdf'), true);

        const started = await runtime.startDownload({
          action: 'start',
          page_url: 'https://example.org/article',
          page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
          linked_type: 'project',
          linked_name: 'Atlas',
          storage_path: storageRoot,
          paper_title: 'PD-1 paper'
        });

        assert.equal(started.ok, true);
        assert.equal(started.status, 'started');
        await new Promise((resolve) => setTimeout(resolve, 10));

        const inFlight = runtime.getDownloadStatus({
          download_id: 'paper-download-direct-1'
        });
        assert.equal(inFlight.status, 'downloading');
        assert.equal(inFlight.method, 'direct');
        assert.equal(inFlight.selected_pdf_url, 'https://example.org/downloads/paper.pdf');
        assert.equal(inFlight.progress_ratio > 0 && inFlight.progress_ratio < 1, true);

        releaseSecondChunk();
        const completed = await runtime.waitForDownload({
          download_id: 'paper-download-direct-1'
        });
        assert.equal(completed.ok, true);
        assert.equal(completed.status, 'completed');
        assert.equal(completed.method, 'direct');
        assert.equal(completed.relative_path.includes('Project/Atlas/Papers/'), true);
        assert.equal(completed.file_name.endsWith('.pdf'), true);
        const saved = await fsPromises.readFile(completed.file_path);
        assert.equal(saved.subarray(0, 5).toString('utf8'), '%PDF-');
        assert.equal(progressEvents.some((entry) => entry.status === 'downloading' && entry.progress_ratio > 0 && entry.progress_ratio < 1), true);
      } finally {
        if (typeof releaseSecondChunk === 'function') {
          releaseSecondChunk();
        }
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper knowledge database writes LLM markdown outside the Papers folder', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-knowledge-db-'));
      const pdfPath = path.join(storageRoot, 'Papers', 'Atlas', 'mapk.pdf');
      let rewritePrompt = '';
      try {
        await fsPromises.mkdir(path.dirname(pdfPath), { recursive: true });
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nfake pdf bytes for knowledge db\n'));
        const runtime = agentPaperKnowledgeDatabase.createPaperKnowledgeDatabaseRuntime({
          now: () => '2026-03-22T12:00:00.000Z',
          pdfTextExtractionRuntime: {
            extractText: async (input = {}) => {
              assert.equal(input.file_path, pdfPath);
              return {
                ok: true,
                status: 'completed',
                page_count: 2,
                text: 'Engineered MAPK Study\nDOI: 10.1000/mapk.test\nThe method uses inhibitor treatment.',
                pages: [
                  {
                    page_number: 1,
                    text: 'Engineered MAPK Study\nDOI: 10.1000/mapk.test'
                  },
                  {
                    page_number: 2,
                    text: 'The method uses inhibitor treatment.'
                  }
                ],
                sections: [
                  {
                    label: 'Methods',
                    normalized_label: 'methods',
                    start_page: 2,
                    end_page: 2,
                    text: 'The method uses inhibitor treatment.'
                  }
                ]
              };
            }
          },
          requestAssistantText: async (options = {}) => {
            rewritePrompt = String(options.userPrompt || '');
            return {
              ok: true,
              text: [
                '# Engineered MAPK Study',
                '**Authors:** -   **Year:** -   **DOI:** 10.1000/mapk.test',
                '## TL;DR',
                '- MAPK inhibitor treatment is described in the methods (p. 2).',
                '## Background',
                '## Methods',
                'Inhibitor treatment is described (p. 2).',
                '## Key results',
                '## Figures & tables',
                '## Limitations',
                '## How it relates',
                '## Verbatim quotes'
              ].join('\n')
            };
          }
        });

        const result = await runtime.ingestPaperPdf({
          storage_path: storageRoot,
          file_path: pdfPath,
          paper_title: 'Engineered MAPK Study',
          doi: '10.1000/mapk.test',
          linked_type: 'literature-search',
          linked_name: 'Atlas'
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'ready');
        assert.match(result.markdown_relative_path, /^KnowledgeBase\/papers\.md\//);
        assert.equal(result.markdown_relative_path.includes('Papers/Atlas'), false);
        assert.notEqual(path.dirname(result.markdown_path), path.dirname(pdfPath));
        assert.match(rewritePrompt, /\[\[page:2\]\]/);
        const markdown = await fsPromises.readFile(result.markdown_path, 'utf8');
        assert.match(markdown, /# Engineered MAPK Study/);
        const meta = JSON.parse(await fsPromises.readFile(result.meta_path, 'utf8'));
        assert.equal(meta.source_pdf_path, 'Papers/Atlas/mapk.pdf');
        assert.equal(meta.markdown_path, result.markdown_relative_path);
        assert.equal(result.sqlite_relative_path, 'KnowledgeBase/knowledge.index.sqlite');

        const lookup = await runtime.lookupPaper({
          storage_path: storageRoot,
          doi: '10.1000/mapk.test',
          linked_type: 'literature-search',
          linked_name: 'Atlas'
        });
        assert.equal(lookup.ok, true);
        assert.equal(lookup.paper.wiki_exists, true);
        assert.equal(lookup.paper.pdf_exists, true);
        assert.equal(lookup.paper.wiki_path, result.markdown_relative_path);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper knowledge database runs intake pipeline after writing markdown', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-knowledge-intake-'));
      const pdfPath = path.join(storageRoot, 'Papers', 'Atlas', 'intake.pdf');
      const stages = [];
      try {
        await fsPromises.mkdir(path.dirname(pdfPath), { recursive: true });
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nfake pdf bytes for intake\n'));
        const runtime = agentPaperKnowledgeDatabase.createPaperKnowledgeDatabaseRuntime({
          now: () => '2026-03-22T12:00:00.000Z',
          pdfTextExtractionRuntime: {
            extractText: async () => ({
              ok: true,
              status: 'completed',
              page_count: 2,
              text: 'Intake MAPK Study\nMethods\nCells were treated with inhibitor.\nResults\nWestern blot signal changed.',
              pages: [
                {
                  page_number: 1,
                  text: 'Intake MAPK Study\nMethods\nCells were treated with inhibitor.'
                },
                {
                  page_number: 2,
                  text: 'Results\nWestern blot signal changed.'
                }
              ],
              sections: [
                {
                  label: 'Methods',
                  normalized_label: 'methods',
                  start_page: 1,
                  end_page: 1,
                  text: 'Cells were treated with inhibitor.'
                },
                {
                  label: 'Results',
                  normalized_label: 'results',
                  start_page: 2,
                  end_page: 2,
                  text: 'Western blot signal changed.'
                }
              ]
            })
          },
          requestStructuredJsonPayload: async (options = {}) => {
            stages.push(options.stage);
            if (options.stage === 'paper_intake_classification') {
              assert.match(options.userPrompt, /Intake MAPK Study/);
              return {
                ok: true,
                payload: {
                  doc_type: 'research_paper',
                  confidence: 0.96,
                  reason: 'Methods and results describe a new experiment.'
                }
              };
            }
            if (options.stage === 'paper_intake_research_summary') {
              return {
                ok: true,
                payload: {
                  one_sentence_summary: 'This study tests inhibitor treatment in cells and finds altered western blot signal.',
                  experiments: [
                    {
                      title: 'Inhibitor treatment western blot',
                      technique: 'western blot',
                      variables: 'treated versus untreated cells',
                      figure_ref: 'Fig. 1',
                      outcome: 'The target signal changed after inhibitor treatment.'
                    }
                  ]
                }
              };
            }
            return { ok: false, error: `Unexpected stage ${options.stage}` };
          }
        });

        const result = await runtime.ingestPaperPdf({
          storage_path: storageRoot,
          file_path: pdfPath,
          paper_title: 'Intake MAPK Study',
          doi: '10.1000/intake.test',
          linked_type: 'literature-search',
          linked_name: 'Atlas',
          use_llm_rewrite: false
        });

        assert.equal(result.ok, true);
        assert.equal(result.paper_intake.ok, true);
        assert.equal(result.paper_intake.status, 'saved');
        assert.deepEqual(stages, ['paper_intake_classification', 'paper_intake_research_summary']);
        assert.equal(result.markdown_relative_path, 'KnowledgeBase/papers.md/10.1000_intake.test/paper.md');
        const intakePath = path.join(storageRoot, 'KnowledgeBase', 'papers.md', '10.1000_intake.test', 'intake.json');
        const intake = JSON.parse(await fsPromises.readFile(intakePath, 'utf8'));
        assert.equal(intake.paper_id, '10.1000_intake.test');
        assert.equal(intake.doc_type, 'research_paper');
        assert.equal(intake.source_paths.paper_md, 'KnowledgeBase/papers.md/10.1000_intake.test/paper.md');
        assert.equal(intake.experiments[0].technique, 'western blot');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('pdf-to-md helper renders extracted PDF pages as markdown and the pdf text tool can include it', async () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-to-md.js'));
      const pdfTextExtraction = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-pdf-text-extraction.js'));
      const markdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: {
          title: 'Engineered MAPK Study',
          doi: '10.1000/mapk'
        },
        extraction: {
          ok: true,
          page_count: 1,
          extracted_page_count: 1,
          pages: [{ page_number: 1, text: 'Abstract\nMAPK inhibitor treatment was tested.' }],
          sections: [{ label: 'Abstract', start_page: 1, end_page: 1, text: 'MAPK inhibitor treatment was tested.' }]
        }
      });
      assert.match(markdown, /^# Engineered MAPK Study/m);
      assert.match(markdown, /DOI: 10\.1000\/mapk/);
      // Sections cover the body, so the redundant Pages dump is dropped by default.
      assert.match(markdown, /### Abstract \(p\. 1\)/);
      assert.doesNotMatch(markdown, /^## Pages/m);

      const runtime = pdfTextExtraction.createPdfTextExtractionRuntime({
        pdfJsLib: {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 1,
              getPage: async () => ({
                getTextContent: async () => ({
                  items: [
                    { str: 'Engineered MAPK Study', hasEOL: true },
                    { str: 'Abstract', hasEOL: true },
                    { str: 'MAPK inhibitor treatment was tested.', hasEOL: true }
                  ]
                }),
                cleanup: () => {}
              }),
              getOutline: async () => [],
              destroy: async () => {}
            })
          })
        }
      });
      const result = await runtime.extractText({
        buffer: Buffer.from('%PDF-1.7\nfake bytes'),
        title: 'Engineered MAPK Study',
        include_markdown: true
      });
      assert.equal(result.ok, true);
      assert.match(result.markdown, /^# Engineered MAPK Study/m);
      assert.match(result.markdown, /MAPK inhibitor treatment was tested/);

      const originalDomMatrix = globalThis.DOMMatrix;
      try {
        delete globalThis.DOMMatrix;
        const nodeRuntime = pdfTextExtraction.createPdfTextExtractionRuntime({
          importEsm: async () => {
            assert.equal(typeof globalThis.DOMMatrix, 'function');
            return {
              getDocument: () => ({
                promise: Promise.resolve({
                  numPages: 1,
                  getPage: async () => ({
                    getTextContent: async () => ({
                      items: [{ str: 'Node extracted paper text.', hasEOL: true }]
                    }),
                    cleanup: () => {}
                  }),
                  getOutline: async () => [],
                  destroy: async () => {}
                })
              })
            };
          },
          vendorPdfJsPath: path.join(__dirname, 'vendor', 'pdfjs', 'build', 'pdf.mjs')
        });
        const nodeResult = await nodeRuntime.extractText({
          buffer: Buffer.from('%PDF-1.7\nfake bytes'),
          include_markdown: true
        });
        assert.equal(nodeResult.ok, true);
        assert.match(nodeResult.markdown, /Node extracted paper text/);
      } finally {
        if (originalDomMatrix) {
          globalThis.DOMMatrix = originalDomMatrix;
        } else {
          delete globalThis.DOMMatrix;
        }
      }

      const sectionRuntime = pdfTextExtraction.createPdfTextExtractionRuntime({
        pdfJsLib: {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 1,
              getPage: async () => ({
                getTextContent: async () => ({
                  items: [
                    { str: 'Example tagged paper', hasEOL: true },
                    { str: 'This introductory paragraph', hasEOL: true },
                    { str: 'wraps across PDF lines.', hasEOL: true },
                    { str: 'Results', hasEOL: true },
                    { str: 'First result sentence', hasEOL: true },
                    { str: 'continues as one paragraph.', hasEOL: true },
                    { str: 'Methods', hasEOL: true },
                    { str: 'Cells were grown', hasEOL: true },
                    { str: 'in culture.', hasEOL: true }
                  ]
                }),
                cleanup: () => {}
              }),
              getOutline: async () => ([{ title: 'Example tagged paper', dest: [{}], items: [] }]),
              getPageIndex: async () => 0,
              destroy: async () => {}
            })
          })
        }
      });
      const sectionResult = await sectionRuntime.extractText({
        buffer: Buffer.from('%PDF-1.7\nfake bytes'),
        include_sections: true
      });
      assert.equal(sectionResult.ok, true);
      assert.equal(sectionResult.sections_source, 'heuristic');
      assert.deepEqual(sectionResult.sections.map((section) => section.label), ['Front matter', 'Results', 'Methods']);

      const sectionMarkdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: { title: 'Example tagged paper' },
        extraction: sectionResult,
        includePages: false
      });
      assert.match(sectionMarkdown, /### Results \(p\. 1\)/);
      assert.match(sectionMarkdown, /First result sentence continues as one paragraph\./);
      assert.doesNotMatch(sectionMarkdown, /^## Pages/m);
    });
    test('pdf text extraction keeps long detected sections within the overall extraction budget by default', async () => {
      const pdfTextExtraction = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-pdf-text-extraction.js'));
      const longBody = (label) => `${label} ${'x'.repeat(19000)}`;
      const pageLabels = ['page-alpha', 'page-beta', 'page-gamma', 'page-delta', 'page-omega-tail-marker'];
      const runtime = pdfTextExtraction.createPdfTextExtractionRuntime({
        pdfJsLib: {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 5,
              getPage: async (pageNumber) => ({
                getTextContent: async () => ({
                  items: pageNumber === 1
                    ? [
                      { str: 'Results', hasEOL: true },
                      { str: longBody(pageLabels[0]), hasEOL: true }
                    ]
                    : [{ str: longBody(pageLabels[pageNumber - 1]), hasEOL: true }]
                }),
                cleanup: () => {}
              }),
              getOutline: async () => [],
              destroy: async () => {}
            })
          })
        }
      });
      const result = await runtime.extractText({
        buffer: Buffer.from('%PDF-1.7\nfake bytes'),
        include_sections: true
      });
      assert.equal(result.ok, true);
      assert.equal(result.sections_source, 'heuristic');
      assert.equal(result.sections[0].label, 'Results');
      assert.match(result.sections[0].text, /page-omega-tail-marker/);
      assert.ok(result.sections[0].text.length > 80000);
    });
    test('pdf joinTextItems merges position-adjacent items without inserting stray ligature spaces', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-text-layout.js'));
      // Three text items on the same baseline whose x-ranges touch — the old
      // joiner would insert a space between each ("con fi rmed"); the new joiner
      // should merge them into a single word.
      const items = [
        { str: 'con', transform: [1, 0, 0, 1, 10, 100], width: 15, height: 10 },
        { str: 'fi', transform: [1, 0, 0, 1, 25, 100], width: 5, height: 10 },
        { str: 'rmed', transform: [1, 0, 0, 1, 30, 100], width: 20, height: 10, hasEOL: true }
      ];
      const text = pdfTextLayout.joinTextItems(items);
      assert.equal(text, 'confirmed');
    });
    test('pdf joinTextItems inserts spaces between items separated by a font-sized gap', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-text-layout.js'));
      const items = [
        { str: 'alpha', transform: [1, 0, 0, 1, 10, 100], width: 30, height: 10 },
        { str: 'beta', transform: [1, 0, 0, 1, 50, 100], width: 25, height: 10, hasEOL: true }
      ];
      const text = pdfTextLayout.joinTextItems(items);
      assert.equal(text, 'alpha beta');
    });
    test('pdf joinTextItems emits a markdown table when a Table caption is followed by aligned rows', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-text-layout.js'));
      // Lines are differentiated by y. Within each line, items at consistent
      // x-positions form columns separated by gaps larger than 2x the font size.
      const fontSize = 10;
      const makeLine = (y, items) => items.map((item, idx) => ({
        str: item.str,
        transform: [1, 0, 0, 1, item.x, y],
        width: item.width,
        height: fontSize,
        hasEOL: idx === items.length - 1
      }));
      const items = [
        ...makeLine(200, [{ str: 'Table 1. Yields by ligand', x: 50, width: 120 }]),
        ...makeLine(180, [
          { str: 'Entry', x: 50, width: 25 },
          { str: 'Ligand', x: 150, width: 35 },
          { str: 'Yield', x: 250, width: 25 }
        ]),
        ...makeLine(165, [
          { str: '1', x: 50, width: 8 },
          { str: 'bipy', x: 150, width: 25 },
          { str: '95%', x: 250, width: 25 }
        ]),
        ...makeLine(150, [
          { str: '2', x: 50, width: 8 },
          { str: 'phen', x: 150, width: 25 },
          { str: '72%', x: 250, width: 25 }
        ]),
        ...makeLine(120, [{ str: 'Narrative text follows.', x: 50, width: 100 }])
      ];
      const text = pdfTextLayout.joinTextItems(items);
      assert.match(text, /^Table 1\. Yields by ligand$/m);
      assert.match(text, /^\| Entry \| Ligand \| Yield \|$/m);
      assert.match(text, /^\| --- \| --- \| --- \|$/m);
      assert.match(text, /^\| 1 \| bipy \| 95% \|$/m);
      assert.match(text, /^\| 2 \| phen \| 72% \|$/m);
      assert.match(text, /^Narrative text follows\.$/m);
    });
    test('pdf-figure-extraction round-trips an embedded RGB image into a PNG file', async () => {
      const pdfFigureExtraction = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-figure-extraction.js'));
      const zlib = require('node:zlib');

      // Sanity-check the pure encoder: a 2x2 RGB block decodes back to the same pixels.
      const rgbPixels = Buffer.from([
        0xFF, 0x00, 0x00, 0x00, 0xFF, 0x00,
        0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF
      ]);
      const png = pdfFigureExtraction.encodePng({ width: 2, height: 2, channels: 3, pixels: rgbPixels });
      assert.equal(png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
      const ihdrLen = png.readUInt32BE(8);
      assert.equal(ihdrLen, 13);
      assert.equal(png.slice(12, 16).toString('ascii'), 'IHDR');
      assert.equal(png.readUInt32BE(16), 2);
      assert.equal(png.readUInt32BE(20), 2);
      assert.equal(png[24], 8);
      assert.equal(png[25], 2);

      // Build a fake pdf.js document with one large embedded image XObject.
      const width = 64;
      const height = 48;
      const pageImage = Buffer.alloc(width * height * 3);
      for (let i = 0; i < pageImage.length; i += 3) {
        pageImage[i] = 0x10;
        pageImage[i + 1] = 0x80;
        pageImage[i + 2] = 0xC0;
      }
      const pdfDocument = {
        numPages: 1,
        getPage: async () => ({
          getOperatorList: async () => ({
            fnArray: [pdfFigureExtraction.OPS_PAINT_IMAGE_X_OBJECT],
            argsArray: [['img-fixture-1']]
          }),
          objs: {
            get: (_objId, callback) => callback({
              kind: pdfFigureExtraction.IMAGE_KIND_RGB_24BPP,
              width,
              height,
              data: pageImage
            })
          },
          commonObjs: { get: () => null },
          cleanup: () => {}
        })
      };

      const outputDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'pdf-figures-'));
      try {
        const figures = await pdfFigureExtraction.extractFiguresFromPdfDocument({
          pdfDocument,
          outputDir,
          minDimension: 16
        });
        assert.equal(figures.length, 1);
        assert.equal(figures[0].page_number, 1);
        assert.equal(figures[0].width, width);
        assert.equal(figures[0].height, height);
        assert.equal(figures[0].file_name, 'page-1-img-1.png');
        const onDisk = await fsPromises.readFile(figures[0].file_path);
        assert.equal(onDisk.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
        // Verify IHDR encodes RGB color type with our dimensions.
        assert.equal(onDisk.slice(12, 16).toString('ascii'), 'IHDR');
        assert.equal(onDisk.readUInt32BE(16), width);
        assert.equal(onDisk.readUInt32BE(20), height);
        assert.equal(onDisk[24], 8);
        assert.equal(onDisk[25], 2);
        // Decode the IDAT and confirm the first pixel survived end-to-end.
        const idatLen = onDisk.readUInt32BE(33);
        const idatBody = onDisk.subarray(41, 41 + idatLen);
        const inflated = zlib.inflateSync(idatBody);
        assert.equal(inflated[0], 0); // filter byte
        assert.equal(inflated[1], 0x10);
        assert.equal(inflated[2], 0x80);
        assert.equal(inflated[3], 0xC0);
      } finally {
        await fsPromises.rm(outputDir, { recursive: true, force: true });
      }
    });
    test('pdfTextExtractionRuntime threads figures_output_dir into the result', async () => {
      const pdfTextExtraction = require(path.join(__dirname, 'src', 'main', 'helpers', 'agent', 'tools', 'agent-pdf-text-extraction.js'));
      const pdfFigureExtraction = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'pdf-figure-extraction.js'));

      const width = 40;
      const height = 32;
      const pageImage = Buffer.alloc(width * height * 3, 0x77);
      const runtime = pdfTextExtraction.createPdfTextExtractionRuntime({
        pdfJsLib: {
          getDocument: () => ({
            promise: Promise.resolve({
              numPages: 1,
              getPage: async () => ({
                getTextContent: async () => ({ items: [{ str: 'page text', hasEOL: true }] }),
                getOperatorList: async () => ({
                  fnArray: [pdfFigureExtraction.OPS_PAINT_IMAGE_X_OBJECT],
                  argsArray: [['img-figure-thread-1']]
                }),
                objs: {
                  get: (_objId, callback) => callback({
                    kind: pdfFigureExtraction.IMAGE_KIND_RGB_24BPP,
                    width,
                    height,
                    data: pageImage
                  })
                },
                commonObjs: { get: () => null },
                cleanup: () => {}
              }),
              getOutline: async () => [],
              destroy: async () => {}
            })
          })
        }
      });

      const outputDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'pdf-text-extract-figures-'));
      try {
        const result = await runtime.extractText({
          buffer: Buffer.from('%PDF-1.7\nfake bytes'),
          figures_output_dir: outputDir,
          figure_min_dimension: 16
        });
        assert.equal(result.ok, true);
        assert.equal(Array.isArray(result.figures), true);
        assert.equal(result.figures.length, 1);
        assert.equal(result.figures[0].file_name, 'page-1-img-1.png');
        assert.equal(result.figures_output_dir, outputDir);
        const onDisk = await fsPromises.readdir(outputDir);
        assert.deepEqual(onDisk.sort(), ['page-1-img-1.png']);
      } finally {
        await fsPromises.rm(outputDir, { recursive: true, force: true });
      }
    });
  }
};
