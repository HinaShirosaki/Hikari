const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  loadEsmStyleModule,
  MockElement
} = require('./support/runtime.js');

const repoRoot = path.resolve(__dirname, '..');
const {
  HIKARI_MCP_TOOL_NAMES
} = require('../src/main/agent/mcp-contract/instructions.js');
const {
  getDirectMcpToolDefinitions
} = require('../src/main/agent/mcp-contract/direct-tools/index.js');
const {
  createAgentMcpGateway
} = require('../src/main/agent/mcp-contract/gateway.js');
const {
  getRequestContextFromEnv
} = require('../src/main/agent/mcp-contract/stdio-server.js');
const {
  buildHikariCodexMcpConfigBlock
} = require('../src/main/agent/codex-agent/runtime-files.js');
const {
  OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS,
  getDisabledOfficialMcpSkillToolNames,
  releaseOfficialMcpSkills,
  releaseOfficialMcpSkillsForWorkspace
} = require('../src/main/agent/codex-agent/official-mcp-skills.js');
const {
  createAgentRuntimeSupport
} = require('../src/main/agent/runtime/agent-runtime-support.js');
const {
  createAgentSkillRuntime
} = require('../src/main/agent/skills/agent-skill-runtime.js');
const {
  ensureCodexCliProjectSkillFolder
} = require('../src/main/lib/codex-cli-provider/guidance.js');
const {
  syncBundleFromSnapshot
} = require('../src/main/storage/storage-sidecars.js');

const controllerModule = loadEsmStyleModule(path.join(
  repoRoot,
  'src/renderer/modules/settings/mcp-tools-controller.js'
));
const externalSkillsControllerModule = loadEsmStyleModule(path.join(
  repoRoot,
  'src/renderer/modules/settings/external-skills-controller.js'
));
const stateModule = loadEsmStyleModule(path.join(
  repoRoot,
  'src/renderer/modules/app-state/state-normalizer.js'
), { URL });
const agentStateSnapshotModule = loadEsmStyleModule(path.join(
  repoRoot,
  'src/renderer/modules/agent-chat/state-snapshot.js'
));

function contextWithDisabled(...names) {
  return {
    snapshot: {
      settings: {
        agent: { disabledMcpToolNames: names }
      }
    }
  };
}

async function run() {
  assert.deepEqual(
    Array.from(controllerModule.HIKARI_MCP_TOOL_CATALOG, (tool) => tool.name),
    Array.from(HIKARI_MCP_TOOL_NAMES),
    'the Settings catalog stays aligned with the complete Hikari MCP surface'
  );
  for (const [skillId, requiredToolNames] of Object.entries(OFFICIAL_MCP_SKILL_TOOL_REQUIREMENTS)) {
    for (const toolName of requiredToolNames) {
      const tool = controllerModule.HIKARI_MCP_TOOL_CATALOG.find((item) => item.name === toolName);
      assert.equal(
        tool?.relatedSkillName,
        `hikari-${skillId}`,
        `${toolName} identifies its dependent official skill in Settings`
      );
    }
  }
  assert.deepEqual(
    getDisabledOfficialMcpSkillToolNames('assay-plotly', contextWithDisabled('plotly_graph')),
    ['plotly_graph'],
    'switching off either half of a multi-tool official skill disables that skill'
  );

  const normalizedDefault = stateModule.normalizeState({ settings: {} });
  assert.deepEqual(Array.from(normalizedDefault.settings.agent.disabledMcpToolNames), []);
  const normalizedLegacy = stateModule.normalizeState({
    settings: {
      agent: {
        disabled_mcp_tool_names: ['paper_download', 'paper_download', 'sequence_get']
      }
    }
  });
  assert.deepEqual(
    Array.from(normalizedLegacy.settings.agent.disabledMcpToolNames),
    ['paper_download', 'sequence_get']
  );
  const normalizedAgentSnapshot = createAgentRuntimeSupport({}).normalizeAgentSnapshot({
    settings: {
      agent: { disabledMcpToolNames: ['paper_download', 'sequence_get'] }
    }
  });
  assert.deepEqual(
    normalizedAgentSnapshot.settings.agent.disabledMcpToolNames,
    ['paper_download', 'sequence_get'],
    'the bounded snapshot sent to Codex retains MCP availability settings'
  );
  const rendererAgentSnapshot = agentStateSnapshotModule.buildStateSnapshot({
    settings: {
      agent: { disabledMcpToolNames: ['protocol_generation'] }
    },
    projects: [],
    protocols: [],
    workflows: [],
    notebookEntries: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] }
  });
  assert.deepEqual(
    Array.from(rendererAgentSnapshot.settings.agent.disabledMcpToolNames),
    ['protocol_generation'],
    'the renderer includes MCP availability in each agent request snapshot'
  );

  const listElement = new MockElement('setting-mcp-tools-list');
  const state = { settings: { agent: { disabledMcpToolNames: [] } } };
  let persistCalls = 0;
  const controller = controllerModule.createMcpToolsController({
    state,
    persist: () => { persistCalls += 1; },
    listElement,
    escapeHtml: (value) => String(value || '')
  });
  controller.render();
  assert.match(listElement.innerHTML, /data-tool-name="inventory_lookup"[^>]*aria-label="Inventory lookup enabled"[^>]*checked/);
  assert.match(listElement.innerHTML, />On</);
  const inventoryToggle = listElement.querySelectorAll('[data-mcp-tool-toggle]')[0];
  inventoryToggle.dataset.toolName = 'inventory_lookup';
  inventoryToggle.checked = false;
  inventoryToggle.change();
  assert.deepEqual(Array.from(state.settings.agent.disabledMcpToolNames), ['inventory_lookup']);
  assert.equal(persistCalls, 1);
  assert.doesNotMatch(
    listElement.innerHTML.match(/<input[^>]*data-tool-name="inventory_lookup"[^>]*>/)?.[0] || '',
    /checked/
  );
  assert.match(listElement.innerHTML, />Off</);

  const externalSkillsList = new MockElement('setting-external-skills-list');
  let externalSkillsPayload = null;
  const externalSkillsController = externalSkillsControllerModule.createExternalSkillsController({
    state,
    persist: () => {},
    api: {
      listAgentSkills: async (payload) => {
        externalSkillsPayload = payload;
        return {
          ok: true,
          skills: [{
            name: 'hikari-protocol-generation',
            description: 'Protocol skill',
            eligible: true,
            enabled: false,
            settings_enabled: false,
            disabled_reason: 'Required Hikari MCP tool is switched off: protocol_generation.'
          }]
        };
      }
    },
    enabledInput: { checked: true },
    listElement: externalSkillsList,
    escapeHtml: (value) => String(value || '')
  });
  state.settings.agent.disabledMcpToolNames = ['protocol_generation'];
  await externalSkillsController.refresh();
  assert.deepEqual(
    Array.from(externalSkillsPayload.agent.disabledMcpToolNames),
    ['protocol_generation'],
    'the skill catalog request carries MCP availability settings'
  );
  assert.match(externalSkillsList.innerHTML, /Required Hikari MCP tool is switched off: protocol_generation/);
  assert.match(externalSkillsList.innerHTML, /data-skill-name="hikari-protocol-generation"[^>]*disabled/);
  assert.match(externalSkillsList.innerHTML, />Blocked</);

  const disabledContext = contextWithDisabled('inventory_lookup', 'paper_download');
  const visibleNames = getDirectMcpToolDefinitions(disabledContext).map((tool) => tool.name);
  assert.equal(visibleNames.includes('inventory_lookup'), false);
  assert.equal(visibleNames.includes('paper_download'), false);
  assert.equal(visibleNames.includes('chemical_lookup'), true);

  let runToolCalls = 0;
  const gateway = createAgentMcpGateway({
    runTool: async () => {
      runToolCalls += 1;
      return { ok: true };
    }
  });
  const rejected = await gateway.callGatewayTool('inventory_lookup', {}, disabledContext);
  assert.equal(rejected.status, 'disabled');
  assert.match(rejected.error, /switched off in Settings/);
  assert.equal(runToolCalls, 0, 'disabled tools never reach an app executor');

  const configBlock = buildHikariCodexMcpConfigBlock({
    envOverrides: {
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(disabledContext)
    }
  });
  const enabledToolsLine = configBlock.split('\n').find((line) => line.startsWith('enabled_tools = '));
  assert.ok(enabledToolsLine);
  assert.equal(enabledToolsLine.includes('inventory_lookup'), false);
  assert.equal(enabledToolsLine.includes('paper_download'), false);
  assert.equal(enabledToolsLine.includes('chemical_lookup'), true);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-mcp-tool-settings-'));
  try {
    const dataFilePath = path.join(tempDir, 'state.json');
    fs.writeFileSync(dataFilePath, JSON.stringify({
      settings: {
        agent: { disabledMcpToolNames: ['chemical_lookup'] }
      }
    }), 'utf8');
    const liveContext = getRequestContextFromEnv({
      HIKARI_AGENT_DATA_FILE: dataFilePath,
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify({
        snapshot: { settings: { storagePath: tempDir } }
      })
    });
    assert.equal(
      getDirectMcpToolDefinitions(liveContext).some((tool) => tool.name === 'chemical_lookup'),
      false,
      'an external Codex MCP connection reads the current persisted setting'
    );

    const explicitContext = getRequestContextFromEnv({
      HIKARI_AGENT_DATA_FILE: dataFilePath,
      HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(contextWithDisabled('inventory_lookup'))
    });
    const explicitNames = getDirectMcpToolDefinitions(explicitContext).map((tool) => tool.name);
    assert.equal(explicitNames.includes('inventory_lookup'), false);
    assert.equal(explicitNames.includes('chemical_lookup'), true, 'per-turn settings override older disk state');

    const skillRoot = path.join(tempDir, 'workspace', '.agents', 'skills');
    await releaseOfficialMcpSkills(skillRoot);
    const protocolSkillPath = path.join(skillRoot, 'hikari-protocol-generation', 'SKILL.md');
    const notebookSkillPath = path.join(skillRoot, 'hikari-notebook-draft', 'SKILL.md');
    assert.equal(fs.existsSync(protocolSkillPath), true);

    const disabledProtocolContext = contextWithDisabled('protocol_generation');
    const skillRuntime = createAgentSkillRuntime({ homeDir: path.join(tempDir, 'home') });
    const disabledSkillListing = skillRuntime.listSkills({
      workspaceDir: path.join(tempDir, 'workspace'),
      includeDisabled: true,
      ...disabledProtocolContext
    });
    const disabledProtocolSkill = disabledSkillListing.find((skill) => skill.name === 'hikari-protocol-generation');
    assert.equal(disabledProtocolSkill?.settings_enabled, false);
    assert.deepEqual(disabledProtocolSkill?.disabled_mcp_tool_names, ['protocol_generation']);
    assert.match(disabledProtocolSkill?.disabled_reason || '', /protocol_generation/);
    assert.equal(
      skillRuntime.buildSkillsPromptPayload({
        workspaceDir: path.join(tempDir, 'workspace'),
        activeSkillNames: ['hikari-protocol-generation'],
        ...disabledProtocolContext
      }).skills_catalog_prompt.includes('hikari-protocol-generation'),
      false,
      'dependent official skills are omitted from assembled skill prompts'
    );
    assert.equal(
      skillRuntime.parseSkillInvocation('/skill hikari-protocol-generation', {
        workspaceDir: path.join(tempDir, 'workspace'),
        ...disabledProtocolContext
      }).type,
      'unknown_skill',
      'dependent official skills cannot be activated explicitly'
    );

    await releaseOfficialMcpSkills(skillRoot, disabledProtocolContext);
    assert.equal(fs.existsSync(protocolSkillPath), false, 'Codex filesystem discovery cannot see a disabled official skill');
    assert.equal(fs.existsSync(notebookSkillPath), true, 'unrelated official skills stay released');
    await ensureCodexCliProjectSkillFolder(path.join(tempDir, 'workspace'), {
      envOverrides: {
        HIKARI_AGENT_MCP_REQUEST_CONTEXT: JSON.stringify(disabledProtocolContext)
      }
    });
    assert.equal(fs.existsSync(protocolSkillPath), false, 'Codex preflight keeps disabled skills out of the working directory');
    await ensureCodexCliProjectSkillFolder(path.join(tempDir, 'workspace'));
    assert.equal(fs.existsSync(protocolSkillPath), true, 're-enabling the tool restores its official skill');

    const storageRoot = path.join(tempDir, 'storage');
    await syncBundleFromSnapshot({
      dataFilePath: path.join(storageRoot, 'hikari-data.json'),
      snapshot: {
        settings: {
          storagePath: storageRoot,
          agent: { disabledMcpToolNames: ['protocol_generation'] }
        },
        projects: [{ id: 'project-1', name: 'Atlas' }]
      },
      releaseOfficialMcpSkillsForWorkspace
    });
    assert.equal(
      fs.existsSync(path.join(storageRoot, '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md')),
      false,
      'persisting Settings does not republish a disabled root official skill'
    );
    assert.equal(
      fs.existsSync(path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-protocol-generation', 'SKILL.md')),
      false,
      'persisting Settings does not republish a disabled project official skill'
    );
    assert.equal(
      fs.existsSync(path.join(storageRoot, 'Project', 'Atlas', '.agents', 'skills', 'hikari-notebook-draft', 'SKILL.md')),
      true,
      'storage persistence continues publishing unrelated official skills'
    );

    fs.writeFileSync(protocolSkillPath, 'user-owned replacement', 'utf8');
    await releaseOfficialMcpSkills(skillRoot, disabledProtocolContext);
    assert.equal(
      fs.readFileSync(protocolSkillPath, 'utf8'),
      'user-owned replacement',
      'tool settings never remove a user-owned skill that occupies an official directory'
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  console.log('Hikari MCP tool settings self-check passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
