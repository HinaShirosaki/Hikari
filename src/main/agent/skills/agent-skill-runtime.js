'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cloneJson, ensureObject } = require('../../lib/normalize.js');
const { collectSkillDirectories, commandExists, existingDirectory } = require('./skill-runtime/command-lookup.js');
const { defaultAsArray, defaultCleanText, parseBoolean, sanitizeCommandName, splitCommandMessage, splitFrontmatter } = require('./skill-runtime/frontmatter.js');

function createAgentSkillRuntime(deps = {}) {
  const asArray = typeof deps.asArray === 'function' ? deps.asArray : defaultAsArray;
  const cleanText = typeof deps.cleanText === 'function' ? deps.cleanText : defaultCleanText;
  const extraSkillDirs = asArray(deps.extraSkillDirs);
  const homeDir = cleanText(deps.homeDir || os.homedir(), 1200) || os.homedir();

  function resolveWorkspaceDir(workspaceDir = '') {
    return existingDirectory(workspaceDir)
      || existingDirectory(process.cwd())
      || existingDirectory(path.dirname(process.execPath))
      || process.cwd();
  }

  function resolveSkillRoots(workspaceDir = '') {
    const workspace = resolveWorkspaceDir(workspaceDir);
    return [
      ...extraSkillDirs.map((item) => cleanText(item, 1200)).filter(Boolean),
      path.join(homeDir, '.hikari', 'skills'),
      path.join(homeDir, '.agents', 'skills'),
      path.join(workspace, '.agents', 'skills'),
      path.join(workspace, 'skills')
    ];
  }

  function normalizeDisabledSkillNames(value) {
    return new Set(
      asArray(value)
        .map((item) => cleanText(item, 160).toLowerCase())
        .filter(Boolean)
    );
  }

  function resolveExternalSkillControls(input = {}) {
    const source = ensureObject(input);
    const snapshot = ensureObject(source.snapshot || source.stateSnapshot || source.state_snapshot);
    const snapshotSettings = ensureObject(snapshot.settings);
    const explicitSettings = ensureObject(source.settings);
    const agentSettings = ensureObject(
      source.agent
      || source.agentSettings
      || source.agent_settings
      || explicitSettings.agent
      || snapshotSettings.agent
    );
    const enabledCandidates = [
      source.externalSkillsEnabled,
      source.external_skills_enabled,
      agentSettings.externalSkillsEnabled,
      agentSettings.external_skills_enabled
    ];
    const explicitEnabled = enabledCandidates.find((item) => typeof item === 'boolean');
    const disabledSkillNames = normalizeDisabledSkillNames([
      ...asArray(source.disabledExternalSkillNames || source.disabled_external_skill_names),
      ...asArray(agentSettings.disabledExternalSkillNames || agentSettings.disabled_external_skill_names),
      ...asArray(agentSettings.disabledSkills || agentSettings.disabled_skills)
    ]);
    return {
      externalSkillsEnabled: explicitEnabled === undefined ? true : explicitEnabled !== false,
      disabledSkillNames
    };
  }

  function normalizeSkill(rawSkill = {}) {
    const source = ensureObject(rawSkill);
    const metadata = ensureObject(source.metadata);
    const openclawMetadata = ensureObject(metadata.openclaw);
    const requires = ensureObject(openclawMetadata.requires);
    const name = cleanText(source.name, 160);
    if (!name) {
      return null;
    }
    const description = cleanText(source.description, 600);
    const commandName = sanitizeCommandName(
      source.command_name
      || source.commandName
      || source.name
    );
    return {
      name,
      description,
      body: cleanText(source.body, 24000),
      path: cleanText(source.path, 1600),
      directory: cleanText(source.directory, 1600),
      homepage: cleanText(source.homepage || openclawMetadata.homepage, 1200),
      metadata: cloneJson(metadata, {}),
      user_invocable: parseBoolean(source.user_invocable !== undefined ? source.user_invocable : source['user-invocable'], true),
      disable_model_invocation: parseBoolean(
        source.disable_model_invocation !== undefined
          ? source.disable_model_invocation
          : source['disable-model-invocation'],
        false
      ),
      command_dispatch: cleanText(source.command_dispatch !== undefined ? source.command_dispatch : source['command-dispatch'], 80),
      command_tool: cleanText(source.command_tool !== undefined ? source.command_tool : source['command-tool'], 120),
      command_arg_mode: cleanText(
        source.command_arg_mode !== undefined ? source.command_arg_mode : source['command-arg-mode'],
        40
      ) || 'raw',
      command_name: commandName,
      requires: {
        bins: asArray(requires.bins).map((item) => cleanText(item, 120)).filter(Boolean),
        anyBins: asArray(requires.anyBins).map((item) => cleanText(item, 120)).filter(Boolean),
        env: asArray(requires.env).map((item) => cleanText(item, 120)).filter(Boolean),
        config: asArray(requires.config).map((item) => cleanText(item, 220)).filter(Boolean)
      },
      os: asArray(openclawMetadata.os).map((item) => cleanText(item, 40)).filter(Boolean),
      always: openclawMetadata.always === true
    };
  }

  function loadSkillFromDirectory(skillDirectory = '') {
    const directory = existingDirectory(skillDirectory);
    if (!directory) {
      return null;
    }
    const skillFilePath = path.join(directory, 'SKILL.md');
    if (!fs.existsSync(skillFilePath)) {
      return null;
    }
    const rawSource = fs.readFileSync(skillFilePath, 'utf8');
    const { frontmatter, body } = splitFrontmatter(rawSource);
    return normalizeSkill({
      ...frontmatter,
      body,
      path: skillFilePath,
      directory
    });
  }

  function isSkillEligible(skill) {
    const source = normalizeSkill(skill);
    if (!source) {
      return false;
    }
    if (source.always === true) {
      return true;
    }
    if (source.os.length && !source.os.includes(process.platform)) {
      return false;
    }
    if (source.requires.bins.length && source.requires.bins.some((bin) => !commandExists(bin))) {
      return false;
    }
    if (source.requires.anyBins.length && !source.requires.anyBins.some((bin) => commandExists(bin))) {
      return false;
    }
    if (source.requires.env.length && source.requires.env.some((key) => !cleanText(process.env[key], 1))) {
      return false;
    }
    return true;
  }

  function applyExternalSkillControls(skill, controls = {}) {
    const source = normalizeSkill(skill);
    if (!source) {
      return null;
    }
    const skillNameKey = source.name.toLowerCase();
    const explicitlyDisabled = controls.disabledSkillNames?.has?.(skillNameKey) === true;
    const settingsEnabled = controls.externalSkillsEnabled !== false && !explicitlyDisabled;
    const eligible = isSkillEligible(source);
    const disabledReason = controls.externalSkillsEnabled === false
      ? 'External skills are switched off in Settings.'
      : explicitlyDisabled
        ? 'Disabled in Settings.'
        : eligible
          ? ''
          : 'Missing required binary, environment, or OS support.';
    return {
      ...source,
      external_skill: true,
      settings_enabled: settingsEnabled,
      eligible,
      enabled: settingsEnabled && eligible,
      disabled_reason: disabledReason
    };
  }

  function listSkills(input = {}) {
    const workspaceDir = resolveWorkspaceDir(input.workspaceDir || input.workspace_dir);
    const includeIneligible = input.includeIneligible === true;
    const includeDisabled = input.includeDisabled === true || input.include_disabled === true;
    const externalSkillControls = resolveExternalSkillControls(input);
    const byName = new Map();
    resolveSkillRoots(workspaceDir).forEach((rootPath) => {
      collectSkillDirectories(rootPath).forEach((skillDirectory) => {
        const loaded = loadSkillFromDirectory(skillDirectory);
        if (!loaded) {
          return;
        }
        const key = loaded.name.toLowerCase();
        byName.set(key, loaded);
      });
    });

    return Array.from(byName.values())
      .map((skill) => applyExternalSkillControls(skill, externalSkillControls))
      .filter(Boolean)
      .filter((skill) => includeDisabled === true || skill.settings_enabled === true)
      .filter((skill) => includeIneligible === true || skill.eligible === true)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  function getSkill(nameOrCommand = '', input = {}) {
    const lookup = cleanText(nameOrCommand, 160).toLowerCase();
    if (!lookup) {
      return null;
    }
    return listSkills(input).find((skill) => (
      skill.name.toLowerCase() === lookup
      || skill.command_name === sanitizeCommandName(lookup)
    )) || null;
  }

  function formatSkillCatalogForPrompt(skills = []) {
    const visibleSkills = asArray(skills).filter((skill) => (
      skill
      && skill.disable_model_invocation !== true
    ));
    if (!visibleSkills.length) {
      return '';
    }
    return [
      'Available skills:',
      ...visibleSkills.map((skill) => [
        `- ${cleanText(skill.name, 160)}: ${cleanText(skill.description, 600) || 'No description provided.'}`,
        cleanText(skill.path, 1600) ? `  Path: ${cleanText(skill.path, 1600)}` : ''
      ].filter(Boolean).join('\n'))
    ].join('\n');
  }

  function formatActiveSkillsForPrompt(skills = []) {
    const visibleSkills = asArray(skills).filter((skill) => (
      skill
      && skill.disable_model_invocation !== true
      && cleanText(skill.body, 1)
    ));
    if (!visibleSkills.length) {
      return '';
    }
    return [
      'Active skill instructions:',
      ...visibleSkills.map((skill) => [
        `Skill: ${cleanText(skill.name, 160)}`,
        cleanText(skill.path, 1600) ? `Path: ${cleanText(skill.path, 1600)}` : '',
        'Instructions:',
        cleanText(skill.body, 12000)
      ].filter(Boolean).join('\n'))
    ].join('\n\n');
  }

  function buildSkillsPromptPayload(input = {}) {
    const eligibleSkills = listSkills(input);
    const activeSkillNames = asArray(input.activeSkillNames || input.active_skill_names)
      .map((item) => cleanText(item, 160))
      .filter(Boolean);
    const activeSkills = activeSkillNames
      .map((name) => getSkill(name, input))
      .filter(Boolean);
    return {
      eligible_skills: eligibleSkills,
      active_skills: activeSkills,
      skills_catalog_prompt: formatSkillCatalogForPrompt(eligibleSkills),
      active_skills_prompt: formatActiveSkillsForPrompt(activeSkills)
    };
  }

  function parseSkillInvocation(message = '', input = {}) {
    const parsed = splitCommandMessage(message);
    const skills = listSkills(input).filter((skill) => skill.user_invocable !== false);
    if (!parsed) {
      return {
        type: 'none',
        command_name: '',
        raw_args: '',
        active_skill_names: [],
        cleaned_message: cleanText(message, 4000)
      };
    }

    if (parsed.command === 'skills') {
      return {
        type: 'list_skills',
        command_name: 'skills',
        raw_args: parsed.args,
        active_skill_names: [],
        cleaned_message: ''
      };
    }

    if (parsed.command === 'skill') {
      const [skillToken, ...restParts] = String(parsed.args || '').split(/\s+/).filter(Boolean);
      if (!skillToken || skillToken.toLowerCase() === 'list') {
        return {
          type: 'list_skills',
          command_name: 'skill',
          raw_args: '',
          active_skill_names: [],
          cleaned_message: ''
        };
      }
      const skill = getSkill(skillToken, input);
      if (!skill || skill.user_invocable === false) {
        return {
          type: 'unknown_skill',
          command_name: 'skill',
          raw_args: parsed.args,
          active_skill_names: [],
          cleaned_message: ''
        };
      }
      const remaining = restParts.join(' ').trim();
      return skill.command_dispatch === 'tool' && skill.command_tool
        ? {
          type: 'direct_tool',
          skill,
          tool_name: skill.command_tool,
          command_name: parsed.command,
          raw_args: remaining,
          active_skill_names: [skill.name],
          cleaned_message: remaining
        }
        : {
          type: 'skill_prompt',
          skill,
          command_name: parsed.command,
          raw_args: remaining,
          active_skill_names: [skill.name],
          cleaned_message: remaining
        };
    }

    const directSkill = skills.find((skill) => skill.command_name === parsed.command);
    if (!directSkill) {
      return {
        type: 'none',
        command_name: parsed.command,
        raw_args: parsed.args,
        active_skill_names: [],
        cleaned_message: cleanText(message, 4000)
      };
    }

    return directSkill.command_dispatch === 'tool' && directSkill.command_tool
      ? {
        type: 'direct_tool',
        skill: directSkill,
        tool_name: directSkill.command_tool,
        command_name: directSkill.command_name,
        raw_args: parsed.args,
        active_skill_names: [directSkill.name],
        cleaned_message: parsed.args
      }
      : {
        type: 'skill_prompt',
        skill: directSkill,
        command_name: directSkill.command_name,
        raw_args: parsed.args,
        active_skill_names: [directSkill.name],
        cleaned_message: parsed.args
      };
  }

  return {
    resolveWorkspaceDir,
    resolveSkillRoots,
    listSkills,
    getSkill,
    isSkillEligible,
    formatSkillCatalogForPrompt,
    formatActiveSkillsForPrompt,
    buildSkillsPromptPayload,
    parseSkillInvocation
  };
}

module.exports = {
  createAgentSkillRuntime,
  sanitizeCommandName,
  splitFrontmatter
};
