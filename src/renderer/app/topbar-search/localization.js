import { i18n } from '../../lib/i18n/index.js';
import { shellEnglish } from '../../lib/i18n/shell-en.js';
import { setShellAttribute, shellText } from '../../lib/i18n/shell.js';
import { messageSpan } from '../../lib/i18n/markup.js';
import { escapeHtml } from '../../lib/html.js';
import { APP_REGISTRY } from '../../modules/app-registry.generated.js';

// Display-only formatting. Candidate labels, kind IDs, ranking, deduplication,
// query text and item-handler lookup continue to use their canonical values.
export function searchCandidateMarkup(item) {
  const app = item.kind === 'Module' ? APP_REGISTRY.find(app => app.viewId === item.target?.viewId) : null;
  const labelKey = app && item.label === app.label ? `app.${app.id}` : '';
  const subtitleKey = `subtitle.${item.target?.viewId}`;
  const kindKey = `search.kind.${item.kind}`;
  return {
    label: labelKey && Object.hasOwn(shellEnglish, labelKey) ? messageSpan(`shell.${labelKey}`) : escapeHtml(item.label || ''),
    sublabel: app && item.sublabel === shellEnglish[subtitleKey]
      ? messageSpan(`shell.${subtitleKey}`) : escapeHtml(item.sublabel || ''),
    kind: Object.hasOwn(shellEnglish, kindKey) ? messageSpan(`shell.${kindKey}`) : escapeHtml(item.kind || '')
  };
}

export function createSearchFeedback(input, apps = []) {
  let current = null;
  function render() {
    if (!current || !input) return;
    const { key, params, target } = current;
    let targetLabel = target?.label || '';
    const app = target && apps.find(app => app.viewId === target.viewId && app.label === target.label);
    if (app && Object.hasOwn(shellEnglish, `app.${app.id}`)) targetLabel = shellText(`app.${app.id}`);
    else if (target?.viewId === 'sample-registry-view' && target.label === 'Containers') targetLabel = shellText('search.containers');
    else if (target?.subtitle && shellEnglish[`subtitle.${target.viewId}`] === target.label) targetLabel = shellText(`subtitle.${target.viewId}`);
    setShellAttribute(input, 'title', key, { ...params, ...(target ? { target: targetLabel } : {}) });
  }
  // Only the existing tooltip changes on locale updates; search is never rerun.
  i18n.subscribe(render);
  return (key, params = {}, target = null) => { current = { key, params, target }; render(); };
}
