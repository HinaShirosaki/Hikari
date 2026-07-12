module.exports = function registerAgentLiteraturePaperAndSubAgentSuitePart05(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('pdf joinTextItems reconstructs a markdown table when the header wraps across multiple lines', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-text-layout.js'));
      const fontSize = 10;
      const mk = (y, list) => list.map((item, idx) => ({
        str: item.str,
        transform: [1, 0, 0, 1, item.x, y],
        width: item.width,
        height: fontSize,
        hasEOL: idx === list.length - 1
      }));
      const items = [
        ...mk(300, [{ str: 'Table 1 | Design of CRBN constructs', x: 50, width: 200 }]),
        // Header line 1 — five columns including hyphen-wrapped column names.
        ...mk(280, [
          { str: 'Construct ID', x: 50, width: 40 },
          { str: 'N-terminal resi-', x: 150, width: 50 },
          { str: 'Linker', x: 250, width: 25 },
          { str: 'C-terminal resi-', x: 350, width: 50 },
          { str: 'Mutations', x: 450, width: 40 }
        ]),
        // Header line 2 — wrapped continuations of columns 2 and 4.
        ...mk(270, [
          { str: 'due range', x: 150, width: 35 },
          { str: 'due range', x: 350, width: 35 }
        ]),
        ...mk(255, [
          { str: '1', x: 50, width: 5 },
          { str: '41–187', x: 150, width: 30 },
          { str: 'GSG', x: 250, width: 15 },
          { str: '249–426', x: 350, width: 30 },
          { str: '–', x: 450, width: 5 }
        ]),
        ...mk(240, [
          { str: '6', x: 50, width: 5 },
          { str: '41–187', x: 150, width: 30 },
          { str: 'GSG', x: 250, width: 15 },
          { str: '249–426', x: 350, width: 30 },
          { str: 'T58S, I92V, K116N,', x: 450, width: 75 }
        ]),
        // Mutations column wraps onto a continuation line aligned with the last column.
        ...mk(230, [{ str: 'C366K, S410R, L423I', x: 450, width: 80 }]),
        ...mk(215, [
          { str: '15', x: 50, width: 10 },
          { str: '44–185', x: 150, width: 30 },
          { str: 'GGSSGGSSG', x: 250, width: 50 },
          { str: '321–427', x: 350, width: 30 },
          { str: 'C366S', x: 450, width: 25 }
        ]),
        ...mk(190, [{ str: 'Narrative text follows.', x: 50, width: 100 }])
      ];
      const text = pdfTextLayout.joinTextItems(items);
      assert.match(text, /^Table 1 \| Design of CRBN constructs$/m);
      // Wrapped headers de-hyphenated into single column titles.
      assert.match(text, /^\| Construct ID \| N-terminal residue range \| Linker \| C-terminal residue range \| Mutations \|$/m);
      assert.match(text, /^\| --- \| --- \| --- \| --- \| --- \|$/m);
      assert.match(text, /^\| 1 \| 41–187 \| GSG \| 249–426 \| – \|$/m);
      // Continuation row merged into the previous row's last cell.
      assert.match(text, /^\| 6 \| 41–187 \| GSG \| 249–426 \| T58S, I92V, K116N, C366K, S410R, L423I \|$/m);
      assert.match(text, /^\| 15 \| 44–185 \| GGSSGGSSG \| 321–427 \| C366S \|$/m);
      assert.match(text, /^Narrative text follows\.$/m);
    });
    test('pdf-text-layout strips running headers/footers that repeat at the same head/tail position across pages', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-text-layout.js'));
      const footer = (n) => [
        'ACS Central Science Research Article',
        'https://doi.org/10.1021/foo',
        `ACS Cent. Sci. 2023, 9, ${n}`,
        String(n)
      ].join('\n');
      const pages = [
        { page_number: 1, text: `Body line one\nBody line two\n${footer(648)}` },
        { page_number: 2, text: `Continued body line\nMore content\n${footer(649)}` },
        { page_number: 3, text: `Another body line\n${footer(650)}` }
      ];
      const stripped = pdfTextLayout.stripRunningHeadersAndFooters(pages);
      assert.equal(stripped.length, 3);
      for (const page of stripped) {
        assert.doesNotMatch(page.text, /ACS Central Science Research Article/);
        assert.doesNotMatch(page.text, /https:\/\/doi\.org/);
        assert.doesNotMatch(page.text, /ACS Cent\. Sci\./);
        assert.doesNotMatch(page.text, /^\d+$/m);
      }
      assert.match(stripped[0].text, /Body line one/);
      assert.match(stripped[1].text, /Continued body line/);
      assert.match(stripped[2].text, /Another body line/);
    });
    test('pdf-text-layout leaves pages untouched when fewer than three repetitions are found', () => {
      const pdfTextLayout = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-text-layout.js'));
      const pages = [
        { page_number: 1, text: 'Body one\nRepeated footer\n1' },
        { page_number: 2, text: 'Body two\nRepeated footer\n2' }
      ];
      const stripped = pdfTextLayout.stripRunningHeadersAndFooters(pages);
      assert.deepStrictEqual(stripped, pages);
    });
    test('pdf-to-md drops the redundant Pages dump by default when sections cover the body', () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-to-md.js'));
      const markdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: { title: 'Paper with sections' },
        extraction: {
          ok: true,
          page_count: 1,
          pages: [{ page_number: 1, text: 'Methods\nWe used X.' }],
          sections: [{ label: 'Methods', start_page: 1, end_page: 1, text: 'We used X.' }]
        }
      });
      assert.match(markdown, /## Sections/);
      assert.doesNotMatch(markdown, /^## Pages/m);
    });
    test('pdf-to-md places each figure inline in the section that covers its page', () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-to-md.js'));
      const markdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: { title: 'Paper with figures' },
        extraction: {
          ok: true,
          page_count: 3,
          sections: [
            { label: 'Methods', start_page: 1, end_page: 1, text: 'We used X.' },
            { label: 'Results', start_page: 2, end_page: 2, text: 'We found Y.' }
          ]
        },
        figures: [
          { page_number: 2, file_name: 'page-2-img-1.png', width: 400, height: 300 },
          { page_number: 9, file_name: 'page-9-img-1.png' }
        ]
      });
      // Figure on page 2 lands inside the Results section, after its body text.
      assert.match(markdown, /We found Y\.[\s\S]*!\[Figure on page 2[^\]]*\]\(figures\/page-2-img-1\.png\)/);
      // The Methods section (page 1) carries no figure.
      assert.doesNotMatch(markdown, /We used X\.\n\n!\[Figure/);
      // A figure on an uncovered page still appears under the trailing Figures list.
      assert.match(markdown, /## Figures\n\n- !\[Figure on page 9\]\(figures\/page-9-img-1\.png\)/);
    });
    test('pdf-to-md still emits Pages when explicitly requested even with sections present', () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-to-md.js'));
      const markdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: { title: 'Paper with sections' },
        extraction: {
          ok: true,
          page_count: 1,
          pages: [{ page_number: 1, text: 'Methods\nWe used X.' }],
          sections: [{ label: 'Methods', start_page: 1, end_page: 1, text: 'We used X.' }]
        },
        includePages: true
      });
      assert.match(markdown, /## Sections/);
      assert.match(markdown, /## Pages/);
    });
    test('pdf-to-md keeps complete section text by default for stored paper markdown', () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-to-md.js'));
      const longSection = `${'A'.repeat(65000)} complete tail marker`;
      const markdown = pdfToMd.buildPdfMarkdownFromExtraction({
        metadata: { title: 'Long paper section' },
        extraction: {
          ok: true,
          page_count: 1,
          extracted_page_count: 1,
          sections: [{ label: 'Results', start_page: 1, end_page: 1, text: longSection }]
        }
      });
      assert.match(markdown, /complete tail marker/);
      assert.doesNotMatch(markdown, /\[\.\.\. truncated \.\.\.\]/);
    });
    test('pdf-to-md formatMarkdownBodyText preserves markdown tables across paragraph joining', () => {
      const pdfToMd = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'pdf-to-md.js'));
      const input = [
        'Intro paragraph that',
        'wraps across two lines.',
        '',
        '| Entry | Yield |',
        '| --- | --- |',
        '| 1 | 95% |',
        '| 2 | 72% |',
        '',
        'Closing sentence.'
      ].join('\n');
      const formatted = pdfToMd.formatMarkdownBodyText(input);
      assert.match(formatted, /Intro paragraph that wraps across two lines\./);
      assert.match(formatted, /\| Entry \| Yield \|\n\| --- \| --- \|\n\| 1 \| 95% \|\n\| 2 \| 72% \|/);
      assert.match(formatted, /Closing sentence\./);
    });
    test('paper markdown import helper updates imported paper records with knowledge markdown paths', async () => {
      const { transformPaperPdfToMarkdown } = require(path.join(__dirname, 'src', 'main', 'papers', 'parse', 'paper-markdown-import.js'));
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-markdown-import-'));
      const pdfPath = path.join(storageRoot, 'Papers', 'Atlas', 'mapk.pdf');
      try {
        await fsPromises.mkdir(path.dirname(pdfPath), { recursive: true });
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nfake pdf bytes\n'));
        const paper = {
          id: 'paper-1',
          title: 'Engineered MAPK Study',
          storedRelativePath: 'Papers/Atlas/mapk.pdf',
          linkedType: 'journal-club',
          linkedName: 'Atlas'
        };
        const result = await transformPaperPdfToMarkdown({
          storagePath: storageRoot,
          paper,
          paperKnowledgeDatabaseRuntime: {
            ingestPaperPdf: async (input = {}) => {
              assert.equal(input.file_path, pdfPath);
              assert.equal(input.use_llm_rewrite, false);
              return {
                ok: true,
                status: 'ready',
                markdown_relative_path: 'KnowledgeBase/papers.md/Engineered_MAPK_Study/paper.md',
                extracted_text_relative_path: 'KnowledgeBase/papers.md/Engineered_MAPK_Study/extracted.txt',
                meta_relative_path: 'KnowledgeBase/papers.md/Engineered_MAPK_Study/meta.json',
                wiki_generation_method: 'pdf-to-md'
              };
            }
          }
        });
        assert.equal(result.ok, true);
        assert.equal(paper.knowledgeMarkdownRelativePath, 'KnowledgeBase/papers.md/Engineered_MAPK_Study/paper.md');
        assert.equal(paper.knowledgeStatus, 'ready');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper download runtime attaches knowledge database output after a successful download', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-knowledge-'));
      let ingestedFilePath = '';
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-knowledge-1',
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
                  return '18';
                }
                return '';
              }
            },
            body: Buffer.from('%PDF-1.7\nattached')
          }),
          paperKnowledgeDatabaseRuntime: {
            ingestPaperPdf: async (input = {}) => {
              ingestedFilePath = input.file_path;
              return {
                ok: true,
                status: 'ready',
                markdown_path: path.join(storageRoot, 'KnowledgeBase', 'papers.md', 'attached', 'paper.md'),
                markdown_relative_path: 'KnowledgeBase/papers.md/attached/paper.md',
                summary: 'Wrote paper knowledge markdown.'
              };
            }
          }
        });

        const result = await runtime.downloadPaper({
          paper_pdf_url: 'https://example.org/attached.pdf',
          linked_type: 'project',
          linked_name: 'Atlas',
          storage_path: storageRoot,
          paper_title: 'Attached Knowledge Paper'
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(ingestedFilePath, result.file_path);
        assert.equal(result.knowledge_database.ok, true);
        assert.equal(result.knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/attached/paper.md');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper download runtime accepts doi-only input and opens the browser-assisted flow under the storage root', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-doi-'));
      const browserCalls = [];
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-doi-1',
          startBrowserDownloadSession: async (options = {}) => {
            browserCalls.push(JSON.parse(JSON.stringify(options)));
            return {
              ok: true,
              session_id: 'paper-browser-paper-download-doi-1',
              data_base64: Buffer.from('%PDF-1.4\nDOI browser fallback\n', 'utf8').toString('base64'),
              file_name: 'doi-paper.pdf',
              relative_path: 'Papers/Atlas/doi-paper.pdf',
              summary: 'Browser download completed from DOI.'
            };
          },
          terminateBrowserDownloadSession: async () => ({ ok: true })
        });

        const result = await runtime.downloadPaper({
          doi: '10.1000/example-doi',
          paper_title: 'doi-paper',
          linked_type: 'literature-search',
          linked_name: 'Atlas',
          storage_path: storageRoot
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(result.method, 'browser');
        assert.equal(browserCalls.length, 1);
        assert.equal(browserCalls[0].browserEntryUrl, 'https://doi.org/10.1000/example-doi');
        assert.equal(String(result.relative_path || '').includes('Papers/Atlas/'), true);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('main agent services enable the default browser download session for packaged paper downloads', async () => {
      const { createMainAgentServices } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'create-main-agent-services.js'));
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-main-browser-'));
      const openedUrls = [];
      const createdWindows = [];

      class FakeBrowserWindow {
        constructor() {
          this.destroyed = false;
          this.handlers = new Map();
          this.sessionHandlers = new Map();
          this.webContents = {
            session: {
              on: (eventName, listener) => {
                this.sessionHandlers.set(eventName, listener);
              },
              removeListener: () => {}
            },
            downloadURL: () => {}
          };
          createdWindows.push(this);
        }

        on(eventName, listener) {
          this.handlers.set(eventName, listener);
        }

        isDestroyed() {
          return this.destroyed;
        }

        close() {
          this.destroyed = true;
        }

        async loadURL(url) {
          openedUrls.push(url);
          setImmediate(() => {
            const listener = this.sessionHandlers.get('will-download');
            if (typeof listener !== 'function') {
              return;
            }
            const item = {
              savePath: '',
              setSavePath: (targetPath) => {
                item.savePath = targetPath;
              },
              getTotalBytes: () => 42,
              getReceivedBytes: () => 42,
              on: () => {},
              once: (_eventName, doneListener) => {
                setImmediate(async () => {
                  await fsPromises.writeFile(item.savePath, '%PDF-1.7\nmain service browser fallback\n');
                  doneListener(null, 'completed');
                });
              }
            };
            listener({}, item);
          });
        }
      }

      try {
        const services = createMainAgentServices({
          BrowserWindow: FakeBrowserWindow,
          getAgentPythonSandboxRoot: () => storageRoot,
          getAgentMemoryFilePath: () => path.join(storageRoot, 'agent-memory.json'),
          getDefaultDataFilePath: () => path.join(storageRoot, 'hikari-data.json')
        });

        const result = await services.paperDownloadRuntime.downloadPaper({
          doi: '10.1000/example-doi',
          paper_title: 'Main service DOI paper',
          linked_type: 'literature-search',
          linked_name: 'Atlas',
          storage_path: storageRoot
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(result.method, 'browser');
        assert.equal(openedUrls[0], 'https://doi.org/10.1000/example-doi');
        assert.equal(createdWindows.length, 1);
        assert.equal(await fsPromises.readFile(result.file_path, 'utf8'), '%PDF-1.7\nmain service browser fallback\n');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('literature search workflow preserves DOI metadata for later user-triggered download', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-doi-'));
      const downloadCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            buildLiteratureQuery: () => 'ncAA incorporation',
            searchLiteratureCandidates: async () => ({
              ok: true,
              status: 'completed',
              query: 'ncAA incorporation',
              sources: ['crossref'],
              items: [
                {
                  id: 'paper-1',
                  source: 'crossref',
                  title: 'DOI-only paper',
                  summary: 'Useful DOI-only literature result.',
                  doi: '10.1000/example-doi',
                  url: ''
                }
              ],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              source_counts: { crossref: 1 },
              source_errors: {},
              summary: 'Found 1 literature result.'
            })
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pmid: '',
              pmcid: '',
              doi: '',
              pdf_urls: [],
              abstract_sections: []
            }),
            loadPaperContexts: async () => ({
              ok: true,
              status: 'completed',
              papers_read_count: 0,
              loaded_context_blocks: [],
              papers: [],
              summary: 'No paper context loaded.'
            })
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => {
              downloadCalls.push(JSON.parse(JSON.stringify(input)));
              return {
                ok: true,
                status: 'completed',
                file_name: 'doi-paper.pdf',
                file_path: path.join(storageRoot, 'LiteratureSearch', 'Atlas', 'Papers', 'doi-paper.pdf'),
                relative_path: 'Papers/Atlas/doi-paper.pdf',
                knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/10.1000_example-doi/paper.md',
                knowledge_database: {
                  ok: true,
                  status: 'ready',
                  markdown_relative_path: 'KnowledgeBase/papers.md/10.1000_example-doi/paper.md'
                },
                summary: 'Downloaded doi-paper.pdf'
              };
            }
          }
        });

        const result = await runtime.execute({
          query: 'ncAA incorporation',
          storage_path: storageRoot,
          snapshot: {
            settings: {
              storagePath: storageRoot
            }
          },
          project: {
            id: 'project-atlas',
            name: 'Atlas'
          }
        });

        assert.equal(result.ok, true);
        assert.equal(downloadCalls.length, 0);
        assert.equal(result.selected_papers[0].doi, '10.1000/example-doi');
        assert.equal(result.selected_papers[0].url, '');
        assert.equal(result.selected_papers[0].download_available, true);
        assert.equal(result.selected_papers[0].download_status, 'not_requested');
        assert.deepEqual(result.selected_papers[0].pdf_urls, []);
        assert.equal(result.downloaded_papers.length, 0);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('packaged literature workflow soft-prefers any configured preferred journal', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-preferred-journals-'));
      const downloadCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            buildLiteratureQuery: () => 'kinase inhibitor resistance',
            searchLiteratureCandidates: async (input = {}) => {
              assert.equal(Object.prototype.hasOwnProperty.call(input, 'journals'), false);
              assert.equal(Object.prototype.hasOwnProperty.call(input, 'journal_filter'), false);
              return {
                ok: true,
                status: 'completed',
                query: 'kinase inhibitor resistance',
                sources: ['pubmed'],
                items: [
                  {
                    id: 'paper-other',
                    source: 'pubmed',
                    title: 'Kinase inhibitor resistance mechanisms',
                    summary: 'Comparable candidate from a non-preferred journal.',
                    journal: 'Other Journal',
                    doi: '10.1000/other',
                    url: 'https://example.org/other'
                  },
                  {
                    id: 'paper-cell',
                    source: 'pubmed',
                    title: 'Kinase inhibitor resistance mechanisms',
                    summary: 'Comparable candidate from Cell.',
                    journal: 'Cell',
                    doi: '10.1000/cell',
                    url: 'https://example.org/cell'
                  }
                ],
                citations: [],
                loaded_context_blocks: [],
                papers_read_count: 0,
                source_counts: { pubmed: 2 },
                source_errors: {},
                summary: 'Found 2 literature results.'
              };
            }
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pmid: '',
              pmcid: '',
              doi: '',
              pdf_urls: [],
              abstract_sections: []
            })
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => {
              downloadCalls.push(JSON.parse(JSON.stringify(input)));
              return {
                ok: true,
                status: 'completed',
                paper_id: input.paper_id,
                paper_title: input.paper_title,
                doi: input.doi,
                relative_path: `Papers/${input.paper_id}.pdf`,
                summary: `Downloaded ${input.paper_title || input.paper_id}.`
              };
            }
          },
          subAgentRuntime: {
            createSubAgent: async () => {
              throw new Error('No extracted markdown should require a Codex paper context turn.');
            }
          }
        });

        const result = await runtime.execute({
          provider: 'codex',
          query: 'kinase inhibitor resistance',
          max_papers: 2,
          snapshot: {
            settings: {
              storagePath: storageRoot,
              preferredJournal: 'Nature Biotechnology; Cell'
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.codex_paper_context, false);
        assert.equal(result.selected_papers.length, 2);
        assert.equal(result.selected_papers[0].paper_title, 'Kinase inhibitor resistance mechanisms');
        assert.equal(result.selected_papers[0].doi, '10.1000/cell');
        assert.equal(result.selected_papers[1].doi, '10.1000/other');
        assert.deepEqual(
          result.sub_agent_context.preferred_journals,
          ['Nature Biotechnology', 'Cell']
        );
        assert.equal(result.sub_agent_context.preferred_journal, 'Nature Biotechnology; Cell');
        assert.equal(downloadCalls.length, 0);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper download runtime falls back to a browser session and terminates it after completion', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-download-browser-'));
      let terminatedSession = null;
      try {
        const runtime = agentPaperDownload.createPaperDownloadRuntime({
          createId: () => 'paper-download-browser-1',
          fetch: async () => ({
            ok: false,
            status: 403,
            headers: {
              get(name) {
                return String(name || '').toLowerCase() === 'content-type'
                  ? 'text/html'
                  : '';
              }
            },
            text: async () => '<html><body>Access denied. Verify you are human.</body></html>'
          }),
          startBrowserDownloadSession: async ({ targetFilePath, updateProgress }) => {
            updateProgress({
              status: 'browser_downloading',
              browser_session_active: true,
              browser_session_id: 'browser-session-1',
              received_bytes: 32,
              total_bytes: 64
            });
            await fsPromises.mkdir(path.dirname(targetFilePath), { recursive: true });
            await fsPromises.writeFile(targetFilePath, Buffer.from('%PDF-1.7 browser-session'));
            updateProgress({
              status: 'browser_downloading',
              browser_session_active: true,
              browser_session_id: 'browser-session-1',
              received_bytes: 64,
              total_bytes: 64
            });
            return {
              ok: true,
              session_id: 'browser-session-1',
              file_path: targetFilePath,
              file_name: path.basename(targetFilePath),
              relative_path: path.relative(storageRoot, targetFilePath).split(path.sep).join('/'),
              received_bytes: 64,
              total_bytes: 64,
              summary: 'Browser download completed.'
            };
          },
          terminateBrowserDownloadSession: async ({ session_id }) => {
            terminatedSession = session_id;
          }
        });

        const result = await runtime.downloadPaper({
          paper_pdf_url: 'https://blocked.example.org/paper.pdf',
          page_url: 'https://blocked.example.org/article',
          linked_type: 'project',
          linked_name: 'Atlas',
          storage_path: storageRoot
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(result.method, 'browser');
        assert.equal(result.browser_session_id, 'browser-session-1');
        assert.equal(result.browser_session_terminated, true);
        assert.equal(terminatedSession, 'browser-session-1');
        const saved = await fsPromises.readFile(result.file_path);
        assert.equal(saved.subarray(0, 5).toString('utf8'), '%PDF-');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
  }
};
