module.exports = function registerAgentLiteraturePaperAndSubAgentSuiteLiteratureSearchWorkflow(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  const {
    assert,
    fsPromises,
    path,
    test,
    agentSubAgent,
    agentLiteratureSearchWorkflow,
    agentPaperDownload
  } = scope;
    test('literature search workflow delegates to a sub-agent, batches paper reads, and leaves downloads for user action', async () => {
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
          createSubAgentRuntime: agentSubAgent.createAgentSubAgentRuntime,
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
        assert.equal(downloadCalls.length, 0);
        assert.equal(maxConcurrentDownloads, 0);
        assert.equal(result.sub_agent_id.length > 0, true);
        assert.equal(result.sub_agent?.task?.state, 'completed');
        assert.equal(result.sub_agent?.message_count >= 2, true);
        assert.equal(result.sub_agent_context.storage_path, storageRoot);
        assert.equal(result.selected_papers.length, 9);
        assert.equal(result.selected_papers.every((item) => item.download_status === 'not_requested'), true);
        assert.equal(result.downloaded_papers.length, 0);
        assert.equal(result.loaded_context_blocks.length, 9);
        assert.equal(result.papers_read_count, 9);
        assert.match(String(result.summary || ''), /downloads were not started automatically/i);
        assert.match(String(result.summary || ''), /Loaded 9 bounded context block/i);
        assert.equal(result.sub_agent?.last_response?.output?.selected_papers.length, 9);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('literature search workflow does not forward public limit fields when caller omits caps', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-no-public-limits-'));
      const searchCalls = [];
      try {
        const candidateItems = Array.from({ length: 13 }, (_unused, index) => ({
          id: `paper-${index + 1}`,
          source: index % 2 ? 'crossref' : 'pubmed',
          title: `Molecular glue degrader paper ${index + 1}`,
          summary: `Candidate paper ${index + 1} about molecular glue degraders.`,
          doi: `10.1000/glue-${index + 1}`,
          url: `https://example.org/glue-${index + 1}`
        }));
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          createSubAgentRuntime: agentSubAgent.createAgentSubAgentRuntime,
          literatureSearchRuntime: {
            searchLiteratureCandidates: async (input = {}) => {
              searchCalls.push(JSON.parse(JSON.stringify(input)));
              return {
                ok: true,
                status: 'completed',
                query: String(input.query || ''),
                sources: ['pubmed', 'crossref', 'web'],
                items: candidateItems,
                citations: [],
                loaded_context_blocks: [],
                papers_read_count: 0,
                source_counts: { pubmed: 1, crossref: 1, web: 0 },
                source_errors: {},
                summary: 'Found 2 literature results.'
              };
            }
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pdf_urls: [],
              abstract_sections: []
            }),
            loadPaperContexts: async ({ items }) => ({
              ok: true,
              papers_read_count: items.length,
              loaded_context_blocks: items.map((item) => ({
                paper_id: item.paper_id,
                paper_title: item.title,
                section_label: 'Abstract',
                excerpt: `Context for ${item.title}.`,
                relevance_reason: 'Matches the query.',
                source: item.source,
                evidence_kind: 'text'
              })),
              papers: items,
              summary: `Read ${items.length} paper(s).`
            })
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => ({
              ok: true,
              status: 'completed',
              file_name: `${String(input.paper_id || 'paper')}.pdf`,
              file_path: path.join(storageRoot, 'Papers', `${String(input.paper_id || 'paper')}.pdf`),
              relative_path: `Papers/${String(input.paper_id || 'paper')}.pdf`,
              summary: `Downloaded ${String(input.paper_id || 'paper')}.pdf`
            })
          }
        });

        const result = await runtime.runLiteratureWorkflow({
          query: 'molecular glue degraders',
          source: 'auto'
        }, {
          storage_path: storageRoot,
          project: {
            id: 'project-atlas',
            name: 'Atlas'
          }
        });

        assert.equal(result.ok, true);
        assert.equal(searchCalls.length, 1);
        assert.equal(searchCalls[0].query, 'molecular glue degraders');
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], 'limit'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], 'max_per_source'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], 'max_papers'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], '_internal_limit'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], '_internal_max_per_source'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], '_internal_max_papers'), false);
        assert.equal(result.selected_papers.length, candidateItems.length);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('literature search workflow owns paper IDs used for reads and future download actions', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-paper-id-'));
      const downloadCalls = [];
      const loadCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          createSubAgentRuntime: agentSubAgent.createAgentSubAgentRuntime,
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
              assert.equal(download_promise, null);
              loadCalls.push({
                itemPaperId: String(items[0]?.paper_id || ''),
                itemId: String(items[0]?.id || '')
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
        assert.equal(downloadCalls.length, 0);
        assert.equal(result.selected_papers[0].paper_id, 'paper-1');
        assert.equal(result.selected_papers[0].download_status, 'not_requested');
        assert.deepEqual(result.selected_papers[0].pdf_urls, ['https://example.org/mapk-resistance.pdf']);
        assert.equal(result.downloaded_papers.length, 0);
        assert.equal(loadCalls.length, 1);
        assert.deepEqual(loadCalls[0], {
          itemPaperId: 'paper-1',
          itemId: 'llm-invented-candidate-id'
        });
        assert.equal(result.loaded_context_blocks[0].paper_id, 'paper-1');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('literature search workflow soft-ranks saved snake_case preferred journals without hard filtering', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-preferred-journal-'));
      const searchCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          createSubAgentRuntime: agentSubAgent.createAgentSubAgentRuntime,
          literatureSearchRuntime: {
            buildLiteratureQuery: () => 'molecular glue degraders',
            searchLiteratureCandidates: async (input = {}) => {
              searchCalls.push(JSON.parse(JSON.stringify(input)));
              return {
                ok: true,
                status: 'completed',
                query: 'molecular glue degraders',
                sources: ['pubmed'],
                items: [
                  {
                    id: 'other-paper',
                    source: 'pubmed',
                    title: 'Molecular glue degrader review',
                    summary: 'Comparable molecular glue degrader evidence from a non-preferred journal.',
                    journal: 'Other Journal',
                    url: 'https://example.org/other',
                    doi: '10.1000/other',
                    published_at: '2026-01-01'
                  },
                  {
                    id: 'cell-paper',
                    source: 'pubmed',
                    title: 'Molecular glue degrader mechanism',
                    summary: 'Comparable molecular glue degrader evidence from a preferred journal.',
                    journal: 'Cell',
                    url: 'https://example.org/cell',
                    doi: '10.1000/cell',
                    published_at: '2024-01-01'
                  }
                ],
                citations: [],
                source_counts: { pubmed: 2 },
                source_errors: {},
                summary: 'Found 2 candidate papers.'
              };
            }
          },
          paperContextLoaderRuntime: {
            fetchEuropePmcMetadataForItem: async () => ({
              pdf_urls: [],
              abstract_sections: []
            }),
            loadPaperContexts: async ({ items }) => ({
              ok: true,
              papers_read_count: items.length,
              loaded_context_blocks: items.map((item) => ({
                paper_id: item.paper_id,
                paper_title: item.paper_title,
                section_label: 'Abstract',
                excerpt: `Loaded ${item.paper_title}.`,
                relevance_reason: 'Selected candidate.',
                source: item.source,
                evidence_kind: 'text'
              })),
              papers: items,
              summary: `Read ${items.length} paper(s).`
            })
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => ({
              ok: true,
              status: 'completed',
              file_name: `${String(input.paper_title || 'paper').trim()}.pdf`,
              file_path: path.join(storageRoot, 'Papers', `${String(input.paper_title || 'paper').trim()}.pdf`),
              relative_path: `Papers/${String(input.paper_title || 'paper').trim()}.pdf`,
              summary: 'Downloaded selected paper.'
            })
          }
        });

        const result = await runtime.execute({
          query: 'molecular glue degraders',
          source: 'auto',
          max_papers: 1,
          storage_path: storageRoot,
          snapshot: {
            settings: {
              preferred_journals: ['Cell'],
              storagePath: storageRoot
            }
          }
        });

        assert.equal(result.ok, true);
        assert.equal(searchCalls.length, 1);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], 'journals'), false);
        assert.equal(Object.prototype.hasOwnProperty.call(searchCalls[0], 'journal_filter'), false);
        assert.deepEqual(result.sub_agent_context.preferred_journals, ['Cell']);
        assert.equal(result.selected_papers.length, 1);
        assert.equal(result.selected_papers[0].journal, 'Cell');
        assert.equal(result.selected_papers[0].doi, '10.1000/cell');
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
    test('paper download runtime maps literature-search downloads into top-level Papers folders', async () => {
      const folder = agentPaperDownload.buildPaperStorageFolder({
        rootPath: '/tmp/hikari-storage',
        linkedType: 'literature_search',
        linkedName: 'Atlas'
      });

      assert.equal(folder, path.join('/tmp/hikari-storage', 'Papers', 'Atlas'));
    });
    test('paper download context resolves an id-only project by snapshot lookup and drops a stale id', () => {
      const { resolvePaperDownloadContext } = require(path.join(__dirname, 'src', 'main', 'agent', 'tools', 'tool-executors', 'shared.js'));
      const snapshot = { settings: { storagePath: '/tmp/hikari-storage' }, projects: [{ id: 'project-atlas', name: 'Atlas' }] };

      const found = resolvePaperDownloadContext({ collection_name: 'MAPK' }, { project: { id: 'project-atlas', name: '' }, snapshot });
      assert.deepEqual([found.linked_type, found.linked_name], ['project', 'Atlas']);

      const stale = resolvePaperDownloadContext({ collection_name: 'MAPK' }, { project: { id: 'project-gone', name: '' }, snapshot });
      assert.deepEqual([stale.linked_type, stale.linked_name], ['literature-search', 'MAPK']);
    });
    test('literature search workflow routes project downloads into the project folder and keeps collection names raw', async () => {
      const storageRoot = await fsPromises.mkdtemp(path.join(__dirname, 'tmp', 'literature-workflow-routing-'));
      const downloadCalls = [];
      try {
        const runtime = agentLiteratureSearchWorkflow.createLiteratureSearchWorkflowRuntime({
          literatureSearchRuntime: {
            searchLiteratureCandidates: async () => ({ ok: false, error: 'search should not run' })
          },
          paperDownloadRuntime: {
            downloadPaper: async (input = {}) => {
              downloadCalls.push({
                linked_type: String(input.linked_type || ''),
                linked_name: String(input.linked_name || '')
              });
              return { ok: true, status: 'completed', file_name: 'paper.pdf' };
            }
          }
        });
        const candidateResult = {
          ok: true,
          status: 'completed',
          query: 'MAPK resistance mechanisms',
          sources: ['pubmed'],
          items: [
            {
              id: 'paper-1',
              source: 'pubmed',
              title: 'MAPK resistance paper one',
              summary: 'Mechanistic evidence for MAPK resistance and pathway reactivation.',
              url: 'https://example.org/paper-1',
              doi: '10.1000/paper-1'
            }
          ],
          citations: [],
          source_counts: { pubmed: 1 },
          source_errors: {}
        };
        const baseInput = {
          query: 'MAPK resistance mechanisms',
          storage_path: storageRoot,
          download_selected_papers: true
        };
        const projectInput = { ...baseInput, project: { id: 'project-atlas', name: 'Atlas' } };

        await runtime.runLiteratureWorkflow(
          projectInput,
          runtime.buildCopiedContext(projectInput, projectInput.query),
          candidateResult
        );
        await runtime.runLiteratureWorkflow(
          baseInput,
          runtime.buildCopiedContext(baseInput, baseInput.query),
          candidateResult
        );

        assert.deepEqual(downloadCalls, [
          { linked_type: 'project', linked_name: 'Atlas' },
          { linked_type: 'literature-search', linked_name: 'MAPK resistance mechanisms' }
        ]);
      } finally {
        await fsPromises.rm(storageRoot, { recursive: true, force: true });
      }
    });
};
