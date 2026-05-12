module.exports = function registerAgentLiteraturePaperAndSubAgentSuite(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
    test('literature search runtime aggregates scholarly sources and builds query from parser payload', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        fetch: async (url) => {
          const normalizedUrl = String(url || '');
          if (normalizedUrl.includes('esearch.fcgi')) {
            return {
              ok: true,
              json: async () => ({
                esearchresult: {
                  idlist: ['12345']
                }
              })
            };
          }
          if (normalizedUrl.includes('esummary.fcgi')) {
            return {
              ok: true,
              json: async () => ({
                result: {
                  uids: ['12345'],
                  '12345': {
                    uid: '12345',
                    title: 'PD-1 stability study',
                    fulljournalname: 'Nature Biotechnology',
                    pubdate: '2024-01-15',
                    authors: [{ name: 'Lee A' }],
                    articleids: [{ idtype: 'doi', value: '10.1000/pd1' }]
                  }
                }
              })
            };
          }
          if (normalizedUrl.includes('api.crossref.org/works')) {
            return {
              ok: true,
              json: async () => ({
                message: {
                  items: [
                    {
                      DOI: '10.1000/cross',
                      title: ['Crossref PD-1 review'],
                      URL: 'https://doi.org/10.1000/cross',
                      author: [{ given: 'Mia', family: 'Chen' }],
                      issued: { 'date-parts': [[2023, 10, 1]] },
                      'container-title': ['Science']
                    }
                  ]
                }
              })
            };
          }
          if (normalizedUrl.includes('europepmc')) {
            return {
              ok: true,
              json: async () => ({
                resultList: {
                  result: [
                    {
                      id: 'PMC123',
                      pmid: '321',
                      pmcid: 'PMC123',
                      doi: '10.1000/eupmc',
                      title: 'Europe PMC PD-1 methods',
                      authorString: 'Pat Doe',
                      journalTitle: 'Cell',
                      pubYear: '2022'
                    }
                  ]
                }
              })
            };
          }
          if (normalizedUrl.includes('rest.uniprot.org')) {
            return {
              ok: true,
              json: async () => ({
                results: [
                  {
                    primaryAccession: 'Q99999',
                    uniProtkbId: 'PD1_HUMAN',
                    proteinDescription: {
                      recommendedName: {
                        fullName: {
                          value: 'Programmed cell death protein 1'
                        }
                      }
                    },
                    genes: [
                      {
                        geneName: {
                          value: 'PDCD1'
                        }
                      }
                    ],
                    organism: {
                      scientificName: 'Homo sapiens'
                    },
                    sequence: {
                      length: 288
                    },
                    entryType: 'Reviewed'
                  }
                ]
              })
            };
          }
          throw new Error(`Unexpected URL ${normalizedUrl}`);
        }
      });

      const result = await runtime.searchLiterature({
        parser_payload: {
          primary_intent: 'literature_search',
          entities: {
            protein_name: 'PD-1',
            requested_output: 'recent papers',
            paper_title: null,
            project_name: null,
            activity_type: null,
            protocol_name: null,
            compound_name: null,
            inventory_item: null,
            cell_line: null,
            workflow_step: null
          }
        },
        sources: ['pubmed', 'crossref', 'europe_pmc', 'uniprot'],
        limit: 6
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.match(String(result.query || ''), /PD-1/i);
      assert.doesNotMatch(String(result.query || ''), /recent papers/i);
      assert.deepEqual(result.sources, ['pubmed', 'crossref', 'europe_pmc', 'uniprot']);
      assert.equal(result.items.some((item) => item.source === 'pubmed' && item.pmid === '12345'), true);
      assert.equal(result.items.some((item) => item.source === 'crossref' && item.doi === '10.1000/cross'), true);
      assert.equal(result.items.some((item) => item.source === 'europe_pmc' && item.pmcid === 'PMC123'), true);
      assert.equal(result.items.some((item) => item.source === 'uniprot' && item.accession === 'Q99999'), true);
      assert.equal(result.citations.some((item) => item.source === 'pubmed' && item.pointer === '10.1000/pd1'), true);
      assert.equal(result.source_counts.pubmed, 1);
      assert.equal(result.source_counts.crossref, 1);
      assert.equal(result.source_counts.europe_pmc, 1);
      assert.equal(result.source_counts.uniprot, 1);
    });

    test('literature search runtime compresses sentence prompts into keyword-style paper queries', async () => {
      const capturedQueries = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async ({ query }) => {
          capturedQueries.push(String(query || ''));
          return [];
        }
      });

      const builtQuery = runtime.buildLiteratureQuery({
        message: 'Explain the whole antigen processing procedure to me.'
      });
      const result = await runtime.execute({
        message: 'Explain the whole antigen processing procedure to me.',
        source: 'pubmed',
        limit: 3
      });

      assert.equal(builtQuery, 'antigen processing');
      assert.equal(result.query, 'antigen processing');
      assert.deepEqual(capturedQueries, ['antigen processing']);
      assert.doesNotMatch(String(result.query || ''), /\b(?:explain|whole)\b/i);
    });

    test('literature search runtime keeps later technical terms instead of truncating the keyword query early', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({});
      const query = runtime.buildLiteratureQuery({
        message: 'Explain antigen processing MHC class I MHC class II TAP tapasin calreticulin ERAP HLA-DM cross-presentation proteasome invariant chain procedure to me.'
      });

      assert.match(String(query || ''), /MHC class II/i);
      assert.match(String(query || ''), /HLA-DM/i);
      assert.match(String(query || ''), /invariant chain/i);
      assert.doesNotMatch(String(query || ''), /\b(?:explain|procedure)\b/i);
    });

    test('literature search runtime falls back to web search when scholarly sources are empty', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => [],
        searchCrossrefRecords: async () => [],
        searchEuropePmcRecords: async () => [],
        searchUniProtRecords: async () => [],
        requestWebSearch: async ({ query, maxResults, provider, model }) => ({
          ok: true,
          results: [
            {
              title: 'Review of PD-1 binders',
              url: 'https://example.org/review',
              summary: 'A recent external review of PD-1 binders.',
              source_domain: 'example.org'
            }
          ].slice(0, maxResults),
          reasoning: `Provider-layer search for ${query} via ${provider || 'default'} ${model || ''}`.trim()
        })
      });

      const result = await runtime.execute({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        query: 'PD-1 binder review',
        source: 'auto',
        limit: 5
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.sources.includes('web'), true);
      assert.equal(result.sources.includes('uniprot'), false);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].source, 'web');
      assert.equal(result.items[0].source_domain, 'example.org');
      assert.match(String(result.summary || ''), /web: 1/i);
    });

    test('literature search runtime applies preferred literature source ahead of auto defaults', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => {
          calls.push('pubmed');
          return [];
        },
        searchCrossrefRecords: async () => {
          calls.push('crossref');
          return [];
        },
        searchEuropePmcRecords: async () => {
          calls.push('europe_pmc');
          return [];
        }
      });

      const result = await runtime.execute({
        query: 'antigen processing machinery',
        preferred_literature_source: 'crossref',
        limit: 5
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['crossref', 'pubmed', 'europe_pmc']);
      assert.deepEqual(result.sources, ['crossref', 'pubmed', 'europe_pmc', 'web']);
    });

    test('literature search runtime prioritizes preferred web sources within returned web results', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => [],
        searchCrossrefRecords: async () => [],
        searchEuropePmcRecords: async () => [],
        searchUniProtRecords: async () => [],
        searchWebResults: async () => ([
          {
            title: 'Secondary review',
            url: 'https://example.org/review',
            summary: 'Generic review result.',
            source_domain: 'example.org'
          },
          {
            title: 'NIH review',
            url: 'https://www.nih.gov/focused-review',
            summary: 'Preferred source review.',
            source_domain: 'www.nih.gov'
          }
        ])
      });

      const result = await runtime.execute({
        query: 'PD-1 focused review',
        preferred_web_source: 'nih.gov',
        limit: 2
      });

      assert.equal(result.ok, true);
      assert.equal(result.sources.includes('web'), true);
      assert.equal(result.items.length, 2);
      assert.equal(result.items[0].source, 'web');
      assert.equal(result.items[0].source_domain, 'www.nih.gov');
    });

    test('literature web source delegates through the shared web-search runtime api', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        webSearchRuntime: {
          searchWebResults: async (input = {}) => {
            calls.push(JSON.parse(JSON.stringify(input)));
            return {
              query: input.query,
              results: [
                {
                  title: 'Focused review',
                  url: 'https://example.org/focused-review',
                  summary: 'Focused external review.',
                  source_domain: 'example.org'
                }
              ],
              reasoning: 'Used shared web-search runtime.'
            };
          }
        }
      });

      const result = await runtime.execute({
        provider: 'openai',
        query: 'PD-1 focused review',
        source: 'web',
        limit: 3
      });

      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].provider, 'openai');
      assert.equal(calls[0].query, 'PD-1 focused review');
      assert.equal(calls[0].limit, 3);
      assert.equal(result.citations[0].source, 'web_source');
    });

    test('paper context loader reads papers in precedence order before falling back to search summaries', async () => {
      const runtime = agentPaperContextLoader.createPaperContextLoaderRuntime({
        fetch: async (url) => {
          const normalizedUrl = String(url || '');
          if (normalizedUrl.includes('/article/PMC/PMC111?format=json')) {
            return {
              ok: true,
              json: async () => ({
                pmcid: 'PMC111',
                pmid: '111',
                doi: '10.1000/fulltext'
              })
            };
          }
          if (normalizedUrl.includes('/PMC111/fullTextXML')) {
            return {
              ok: true,
              text: async () => [
                '<article>',
                '<abstract><p>Abstract overview for the mechanism study.</p></abstract>',
                '<body>',
                '<sec><title>Results</title><p>MAPK resistance increased after pathway reactivation.</p></sec>',
                '<sec><title>Discussion</title><p>Compensatory signaling sustained survival.</p></sec>',
                '</body>',
                '</article>'
              ].join('')
            };
          }
          if (normalizedUrl.includes('/article/MED/222?format=json')) {
            return {
              ok: true,
              json: async () => ({
                pmid: '222'
              })
            };
          }
          if (normalizedUrl.includes('efetch.fcgi') && normalizedUrl.includes('id=222')) {
            return {
              ok: true,
              text: async () => [
                '<PubmedArticleSet>',
                '<PubmedArticle>',
                '<Abstract>',
                '<AbstractText Label="Results">PubMed abstract about adaptive resistance.</AbstractText>',
                '</Abstract>',
                '</PubmedArticle>',
                '</PubmedArticleSet>'
              ].join('')
            };
          }
          if (normalizedUrl.includes('/article/DOI/10.1000%2Feupmc?format=json')) {
            return {
              ok: true,
              json: async () => ({
                doi: '10.1000/eupmc',
                abstractText: 'Europe PMC abstract about resistance adaptation.'
              })
            };
          }
          if (normalizedUrl.includes('/article/DOI/10.1000%2Fcross?format=json')) {
            return {
              ok: true,
              json: async () => ({
                doi: '10.1000/cross'
              })
            };
          }
          if (normalizedUrl.includes('api.crossref.org/works/10.1000%2Fcross')) {
            return {
              ok: true,
              json: async () => ({
                message: {
                  abstract: '<jats:p>Crossref abstract about acquired resistance.</jats:p>'
                }
              })
            };
          }
          throw new Error(`Unexpected URL ${normalizedUrl}`);
        }
      });

      const fullTextPaper = await runtime.readPaperContext({
        pmcid: 'PMC111',
        title: 'Full text paper'
      });
      const pubMedAbstractPaper = await runtime.readPaperContext({
        pmid: '222',
        title: 'PubMed abstract paper'
      });
      const europePmcAbstractPaper = await runtime.readPaperContext({
        doi: '10.1000/eupmc',
        title: 'Europe PMC metadata paper'
      });
      const crossrefAbstractPaper = await runtime.readPaperContext({
        doi: '10.1000/cross',
        title: 'Crossref paper'
      });
      const fallbackPaper = await runtime.readPaperContext({
        id: 'fallback-paper',
        title: 'Fallback paper',
        summary: 'Search result summary about resistance markers.'
      });

      assert.deepEqual(agentPaperContextLoader.PAPER_CONTEXT_SOURCE_ORDER, [
        'europe_pmc_full_text',
        'pubmed_abstract',
        'europe_pmc_abstract',
        'crossref_abstract',
        'search_result_summary'
      ]);
      assert.equal(fullTextPaper.read_source, 'europe_pmc_full_text');
      assert.equal(fullTextPaper.sections.some((section) => section.label === 'Results'), true);
      assert.equal(fullTextPaper.sections.some((section) => /pathway reactivation/i.test(String(section.text || ''))), true);
      assert.equal(pubMedAbstractPaper.read_source, 'pubmed_abstract');
      assert.equal(pubMedAbstractPaper.sections[0].label, 'Results');
      assert.equal(europePmcAbstractPaper.read_source, 'europe_pmc_abstract');
      assert.match(String(europePmcAbstractPaper.sections[0]?.text || ''), /Europe PMC abstract/i);
      assert.equal(crossrefAbstractPaper.read_source, 'crossref_abstract');
      assert.match(String(crossrefAbstractPaper.sections[0]?.text || ''), /Crossref abstract/i);
      assert.equal(fallbackPaper.read_source, 'search_result_summary');
      assert.equal(fallbackPaper.sections[0].label, 'Summary');
      assert.match(String(fallbackPaper.sections[0]?.text || ''), /Search result summary/i);
    });

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

    test('literature search workflow delegates to a sub-agent, batches paper reads, and downloads into literature-search storage', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-'));
      const searchCalls = [];
      const loadCalls = [];
      const downloadCalls = [];
      let activeDownloads = 0;
      let maxConcurrentDownloads = 0;
      const candidateItems = Array.from({ length: 9 }, (_unused, index) => ({
        id: `paper-${index + 1}`,
        source: 'pubmed',
        pmid: String(200 + index),
        title: `MAPK resistance mechanism paper ${index + 1}`,
        summary: `Mechanistic evidence for MAPK resistance and pathway reactivation candidate ${index + 1}.`,
        url: `https://example.org/paper-${index + 1}`,
        doi: `10.1000/paper-${index + 1}`,
        published_at: `2025-01-${String(9 - index).padStart(2, '0')}`
      }));
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            buildLiteratureQuery: () => 'MAPK resistance mechanism',
            searchLiteratureCandidates: async (input = {}) => {
              searchCalls.push({
                query: String(input.query || ''),
                limit: Number(input.limit),
                max_papers: Number(input.max_papers),
                max_per_source: Number(input.max_per_source)
              });
              return {
                ok: true,
                status: 'completed',
                query: String(input.query || 'MAPK resistance mechanism'),
                sources: ['pubmed'],
                items: candidateItems,
                citations: candidateItems.map((item, index) => ({
                  source: 'pubmed',
                  pointer: item.pmid || item.id || `paper-${index + 1}`,
                  reason: `Candidate ${index + 1}.`
                })),
                loaded_context_blocks: [],
                papers_read_count: 0,
                source_counts: { pubmed: candidateItems.length },
                source_errors: {},
                summary: `Found ${candidateItems.length} literature results (PubMed: ${candidateItems.length}).`
              };
            }
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async (item = {}) => ({
              pdf_urls: [`https://example.org/${String(item.id || 'paper').trim()}.pdf`],
              abstract_sections: [
                {
                  label: 'Abstract',
                  text: `Abstract for ${String(item.id || 'paper').trim()}.`
                }
              ]
            }),
            loadPaperContexts: async ({ items }) => {
              loadCalls.push(items.map((item) => item.id));
              return {
                ok: true,
                papers_read_count: items.length,
                loaded_context_blocks: items.map((item) => ({
                  paper_id: item.id,
                  paper_title: item.title,
                  section_label: 'Results',
                  excerpt: `Loaded context for ${item.id}.`,
                  relevance_reason: 'Directly matches the search query.',
                  source: item.source,
                  evidence_kind: 'text'
                })),
                papers: items,
                summary: `Read ${items.length} paper(s) and loaded ${items.length} context block(s).`
              };
            }
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => {
              activeDownloads += 1;
              maxConcurrentDownloads = Math.max(maxConcurrentDownloads, activeDownloads);
              downloadCalls.push({
                linked_type: String(input.linked_type || ''),
                linked_name: String(input.linked_name || ''),
                storage_path: String(input.storage_path || ''),
                paper_title: String(input.paper_title || ''),
                page_url: String(input.page_url || ''),
                candidate_urls: Array.isArray(input.candidate_urls) ? input.candidate_urls.slice() : []
              });
              try {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                  ok: true,
                  status: 'completed',
                  file_name: `${String(input.paper_title || 'paper').trim()}.pdf`,
                  file_path: path.join(storageRoot, 'Papers', String(input.linked_name || 'Uncategorized'), `${String(input.paper_title || 'paper').trim()}.pdf`),
                  relative_path: `Papers/${String(input.linked_name || 'Uncategorized')}/${String(input.paper_title || 'paper').trim()}.pdf`,
                  summary: `Downloaded ${String(input.paper_title || 'paper').trim()}.pdf`
                };
              } finally {
                activeDownloads -= 1;
              }
            }
          }
        });

        const result = await runtime.execute({
          query: 'MAPK resistance mechanism',
          message: 'Please gather literature on MAPK resistance.',
          limit: 9,
          max_papers: 9,
          source: 'pubmed',
          storage_path: storageRoot,
          snapshot: {
            settings: {
              storagePath: storageRoot
            },
            projects: [
              {
                id: 'project-atlas',
                name: 'Atlas'
              }
            ],
            protocols: [],
            notebooks: [],
            workflows: [],
            papers: []
          },
          project: {
            id: 'project-atlas',
            name: 'Atlas'
          }
        });

        assert.equal(result.ok, true);
        assert.equal(result.status, 'completed');
        assert.equal(searchCalls.length, 1);
        assert.equal(searchCalls[0].query, 'MAPK resistance mechanism');
        assert.equal(searchCalls[0].limit, 9);
        assert.equal(searchCalls[0].max_papers, 9);
        assert.equal(loadCalls.length, 2);
        assert.deepEqual(loadCalls[0], candidateItems.slice(0, 8).map((item) => item.id));
        assert.deepEqual(loadCalls[1], [candidateItems[8].id]);
        assert.equal(downloadCalls.length, 9);
        assert.equal(maxConcurrentDownloads > 1, true);
        assert.equal(downloadCalls.every((call) => call.linked_type === 'literature-search'), true);
        assert.equal(downloadCalls.every((call) => call.linked_name === 'Atlas'), true);
        assert.equal(downloadCalls.every((call) => call.storage_path === storageRoot), true);
        assert.equal(result.sub_agent_id.length > 0, true);
        assert.equal(result.sub_agent?.task?.state, 'completed');
        assert.equal(result.sub_agent?.message_count >= 2, true);
        assert.equal(result.sub_agent_context.storage_path, storageRoot);
        assert.equal(result.selected_papers.length, 9);
        assert.equal(result.downloaded_papers.length, 9);
        assert.equal(result.loaded_context_blocks.length, 9);
        assert.equal(result.papers_read_count, 9);
        assert.match(String(result.summary || ''), /Downloaded 9 selected PDF/i);
        assert.match(String(result.summary || ''), /Loaded 9 bounded context block/i);
        assert.equal(result.downloaded_papers.every((item) => String(item.relative_path || '').includes('Papers/Atlas/')), true);
        assert.equal(result.sub_agent?.last_response?.output?.selected_papers.length, 9);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('literature search workflow uses a real Codex sub-agent to read extracted paper markdown for Codex callers', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-codex-'));
      const turns = [];
      const loadCalls = [];
      const subAgentRuntime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:00:00.000Z',
        createId: () => 'subagent-codex-paper-1',
        runSubAgentTurn: async (turnInput = {}) => {
          turns.push(JSON.parse(JSON.stringify(turnInput)));
          return {
            assistant_message: JSON.stringify({
              ok: true,
              status: 'completed',
              selected_papers: [
                {
                  paper_id: 'paper-1',
                  paper_title: 'MAPK resistance markdown paper',
                  reason: 'The extracted markdown contains the requested mechanism.'
                }
              ],
              loaded_context_blocks: [
                {
                  paper_id: 'paper-1',
                  paper_title: 'MAPK resistance markdown paper',
                  section_label: 'Results',
                  excerpt: 'Extracted markdown links pathway reactivation to MAPK inhibitor resistance.',
                  relevance_reason: 'Directly answers what mechanism should enter the main context.',
                  source: 'knowledge_markdown',
                  evidence_kind: 'text'
                }
              ],
              papers_read_count: 1,
              summary: 'Read 1 extracted paper markdown file and loaded 1 context block.'
            }),
            summary: 'Codex paper context loaded.',
            metadata: {
              provider: 'codex-cli',
              real_codex_sub_agent: true,
              codex_session_id: 'codex-session-paper-1',
              command: 'exec'
            }
          };
        }
      });

      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            searchLiteratureCandidates: async () => ({
              ok: true,
              status: 'completed',
              query: 'MAPK resistance',
              sources: ['pubmed'],
              items: [
                {
                  id: 'candidate-1',
                  source: 'pubmed',
                  title: 'MAPK resistance markdown paper',
                  summary: 'A paper about pathway reactivation and MAPK resistance.',
                  url: 'https://example.org/mapk',
                  doi: '10.1000/mapk'
                }
              ],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              source_counts: { pubmed: 1 },
              source_errors: {},
              summary: 'Found 1 literature result.'
            })
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pdf_urls: ['https://example.org/mapk.pdf'],
              abstract_sections: []
            }),
            loadPaperContexts: async () => {
              loadCalls.push('called');
              throw new Error('Codex paper context path should not call the generic paper context loader.');
            }
          },
          paperDownloadRuntime: {
            downloadPaper: async () => ({
              ok: true,
              status: 'completed',
              file_name: 'mapk.pdf',
              file_path: path.join(storageRoot, 'Papers', 'Atlas', 'mapk.pdf'),
              relative_path: 'Papers/Atlas/mapk.pdf',
              knowledge_markdown_path: path.join(storageRoot, 'KnowledgeBase', 'papers.md', '10.1000_mapk', 'paper.md'),
              knowledge_markdown_relative_path: 'KnowledgeBase/papers.md/10.1000_mapk/paper.md',
              knowledge_database: {
                ok: true,
                status: 'ready',
                markdown_relative_path: 'KnowledgeBase/papers.md/10.1000_mapk/paper.md'
              },
              summary: 'Downloaded mapk.pdf and wrote paper.md.'
            })
          },
          subAgentRuntime
        });

        const result = await runtime.execute({
          provider: 'codex',
          model: 'gpt-5.4-mini',
          cwd: '/Users/shiyifan/Projects/Enana',
          query: 'MAPK resistance',
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
        assert.equal(result.codex_paper_context, true);
        assert.equal(result.sub_agent_id, 'subagent-codex-paper-1');
        assert.equal(result.sub_agent.metadata.real_codex_sub_agent, true);
        assert.equal(result.sub_agent.metadata.codex_session_id, 'codex-session-paper-1');
        assert.equal(loadCalls.length, 0);
        assert.equal(result.loaded_context_blocks.length, 1);
        assert.equal(result.loaded_context_blocks[0].source, 'knowledge_markdown');
        assert.equal(result.papers_read_count, 1);
        assert.equal(result.downloaded_papers[0].knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/10.1000_mapk/paper.md');
        assert.equal(turns.length, 1);
        assert.match(String(turns[0].system_prompt || ''), /Codex paper-context sub-agent/);
        assert.match(String(turns[0].message || ''), /knowledge_markdown_path/);
        assert.match(String(turns[0].message || ''), /KnowledgeBase\/papers\.md\/10\.1000_mapk\/paper\.md/);
        assert.doesNotMatch(String(turns[0].message || ''), /call Hikari literature-search/i);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('literature search workflow owns paper IDs used for downloads and reads', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-paper-id-'));
      const downloadCalls = [];
      const loadCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            searchLiteratureCandidates: async () => ({
              ok: true,
              status: 'completed',
              query: 'MAPK resistance',
              sources: ['web'],
              items: [
                {
                  id: 'llm-invented-candidate-id',
                  paper_id: 'llm-invented-paper-id',
                  source: 'web',
                  title: 'MAPK resistance PDF',
                  summary: 'A candidate PDF about MAPK resistance.',
                  url: 'https://example.org/mapk-resistance',
                  published_at: '2025-01-01'
                }
              ],
              citations: [],
              loaded_context_blocks: [],
              papers_read_count: 0,
              source_counts: { web: 1 },
              source_errors: {},
              summary: 'Found 1 literature result.'
            })
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pdf_urls: ['https://example.org/mapk-resistance.pdf'],
              abstract_sections: []
            }),
            loadPaperContexts: async ({ items, download_promise }) => {
              const downloaded = await download_promise;
              loadCalls.push({
                itemPaperId: String(items[0]?.paper_id || ''),
                itemId: String(items[0]?.id || ''),
                downloadedPaperId: String(downloaded[0]?.paper_id || '')
              });
              return {
                ok: true,
                papers_read_count: 1,
                loaded_context_blocks: [
                  {
                    paper_id: String(items[0]?.paper_id || ''),
                    paper_title: String(items[0]?.title || ''),
                    section_label: 'Results',
                    excerpt: 'Canonical paper IDs keep the downloaded PDF matched to the selected item.',
                    relevance_reason: 'Regression coverage for paper ID ownership.',
                    source: 'llm_pdf_read',
                    evidence_kind: 'text'
                  }
                ],
                papers: items,
                summary: 'Read 1 paper(s) and loaded 1 context block(s).'
              };
            }
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => {
              downloadCalls.push(JSON.parse(JSON.stringify(input)));
              return {
                ok: true,
                status: 'completed',
                file_name: 'mapk-resistance.pdf',
                file_path: path.join(storageRoot, 'Papers', 'Atlas', 'mapk-resistance.pdf'),
                relative_path: 'Papers/Atlas/mapk-resistance.pdf',
                summary: 'Downloaded mapk-resistance.pdf'
              };
            }
          }
        });

        const result = await runtime.execute({
          query: 'MAPK resistance',
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
        assert.equal(downloadCalls.length, 1);
        assert.equal(result.selected_papers[0].paper_id, 'paper-1');
        assert.equal(result.downloaded_papers[0].paper_id, 'paper-1');
        assert.equal(loadCalls.length, 1);
        assert.deepEqual(loadCalls[0], {
          itemPaperId: 'paper-1',
          itemId: 'llm-invented-candidate-id',
          downloadedPaperId: 'paper-1'
        });
        assert.equal(result.loaded_context_blocks[0].paper_id, 'paper-1');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });

    test('paper download runtime maps literature-search downloads into top-level Papers folders', async () => {
      const folder = agentPaperDownload.buildPaperStorageFolder({
        rootPath: '/tmp/enana-storage',
        linkedType: 'literature_search',
        linkedName: 'Atlas'
      });

      assert.equal(folder, path.join('/tmp/enana-storage', 'Papers', 'Atlas'));
    });

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
      assert.match(markdown, /### Page 1/);

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

    test('paper markdown import helper updates imported paper records with knowledge markdown paths', async () => {
      const { transformPaperPdfToMarkdown } = require(path.join(__dirname, 'src', 'main', 'helpers', 'main', 'paper-markdown-import.js'));
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

    test('literature search workflow preserves DOI metadata and passes it into paper download', async () => {
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
        assert.equal(downloadCalls.length, 1);
        assert.equal(downloadCalls[0].doi, '10.1000/example-doi');
        assert.equal(downloadCalls[0].page_url, 'https://doi.org/10.1000/example-doi');
        assert.equal(result.selected_papers[0].doi, '10.1000/example-doi');
        assert.equal(result.downloaded_papers[0].knowledge_markdown_relative_path, 'KnowledgeBase/papers.md/10.1000_example-doi/paper.md');
        assert.equal(result.downloaded_papers[0].knowledge_database.status, 'ready');
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

    test('paper analysis runtime summarizes a paper and extracts a protocol candidate', async () => {
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'This paper describes engineered PD-1 nanobodies and reports improved expression after purification optimization.',
            key_findings: [
              'Engineered nanobodies retained target binding.',
              'Purification changes improved recovered material.'
            ],
            method_overview: 'The authors expressed the nanobody in E. coli and purified it by Ni-NTA affinity chromatography.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify engineered PD-1 nanobodies.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin, wash, and elute with imidazole.',
              materials: ['Ni-NTA resin', 'imidazole buffer'],
              steps: ['Clarify lysate', 'Bind to resin', 'Elute with imidazole'],
              notes: 'Exact buffer composition was not fully specified.'
            },
            result_summary: 'Summarized the paper and extracted one purification procedure.'
          }
        })
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Expression rescue and purification optimization for PD-1 nanobodies.',
          methods: [
            'Express nanobody in E. coli.',
            'Purify using Ni-NTA affinity chromatography.'
          ]
        },
        message: 'Summarize the paper and extract the protocol.',
        extract_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.status, 'completed');
      assert.equal(result.paper_title, 'Engineered PD-1 Nanobodies');
      assert.match(String(result.brief_summary || ''), /engineered PD-1 nanobodies/i);
      assert.equal(Array.isArray(result.key_findings), true);
      assert.equal(result.protocol_extraction.title, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol, null);
      assert.match(String(result.summary || ''), /extracted one purification procedure/i);
    });

    test('paper analysis runtime can generate an import-ready protocol from extracted methods', async () => {
      let capturedProtocolInput = null;
      const runtime = agentPaperAnalysis.createPaperAnalysisRuntime({
        requestStructuredJsonPayload: async () => ({
          ok: true,
          payload: {
            brief_summary: 'The paper presents a practical purification workflow for a PD-1 nanobody construct.',
            key_findings: ['Affinity purification was central to the workflow.'],
            method_overview: 'Cells were lysed and the tagged nanobody was purified on Ni-NTA resin.',
            protocol_candidate: {
              title: 'PD-1 Nanobody Purification',
              purpose: 'Purify a tagged PD-1 nanobody.',
              method_text: 'Clarify lysate, bind to Ni-NTA resin for [time], wash, and elute.',
              materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
              steps: ['Clarify lysate', 'Bind to Ni-NTA resin for [time]', 'Elute bound protein'],
              notes: 'Binding duration was not explicitly stated.'
            },
            result_summary: 'Paper analysis completed and protocol candidate prepared.'
          }
        }),
        protocolGenerationRuntime: {
          generateProtocol: async (input) => {
            capturedProtocolInput = input;
            return {
              ok: true,
              status: 'generated',
              protocol: {
                id: 'protocol-generated-1',
                name: 'PD-1 Nanobody Purification',
                createdAt: '2026-03-22T12:05:00.000Z',
                updatedAt: '2026-03-22T12:05:00.000Z',
                purpose: 'Purify a tagged PD-1 nanobody.',
                materials: ['Ni-NTA resin', 'wash buffer', 'elution buffer'],
                steps: [
                  {
                    id: 'step-1',
                    text: 'Clarify lysate',
                    placeholders: []
                  }
                ],
                troubleshooting: 'Problem: Low binding; Possible cause: Short incubation; Solution: Increase contact time.'
              },
              summary: 'Generated protocol from paper analysis.'
            };
          }
        }
      });

      const result = await runtime.analyzePaper({
        paper: {
          title: 'Engineered PD-1 Nanobodies',
          summary: 'Purification-focused workflow for PD-1 nanobody constructs.',
          methods: ['Clarify lysate', 'Bind to Ni-NTA resin', 'Elute protein']
        },
        message: 'Extract the protocol and generate an importable protocol JSON.',
        extract_protocol: true,
        generate_protocol: true
      });

      assert.equal(result.ok, true);
      assert.equal(result.generated_protocol.name, 'PD-1 Nanobody Purification');
      assert.equal(result.generated_protocol.troubleshooting.includes('Low binding'), true);
      assert.equal(capturedProtocolInput.protocol.name, 'PD-1 Nanobody Purification');
      assert.match(String(capturedProtocolInput.protocol.steps.join(' ') || ''), /Ni-NTA resin/i);
      assert.equal(capturedProtocolInput.result_summary, 'The paper presents a practical purification workflow for a PD-1 nanobody construct.');
    });

    test('sub-agent runtime creates, messages, lists, and deletes managed sub-agents', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: (() => {
          let index = 0;
          const values = [
            '2026-03-22T10:00:00.000Z',
            '2026-03-22T10:00:01.000Z',
            '2026-03-22T10:00:02.000Z',
            '2026-03-22T10:00:03.000Z'
          ];
          return () => values[Math.min(index++, values.length - 1)];
        })(),
        createId: () => 'subagent-fixed-1',
        runSubAgentTurn: async ({ phase, message }) => ({
          assistant_message: `${phase}: ${message}`,
          summary: `Handled ${phase}.`
        })
      });

      const created = await runtime.createSubAgent({
        name: 'paper-helper',
        system_prompt: 'You help summarize papers.',
        message: 'Read this abstract.',
        metadata: {
          task_type: 'paper-analysis'
        }
      });
      assert.equal(created.ok, true);
      assert.equal(created.status, 'created');
      assert.equal(created.agent.id, 'subagent-fixed-1');
      assert.equal(created.agent.messages.length, 2);
      assert.equal(created.agent.messages[1].role, 'assistant');

      const updated = await runtime.sendSubAgentMessage({
        agent_id: 'subagent-fixed-1',
        message: 'Now extract the main methods.'
      });
      assert.equal(updated.ok, true);
      assert.equal(updated.status, 'updated');
      assert.equal(updated.agent.messages.length, 4);
      assert.match(String(updated.agent.last_response?.assistant_message || ''), /message: Now extract/i);

      const listed = runtime.listSubAgents();
      assert.equal(listed.ok, true);
      assert.equal(listed.items.length, 1);
      assert.equal(listed.items[0].id, 'subagent-fixed-1');

      const deleted = runtime.deleteSubAgent({
        agent_id: 'subagent-fixed-1',
        reason: 'Task finished'
      });
      assert.equal(deleted.ok, true);
      assert.equal(deleted.status, 'deleted');

      const missing = runtime.getSubAgent({
        agent_id: 'subagent-fixed-1'
      });
      assert.equal(missing.ok, false);
      assert.equal(missing.status, 'missing');
    });

    test('sub-agent runtime preserves Codex session metadata for real session resumes', async () => {
      let messageTurnAgentMetadata = null;
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:00:00.000Z',
        createId: () => 'subagent-codex-1',
        runSubAgentTurn: async (turnInput = {}) => {
          if (turnInput.phase === 'create') {
            return {
              assistant_message: 'created in Codex',
              summary: 'created',
              metadata: {
                provider: 'codex-cli',
                real_codex_sub_agent: true,
                codex_session_id: 'codex-session-1',
                command: 'exec'
              }
            };
          }
          messageTurnAgentMetadata = turnInput.agent?.metadata || {};
          return {
            assistant_message: 'resumed in Codex',
            summary: 'resumed',
            metadata: {
              provider: 'codex-cli',
              real_codex_sub_agent: true,
              codex_session_id: 'codex-session-1',
              command: 'exec resume'
            }
          };
        }
      });

      const created = await runtime.createSubAgent({
        system_prompt: 'You are a delegated Codex helper.',
        message: 'Start the helper.'
      });
      assert.equal(created.ok, true);
      assert.equal(created.agent.metadata.codex_session_id, 'codex-session-1');
      assert.equal(created.agent.metadata.real_codex_sub_agent, true);

      const updated = await runtime.sendSubAgentMessage({
        agent_id: 'subagent-codex-1',
        message: 'Continue the helper.'
      });
      assert.equal(updated.ok, true);
      assert.equal(messageTurnAgentMetadata.codex_session_id, 'codex-session-1');
      assert.equal(updated.agent.metadata.command, 'exec resume');
    });

    test('sub-agent runtime builds a Codex prompt for delegated helper sessions', () => {
      const prompt = agentSubAgent.buildCodexSubAgentPrompt({
        phase: 'create',
        agent: {
          id: 'subagent-codex-2',
          name: 'methods-helper'
        },
        system_prompt: 'Find protocol risks.',
        message: 'Review the assay setup.',
        messages: [
          { role: 'user', text: 'Review the assay setup.' }
        ]
      });

      assert.match(prompt, /real delegated Codex sub-agent/);
      assert.match(prompt, /Sub-agent name: methods-helper/);
      assert.match(prompt, /Find protocol risks\./);
      assert.match(prompt, /Review the assay setup\./);
    });

    test('sub-agent runtime supplies the python sandbox prompt internally when task metadata requests it', async () => {
      const turns = [];
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        runSubAgentTurn: async (turnInput = {}) => {
          turns.push(turnInput);
          return {
            assistant_message: `handled ${turnInput.phase}`,
            summary: 'handled'
          };
        }
      });

      const created = await runtime.createSubAgent({
        name: 'python-sandbox-helper',
        message: 'Supervise the next run.',
        metadata: {
          task_type: 'python-sandbox'
        }
      });

      assert.equal(created.ok, true);
      assert.match(String(created.agent.system_prompt || ''), /Python sandbox supervisor sub-agent/);
      assert.match(String(turns[0]?.system_prompt || ''), /Python sandbox supervisor sub-agent/);
      assert.equal(turns[0]?.message, 'Supervise the next run.');
    });

    test('sub-agent runtime execute validates action-specific requirements', async () => {
      const runtime = agentSubAgent.createAgentSubAgentRuntime();

      const invalidCreate = await runtime.execute({
        action: 'create',
        system_prompt: '',
        message: 'hello'
      });
      assert.equal(invalidCreate.ok, false);
      assert.match(String(invalidCreate.error || ''), /system_prompt/i);

      const invalidAction = await runtime.execute({
        action: 'unknown'
      });
      assert.equal(invalidAction.ok, false);
      assert.match(String(invalidAction.error || ''), /must be one of create, message, delete, get, or list/i);
    });

    test('sub-agent runtime tracks liveness from process state instead of timeout-only age checks', async () => {
      let createIndex = 0;
      const runtime = agentSubAgent.createAgentSubAgentRuntime({
        now: () => '2026-03-22T10:10:00.000Z',
        createId: () => {
          createIndex += 1;
          return `subagent-live-${createIndex}`;
        },
        isProcessAlive: (processId) => Number(processId) === 4312,
        runSubAgentTurn: async ({ phase }) => ({
          assistant_message: `${phase} ok`,
          summary: `${phase} ok`
        })
      });

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-1',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 4312,
        summary: 'Python still running.'
      });
      const processBacked = runtime.getSubAgent({
        agent_id: 'subagent-live-1'
      });
      assert.equal(processBacked.ok, true);
      assert.equal(processBacked.agent.liveness.live, true);
      assert.equal(processBacked.agent.liveness.state, 'running');
      assert.equal(processBacked.agent.liveness.reason, 'process_alive');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-2',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        summary: 'Long run with no OS pid exposed yet.'
      });
      const noPid = runtime.getSubAgent({
        agent_id: 'subagent-live-2'
      });
      assert.equal(noPid.ok, true);
      assert.equal(noPid.agent.liveness.live, true);
      assert.equal(noPid.agent.liveness.state, 'running');
      assert.equal(noPid.agent.liveness.reason, 'heartbeat_observed');

      await runtime.createSubAgent({
        system_prompt: 'Track one task.',
        message: 'Start tracking.'
      });
      runtime.startSubAgentTask({
        agent_id: 'subagent-live-3',
        task_type: 'python-sandbox',
        started_at: '2026-03-22T08:00:00.000Z',
        process_id: 9999,
        summary: 'This worker exited unexpectedly.'
      });
      const dead = runtime.getSubAgent({
        agent_id: 'subagent-live-3'
      });
      assert.equal(dead.ok, true);
      assert.equal(dead.agent.liveness.live, false);
      assert.equal(dead.agent.liveness.state, 'dead');
      assert.equal(dead.agent.liveness.reason, 'process_exited');
    });

  }
};
