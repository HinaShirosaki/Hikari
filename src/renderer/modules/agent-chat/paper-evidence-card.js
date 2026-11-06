import { mergePaperEvidence, paperEvidenceText } from '../../../shared/paper-evidence.mjs';
import { setAgentText } from './localization.js';

export function createPaperEvidenceCard(container) {
  let signature = '';
  let activeSession = '';
  let previousCollections = [];
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

  function excerpt(block, paperKey, disclosures) {
    const section = node('details', 'agent-evidence-chunk');
    const location = block.line_ranges.length ? block.line_ranges : block.source_lines.map(line => line.line_number);
    const key = JSON.stringify(['excerpt', paperKey, location.length ? location : block.block_id || block.excerpt]);
    section.dataset.evidenceKey = key;
    section.open = disclosures.get(key) ?? true;
    section.append(block.section_label
      ? node('summary', 'agent-evidence-section', block.section_label)
      : label('summary', 'agent-evidence-section', 'evidence.excerpt'));
    const quote = node('blockquote', 'agent-evidence-quote');
    quote.append(node('p', 'agent-evidence-line-text', paperEvidenceText(block)));
    section.append(quote);
    if (block.relevance_reason) {
      section.append(label('h5', 'agent-evidence-comment-label', 'evidence.why'),
        node('p', 'agent-evidence-comment', block.relevance_reason));
    }
    if (block.related_comments.length) {
      section.append(label('h5', 'agent-evidence-comment-label', 'evidence.notes'));
      block.related_comments.forEach(comment => section.append(node('p', 'agent-evidence-comment',
        [comment.author, comment.text].filter(Boolean).join(': '))));
    }
    return section;
  }

  function render(messages, sessionId = '') {
    if (!container || typeof container.replaceChildren !== 'function' || !doc?.createElement) return;
    const collections = [...(messages || [])].reverse()
      .filter(message => message?.role === 'assistant')
      .map(message => message.meta?.paper_evidence)
      .filter(blocks => blocks?.length);
    if (activeSession === sessionId && signature && collections.length === previousCollections.length
      && collections.every((collection, index) => collection === previousCollections[index])) return;
    previousCollections = collections;
    const blocks = mergePaperEvidence(...collections);
    const nextSignature = JSON.stringify([sessionId, blocks]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const sameSession = activeSession === sessionId;
    activeSession = sessionId;
    const disclosures = new Map(sameSession ? [...container.querySelectorAll('details[data-evidence-key]')]
      .map(detail => [detail.dataset.evidenceKey, detail.open]) : []);
    const cardOpen = sameSession ? container.querySelector('.agent-evidence-card')?.open ?? true : true;
    container.hidden = !blocks.length;
    container.closest('.agent-chat-stage')?.classList.toggle('has-paper-evidence', blocks.length > 0);
    if (!blocks.length) { container.replaceChildren(); return; }
    const papers = new Map();
    for (const block of blocks) {
      const key = block.paper_id || block.source_path || block.source_absolute_path || block.paper_title;
      if (!papers.has(key)) papers.set(key, []);
      papers.get(key).push(block);
    }
    const card = node('details', 'agent-evidence-card');
    card.open = cardOpen;
    const heading = node('summary', 'agent-evidence-heading');
    heading.append(label('span', 'agent-evidence-title', 'evidence.title'),
      node('span', 'agent-evidence-total', String(blocks.length)));
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
      paper.append(summary);
      entries.forEach(block => paper.append(excerpt(block, key, disclosures)));
      list.append(paper);
      index += 1;
    }
    card.append(list);
    container.replaceChildren(card);
  }

  return { render };
}
