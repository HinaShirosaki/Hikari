module.exports = function registerAgentLiteraturePaperAndSubAgentSuitePaperContextLoading(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const { assert, fsPromises, path, test, agentLiteratureSearch, agentPaperContextLoader } = scope;
    test('paper context loader caps reads, ranks chunks, and reviews figures only for selected papers', async () => {
      const figureReviewCalls = [];
      const runtime = agentPaperContextLoader.createPaperContextLoaderRuntime({
        fetch: async (url) => {
          const normalizedUrl = String(url || '');
          if (normalizedUrl === 'https://example.org/paper-1.pdf' || normalizedUrl === 'https://example.org/paper-2.pdf') {
            return {
              ok: true,
              arrayBuffer: async () => Buffer.from('%PDF-1.7 figure-review')
            };
          }
          throw new Error(`Unexpected URL ${normalizedUrl}`);
        },
        requestStructuredJsonPayload: async (options = {}) => {
          if (options.stage === 'paper_context_selection') {
            return {
              ok: true,
              payload: {
                selected_blocks: [
                  { block_id: 'paper-1::1-1', relevance_reason: 'Most directly answers the mechanism question.' },
                  { block_id: 'paper-2::1-1', relevance_reason: 'Adds a complementary angle.' },
                  { block_id: 'paper-3::1-1', relevance_reason: 'Useful supporting context.' }
                ],
                figure_review_requests: [
                  { paper_id: 'paper-1', reason: 'Figure 2 appears central.' },
                  { paper_id: 'paper-2', reason: 'Figure review might clarify localization.' },
                  { paper_id: 'paper-9', reason: 'This should be ignored because it was not selected.' }
                ]
              }
            };
          }
          if (options.stage === 'paper_figure_review') {
            const paperTitle = String(options.userPrompt || '').match(/Paper title:\s*(.+)/)?.[1] || '';
            figureReviewCalls.push({
              paperTitle,
              pdfDataUrl: String(options.pdfDataUrl || ''),
              fileName: String(options.fileName || '')
            });
            return paperTitle.includes('Selected paper 1')
              ? {
                ok: true,
                payload: {
                  useful: true,
                  figure_summary: 'Figure 2 shows ERK signaling returning after inhibitor escape.',
                  relevance_reason: 'The figure directly visualizes pathway reactivation.'
                }
              }
              : {
                ok: true,
                payload: {
                  useful: false,
                  figure_summary: '',
                  relevance_reason: 'The selected text already covers the point.'
                }
              };
          }
          return {
            ok: false,
            error: `Unexpected stage ${options.stage}`
          };
        }
      });

      const chunks = runtime.chunkSectionText('MAPK pathway resistance '.repeat(220));
      const rankedBlocks = runtime.buildCandidateBlocks([
        {
          paper_id: 'paper-low',
          paper_title: 'Low signal paper',
          read_source: 'search_result_summary',
          sections: [{ label: 'Methods', text: 'Prepared buffer and incubated cells overnight.' }]
        },
        {
          paper_id: 'paper-high',
          paper_title: 'High signal paper',
          read_source: 'search_result_summary',
          sections: [{ label: 'Results', text: 'MAPK resistance mechanisms converged on ERK pathway reactivation.' }]
        }
      ], 'MAPK resistance mechanisms');

      const result = await runtime.loadPaperContexts({
        query: 'Which figures support MAPK resistance mechanisms?',
        items: Array.from({ length: 9 }, (_value, index) => ({
          id: `paper-${index + 1}`,
          title: `Selected paper ${index + 1}`,
          summary: index < 3
            ? `MAPK resistance summary ${index + 1} with pathway reactivation evidence.`
            : `Background summary ${index + 1} about unrelated controls.`,
          pdf_urls: index < 2 ? [`https://example.org/paper-${index + 1}.pdf`] : []
        }))
      });

      assert.equal(chunks.length > 1, true);
      assert.equal(rankedBlocks[0].paper_id, 'paper-high');
      assert.equal(result.ok, true);
      assert.equal(result.papers.length, 8);
      assert.equal(result.papers_read_count, 8);
      assert.equal(result.loaded_context_blocks.length <= 50, true);
      assert.equal(result.loaded_context_blocks.some((block) => block.paper_id === 'paper-1' && block.evidence_kind === 'figure_review'), true);
      assert.equal(result.loaded_context_blocks.some((block) => block.paper_id === 'paper-9'), false);
      assert.equal(result.loaded_context_blocks.some((block) => /ERK signaling returning/i.test(String(block.excerpt || ''))), true);
      assert.deepEqual(figureReviewCalls.map((call) => call.paperTitle), ['Selected paper 1', 'Selected paper 2']);
      assert.equal(figureReviewCalls.every((call) => call.pdfDataUrl.startsWith('data:application/pdf;base64,')), true);
      assert.equal(figureReviewCalls.every((call) => call.fileName.endsWith('.pdf')), true);
      assert.match(String(result.summary || ''), /Read 8 paper\(s\) and loaded/i);
    });
    test('paper context loader sends downloaded PDF-only papers to the LLM', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-context-pdf-only-'));
      try {
        const pdfPath = path.join(tempDir, 'pdf-only.pdf');
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nPDF-only paper body'));
        const calls = [];
        const runtime = agentPaperContextLoader.createPaperContextLoaderRuntime({
          requestStructuredJsonPayload: async (options = {}) => {
            calls.push({
              stage: String(options.stage || ''),
              pdfDataUrl: String(options.pdfDataUrl || ''),
              userPrompt: String(options.userPrompt || '')
            });
            if (options.stage === 'paper_context_selection_pdf') {
              return {
                ok: true,
                payload: {
                  excerpts: [
                    {
                      section_label: 'Results',
                      excerpt: 'The PDF-only paper reports a direct rescue of pathway activity.',
                      relevance_reason: 'The excerpt answers the clarified request from the attached PDF.'
                    }
                  ]
                }
              };
            }
            return {
              ok: false,
              error: `Unexpected stage ${options.stage}`
            };
          }
        });

        const result = await runtime.loadPaperContexts({
          query: 'What does the PDF-only paper report?',
          items: [
            {
              id: 'llm-invented-id',
              paper_id: 'paper-1',
              title: 'PDF-only paper'
            }
          ],
          downloaded_papers: [
            {
              ok: true,
              paper_id: 'paper-1',
              file_path: pdfPath
            }
          ]
        });

        assert.equal(result.ok, true);
        assert.equal(result.papers_read_count, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].stage, 'paper_context_selection_pdf');
        assert.equal(calls[0].pdfDataUrl.startsWith('data:application/pdf;base64,'), true);
        assert.match(calls[0].userPrompt, /full paper PDF attached/i);
        assert.equal(result.loaded_context_blocks.length, 1);
        assert.equal(result.loaded_context_blocks[0].paper_id, 'paper-1');
        assert.equal(result.loaded_context_blocks[0].source, 'llm_pdf_read');
        assert.match(String(result.loaded_context_blocks[0].excerpt || ''), /direct rescue/i);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('paper context loader prefers extracted PDF text and skips the PDF binary when figures are not needed', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-context-pdf-text-'));
      try {
        const pdfPath = path.join(tempDir, 'extract.pdf');
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nExtracted body'));
        const calls = [];
        const extractCalls = [];
        const runtime = agentPaperContextLoader.createPaperContextLoaderRuntime({
          pdfTextExtractionRuntime: {
            extractText: async (options = {}) => {
              extractCalls.push(options);
              return {
                ok: true,
                status: 'completed',
                page_count: 4,
                text: 'Background and results combined into one body of text.',
                sections: [
                  { label: 'Abstract', normalized_label: 'abstract', text: 'We engineered a binder against PD-1.', start_page: 1, end_page: 1 },
                  { label: 'Results', normalized_label: 'results', text: 'The binder rescued T cell killing in coculture by 3.2-fold.', start_page: 2, end_page: 3 }
                ],
                sections_source: 'heuristic'
              };
            }
          },
          requestStructuredJsonPayload: async (options = {}) => {
            calls.push({
              stage: String(options.stage || ''),
              pdfDataUrl: String(options.pdfDataUrl || ''),
              userPrompt: String(options.userPrompt || '')
            });
            if (options.stage === 'paper_context_selection_pdf_text') {
              return {
                ok: true,
                payload: {
                  excerpts: [
                    {
                      section_label: 'Results',
                      excerpt: 'The binder rescued T cell killing in coculture by 3.2-fold.',
                      relevance_reason: 'Directly answers the request about rescue magnitude.'
                    }
                  ],
                  request_pdf_review: false,
                  pdf_review_reason: ''
                }
              };
            }
            return {
              ok: false,
              error: `Unexpected stage ${options.stage}`
            };
          }
        });

        const result = await runtime.loadPaperContexts({
          query: 'How much did the binder rescue T cell killing?',
          items: [{ paper_id: 'paper-text', title: 'Text-first paper' }],
          downloaded_papers: [{ ok: true, paper_id: 'paper-text', file_path: pdfPath }]
        });

        assert.equal(result.ok, true);
        assert.equal(extractCalls.length, 1);
        assert.equal(extractCalls[0].file_path, pdfPath);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].stage, 'paper_context_selection_pdf_text');
        assert.equal(calls[0].pdfDataUrl, '');
        assert.match(calls[0].userPrompt, /extracted text of a scientific paper/i);
        assert.match(calls[0].userPrompt, /Results/);
        assert.equal(result.loaded_context_blocks.length, 1);
        assert.equal(result.loaded_context_blocks[0].source, 'llm_pdf_text_read');
        assert.match(String(result.loaded_context_blocks[0].excerpt || ''), /3\.2-fold/);
        assert.equal(result.papers_read_count, 1);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('paper context loader falls back to whole-PDF read when text-stage requests figure review', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'paper-context-pdf-text-fallback-'));
      try {
        const pdfPath = path.join(tempDir, 'figs.pdf');
        await fsPromises.writeFile(pdfPath, Buffer.from('%PDF-1.7\nFigure heavy paper'));
        const calls = [];
        const runtime = agentPaperContextLoader.createPaperContextLoaderRuntime({
          pdfTextExtractionRuntime: {
            extractText: async () => ({
              ok: true,
              status: 'completed',
              page_count: 2,
              text: 'See Figure 2 for the localization pattern.',
              sections: [
                { label: 'Results', normalized_label: 'results', text: 'See Figure 2 for the localization pattern.', start_page: 1, end_page: 1 }
              ],
              sections_source: 'heuristic'
            })
          },
          requestStructuredJsonPayload: async (options = {}) => {
            calls.push(String(options.stage || ''));
            if (options.stage === 'paper_context_selection_pdf_text') {
              return {
                ok: true,
                payload: {
                  excerpts: [],
                  request_pdf_review: true,
                  pdf_review_reason: 'Localization is shown in Figure 2 only.'
                }
              };
            }
            if (options.stage === 'paper_context_selection_pdf') {
              return {
                ok: true,
                payload: {
                  excerpts: [
                    {
                      section_label: 'Figure 2 caption',
                      excerpt: 'Confocal images show membrane localization in transfected HEK293 cells.',
                      relevance_reason: 'Figure 2 directly visualizes localization.'
                    }
                  ]
                }
              };
            }
            return { ok: false, error: `Unexpected stage ${options.stage}` };
          }
        });

        const result = await runtime.loadPaperContexts({
          query: 'Where does the protein localize?',
          items: [{ paper_id: 'paper-fig', title: 'Figure-first paper' }],
          downloaded_papers: [{ ok: true, paper_id: 'paper-fig', file_path: pdfPath }]
        });

        assert.equal(result.ok, true);
        assert.deepEqual(calls, ['paper_context_selection_pdf_text', 'paper_context_selection_pdf']);
        assert.equal(result.loaded_context_blocks.length, 1);
        assert.equal(result.loaded_context_blocks[0].source, 'llm_pdf_read');
        assert.match(String(result.loaded_context_blocks[0].excerpt || ''), /membrane localization/i);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('literature search runtime returns loaded paper context blocks without writing paper files', async () => {
      const tempDir = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-context-no-write-'));
      try {
        const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
          searchPubMedRecords: async () => [
            {
              id: 'paper-1',
              source: 'pubmed',
              pmid: '12345',
              title: 'Mechanism paper',
              summary: 'Abstract summary about ERK reactivation.',
              published_at: '2025-01-01'
            }
          ],
          paperContextLoaderRuntime: {
            loadPaperContexts: async ({ items, query }) => {
              assert.equal(items.length, 1);
              assert.match(String(query || ''), /MAPK resistance/i);
              return {
                ok: true,
                papers_read_count: 1,
                loaded_context_blocks: [
                  {
                    paper_id: 'paper-1',
                    paper_title: 'Mechanism paper',
                    section_label: 'Results',
                    excerpt: 'ERK reactivation restored signaling after inhibitor escape.',
                    relevance_reason: 'Directly addresses the resistance mechanism.',
                    source: 'pubmed_abstract',
                    evidence_kind: 'text'
                  }
                ],
                summary: 'Read 1 paper(s) and loaded 1 context block(s).'
              };
            }
          }
        });

        const result = await runtime.execute({
          query: 'MAPK resistance mechanism',
          source: 'pubmed',
          limit: 3,
          storage_path: tempDir
        });

        assert.equal(result.ok, true);
        assert.equal(result.papers_read_count, 1);
        assert.equal(result.loaded_context_blocks.length, 1);
        assert.match(String(result.loaded_context_blocks[0]?.excerpt || ''), /ERK reactivation/i);
        assert.match(String(result.summary || ''), /loaded 1 context block/i);
        assert.deepEqual(await fsPromises.readdir(tempDir), []);
      } finally {
        await fsPromises.rm(tempDir, { recursive: true, force: true });
      }
    });
    test('literature search runtime can return candidate papers without loading paper contexts', async () => {
      let contextLoadCount = 0;
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => [
          {
            id: 'paper-1',
            source: 'pubmed',
            pmid: '111',
            title: 'MAPK resistance mechanism paper 1',
            summary: 'MAPK resistance and pathway reactivation in the first candidate.',
            published_at: '2025-01-02'
          },
          {
            id: 'paper-2',
            source: 'pubmed',
            pmid: '222',
            title: 'MAPK resistance mechanism paper 2',
            summary: 'MAPK resistance and pathway reactivation in the second candidate.',
            published_at: '2025-01-01'
          }
        ],
        paperContextLoaderRuntime: {
          loadPaperContexts: async () => {
            contextLoadCount += 1;
            return {
              ok: true,
              papers_read_count: 2,
              loaded_context_blocks: [
                {
                  paper_id: 'paper-1',
                  paper_title: 'MAPK resistance mechanism paper 1',
                  section_label: 'Results',
                  excerpt: 'This block should never be loaded by the candidate-only path.',
                  relevance_reason: 'Should not be used.',
                  source: 'pubmed_abstract',
                  evidence_kind: 'text'
                }
              ]
            };
          }
        }
      });

      const result = await runtime.searchLiteratureCandidates({
        source: 'pubmed',
        query: 'MAPK resistance mechanism',
        limit: 2
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(contextLoadCount, 0);
      assert.equal(result.items.length, 2);
      assert.equal(result.loaded_context_blocks.length, 0);
      assert.equal(result.papers_read_count, 0);
      assert.match(String(result.summary || ''), /Found 2 literature result/i);
    });
};
