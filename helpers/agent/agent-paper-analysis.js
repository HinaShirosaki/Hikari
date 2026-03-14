'use strict';

const PAPER_MATCH_SCORE_THRESHOLD = 0.6;
const PAPER_MATCH_DELTA_THRESHOLD = 0.1;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value, maxLength = 600) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  asArray(values).forEach((value) => {
    const normalized = cleanText(value, 300);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

function tokenize(value) {
  return cleanText(value, 12000)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 180);
}

function parseDate(value) {
  const parsed = Date.parse(cleanText(value, 80));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeIso(value) {
  const parsed = parseDate(value);
  return parsed ? new Date(parsed).toISOString() : '';
}

function tokenOverlapScore(leftTokens, rightTokens) {
  const left = new Set(asArray(leftTokens).map((token) => String(token).toLowerCase()));
  const right = uniqueStrings(asArray(rightTokens).map((token) => String(token).toLowerCase()));
  if (!left.size || !right.length) {
    return 0;
  }
  let overlap = 0;
  right.forEach((token) => {
    if (left.has(token)) {
      overlap += 1;
    }
  });
  return clamp(overlap / right.length, 0, 1);
}

function buildCharNgramSet(value, n = 3) {
  const normalized = cleanText(value, 12000)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return new Set();
  }
  if (normalized.length <= n) {
    return new Set([normalized]);
  }
  const set = new Set();
  for (let index = 0; index <= normalized.length - n; index += 1) {
    set.add(normalized.slice(index, index + n));
  }
  return set;
}

function charNgramJaccard(left, right) {
  const leftSet = buildCharNgramSet(left, 3);
  const rightSet = buildCharNgramSet(right, 3);
  if (!leftSet.size || !rightSet.size) {
    return 0;
  }
  let overlap = 0;
  leftSet.forEach((gram) => {
    if (rightSet.has(gram)) {
      overlap += 1;
    }
  });
  const union = leftSet.size + rightSet.size - overlap;
  if (!union) {
    return 0;
  }
  return clamp(overlap / union, 0, 1);
}

function semanticSimilarity(query, targetText) {
  const queryTokens = tokenize(query);
  const targetTokens = tokenize(targetText);
  const tokenScore = tokenOverlapScore(targetTokens, queryTokens);
  const ngramScore = charNgramJaccard(query, targetText);
  return clamp((0.65 * tokenScore) + (0.35 * ngramScore), 0, 1);
}

function normalizeMethod(method) {
  const source = method && typeof method === 'object' ? method : {};
  const rawSteps = asArray(source.steps);
  const steps = rawSteps
    .map((step) => {
      if (typeof step === 'string') {
        return cleanText(step, 240);
      }
      return cleanText(step?.action || step?.text || step?.instruction || step?.description, 240);
    })
    .filter(Boolean)
    .slice(0, 20);

  return {
    title: cleanText(source.title || source.name, 220),
    steps,
    citations: asArray(source.citations).map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 8)
  };
}

function normalizeReagent(reagent) {
  const source = reagent && typeof reagent === 'object' ? reagent : {};
  return {
    name: cleanText(source.name, 180),
    type: cleanText(source.type, 80),
    identifier: cleanText(source.identifier, 140),
    notes: cleanText(source.notes, 220)
  };
}

function normalizeKeyFigure(figure, index) {
  if (typeof figure === 'string') {
    const summary = cleanText(figure, 280);
    return {
      item: summary ? `Figure ${index + 1}` : '',
      summary
    };
  }
  const source = figure && typeof figure === 'object' ? figure : {};
  return {
    item: cleanText(source.item || source.label || source.figure || source.table, 140),
    summary: cleanText(source.summary || source.description || source.note, 320)
  };
}

function hasUploadedPdf(paper) {
  const source = paper && typeof paper === 'object' ? paper : {};
  return source.has_uploaded_pdf === true
    || source.hasUploadedPdf === true
    || Boolean(cleanText(source.pdfDataUrl, 120))
    || Boolean(cleanText(source.storedFilePath, 280))
    || Boolean(cleanText(source.storedRelativePath, 280))
    || Boolean(cleanText(source.relative_path, 280));
}

function deriveDeepReadReady(paper) {
  const source = paper && typeof paper === 'object' ? paper : {};
  if (source.deep_read_ready === true || source.deepReadReady === true) {
    return true;
  }
  const uploaded = hasUploadedPdf(source);
  const hasSummary = Boolean(cleanText(source.summary, 200));
  const methods = asArray(source.methods).length || asArray(source.methodsExtract).length;
  const reagents = asArray(source.keyReagents).length || asArray(source.reagents).length;
  const keyFigures = asArray(source.keyFigures).length
    || asArray(source.key_figures).length
    || asArray(source.summaryStructured?.important_figures_or_tables).length;
  return uploaded && (hasSummary || methods > 0 || reagents > 0 || keyFigures > 0);
}

function deriveAvailabilityStatus(paper) {
  const source = paper && typeof paper === 'object' ? paper : {};
  const explicit = cleanText(source.availability_status || source.availabilityStatus, 80).toLowerCase();
  if (explicit) {
    return explicit;
  }
  const deepReady = deriveDeepReadReady(source);
  if (deepReady) {
    return 'deep_ready';
  }
  if (hasUploadedPdf(source)) {
    return 'uploaded_pdf';
  }
  if (cleanText(source.title, 220) || cleanText(source.summary, 200)) {
    return 'metadata_only';
  }
  return 'unavailable';
}

function scoreRecency(value, now = new Date()) {
  const updated = parseDate(value);
  if (!updated) {
    return 0.2;
  }
  const deltaMs = Math.max(0, now.getTime() - updated);
  const days = deltaMs / (24 * 60 * 60 * 1000);
  return clamp(Math.exp(-days / 270), 0, 1);
}

function splitCompareQueries(message) {
  const source = cleanText(message, 800);
  const quoted = [];
  const regex = /["“”']([^"“”']{2,220})["“”']/g;
  let match = regex.exec(source);
  while (match) {
    quoted.push(cleanText(match[1], 220));
    match = regex.exec(source);
  }
  if (quoted.length >= 2) {
    return uniqueStrings(quoted).slice(0, 2);
  }

  const normalized = source.replace(/\s+/g, ' ').trim();
  const split = normalized.split(/\b(?:vs\.?|versus|compared to|compare)\b/i).map((part) => cleanText(part, 220)).filter(Boolean);
  if (split.length >= 2) {
    return uniqueStrings([split[0], split[1]]).slice(0, 2);
  }
  return [];
}

function buildPaperSearchableDocs({ papers, projects }) {
  const projectNameById = new Map(
    asArray(projects).map((project) => [cleanText(project?.id, 80), cleanText(project?.name, 220)])
  );
  return asArray(papers).map((paper, index) => {
    const source = paper && typeof paper === 'object' ? paper : {};
    const id = cleanText(source.id, 80) || `paper_${index + 1}`;
    const title = cleanText(source.title, 320);
    const linkedProjectId = cleanText(source.linkedId || source.project_id, 80);
    const linkedProjectName = cleanText(source.linked_project_name || source.linkedProjectName, 220)
      || cleanText(source.project_name, 220)
      || projectNameById.get(linkedProjectId)
      || '';
    const methods = asArray(source.methods).map(normalizeMethod).filter((method) => method.title || method.steps.length);
    const fallbackMethods = !methods.length
      ? asArray(source.methodsExtract).map(normalizeMethod).filter((method) => method.title || method.steps.length)
      : [];
    const normalizedMethods = methods.length ? methods : fallbackMethods;
    const reagents = asArray(source.keyReagents).map(normalizeReagent).filter((item) => item.name);
    const fallbackReagents = !reagents.length
      ? asArray(source.reagents).map(normalizeReagent).filter((item) => item.name)
      : [];
    const normalizedReagents = reagents.length ? reagents : fallbackReagents;
    const keyFigures = uniqueStrings([
      ...asArray(source.keyFigures).map((item, figureIndex) => {
        const normalized = normalizeKeyFigure(item, figureIndex);
        return cleanText(`${normalized.item}: ${normalized.summary}`, 320);
      }),
      ...asArray(source.key_figures).map((item, figureIndex) => {
        const normalized = normalizeKeyFigure(item, figureIndex);
        return cleanText(`${normalized.item}: ${normalized.summary}`, 320);
      }),
      ...asArray(source.summaryStructured?.important_figures_or_tables).map((item, figureIndex) => {
        const normalized = normalizeKeyFigure(item, figureIndex);
        return cleanText(`${normalized.item}: ${normalized.summary}`, 320);
      })
    ]).filter(Boolean);
    const tags = uniqueStrings([
      ...asArray(source.tags),
      ...asArray(source.summaryStructured?.keywords)
    ]).slice(0, 20);
    const availabilityStatus = deriveAvailabilityStatus(source);
    const deepReadReady = deriveDeepReadReady(source);
    const uploaded = hasUploadedPdf(source);
    const ingestionStatus = cleanText(source.ingestion_status || source.ingestionStatus, 80).toLowerCase()
      || (deepReadReady ? 'ready' : (uploaded ? 'uploaded' : 'metadata_only'));
    const updatedAt = normalizeIso(source.updated_at || source.updatedAt || source.ingestionUpdatedAt || source.createdAt);
    const searchableText = [
      title,
      cleanText(source.summary, 1200),
      linkedProjectName,
      linkedProjectId,
      tags.join(' '),
      normalizedMethods.map((method) => `${method.title} ${method.steps.join(' ')}`).join(' '),
      normalizedReagents.map((item) => `${item.type} ${item.name} ${item.identifier} ${item.notes}`).join(' '),
      keyFigures.join(' ')
    ].join(' ').trim();

    return {
      paper_id: id,
      paper_title: title,
      summary: cleanText(source.summary, 1500),
      linked_project_id: linkedProjectId,
      linked_project_name: linkedProjectName,
      methods: normalizedMethods,
      reagents: normalizedReagents,
      key_figures: keyFigures,
      tags,
      has_uploaded_pdf: uploaded,
      deep_read_ready: deepReadReady,
      availability_status: availabilityStatus,
      ingestion_status: ingestionStatus,
      updated_at: updatedAt,
      searchable_text: searchableText
    };
  }).filter((doc) => doc.paper_id || doc.paper_title);
}

function classifyPaperTaskMode({ message, entities }) {
  const text = cleanText(message, 2000).toLowerCase();
  const combined = `${text} ${cleanText(entities?.paper_title, 220).toLowerCase()}`;
  const compareQueries = splitCompareQueries(message);

  if (/\b(compare|versus|vs|difference)\b/.test(combined) || compareQueries.length >= 2) {
    return {
      mode: 'compare_papers',
      requires_deep_reading: true,
      compare_queries: compareQueries
    };
  }
  if (/\b(method|methods|procedure|protocol|experimental design)\b/.test(combined)) {
    return {
      mode: 'extract_methods',
      requires_deep_reading: true,
      compare_queries: []
    };
  }
  if (/\b(reagents?|materials?|antibod(?:y|ies)|plasmids?|buffers?|compounds?|strains?|primers?)\b/.test(combined)) {
    return {
      mode: 'extract_reagents',
      requires_deep_reading: true,
      compare_queries: []
    };
  }
  if (/\b(figure|figures|table|panel)\b/.test(combined)) {
    return {
      mode: 'identify_key_figures',
      requires_deep_reading: true,
      compare_queries: []
    };
  }
  if (/\b(summarize|summary|summarise|abstract|overview|gist)\b/.test(combined)) {
    return {
      mode: 'summarize',
      requires_deep_reading: false,
      compare_queries: []
    };
  }
  return {
    mode: 'general_paper_query',
    requires_deep_reading: false,
    compare_queries: []
  };
}

function retrievePaperCandidates({
  message,
  entities,
  docs,
  maxCandidates = 6,
  now = new Date()
}) {
  const rows = asArray(docs);
  const queryText = cleanText(message, 2000);
  const queryTokens = tokenize(queryText);
  const entityText = [
    cleanText(entities?.paper_title, 220),
    cleanText(entities?.project, 180),
    cleanText(entities?.protein, 140),
    cleanText(entities?.compound, 140)
  ].join(' ').trim();
  const entityTokens = tokenize(entityText);
  const entityPaperTitle = cleanText(entities?.paper_title, 220);
  const projectHint = cleanText(entities?.project, 180);

  return rows
    .map((doc) => {
      const searchable = cleanText(doc.searchable_text, 9000);
      const semanticScore = semanticSimilarity(queryText, searchable);
      const titleScore = semanticSimilarity(queryText, doc.paper_title || '');
      const entityTitleScore = entityPaperTitle
        ? semanticSimilarity(entityPaperTitle, doc.paper_title || '')
        : 0;
      const entityOverlapScore = tokenOverlapScore(tokenize(searchable), entityTokens);
      const projectRelevanceScore = projectHint
        ? semanticSimilarity(projectHint, `${doc.linked_project_name || ''} ${doc.linked_project_id || ''}`)
        : 0;
      const recency = scoreRecency(doc.updated_at, now);
      const score = clamp(
        (0.35 * semanticScore)
        + (0.20 * titleScore)
        + (0.20 * entityTitleScore)
        + (0.10 * entityOverlapScore)
        + (0.10 * projectRelevanceScore)
        + (0.05 * recency),
        0,
        1
      );
      const reasonParts = [];
      if (titleScore >= 0.55) {
        reasonParts.push('title overlap');
      }
      if (entityTitleScore >= 0.75) {
        reasonParts.push('entity title overlap');
      }
      if (semanticScore >= 0.4) {
        reasonParts.push('semantic overlap');
      }
      if (entityOverlapScore > 0) {
        reasonParts.push('entity overlap');
      }
      if (projectRelevanceScore > 0) {
        reasonParts.push('project relevance');
      }

      return {
        ...doc,
        score,
        semantic_score: semanticScore,
        title_score: titleScore,
        entity_title_score: entityTitleScore,
        entity_overlap_score: entityOverlapScore,
        project_relevance_score: projectRelevanceScore,
        recency_score: recency,
        reason: reasonParts.length ? reasonParts.join(', ') : 'fallback candidate',
        _queryTokens: queryTokens
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      if (right.title_score !== left.title_score) {
        return right.title_score - left.title_score;
      }
      if (right.semantic_score !== left.semantic_score) {
        return right.semantic_score - left.semantic_score;
      }
      return cleanText(left.paper_title || left.paper_id, 320)
        .localeCompare(cleanText(right.paper_title || right.paper_id, 320));
    })
    .slice(0, Math.max(1, Number(maxCandidates) || 6))
    .map((row) => {
      const next = { ...row };
      delete next._queryTokens;
      return next;
    });
}

function evaluatePaperAvailability({ candidate, mode }) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const deepMode = ['extract_methods', 'extract_reagents', 'identify_key_figures', 'compare_papers']
    .includes(cleanText(mode, 80));
  const hasUpload = source.has_uploaded_pdf === true;
  const deepReady = source.deep_read_ready === true;
  const status = cleanText(source.availability_status, 80).toLowerCase()
    || (deepReady ? 'deep_ready' : (hasUpload ? 'uploaded_pdf' : 'metadata_only'));
  const deepAvailable = !deepMode || deepReady;
  return {
    availability_status: status || 'unavailable',
    has_uploaded_pdf: hasUpload,
    deep_read_ready: deepReady,
    deep_read_available: deepAvailable,
    needs_upload: deepMode && !deepReady
  };
}

function evaluatePaperAmbiguity({ ranked }) {
  const rows = asArray(ranked);
  const top = rows[0] || null;
  const second = rows[1] || null;
  const topScore = Number(top?.score) || 0;
  const scoreDelta = top && second
    ? Math.max(0, Number(top.score) - Number(second.score))
    : (top ? Number(top.score) : 0);

  let needsClarification = false;
  let ambiguityReason = '';
  if (!rows.length) {
    needsClarification = true;
    ambiguityReason = 'no_paper_candidates';
  } else if (topScore < PAPER_MATCH_SCORE_THRESHOLD) {
    needsClarification = true;
    ambiguityReason = 'top_score_below_threshold';
  } else if (rows.length > 1 && scoreDelta < PAPER_MATCH_DELTA_THRESHOLD) {
    needsClarification = true;
    ambiguityReason = 'top_two_scores_too_close';
  }
  return {
    needs_clarification: needsClarification,
    ambiguity_reason: ambiguityReason,
    top_score: topScore,
    score_delta: Number(scoreDelta) || 0
  };
}

function buildPaperFollowUpQuestion({ mode, candidates, availability }) {
  const selected = availability?.selected && typeof availability.selected === 'object'
    ? availability.selected
    : {};
  const secondary = availability?.secondary && typeof availability.secondary === 'object'
    ? availability.secondary
    : {};
  const deepMode = ['extract_methods', 'extract_reagents', 'identify_key_figures', 'compare_papers']
    .includes(cleanText(mode, 80));

  if (deepMode && cleanText(mode, 80) === 'compare_papers' && (selected.needs_upload || secondary.needs_upload)) {
    return 'I can compare these papers deeply after both PDFs are uploaded and ingested. Which missing paper PDF should we upload first?';
  }
  if (deepMode && selected.needs_upload) {
    return 'I need the paper PDF uploaded and ingested before deep analysis. Please upload the PDF (or wait for ingestion to finish), then ask again.';
  }

  const options = asArray(candidates)
    .slice(0, 3)
    .map((candidate) => cleanText(candidate?.paper_title || candidate?.paper_id, 220))
    .filter(Boolean);

  if (!options.length) {
    return 'Which paper should I analyze? You can give the exact title or upload the PDF.';
  }
  if (cleanText(mode, 80) === 'compare_papers' && options.length < 2) {
    return 'Which two uploaded papers should I compare? Please provide both paper titles.';
  }
  if (options.length === 1) {
    return `Should I use "${options[0]}" for this request?`;
  }

  const quoted = options.map((item) => `"${item}"`);
  const optionText = quoted.length === 2
    ? `${quoted[0]} or ${quoted[1]}`
    : `${quoted[0]}, ${quoted[1]}, or ${quoted[2]}`;
  return `Which paper should I use: ${optionText}?`;
}

function pickComparisonCandidates({ modeInfo, ranked }) {
  if (modeInfo.mode !== 'compare_papers') {
    return {
      primary: ranked[0] || null,
      secondary: null
    };
  }

  const queries = asArray(modeInfo.compare_queries).slice(0, 2);
  if (!queries.length) {
    return {
      primary: ranked[0] || null,
      secondary: ranked[1] || null
    };
  }

  const byQuery = queries.map((query) => {
    return asArray(ranked)
      .map((candidate) => ({
        candidate,
        score: semanticSimilarity(query, `${candidate.paper_title || ''} ${candidate.summary || ''}`)
      }))
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return cleanText(left.candidate?.paper_title || left.candidate?.paper_id, 320)
          .localeCompare(cleanText(right.candidate?.paper_title || right.candidate?.paper_id, 320));
      })
      .map((entry) => entry.candidate)[0] || null;
  }).filter(Boolean);

  const unique = [];
  byQuery.forEach((candidate) => {
    if (!candidate) {
      return;
    }
    if (unique.some((item) => item.paper_id === candidate.paper_id)) {
      return;
    }
    unique.push(candidate);
  });
  asArray(ranked).forEach((candidate) => {
    if (unique.length >= 2) {
      return;
    }
    if (unique.some((item) => item.paper_id === candidate.paper_id)) {
      return;
    }
    unique.push(candidate);
  });

  return {
    primary: unique[0] || null,
    secondary: unique[1] || null
  };
}

function buildPaperComparisonSummary({ primary, secondary }) {
  const left = primary && typeof primary === 'object' ? primary : {};
  const right = secondary && typeof secondary === 'object' ? secondary : {};
  const leftName = cleanText(left.paper_title || left.paper_id, 220) || 'Paper A';
  const rightName = cleanText(right.paper_title || right.paper_id, 220) || 'Paper B';
  const leftSummary = cleanText(left.summary, 260) || 'No summary available.';
  const rightSummary = cleanText(right.summary, 260) || 'No summary available.';

  const leftMethodTitles = asArray(left.methods).map((method) => cleanText(method?.title, 160)).filter(Boolean);
  const rightMethodTitles = asArray(right.methods).map((method) => cleanText(method?.title, 160)).filter(Boolean);
  const leftReagents = uniqueStrings(asArray(left.reagents).map((item) => cleanText(item?.name, 140)).filter(Boolean));
  const rightReagents = uniqueStrings(asArray(right.reagents).map((item) => cleanText(item?.name, 140)).filter(Boolean));
  const overlapReagents = leftReagents.filter((name) => rightReagents.some((item) => item.toLowerCase() === name.toLowerCase()));

  const methodDelta = `${leftMethodTitles.length} vs ${rightMethodTitles.length}`;
  const figureDelta = `${asArray(left.key_figures).length} vs ${asArray(right.key_figures).length}`;
  const reagentLine = overlapReagents.length
    ? `Shared reagents: ${overlapReagents.slice(0, 5).join(', ')}.`
    : 'No obvious shared reagents were found in cached extraction.';

  return [
    `Paper comparison: "${leftName}" vs "${rightName}".`,
    `Summaries: ${leftSummary} | ${rightSummary}`,
    `Method coverage (cached): ${methodDelta}. Key-figure coverage: ${figureDelta}.`,
    reagentLine
  ].join(' ');
}

function resolvePaperRequest({
  message,
  entities,
  papers,
  projects,
  docs,
  maxCandidates = 6,
  now = new Date()
}) {
  const searchableDocs = asArray(docs).length
    ? asArray(docs)
    : buildPaperSearchableDocs({
      papers: asArray(papers),
      projects: asArray(projects)
    });
  const modeInfo = classifyPaperTaskMode({ message, entities });
  const ranked = retrievePaperCandidates({
    message,
    entities,
    docs: searchableDocs,
    maxCandidates,
    now
  });
  const ambiguity = evaluatePaperAmbiguity({ ranked });
  const comparison = pickComparisonCandidates({ modeInfo, ranked });
  const selected = comparison.primary;
  const secondary = comparison.secondary;
  const availability = evaluatePaperAvailability({
    candidate: selected,
    mode: modeInfo.mode
  });
  const secondaryAvailability = evaluatePaperAvailability({
    candidate: secondary,
    mode: modeInfo.mode
  });

  let needsClarification = ambiguity.needs_clarification;
  let ambiguityReason = cleanText(ambiguity.ambiguity_reason, 120);
  if (
    modeInfo.mode === 'compare_papers'
    && selected
    && secondary
    && availability.needs_upload !== true
    && secondaryAvailability.needs_upload !== true
    && (
      ambiguityReason === 'top_score_below_threshold'
      || ambiguityReason === 'top_two_scores_too_close'
      || ambiguityReason === 'no_paper_candidates'
    )
  ) {
    needsClarification = false;
    ambiguityReason = '';
  }
  if (modeInfo.mode === 'compare_papers' && (!selected || !secondary)) {
    needsClarification = true;
    ambiguityReason = 'compare_papers_requires_two_candidates';
  }
  if (modeInfo.requires_deep_reading && modeInfo.mode === 'compare_papers' && (availability.needs_upload || secondaryAvailability.needs_upload)) {
    needsClarification = true;
    ambiguityReason = 'compare_requires_uploaded_pdfs';
  } else if (modeInfo.requires_deep_reading && availability.needs_upload) {
    needsClarification = true;
    ambiguityReason = 'deep_read_requires_uploaded_pdf';
  }

  const candidates = asArray(ranked).slice(0, 3).map((candidate) => ({
    paper_id: cleanText(candidate.paper_id, 80),
    paper_title: cleanText(candidate.paper_title, 320),
    linked_project_name: cleanText(candidate.linked_project_name, 220),
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : 0,
    semantic_score: Number.isFinite(Number(candidate.semantic_score)) ? Number(candidate.semantic_score) : 0,
    title_score: Number.isFinite(Number(candidate.title_score)) ? Number(candidate.title_score) : 0,
    entity_overlap_score: Number.isFinite(Number(candidate.entity_overlap_score))
      ? Number(candidate.entity_overlap_score)
      : 0,
    project_relevance_score: Number.isFinite(Number(candidate.project_relevance_score))
      ? Number(candidate.project_relevance_score)
      : 0,
    availability_status: cleanText(candidate.availability_status, 80),
    deep_read_ready: candidate.deep_read_ready === true,
    has_uploaded_pdf: candidate.has_uploaded_pdf === true,
    reason: cleanText(candidate.reason, 260)
  }));
  const clarificationQuestion = needsClarification
    ? buildPaperFollowUpQuestion({
      mode: modeInfo.mode,
      candidates,
      availability: {
        selected: availability,
        secondary: secondaryAvailability
      }
    })
    : '';
  const comparisonSummary = modeInfo.mode === 'compare_papers' && selected && secondary && !needsClarification
    ? buildPaperComparisonSummary({ primary: selected, secondary })
    : '';

  return {
    mode: modeInfo.mode,
    requires_deep_reading: modeInfo.requires_deep_reading === true,
    compare_queries: asArray(modeInfo.compare_queries),
    selected,
    secondary_selected: secondary,
    availability,
    secondary_availability: secondaryAvailability,
    ranked,
    candidates,
    needs_clarification: needsClarification,
    ambiguity_reason: ambiguityReason,
    clarification_question: cleanText(clarificationQuestion, 360),
    top_score: Number(ambiguity.top_score) || 0,
    score_delta: Number(ambiguity.score_delta) || 0,
    comparison_summary: cleanText(comparisonSummary, 2200)
  };
}

module.exports = {
  PAPER_MATCH_SCORE_THRESHOLD,
  PAPER_MATCH_DELTA_THRESHOLD,
  buildPaperSearchableDocs,
  classifyPaperTaskMode,
  retrievePaperCandidates,
  evaluatePaperAvailability,
  evaluatePaperAmbiguity,
  buildPaperFollowUpQuestion,
  resolvePaperRequest,
  buildPaperComparisonSummary
};
