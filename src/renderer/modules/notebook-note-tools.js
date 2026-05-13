import { requestLlmText } from './direct-llm.js';

let activeToastTimer = 0;
let activeToastFadeTimer = 0;

function ensureToastElement() {
  let toast = document.querySelector('[data-enana-transient-toast]');
  if (toast) {
    return toast;
  }
  toast = document.createElement('div');
  toast.setAttribute('data-enana-transient-toast', 'true');
  toast.hidden = true;
  Object.assign(toast.style, {
    position: 'fixed',
    top: '22px',
    right: '22px',
    zIndex: '1200',
    maxWidth: 'min(360px, calc(100vw - 32px))',
    padding: '12px 16px',
    borderRadius: '12px',
    boxShadow: '0 16px 32px rgba(23, 18, 14, 0.18)',
    color: '#ffffff',
    fontSize: '0.94rem',
    lineHeight: '1.35',
    opacity: '0',
    transform: 'translateY(-6px)',
    transition: 'opacity 180ms ease, transform 180ms ease',
    pointerEvents: 'none'
  });
  document.body.appendChild(toast);
  return toast;
}

export function showTransientNotice(message, { type = 'success', durationMs = 5000 } = {}) {
  const toast = ensureToastElement();
  toast.textContent = String(message || '').trim();
  toast.style.background = type === 'error'
    ? 'rgba(156, 54, 48, 0.96)'
    : 'rgba(51, 111, 75, 0.96)';
  toast.hidden = false;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';

  window.clearTimeout(activeToastTimer);
  window.clearTimeout(activeToastFadeTimer);

  activeToastTimer = window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    activeToastFadeTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 180);
  }, Math.max(1000, Number(durationMs) || 5000));
}

export function buildClarifiedNotebookNote(sourceText, clarifiedText) {
  const source = String(sourceText || '').trim();
  const clarified = String(clarifiedText || '').trim() || source;
  if (!source) {
    return clarified;
  }
  if (!clarified) {
    return source;
  }
  return [
    'Original note:',
    source,
    '',
    'Clarified note:',
    clarified
  ].join('\n');
}

export const clarifyNotebookNote = async ({ llm, text }) => {
  const source = String(text || '').trim();
  if (!source) {
    throw new Error('Add a note before clarifying it.');
  }

  const prompt = [
    'Clarify the following lab notebook note before it is saved.',
    '',
    'Requirements:',
    '- Preserve the original meaning, uncertainty, chronology, numbers, units, names, and sample identifiers.',
    '- Do not invent missing details.',
    '- Improve clarity, grammar, and readability only where needed.',
    '- Return plain text only.',
    '',
    'Note:',
    source
  ].join('\n');

  const clarified = await requestLlmText({
    llm,
    prompt,
    moduleId: 'notebook',
    task: 'note-clarify'
  });

  return String(clarified || '').trim() || source;
};
