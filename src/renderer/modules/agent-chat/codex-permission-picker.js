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
    for (const option of options) {
      const selected = option.dataset.codexPreset === result.preset;
      option.setAttribute('aria-checked', String(selected));
      option.autofocus = selected;
    }
  }

  function closePicker() {
    if (!panel.matches(':popover-open')) return;
    panel.hidePopover();
    button.focus();
  }

  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    panel.showPopover({ source: button });
  });

  panel.addEventListener('beforetoggle', () => panel.removeAttribute('data-pointer-input'));
  panel.addEventListener('pointermove', () => panel.toggleAttribute('data-pointer-input', true));

  panel.addEventListener('keydown', event => {
    panel.removeAttribute('data-pointer-input');
    if (event.key === 'Tab') {
      closePicker();
      return;
    }
    const index = options.indexOf(document.activeElement);
    let next;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % options.length;
        break;
      case 'ArrowUp':
        next = index > 0 ? index - 1 : options.length - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = options.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    options[next]?.focus();
  });

  panel.addEventListener('click', async event => {
    const option = event.target.closest('[data-codex-preset]');
    if (!option || busy) return;
    if (option.getAttribute('aria-checked') === 'true') {
      closePicker();
      return;
    }
    busy = true;
    panel.setAttribute('aria-busy', 'true');
    try {
      render(await api.setAgentCodexPermission(option.dataset.codexPreset));
      closePicker();
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
