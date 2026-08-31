import { requestLlmText } from './direct-llm.js';

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
