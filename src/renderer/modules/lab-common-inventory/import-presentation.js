import { escapeHtml } from '../../lib/html.js';
import { fieldLabel } from './import-schema.js';
import { chemicalsEnglish } from './locales/en.js';
import { chemicalMessage } from './localization.js';

export function buildChemicalImportResultMarkup(result, inference, fileName) {
  const decisions = inference.decisions.slice(0, 8);
  const mappings = decisions.map(decision => {
    const key = `field.${decision.field}`;
    const label = Object.hasOwn(chemicalsEnglish, key) ? chemicalMessage(key) : escapeHtml(fieldLabel(decision.field));
    return `${escapeHtml(decision.header)} -> ${label}${decision.source === 'llm' ? ' (LLM)' : ''}`;
  }).join(', ');
  const remaining = Math.max(0, inference.decisions.length - decisions.length);
  const summary = mappings + (remaining ? chemicalMessage('import.more', { count: remaining }) : '');
  const mapped = summary ? `${chemicalMessage('import.mapped')} ${summary}.` : '';
  const warning = inference.llmError ? chemicalMessage('import.llmWarning', { error: inference.llmError }) : '';
  return chemicalMessage('import.result', { created: result.created, updated: result.updated, skipped: result.skipped, file: fileName })
    + ` ${mapped}${warning}`;
}
