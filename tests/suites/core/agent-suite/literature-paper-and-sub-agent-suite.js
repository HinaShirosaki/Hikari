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

    test('literature search runtime falls back to web search when scholarly sources are empty', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => [],
        searchCrossrefRecords: async () => [],
        searchEuropePmcRecords: async () => [],
        searchUniProtRecords: async () => [],
        searchWebResults: async () => ({
          items: [
            {
              title: 'Review of PD-1 binders',
              url: 'https://example.org/review',
              snippet: 'A recent external review of PD-1 binders.'
            }
          ]
        })
      });

      const result = await runtime.execute({
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
      assert.equal(capturedProtocolInput.source_paper_title, 'Engineered PD-1 Nanobodies');
      assert.equal(capturedProtocolInput.title, 'PD-1 Nanobody Purification');
      assert.match(String(capturedProtocolInput.method_text || ''), /Ni-NTA resin/i);
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
