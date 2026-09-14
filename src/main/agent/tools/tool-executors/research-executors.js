'use strict';

const { toIntegerInRange } = require('../../../data/value-utils.js');
const { ensureObject } = require('../../../lib/normalize.js');
const { getLiteratureResearchSession, recordLiteratureResearchDownload } = require('../../../papers/workflow/literature-research-session.js');
const {
  resolveToolParserPayload,
  hasOwn,
  buildExecutorSummary,
  resolvePaperDownloadContext
} = require('./shared.js');

function registerResearchToolExecutors(genericAgentToolRuntime, context = {}) {
  const {
    cleanText,
    webSearchRuntime,
    literatureSearchRuntime,
    paperDownloadRuntime,
    purchaseRecommendationRuntime,
    paperAnalysisRuntime,
    paperWikiSearchRuntime
  } = context;

  genericAgentToolRuntime.registerToolExecutor('web-search', async ({ args, context }) => {
    if (!webSearchRuntime || typeof webSearchRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Web search runtime is not configured.'
      };
    }
    return webSearchRuntime.execute({
      ...args,
      traceContext: context?.traceContext || null,
      query: cleanText(args?.query, 1200),
      message: cleanText(args?.message || context?.message, 1200),
      parser_payload: resolveToolParserPayload(args, context),
      limit: toIntegerInRange(args?.limit, 8, 1, 25),
      allowed_domains: Array.isArray(args?.allowed_domains) ? args.allowed_domains : [],
      user_location: args?.user_location && typeof args.user_location === 'object'
        ? args.user_location
        : null,
      external_web_access: args?.external_web_access !== false
    });
  });

  genericAgentToolRuntime.registerToolExecutor('literature-search', async ({ args, context }) => {
    if (!literatureSearchRuntime || typeof literatureSearchRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Literature search runtime is not configured.'
      };
    }
    const snapshot = context?.snapshot && typeof context.snapshot === 'object'
      ? context.snapshot
      : {};
    const project = args?.project && typeof args.project === 'object'
      ? args.project
      : (context?.project && typeof context.project === 'object' ? context.project : {});
    const storagePath = cleanText(
      args?.storage_path
      || args?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    );
    const input = {
      ...args,
      provider: cleanText(args?.provider || context?.provider, 80),
      model: cleanText(args?.model || context?.model, 120),
      reasoning_effort: cleanText(
        args?.reasoning_effort
          || args?.reasoningEffort
          || context?.reasoning_effort
          || context?.reasoningEffort,
        40
      ),
      cwd: cleanText(args?.cwd || context?.cwd, 2400),
      traceContext: context?.traceContext || null,
      defer_web_search_to_codex: context?.agentMcp === true
        && cleanText(context?.provider, 80).toLowerCase() === 'codex',
      query: cleanText(args?.query, 600),
      message: cleanText(args?.message || context?.message, 12000),
      snapshot,
      project,
      storage_path: storagePath,
      storagePath,
      parser_payload: resolveToolParserPayload(args, context)
    };
    if (hasOwn(args, 'limit')) {
      input.limit = toIntegerInRange(args?.limit, 8);
    }
    if (hasOwn(args, 'max_per_source')) {
      input.max_per_source = toIntegerInRange(args?.max_per_source, 5, 1, 10);
    }
    return literatureSearchRuntime.execute(input);
  });

  genericAgentToolRuntime.registerToolExecutor('paper-download', async ({ args, context }) => {
    const scheduledTaskContext = ensureObject(
      ensureObject(context?.snapshot).scheduled_task
        || ensureObject(context?.snapshot).scheduledTask
    );
    if (scheduledTaskContext.deny_paper_download === true || scheduledTaskContext.denyPaperDownload === true) {
      return {
        ok: false,
        status: 'blocked',
        error: 'Paper downloads are disabled for this metadata-only scheduled task.',
        summary: 'Paper download was blocked by the scheduled task policy.'
      };
    }
    if (!paperDownloadRuntime || typeof paperDownloadRuntime.downloadPaper !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper download runtime is not configured.'
      };
    }
    const resolved = resolvePaperDownloadContext(args, context);
    const research = getLiteratureResearchSession(context?.snapshot);
    if (context?.snapshot?.literature_research && !research) {
      return { ok: false, status: 'error', error: 'Paper research session is no longer active.' };
    }
    if (research) {
      resolved.linked_name = research.input.project?.name || research.input.query;
      resolved.linked_type = research.input.project?.name ? 'project' : 'literature-search';
      const previous = research.downloads.find((paper) => paper.ok && paper.knowledge_markdown_path
        && args.doi && String(paper.doi).toLowerCase() === String(args.doi).toLowerCase());
      const reused = previous || await research.findLocalPaper?.(args);
      if (reused) {
        recordLiteratureResearchDownload(context?.snapshot, args, reused);
        return { ...reused, summary: `Reused extracted paper Markdown for ${args.paper_title || args.doi}.` };
      }
    }
    const result = await paperDownloadRuntime.downloadPaper({
      ...args,
      page_url: cleanText(args?.page_url || args?.pageUrl || context?.pageUrl, 2000),
      message: cleanText(args?.message || context?.message, 12000),
      paper_title: cleanText(args?.paper_title || args?.paperTitle, 320),
      linked_type: resolved.linked_type,
      collection_name: resolved.linked_name,
      linked_name: resolved.linked_name,
      storage_path: resolved.storage_path
    }).catch((error) => ({
      ok: false,
      status: 'error',
      error: cleanText(error?.message || error, 1200) || 'Paper download failed.'
    }));

    recordLiteratureResearchDownload(context?.snapshot, args, result);

    return {
      ...result,
      summary: cleanText(result?.summary, 320)
        || (result?.ok === true
          ? `Downloaded ${cleanText(result?.file_name, 240) || 'paper.pdf'}.`
          : 'Paper download failed.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('purchase-recommendation', async ({ args, context }) => {
    const result = await purchaseRecommendationRuntime.execute({
      ...args,
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      traceContext: context?.traceContext || null,
      message: cleanText(args?.message || context?.message, 1200),
      parser_payload: resolveToolParserPayload(args, context),
      limit: toIntegerInRange(args?.limit, 6, 1, 6),
      search_limit: toIntegerInRange(args?.search_limit, 10, 1, 16)
    });
    const items = Array.isArray(result?.items) ? result.items : [];
    return {
      ...result,
      citations: items.slice(0, 8).map((item, index) => ({
        source: 'web_source',
        pointer: cleanText(item?.product_url || item?.title, 260) || `purchase-result:${index + 1}`,
        reason: 'Matched purchasable product metadata from a vendor page.'
      })),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(
          cleanText,
          'purchase-recommendation',
          items,
          'purchase-recommendation returned no matches.'
        )
    };
  });

  genericAgentToolRuntime.registerToolExecutor('paper-analysis', async ({ args, context }) => {
    if (!paperAnalysisRuntime || typeof paperAnalysisRuntime.analyzePaper !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper analysis runtime is not configured.',
        summary: 'Paper analysis runtime is not configured.'
      };
    }
    const snapshot = context?.snapshot && typeof context.snapshot === 'object'
      ? context.snapshot
      : {};
    // The agent owns conversational continuity, so the caller is responsible for
    // passing the full analytical request as `query` (the tool description says to
    // preserve it across a paper-reference clarification). Fall back to the current
    // turn only when `query` is absent.
    const analysisQuery = cleanText(args?.query || context?.message, 2400);
    return paperAnalysisRuntime.analyzePaper({
      ...args,
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      reasoning_effort: cleanText(context?.reasoning_effort || context?.reasoningEffort, 40),
      cwd: cleanText(context?.cwd, 2400),
      query: analysisQuery,
      message: analysisQuery,
      snapshot,
      storage_path: cleanText(
        args?.storage_path
        || context?.storagePath
        || snapshot?.settings?.storagePath
        || snapshot?.storagePath,
        2000
      ),
      traceContext: context?.traceContext || null
    });
  });

  genericAgentToolRuntime.registerToolExecutor('paper-search', async ({ args, context }) => {
    if (!paperWikiSearchRuntime || typeof paperWikiSearchRuntime.searchWikiSections !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Paper wiki search runtime is not configured.',
        summary: 'Paper wiki search runtime is not configured.'
      };
    }
    const snapshot = context?.snapshot && typeof context.snapshot === 'object' ? context.snapshot : {};
    const storagePath = cleanText(
      args?.storage_path
      || args?.storagePath
      || context?.storagePath
      || snapshot?.settings?.storagePath
      || snapshot?.storagePath,
      2000
    );
    const result = await paperWikiSearchRuntime.searchWikiSections({
      storage_path: storagePath,
      query: cleanText(args?.query, 400),
      limit: toIntegerInRange(args?.limit, 8, 1, 25),
      paper_id: cleanText(args?.paper_id || args?.paperId, 180),
      scope: cleanText(args?.scope, 40),
      container: cleanText(args?.container, 220)
    }).catch((error) => ({
      ok: false,
      status: 'error',
      error: cleanText(error?.message || error, 1200) || 'Paper wiki search failed.'
    }));

    const matches = Array.isArray(result?.matches) ? result.matches : [];
    return {
      ...result,
      items: matches,
      citations: matches.slice(0, 8).map((match, index) => ({
        source: 'paper-wiki',
        pointer: [
          cleanText(match?.title, 200),
          match?.page_citation ? `(${match.page_citation})` : '',
          cleanText(match?.doi, 120)
        ].filter(Boolean).join(' ') || `paper-wiki:${index + 1}`,
        reason: cleanText(match?.section_heading, 120) || 'Matched section from paper wiki.'
      })),
      summary: cleanText(result?.summary, 320)
        || (matches.length
          ? `paper-search matched ${matches.length} section${matches.length === 1 ? '' : 's'}.`
          : 'paper-search returned no matches.')
    };
  });
}

module.exports = { registerResearchToolExecutors };
