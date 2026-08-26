module.exports = function registerAgentLiteraturePaperAndSubAgentSuiteLiteratureSearchRuntime(context = {}) {
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
    test('literature search runtime auto mode runs web search alongside scholarly APIs', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => {
          calls.push('pubmed');
          return [
            {
              pmid: '100',
              title: 'EGFR inhibitor resistance PubMed paper',
              summary: 'PubMed result about EGFR inhibitor resistance.',
              url: 'https://pubmed.ncbi.nlm.nih.gov/100/'
            }
          ];
        },
        searchEuropePmcRecords: async () => {
          calls.push('europe_pmc');
          return [
            {
              pmcid: 'PMC100',
              title: 'EGFR inhibitor resistance Europe PMC paper',
              summary: 'Europe PMC result about EGFR inhibitor resistance.',
              url: 'https://europepmc.org/article/PMC/PMC100'
            }
          ];
        },
        searchCrossrefRecords: async () => {
          calls.push('crossref');
          return [
            {
              doi: '10.1000/egfr',
              title: 'EGFR inhibitor resistance Crossref paper',
              summary: 'Crossref result about EGFR inhibitor resistance.',
              url: 'https://doi.org/10.1000/egfr'
            }
          ];
        },
        searchWebResults: async () => {
          calls.push('web');
          return [
            {
              title: 'EGFR inhibitor resistance web-discovered paper',
              summary: 'Provider web search result about EGFR inhibitor resistance.',
              url: 'https://www.nature.com/articles/egfr-resistance',
              source_domain: 'www.nature.com'
            }
          ];
        }
      });

      const result = await runtime.execute({
        query: 'EGFR inhibitor resistance',
        source: 'auto'
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['pubmed', 'europe_pmc', 'crossref', 'web']);
      assert.deepEqual(result.sources, ['pubmed', 'europe_pmc', 'crossref', 'web']);
      assert.equal(result.source_counts.web, 1);
      assert.equal(result.items.some((item) => item.source === 'web' && item.source_domain === 'www.nature.com'), true);
    });
    test('literature search defers web discovery to the outer Codex agent during an MCP request', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async () => {
          calls.push('pubmed');
          return [{
            pmid: '101',
            title: 'Molecular glue degrader PubMed paper',
            url: 'https://pubmed.ncbi.nlm.nih.gov/101/'
          }];
        },
        searchWebResults: async () => {
          calls.push('web');
          throw new Error('Nested Codex web search should not run.');
        }
      });

      const result = await runtime.searchLiteratureCandidates({
        query: 'molecular glue degraders',
        sources: ['pubmed', 'web'],
        defer_web_search_to_codex: true
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['pubmed']);
      assert.deepEqual(result.sources, ['pubmed', 'web']);
      assert.equal(result.source_counts.pubmed, 1);
      assert.equal(result.source_counts.web, 0);
      assert.match(String(result.source_errors.web || ''), /deferred to the active Codex agent/i);
    });
    test('literature search runtime uses private internal sizing without a public query limit', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async ({ query, limit }) => {
          calls.push({ query, limit });
          return Array.from({ length: limit }, (_unused, index) => ({
            pmid: String(1000 + index),
            title: `Molecular glue degrader candidate ${index + 1}`,
            summary: 'Candidate paper found through PubMed.',
            url: `https://pubmed.ncbi.nlm.nih.gov/${1000 + index}/`
          }));
        }
      });

      const result = await runtime.searchLiteratureCandidates({
        query: 'molecular glue degraders',
        source: 'pubmed',
        _internal_limit: 12,
        _internal_max_per_source: 12
      });

      assert.equal(result.ok, true);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].query, 'molecular glue degraders');
      assert.equal(calls[0].limit, 12);
      assert.equal(result.items.length, 12);
      assert.equal(result.source_counts.pubmed, 12);
    });
    test('literature search runtime leaves sources unbounded when the caller omits caps', async () => {
      const calls = [];
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchPubMedRecords: async ({ limit }) => {
          calls.push(limit);
          return Array.from({ length: 13 }, (_unused, index) => ({
            pmid: String(2000 + index),
            title: `Molecular glue degrader candidate ${index + 1}`
          }));
        }
      });

      const result = await runtime.searchLiteratureCandidates({
        query: 'molecular glue degraders',
        source: 'pubmed'
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, [0]);
      assert.equal(result.items.length, 13);
      assert.equal(result.source_counts.pubmed, 13);
    });
    test('literature search canonicalizes supplementary DOI results to the parent article URL', async () => {
      const runtime = agentLiteratureSearch.createLiteratureSearchRuntime({
        searchCrossrefRecords: async () => ([
          {
            doi: '10.1021/acs.jmedchem.5c01681.s001',
            title: 'Molecular glue degrader study',
            url: 'https://doi.org/10.1021/acs.jmedchem.5c01681.s001'
          },
          {
            doi: '10.1021/acs.jmedchem.5c01681.s002',
            title: 'Molecular glue degrader study supplement',
            url: 'https://doi.org/10.1021/acs.jmedchem.5c01681.s002'
          }
        ])
      });

      const result = await runtime.searchLiteratureCandidates({
        query: 'molecular glue degraders',
        source: 'crossref'
      });

      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].doi, '10.1021/acs.jmedchem.5c01681');
      assert.equal(result.items[0].url, 'https://doi.org/10.1021%2Facs.jmedchem.5c01681');
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
    test('literature search runtime applies a preferred source within an explicit source list', async () => {
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
        sources: ['pubmed', 'crossref'],
        preferred_literature_source: 'crossref',
        allow_web_fallback: false
      });

      assert.equal(result.ok, true);
      assert.deepEqual(calls, ['crossref', 'pubmed']);
      assert.deepEqual(result.sources, ['crossref', 'pubmed']);
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
  }
};
