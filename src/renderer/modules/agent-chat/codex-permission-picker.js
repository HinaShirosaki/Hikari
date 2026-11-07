import { agentNotice, agentUi, setAgentText } from './localization.js';

const LABELS = new Map([
  ['read-only', 'permission.readOnly'],
  ['default', 'permission.default'],
  ['approve-for-me', 'permission.approveForMe'],
  ['full-access', 'permission.fullAccess']
]);

export function bindCodexPermissionPicker({ document, api }) {
  const button = document?.getElementById('agent-codex-permission-btn');
  const panel = document?.getElementById('agent-codex-permission-picker');
  const current = document?.getElementById('agent-codex-permission-current');
  if (!button || !panel || !current || !api?.getAgentCodexPermission || !api?.setAgentCodexPermission) return;
  const options = [...panel.querySelectorAll('[data-codex-preset]')];
  let busy = false;

  function render(result) {
    const key = LABELS.get(result?.preset);
    if (!result?.ok || !key) throw new Error('Could not load Codex permissions.');
    setAgentText(current, key);
    for (const option of options) option.setAttribute('aria-pressed', String(option.dataset.codexPreset === result.preset));
  }

  panel.addEventListener('click', async event => {
    const option = event.target.closest('[data-codex-preset]');
    if (!option || busy) return;
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      render(await api.setAgentCodexPermission(option.dataset.codexPreset));
      panel.hidePopover();
      button.focus();
    } catch {
      agentNotice(agentUi('permission.updateFailed'), { type: 'error' });
    } finally {
      busy = false;
      panel.removeAttribute('aria-busy');
    }
  });

  void api.getAgentCodexPermission().then(result => {
    render(result);
    button.disabled = false;
  }).catch(() => {});
}
