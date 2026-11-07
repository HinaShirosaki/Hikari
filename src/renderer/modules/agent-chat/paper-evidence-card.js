import { mergePaperEvidence } from '../../../shared/paper-evidence.mjs';
import { setAgentText } from './localization.js';
import { createPaperEvidenceReader } from './paper-evidence-reader.js';
import { resolvePaperSourceLink } from './paper-source-links.js';

export function createPaperEvidenceCard(container, { getStoragePath = () => '', onOpenPaperCitation, onOpenRecordCitation } = {}) {
  let signature = '';
  let activeSession = '';
  let activeStorage = '';
  let previousCollections = [];
  let previousRecords = '';
  const choices = new Map();
  const doc = container?.ownerDocument;

  function node(tag, className, text = '') {
    const element = doc.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function label(tag, className, key, params) {
    const element = node(tag, className);
    setAgentText(element, key, params);
    return element;
  }

  function sourceFor(block) {
    const storagePath = getStoragePath();
    if (!storagePath) return null;
    return resolvePaperSourceLink(block.source_path || block.source_absolute_path, [block], storagePath);
  }

  function render(messages, sessionId = '', records = []) {
    if (!container || typeof container.replaceChildren !== 'function' || !doc?.createElement) return;
    const storagePath = getStoragePath();
    const collections = [...(messages || [])].reverse()
      .filter(message => message?.role === 'assistant')
      .map(message => message.meta?.paper_evidence)
      .filter(blocks => Array.isArray(blocks) && blocks.some(block => block && !block.source_type));
    const recordSignature = JSON.stringify(records);
    if (activeSession === sessionId && activeStorage === storagePath && signature
      && recordSignature === previousRecords
      && collections.length === previousCollections.length
      && collections.every((collection, index) => collection === previousCollections[index])) return;
    previousCollections = collections;
    previousRecords = recordSignature;
    const blocks = mergePaperEvidence(...collections);
    const nextSignature = JSON.stringify([sessionId, storagePath, blocks, recordSignature]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const sameSession = activeSession === sessionId && activeStorage === storagePath;
    activeSession = sessionId;
    activeStorage = storagePath;
    if (!sameSession) choices.clear();
    const disclosures = new Map(sameSession ? [...container.querySelectorAll('details[data-evidence-key]')]
      .map(detail => [detail.dataset.evidenceKey, detail.open]) : []);
    const cardOpen = sameSession ? container.querySelector('.agent-evidence-card')?.open ?? true : true;
    const hasEvidence = Boolean(blocks.length || records.length);
    container.hidden = !hasEvidence;
    container.closest('.agent-chat-stage')?.classList.toggle('has-paper-evidence', hasEvidence);
    if (!hasEvidence) { container.replaceChildren(); return; }
    const papers = new Map();
    for (const block of blocks) {
      const key = block.paper_id || block.source_path || block.source_absolute_path || block.paper_title;
      if (!papers.has(key)) papers.set(key, []);
      papers.get(key).push(block);
    }
    for (const key of choices.keys()) if (!papers.has(key)) choices.delete(key);
    const card = node('details', 'agent-evidence-card');
    card.open = cardOpen;
    const heading = node('summary', 'agent-evidence-heading');
    const totals = node('span', 'agent-evidence-total');
    if (papers.size) totals.append(label('span', '', 'evidence.papers', { count: papers.size }), node('span', '', ' · '),
      label('span', '', 'evidence.passages', { count: blocks.length }));
    if (records.length) {
      if (papers.size) totals.append(node('span', '', ' · '));
      totals.append(label('span', '', 'evidence.records', { count: records.length }));
    }
    heading.append(label('span', 'agent-evidence-title', 'evidence.title'), totals);
    card.append(heading);
    const list = node('div', 'agent-evidence-papers');
    let index = 0;
    for (const [key, entries] of papers) {
      const paper = node('details', 'agent-evidence-paper');
      paper.dataset.evidenceKey = key;
      paper.open = disclosures.get(key) ?? index === 0;
      const summary = node('summary', 'agent-evidence-paper-heading');
      summary.append(entries[0].paper_title
        ? node('span', 'agent-evidence-paper-title', entries[0].paper_title)
        : label('span', 'agent-evidence-paper-title', 'evidence.untitled'));
      paper.append(summary, createPaperEvidenceReader({
        doc, entries, choice: choices.get(key),
        onChoiceChange: choice => choices.set(key, choice),
        canOpenSource: block => typeof onOpenPaperCitation === 'function' && Boolean(sourceFor(block)),
        onOpenSource: block => {
          const source = sourceFor(block);
          if (source) return onOpenPaperCitation(source);
        }
      }));
      list.append(paper);
      index += 1;
    }
    for (const record of records) {
      const detail = node('details', 'agent-evidence-paper');
      detail.dataset.evidenceKey = record.target;
      detail.open = disclosures.get(record.target) ?? index === 0;
      const summary = node('summary', 'agent-evidence-paper-heading');
      summary.append(node('span', 'agent-evidence-paper-title', record.title || record.record_id));
      const content = node('div', 'agent-evidence-reader agent-evidence-passage');
      if (record.excerpt) {
        const quote = node('blockquote', 'agent-evidence-quote');
        quote.append(node('p', 'agent-evidence-line-text', record.excerpt));
        content.append(quote);
      }
      if (onOpenRecordCitation) {
        const button = label('button', 'agent-evidence-open-paper',
          record.source_type === 'protocol' ? 'evidence.openProtocol' : 'evidence.openNotebook');
        button.type = 'button';
        button.addEventListener('click', () => onOpenRecordCitation(record));
        content.append(button);
      }
      detail.append(summary, content);
      list.append(detail);
      index += 1;
    }
    card.append(list);
    container.replaceChildren(card);
  }

  return { render };
}
