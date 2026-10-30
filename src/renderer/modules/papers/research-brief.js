import { createPresentation } from "../../lib/i18n/presentation.js";
import "./localization.js";
const i18nUi = createPresentation("papers");
import { setPaperText } from './localization.js';

// Read the canonical saved analysis beside the paper's knowledge files. The
// renderer paper ID is unrelated to the folder ID; never construct it from ID.
export function resolveResearchBriefPath(paper, storagePath) {
  const root = String(storagePath || '').trim().replace(/[\\/]+$/u, '');
  if (!root) return '';
  for (const candidate of [paper?.knowledgeMetaRelativePath, paper?.knowledge_meta_relative_path,
    paper?.knowledgeMarkdownRelativePath, paper?.knowledge_markdown_relative_path,
    paper?.knowledgeExtractedTextRelativePath, paper?.knowledge_extracted_text_relative_path]) {
    const parts = String(candidate || '').replace(/\\/gu, '/').split('/');
    if (parts.length !== 4 || parts[0] !== 'KnowledgeBase' || parts[1] !== 'papers.md'
      || parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))) continue;
    return `${root}/${parts.slice(0, 3).join('/')}/intake.json`;
  }
  return '';
}

export async function loadResearchBrief(paper, storagePath, api) {
  const path = resolveResearchBriefPath(paper, storagePath);
  if (!paper || !path) return { status: 'empty' };
  if (typeof api?.readFileBytes !== 'function') return { status: 'unavailable' };
  try {
    const result = await api.readFileBytes(path);
    if (!result?.ok) {
      return { status: /ENOENT|ENOTDIR/u.test(String(result?.error || '')) ? 'empty' : 'error' };
    }
    const record = JSON.parse(new TextDecoder().decode(result.bytes));
    if (!record || typeof record !== 'object' || Array.isArray(record)) return { status: 'error' };
    return { status: 'ready', record };
  } catch {
    return { status: 'error' };
  }
}

export function createPaperResearchBrief(context) {
  const { elements, document: doc, window: win, state, uiState } = context;
  const content = elements.paperBriefContent;
  let activeKey = '';
  let request = 0;
  const text = value => typeof value === 'string' ? value.trim() : '';
  const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];

  function node(tag, className, value) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (value) i18nUi.setText(element, value);
    return element;
  }

  // UI copy is bound so a language switch updates the open brief in place.
  function uiNode(tag, className, key, params) {
    const element = node(tag, className);
    setPaperText(element, key, params);
    return element;
  }

  function message(key, retry = false) {
    content.replaceChildren(uiNode('p', 'papers-brief-status', key));
    if (retry) {
      const button = uiNode('button', 'ghost-btn', 'brief.retry');
      button.type = 'button';
      button.addEventListener('click', () => { activeKey = ''; render(); });
      content.append(button);
    }
  }

  function field(parent, labelKey, value) {
    if (!text(value)) return;
    const row = node('div', 'papers-brief-field');
    row.append(uiNode('dt', '', labelKey), node('dd', '', text(value)));
    parent.append(row);
  }

  function showRecord(record) {
    const fragment = doc.createDocumentFragment();
    const summary = text(record.one_sentence_summary);
    if (summary) fragment.append(node('p', 'papers-brief-takeaway', summary));
    const experiments = list(record.experiments);
    if (experiments.length) {
      fragment.append(uiNode('h3', 'papers-brief-section-title', 'brief.experiments', { count: experiments.length }));
      experiments.forEach((experiment, index) => {
        const item = node('details', 'papers-brief-experiment');
        item.open = index === 0;
        item.append(text(experiment.title) ? node('summary', '', text(experiment.title)) : uiNode('summary', '', 'brief.experiment', { index: index + 1 }));
        const fields = node('dl', 'papers-brief-fields');
        field(fields, 'brief.method', experiment.technique);
        field(fields, 'brief.variables', experiment.variables);
        field(fields, 'brief.outcome', experiment.outcome);
        field(fields, 'brief.reference', experiment.figure_ref);
        item.append(fields);
        if (text(experiment.evidence)) {
          const evidence = node('details', 'papers-brief-evidence');
          evidence.append(uiNode('summary', '', 'brief.excerpt'), node('blockquote', '', text(experiment.evidence)));
          item.append(evidence);
        }
        fragment.append(item);
      });
    }
    for (const [title, entries, valueKey] of [
      ['brief.sections', list(record.structure_outline), 'summary'],
      ['brief.claims', list(record.notable_claims), 'claim']
    ]) {
      if (!entries.length) continue;
      fragment.append(uiNode('h3', 'papers-brief-section-title', title));
      entries.forEach(entry => {
        const section = node('section', 'papers-brief-section');
        if (text(entry.section)) section.append(node('h4', '', text(entry.section)));
        if (text(entry[valueKey])) section.append(node('p', '', text(entry[valueKey])));
        fragment.append(section);
      });
    }
    if (!fragment.childNodes.length) { message('brief.none'); return; }
    content.replaceChildren(fragment);
  }

  async function render() {
    if (!content) return;
    if (uiState.commentsCollapsed || uiState.contextPanel !== 'brief') {
      activeKey = '';
      request += 1;
      return;
    }
    const paper = context.getActivePaper();
    const key = JSON.stringify([paper?.id, state.settings?.storagePath, resolveResearchBriefPath(paper, state.settings?.storagePath)]);
    if (key === activeKey) return;
    activeKey = key;
    const currentRequest = ++request;
    if (!paper) { message('brief.openPaper'); return; }
    message('brief.loading');
    const result = await loadResearchBrief(paper, state.settings?.storagePath, win?.hikariApi);
    if (currentRequest !== request) return;
    if (result.status === 'ready') showRecord(result.record);
    else if (result.status === 'error') message('brief.readFailed', true);
    else if (result.status === 'unavailable') message('brief.desktopOnly');
    else if (paper.ingestionStatus === 'error') message('brief.processingFailed');
    else message('brief.none');
  }

  return { render };
}
