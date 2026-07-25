function normalizeDisabledNames(value = []) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeCatalog(result = {}) {
  const source = result && typeof result === 'object' ? result : {};
  return {
    ok: source.ok === true,
    error: String(source.error || '').trim(),
    skills: (Array.isArray(source.skills) ? source.skills : []).map((skill) => ({
      name: String(skill?.name || '').trim(),
      description: String(skill?.description || '').trim(),
      commandName: String(skill?.command_name || skill?.commandName || '').trim(),
      path: String(skill?.path || '').trim(),
      homepage: String(skill?.homepage || '').trim(),
      eligible: skill?.eligible !== false,
      enabled: skill?.enabled === true,
      settingsEnabled: skill?.settings_enabled !== false,
      disabledReason: String(skill?.disabled_reason || '').trim(),
      userInvocable: skill?.user_invocable !== false,
      modelVisible: skill?.disable_model_invocation !== true
    })).filter((skill) => skill.name)
  };
}

export function createExternalSkillsController({
  state,
  persist,
  api,
  enabledInput,
  listElement,
  escapeHtml
}) {
  let loading = false;
  let catalog = { ok: false, error: '', skills: [] };

  function getAgentSettings() {
    const current = state.settings?.agent && typeof state.settings.agent === 'object'
      ? state.settings.agent
      : {};
    state.settings.agent = {
      ...current,
      externalSkillsEnabled: current.externalSkillsEnabled !== false,
      disabledExternalSkillNames: normalizeDisabledNames(current.disabledExternalSkillNames)
    };
    return state.settings.agent;
  }

  function getDisabledSet() {
    return new Set(
      normalizeDisabledNames(getAgentSettings().disabledExternalSkillNames)
        .map((item) => item.toLowerCase())
    );
  }

  function buildPayload() {
    const settings = getAgentSettings();
    const agent = {
      externalSkillsEnabled: settings.externalSkillsEnabled !== false,
      disabledExternalSkillNames: normalizeDisabledNames(settings.disabledExternalSkillNames)
    };
    return {
      agent,
      stateSnapshot: { settings: { agent: { ...agent } } }
    };
  }

  function setSkillEnabled(skillName = '', enabled = true) {
    const cleanName = String(skillName || '').trim();
    if (!cleanName) {
      return;
    }
    const settings = getAgentSettings();
    const nextDisabledByKey = new Map(
      normalizeDisabledNames(settings.disabledExternalSkillNames)
        .map((item) => [item.toLowerCase(), item])
    );
    if (enabled) {
      nextDisabledByKey.delete(cleanName.toLowerCase());
    } else {
      nextDisabledByKey.set(cleanName.toLowerCase(), cleanName);
    }
    state.settings.agent = {
      ...settings,
      disabledExternalSkillNames: Array.from(nextDisabledByKey.values())
        .sort((left, right) => left.localeCompare(right))
    };
    persist();
    render();
  }

  function render() {
    if (!listElement) {
      return;
    }
    const settings = getAgentSettings();
    const globallyEnabled = settings.externalSkillsEnabled !== false;
    const disabledSet = getDisabledSet();
    const skills = catalog.skills || [];

    if (!skills.length) {
      listElement.innerHTML = '<p class="small-note">No external skills discovered.</p>';
      return;
    }

    listElement.innerHTML = skills.map((skill) => {
      const individuallyEnabled = !disabledSet.has(skill.name.toLowerCase());
      const statusText = !globallyEnabled
        ? 'Paused by global switch.'
        : !individuallyEnabled
          ? 'Hidden from agent prompts.'
          : skill.eligible
            ? 'Available to agent.'
            : (skill.disabledReason || 'Not eligible in this environment.');
      const toggleText = individuallyEnabled ? (globallyEnabled ? 'On' : 'Allowed') : 'Off';
      const commandText = skill.commandName ? `/${escapeHtml(skill.commandName)}` : 'no command';
      const modelText = skill.modelVisible ? 'model visible' : 'command only';
      const pathText = skill.path
        ? `<p class="small-note settings-skill-path">${escapeHtml(skill.path)}</p>`
        : '';
      return `
        <div class="settings-skill-row">
          <div class="settings-skill-main">
            <div class="settings-skill-title">
              <span>${escapeHtml(skill.name)}</span>
              <span class="settings-skill-command">${commandText}</span>
            </div>
            <p class="small-note settings-skill-description">${escapeHtml(skill.description || 'No description provided.')}</p>
            <p class="small-note">${escapeHtml(statusText)} ${escapeHtml(modelText)}.</p>
            ${pathText}
          </div>
          <label class="settings-skill-toggle">
            <input type="checkbox" data-external-skill-toggle data-skill-name="${escapeHtml(skill.name)}" ${individuallyEnabled ? 'checked' : ''} />
            <span>${escapeHtml(toggleText)}</span>
          </label>
        </div>
      `;
    }).join('');

    listElement.querySelectorAll('[data-external-skill-toggle]').forEach((input) => {
      input.addEventListener('change', () => {
        setSkillEnabled(input.dataset.skillName, input.checked === true);
      });
    });
  }

  async function refresh() {
    if (!api?.listAgentSkills) {
      catalog = { ok: false, error: 'Agent skill listing is unavailable.', skills: [] };
      render();
      return;
    }
    loading = true;
    render();
    try {
      catalog = normalizeCatalog(await api.listAgentSkills(buildPayload()));
    } catch {
      catalog = { ok: false, error: 'Failed to load external skills.', skills: [] };
    } finally {
      loading = false;
      render();
    }
  }

  function onGlobalEnabledChanged() {
    state.settings.agent = {
      ...getAgentSettings(),
      externalSkillsEnabled: enabledInput?.checked === true
    };
    persist();
    render();
  }

  return {
    hasDiscoveredSkills: () => catalog.skills.length > 0,
    isLoading: () => loading,
    onGlobalEnabledChanged,
    refresh,
    render
  };
}
