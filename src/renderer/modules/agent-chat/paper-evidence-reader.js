import { paperEvidenceText } from '../../../shared/paper-evidence.mjs';
import { hydrateAgentChatIcons } from './icons.js';
import { setAgentAttribute, setAgentText } from './localization.js';

let nextReaderId = 0;

export function createPaperEvidenceReader({ doc, entries, choice, onChoiceChange, canOpenSource, onOpenSource }) {
  const node = (tag, className, text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const label = (tag, className, key, params) => {
    const element = node(tag, className);
    setAgentText(element, key, params);
    return element;
  };
  const icon = name => {
    const element = node('span', '');
    element.dataset.agentChatIcon = name;
    return element;
  };
  const groups = new Map();
  const occurrences = new Map();
  for (const block of entries) {
    const section = block.section_label.toLowerCase();
    if (!groups.has(section)) groups.set(section, { label: block.section_label, passages: [] });
    const location = block.line_ranges.length ? block.line_ranges : block.source_lines.map(line => line.line_number);
    const source = JSON.stringify([section, block.source_path || block.source_absolute_path,
      location.length ? location : block.block_id || block.excerpt]);
    const occurrence = occurrences.get(source) || 0;
    occurrences.set(source, occurrence + 1);
    groups.get(section).passages.push({ block, key: JSON.stringify([source, occurrence]) });
  }
  let section = groups.has(choice?.section) ? choice.section : groups.keys().next().value;
  const selections = new Map(choice?.selections || []);
  const id = `agent-evidence-reader-${++nextReaderId}`;
  const reader = node('div', 'agent-evidence-reader');
  const toolbar = node('div', 'agent-evidence-reader-toolbar');
  const tabs = node('div', 'agent-evidence-tabs');
  tabs.setAttribute('role', 'tablist');
  setAgentAttribute(tabs, 'aria-label', 'evidence.sections');
  const panel = node('section', 'agent-evidence-passage');
  panel.id = `${id}-passage`;
  panel.setAttribute('role', 'tabpanel');
  const tabButtons = new Map();

  const navigation = node('div', 'agent-evidence-navigation');
  const position = node('span', 'agent-evidence-position');
  position.setAttribute('aria-live', 'polite');
  position.setAttribute('aria-atomic', 'true');
  const controls = node('div', 'agent-evidence-page-controls');
  const previous = node('button', 'agent-evidence-page-button is-previous');
  const next = node('button', 'agent-evidence-page-button');
  [previous, next].forEach((button, index) => {
    button.type = 'button';
    setAgentAttribute(button, 'aria-label', index ? 'evidence.next' : 'evidence.previous');
    setAgentAttribute(button, 'title', index ? 'evidence.next' : 'evidence.previous');
    button.append(icon('chevron-right'));
  });
  controls.append(previous, next);
  navigation.append(position, controls);

  function showPassage(navigate = false) {
    const scroller = reader.closest('.agent-paper-evidence');
    const scrollTop = navigate && scroller
      ? Math.max(0, scroller.scrollTop + reader.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top - scroller.clientTop) : null;
    const group = groups.get(section);
    let index = group.passages.findIndex(passage => passage.key === selections.get(section));
    if (index < 0) index = 0;
    const { block, key } = group.passages[index];
    selections.set(section, key);
    for (const [key, button] of tabButtons) {
      button.setAttribute('aria-selected', String(key === section));
      button.tabIndex = key === section ? 0 : -1;
    }
    panel.setAttribute('aria-labelledby', tabButtons.get(section).id);
    setAgentText(position, 'evidence.position', { current: index + 1, total: group.passages.length });
    previous.disabled = index === 0;
    next.disabled = index === group.passages.length - 1;
    const quote = node('blockquote', 'agent-evidence-quote');
    quote.append(node('p', 'agent-evidence-line-text', paperEvidenceText(block)));
    const contents = [quote];
    if (block.relevance_reason) contents.push(
      label('h5', 'agent-evidence-comment-label', 'evidence.why'),
      node('p', 'agent-evidence-comment', block.relevance_reason));
    if (block.related_comments.length) {
      contents.push(label('h5', 'agent-evidence-comment-label', 'evidence.notes'));
      block.related_comments.forEach(comment => contents.push(node('p', 'agent-evidence-comment',
        [comment.author, comment.text].filter(Boolean).join(': '))));
    }
    if (canOpenSource?.(block)) {
      const open = node('button', 'agent-evidence-open-paper');
      open.type = 'button';
      open.append(icon('book-open'), label('span', '', 'evidence.openPaper'));
      open.addEventListener('click', () => onOpenSource(block));
      contents.push(open);
    }
    panel.replaceChildren(...contents);
    hydrateAgentChatIcons(panel);
    if (scrollTop !== null && scroller.scrollTop > scrollTop) scroller.scrollTop = scrollTop;
    onChoiceChange({ section, selections: new Map(selections) });
  }

  for (const [key, group] of groups) {
    const tab = node('button', 'agent-evidence-tab');
    tab.type = 'button';
    tab.id = `${id}-section-${tabButtons.size}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', panel.id);
    const count = node('span', 'agent-evidence-section-count', String(group.passages.length));
    count.setAttribute('aria-hidden', 'true');
    tab.append(group.label ? node('span', 'agent-evidence-tab-label', group.label)
      : label('span', 'agent-evidence-tab-label', 'evidence.excerpt'), count,
    label('span', 'sr-only', 'evidence.passages', { count: group.passages.length }));
    tab.addEventListener('click', () => { section = key; showPassage(true); });
    tab.addEventListener('keydown', event => {
      const keys = [...groups.keys()];
      const index = keys.indexOf(key);
      const target = event.key === 'ArrowRight' ? (index + 1) % keys.length
        : event.key === 'ArrowLeft' ? (index + keys.length - 1) % keys.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? keys.length - 1 : null;
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      section = keys[target];
      showPassage(true);
      tabButtons.get(section).focus();
    });
    tabButtons.set(key, tab);
    tabs.append(tab);
  }
  [previous, next].forEach((button, direction) => button.addEventListener('click', () => {
    const passages = groups.get(section).passages;
    const index = passages.findIndex(passage => passage.key === selections.get(section));
    const target = index + (direction ? 1 : -1);
    if (!passages[target]) return;
    selections.set(section, passages[target].key);
    showPassage(true);
  }));
  toolbar.append(tabs, navigation);
  reader.append(toolbar, panel);
  hydrateAgentChatIcons(toolbar);
  showPassage();
  return reader;
}
