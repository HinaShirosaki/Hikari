'use strict';

const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createWebSearchRuntime } = require('../agent-web-search.js');
const { createLiteratureSearchRuntime } = require('../../../papers/search/agent-literature-search.js');
const { createPurchaseRecommendationRuntime } = require('../agent-purchase-recommendation.js');
const { createPaperDownloadRuntime } = require('../../../papers/download/agent-paper-download.js');
const { createPaperAnalysisRuntime } = require('../../../papers/analysis/agent-paper-analysis.js');
const { asArray } = require('../../../lib/normalize.js');
const {
  cleanText,
  resolveToolMessage,
  resolveFocusedToolText
} = require('./utils.js');

function createResearchSmokeChecks({ structuredResponder } = {}) {

  async function smokeLiteratureSearch(options = {}) {
    const runtime = createLiteratureSearchRuntime({
      searchPubMedRecords: async () => ([
        {
          pmid: '12345',
          doi: '10.1000/smoke-pubmed',
          title: 'Smoke Test Paper',
          summary: 'PubMed smoke-test entry.',
          journal: 'Nature',
          published_at: '2024-01-10',
          authors: ['Pat Doe'],
          url: 'https://pubmed.ncbi.nlm.nih.gov/12345/'
        }
      ]),
      searchCrossrefRecords: async () => ([
        {
          doi: '10.1000/smoke-crossref',
          title: 'Crossref Smoke Record',
          summary: 'Crossref smoke-test entry.',
          journal: 'Science',
          published_at: '2023-11-02',
          authors: ['Chris Doe'],
          url: 'https://doi.org/10.1000/smoke-crossref'
        }
      ]),
      searchEuropePmcRecords: async () => ([
        {
          pmcid: 'PMC123',
          pmid: '321',
          doi: '10.1000/smoke-eupmc',
          title: 'Europe PMC Smoke Record',
          summary: 'Europe PMC smoke-test entry.',
          journal: 'Cell',
          published_at: '2022-05-01',
          authors: ['Sam Doe'],
          url: 'https://europepmc.org/article/PMC/PMC123'
        }
      ]),
      searchUniProtRecords: async () => ([
        {
          accession: 'Q9TEST',
          protein_name: 'Example receptor protein',
          gene_name: 'EXR1',
          organism: 'Homo sapiens',
          summary: 'UniProt smoke-test entry.',
          url: 'https://www.uniprot.org/uniprotkb/Q9TEST'
        }
      ])
    });
    const requestMessage = resolveToolMessage(options.message, 'binder methods');
    const result = await runtime.searchLiterature({
      query: requestMessage,
      sources: ['pubmed', 'crossref', 'europe_pmc', 'uniprot'],
      limit: 6
    });
    const itemCount = asArray(result?.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : result?.ok !== false,
      summary: itemCount > 0
        ? `Literature search returned ${itemCount} result${itemCount === 1 ? '' : 's'}.`
        : 'Literature search returned no results.'
    };
  }

  async function smokeWebSearch(options = {}) {
    const runtime = createWebSearchRuntime({
      requestWebSearch: async ({ query, maxResults }) => ({
        ok: true,
        results: [
          {
            title: 'Smoke Web Search Result',
            url: 'https://example.org/smoke-web-search',
            summary: `External result for ${query}.`,
            source_domain: 'example.org'
          }
        ].slice(0, maxResults),
        reasoning: 'Smoke provider-backed web search.'
      })
    });
    const requestMessage = resolveToolMessage(options.message, 'recent binder review');
    const result = await runtime.execute({
      query: requestMessage,
      limit: 4
    });
    const itemCount = asArray(result?.items).length;
    return {
      ...result,
      ok: options.strict === true ? itemCount > 0 : result?.ok !== false,
      summary: itemCount > 0
        ? `Web search returned ${itemCount} result${itemCount === 1 ? '' : 's'}.`
        : 'Web search returned no results.'
    };
  }

  async function smokePaperDownload(options = {}) {
    const storageRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'hikari-agent-tool-smoke-download-'));
    try {
      const runtime = createPaperDownloadRuntime({
        createId: () => 'paper-download-smoke-1',
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
                return '14';
              }
              return '';
            }
          },
          body: {
            async *[Symbol.asyncIterator]() {
              yield Buffer.from('%PDF-1.7 smoke');
            }
          }
        })
      });
      const requestMessage = resolveToolMessage(options.message, 'Smoke Test Paper');
      const result = await runtime.downloadPaper({
        action: 'download',
        page_url: 'https://example.org/article',
        page_html: '<a href="/downloads/paper.pdf">Download PDF</a>',
        linked_type: 'project',
        linked_name: 'Atlas',
        storage_path: storageRoot,
        paper_title: requestMessage
      });
      return {
        ...result,
        ok: result?.ok !== false,
        summary: result?.ok === false
          ? cleanText(result?.error) || 'Paper download smoke test failed.'
          : `Downloaded PDF to ${cleanText(result?.relative_path || result?.file_name) || 'storage'}.`
      };
    } finally {
      await fsPromises.rm(storageRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function smokePaperAnalysis(options = {}) {
    const runtime = createPaperAnalysisRuntime({
      requestStructuredJsonPayload: structuredResponder
    });
    const requestMessage = resolveToolMessage(options.message, 'Extract a protocol from this paper.');
    const result = await runtime.analyzePaper({
      paper: {
        title: 'Binder Methods',
        summary: 'A short paper summary for smoke testing.',
        methods: [
          'Clarify lysate.',
          'Bind clarified lysate to Ni-NTA resin for [time].',
          'Elute with imidazole.'
        ]
      },
      message: requestMessage,
      extract_protocol: true,
      generate_protocol: true
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: cleanText(result?.result_summary || result?.brief_summary) || 'Paper analysis smoke test completed.'
    };
  }

  async function smokePaperSearch(options = {}) {
    const requestMessage = resolveToolMessage(options.message, 'binder purification Ni-NTA methods');
    const focusedQuery = resolveFocusedToolText(options.message, 'binder purification', 8);
    const runtime = {
      searchWikiSections: async ({ query, limit }) => {
        const matches = [
          {
            chunk_id: 'chunk-1',
            paper_id: 'paper-1',
            title: 'Binder Methods',
            doi: '10.1000/binder-methods-smoke',
            year: '2026',
            journal: 'Hikari Smoke Journal',
            section_heading: 'Methods',
            section_text: 'The binder workflow clarifies lysate and binds the clarified sample to Ni-NTA resin.',
            snippet: `The binder workflow uses Ni-NTA resin for ${cleanText(query) || 'purification'}.`,
            page_citation: 'p. 3',
            page_start: 3,
            page_end: 3,
            rank_score: -1.2
          }
        ].slice(0, Math.max(1, Number(limit) || 1));
        return {
          ok: true,
          status: matches.length ? 'matched' : 'no_match',
          query,
          match_count: matches.length,
          matches,
          summary: matches.length
            ? `Found ${matches.length} matching section${matches.length === 1 ? '' : 's'} across 1 paper.`
            : 'No matching paper sections.'
        };
      }
    };
    const result = await runtime.searchWikiSections({
      storage_path: path.join(os.tmpdir(), 'hikari-agent-tool-smoke-paper-wiki'),
      query: focusedQuery,
      limit: 3,
      scope: 'project',
      container: 'Atlas'
    });
    const matches = asArray(result?.matches);
    return {
      ...result,
      items: matches,
      ok: options.strict === true ? matches.length > 0 : result?.ok !== false,
      citations: matches.slice(0, 8).map((match, index) => ({
        source: 'paper-wiki',
        pointer: [
          cleanText(match?.title),
          match?.page_citation ? `(${match.page_citation})` : '',
          cleanText(match?.doi)
        ].filter(Boolean).join(' ') || `paper-wiki:${index + 1}`,
        reason: cleanText(match?.section_heading) || 'Matched section from paper wiki.'
      })),
      summary: matches.length
        ? `paper-search matched ${matches.length} section${matches.length === 1 ? '' : 's'}.`
        : 'paper-search returned no matches.',
      request_message: requestMessage
    };
  }

  async function smokePurchaseRecommendation(options = {}) {
    const pages = {
      'https://vendor-a.test/filter': `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "Product",
                "name": "Metal-Free Endotoxin-Free Filter",
                "image": "https://vendor-a.test/filter.png",
                "brand": { "@type": "Brand", "name": "Vendor A" },
                "offers": {
                  "@type": "Offer",
                  "priceCurrency": "USD",
                  "price": "12.50",
                  "url": "https://vendor-a.test/filter"
                }
              }
            </script>
          </head>
          <body>metal-free endotoxin-free disposable filter</body>
        </html>
      `,
      'https://vendor-b.test/filter': `
        <html>
          <head>
            <meta property="og:title" content="Premium Metal-Free Endotoxin-Free Filter" />
            <meta property="og:image" content="https://vendor-b.test/filter.png" />
            <meta property="og:site_name" content="Vendor B" />
            <meta property="product:price:amount" content="19.99" />
            <meta property="product:price:currency" content="USD" />
            <link rel="canonical" href="https://vendor-b.test/filter" />
          </head>
          <body>metal-free endotoxin-free premium filter</body>
        </html>
      `
    };
    const runtime = createPurchaseRecommendationRuntime({
      searchWebResults: async () => ([
        { title: 'Vendor A filter', url: 'https://vendor-a.test/filter' },
        { title: 'Vendor B filter', url: 'https://vendor-b.test/filter' }
      ]),
      fetch: async (url) => ({
        ok: true,
        text: async () => pages[url] || ''
      })
    });
    const requestMessage = resolveToolMessage(options.message, 'Find a cheap metal-free endotoxin-free syringe filter.');
    const result = await runtime.execute({
      message: requestMessage,
      query: 'syringe filter',
      required_terms: ['metal-free', 'endotoxin-free'],
      budget_preference: 'cheap'
    });
    return {
      ...result,
      ok: result?.ok !== false,
      summary: cleanText(result?.summary) || 'Purchase recommendation smoke test completed.'
    };
  }

  return {
    smokeLiteratureSearch,
    smokeWebSearch,
    smokePaperDownload,
    smokePaperAnalysis,
    smokePaperSearch,
    smokePurchaseRecommendation
  };
}

module.exports = { createResearchSmokeChecks };
