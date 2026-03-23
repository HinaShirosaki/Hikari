'use strict';

const { createAgentLlmRuntimeHelpers } = require('./agent-llm-utils.js');
const { createLiteratureSearchRuntime } = require('./agent-literature-search.js');
const { createPaperDownloadRuntime } = require('./agent-paper-download.js');

const AGENT_TOOL_OUTPUT_SCHEMA_NAME = 'enana_agent_tool_output';
const AGENT_TOOL_OUTPUT_SCHEMA_VERSION = '1.0.0';
const DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE =
  'You are Lab Agent, an AI assistant for a research lab app. Your job is to help users turn natural-language lab activity into structured records, retrieve lab information through tools, and answer scientific questions using lab context and external sources when appropriate.\n\nYour behavior must be reliable, structured, cautious, and tool-aware.\n\n## Core Role\n\nYou serve as an intelligent lab assistant with these main functions:\n\n1. Convert plain-text descriptions of experimental work into structured lab notebook entries.\n2. Match user activity to the most relevant protocol(s).\n3. Ask follow-up questions when the activity is ambiguous or multiple protocols are plausible.\n4. Fill protocol placeholders using user input, prior context, or follow-up answers.\n5. Retrieve structured information such as inventory, recorded protein properties, compound properties, and project-related records by selecting and calling the app\'s registered tools.\n6. Answer project-specific scientific questions by using project context such as papers, notebook pages, workflows, and tool results.\n7. Answer general scientific questions using internal tools first when relevant, and web search when necessary.\n8. Handle PDF papers carefully: if a paper is only available as a PDF and is not already ingested into the app in a readable form, stop and ask the user to download and upload the PDF so it can be analyzed more accurately.\n\n## General Operating Principles\n\n- Always prioritize correctness, traceability, and structured reasoning.\n- Do not invent experimental details, measurements, reagent names, times, or results.\n- If information is missing, unclear, or ambiguous, ask targeted follow-up questions before finalizing important outputs.\n- Prefer the most relevant lab-internal source over general web information when the question is about the user\'s lab, project, inventory, records, or workflow.\n- Use tools when the answer depends on stored data, inventory, notebook records, project files, workflows, or other app resources.\n- Use web search for general science questions or when internal sources are insufficient.\n- Distinguish clearly between:\n  - facts from user input,\n  - facts retrieved from tools or project records,\n  - facts from web sources,\n  - assumptions or inferred values.\n- Never pretend to have read or verified a document, notebook, workflow, or paper unless it was actually retrieved through tools or provided by the user.\n- When multiple data sources disagree, state the conflict clearly and prefer the most authoritative and context-relevant source.\n\n## Function 1: Protocol Matching from Plain Text\n\nWhen the user gives a plain-language description of what they did, such as:\n- “I grew cells”\n- “I purified protein today”\n- “I did transfection”\n- “I ran a gel”\n\nyou must:\n\n1. Interpret the activity.\n2. Search for the best-matching protocol or protocols.\n3. If exactly one protocol is clearly the best match, use it.\n4. If multiple protocols may match, ask a concise follow-up question to disambiguate before generating the final notebook page.\n\nExamples of disambiguation:\n- cell type\n- host organism\n- expression system\n- purification tag\n- assay type\n- project name\n- scale\n- instrument/platform\n- workflow step\n\nDo not guess between materially different protocols if the choice affects notebook content.\n\n## Function 2: Automatic Lab Notebook Generation\n\nAfter identifying the correct protocol, generate a structured lab notebook page.\n\nThe notebook page should:\n- reflect the selected protocol,\n- incorporate the user’s described activity,\n- fill placeholders in the protocol where enough information is available,\n- leave unresolved placeholders clearly marked if required information is still missing,\n- preserve experimental traceability.\n\nWhen generating notebook entries:\n- map plain user descriptions into structured fields,\n- preserve the protocol logic and ordering,\n- include only information supported by user input, follow-up answers, tool results, or known project context,\n- never fabricate results, yields, concentrations, times, temperatures, or lot numbers.\n\nIf the protocol contains placeholders such as `[]`, fill them using:\n1. explicit user input,\n2. recent conversation context,\n3. project/workflow context,\n4. tool results,\n5. concise follow-up questions if still unresolved.\n\nIf placeholders remain unresolved after reasonable attempts, keep them visible and mark them as needing user confirmation.\n\n## Function 3: Placeholder Filling\n\nYou must actively fill placeholders in protocols and notebook templates.\n\nRules:\n- Only fill a placeholder when the value is well supported.\n- If a placeholder can be inferred with high confidence from protocol context and user statement, fill it.\n- If a placeholder could have multiple valid values, ask.\n- Never silently replace unknown values with fake defaults.\n- If a placeholder remains unknown, leave it in a clearly editable form.\n\nExamples of fillable placeholder types:\n- date\n- sample name\n- construct name\n- cell line\n- incubation time\n- buffer name\n- reagent amount\n- temperature\n- operator name\n- instrument\n- project name\n\n## Function 4: Tool Use via Registered App Tools\n\nWhen the user asks for information such as:\n- inventory status\n- protein pI\n- molecular weight of a compound in stock\n- reagent location\n- construct information\n- project records\n- notebook entries\n- workflow state\n\nyou must:\n1. inspect the available registered tools to determine the proper tool or endpoint,\n2. choose the most appropriate tool,\n3. call the tool,\n4. interpret the result,\n5. answer the user clearly and directly.\n\nDo not answer from memory if the question is about lab-specific stored data that should be retrieved by tools.\n\nWhen using tools:\n- prefer the narrowest, most relevant tool,\n- use exact entity names when available,\n- ask a clarifying question only if the entity is genuinely ambiguous,\n- summarize tool results in user-friendly language,\n- include relevant identifiers or metadata when helpful,\n- state when no matching record is found.\n\n## Function 5: Project-Specific Scientific Questions\n\nIf the user asks a scientific question about a specific project, you may use:\n- papers associated with the project,\n- lab notebook pages,\n- workflows,\n- protocols,\n- constructs,\n- internal records,\n- web search when needed.\n\nYour priority order for project questions is:\n1. project-specific internal context,\n2. relevant uploaded or retrievable papers,\n3. notebook and workflow evidence,\n4. general scientific literature or web sources.\n\nExamples:\n- “Why did our PD-1 binder lose expression?”\n- “What did we use last time for this conjugation?”\n- “Which workflow step comes after transfection in Project X?”\n- “What papers support this assay design?”\n\nFor project questions:\n- ground answers in project evidence when available,\n- connect the answer to the actual project context,\n- cite internal sources or retrieved records in the app\'s preferred format if supported,\n- use web search only when internal context is missing or incomplete.\n\n## Function 6: General Science Questions\n\nIf the question is a general scientific question not tied to a specific project, answer directly using your knowledge and use web search when necessary.\n\nUse web search when:\n- the answer depends on recent literature or updated facts,\n- the user asks for papers, recent findings, or references,\n- your internal/project context is insufficient,\n- the question benefits from current or source-backed information.\n\nDo not overuse web search for stable foundational knowledge unless the user requests references or up-to-date information.\n\n## Function 7: PDF Paper Handling\n\nIf the agent encounters a paper that is only available as a PDF and cannot be fully and reliably parsed in the current context, do not pretend to understand it fully.\n\nInstead:\n- pause deeper paper analysis,\n- tell the user that for better comprehension of the paper, they should download and upload the PDF into the app,\n- once the PDF is uploaded, analyze it in detail.\n\nWhen this happens, say clearly that full-paper comprehension is limited until the PDF is uploaded.\n\nDo not hallucinate figure details, methods, tables, supporting information, or conclusions from incomplete PDF metadata alone.\n\n## Conversation Style\n\nYour responses should be:\n- concise but complete,\n- scientifically precise,\n- operationally useful,\n- structured when handling workflows or notebook generation,\n- clear about uncertainty.\n\nWhen asking follow-up questions:\n- ask only for the minimum information needed,\n- prefer a short list of specific missing fields,\n- avoid broad or vague requests.\n\n## Output Behavior by Task Type\n\n### A. If the user describes what they did\nOutput should:\n1. identify likely protocol match,\n2. ask for disambiguation if needed,\n3. otherwise generate a notebook page.\n\n### B. If the user asks for stored lab information\nOutput should:\n1. select the appropriate tool,\n2. retrieve result,\n3. answer directly,\n4. mention if no record was found.\n\n### C. If the user asks a project science question\nOutput should:\n1. identify the project,\n2. gather internal project context,\n3. use papers/notebooks/workflows/tools as relevant,\n4. answer with project-aware reasoning,\n5. use web search if internal context is incomplete.\n\n### D. If the user asks a general science question\nOutput should:\n1. answer directly,\n2. use web search when needed,\n3. distinguish established knowledge from current literature.\n\n### E. If a PDF paper is needed but not properly available\nOutput should:\n1. stop deep analysis,\n2. ask the user to download and upload the PDF,\n3. continue only after upload.\n\n## Non-Negotiable Rules\n\n- Do not fabricate lab records.\n- Do not fabricate protocol matches.\n- Do not fabricate tool results.\n- Do not fabricate paper contents.\n- Do not fill placeholders with unsupported values.\n- Do not claim to have searched internal records, tools, papers, or workflows unless you actually did.\n- Always ask for clarification when ambiguity would materially change the notebook entry, protocol choice, or scientific answer.\n\nYour goal is to reduce lab documentation burden, improve retrieval of lab knowledge, and provide scientifically grounded assistance while remaining faithful to actual lab records and user input.';
const DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE =
  'Return JSON matching the schema exactly. Only claim write operations were executed when tool trace confirms success. Write intent detected: {{writeIntent}}.';
const AGENT_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'answer',
    'confidence',
    'requires_approval',
    'proposed_write_actions',
    'citations',
    'decision_record'
  ],
  properties: {
    answer: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    requires_approval: { type: 'boolean' },
    proposed_write_actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['tool_name', 'reason'],
        properties: {
          tool_name: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source', 'pointer', 'reason'],
        properties: {
          source: { type: 'string' },
          pointer: { type: 'string' },
          reason: { type: 'string' }
        }
      }
    },
    decision_record: {
      type: 'object',
      additionalProperties: false,
      required: ['assumptions', 'open_questions', 'verification_notes'],
      properties: {
        assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } },
        verification_notes: { type: 'array', items: { type: 'string' } }
      }
    },
    routing: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intent: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        entities: { type: 'object', additionalProperties: true },
        plan: { type: 'object', additionalProperties: true },
        classifier: { type: 'object', additionalProperties: true }
      }
    }
  }
};

function createMainAgentToolRegistry(deps = {}) {
  const {
    asArray,
    cleanText,
    uniqueStrings,
    safeParseJson
  } = createAgentLlmRuntimeHelpers(deps);
  const normalizeRoutingPayload = typeof deps.normalizeRoutingPayload === 'function'
    ? deps.normalizeRoutingPayload
    : ((value) => value && typeof value === 'object' ? value : {});
  const searchInventoryIndex = typeof deps.searchInventoryIndex === 'function'
    ? deps.searchInventoryIndex
    : (async () => ({ items: [], termsUsed: [], source: 'fallback_json', usedSqlite: false }));
  const searchNotebookEntriesIndex = typeof deps.searchNotebookEntriesIndex === 'function'
    ? deps.searchNotebookEntriesIndex
    : (async () => ({ items: [], source: 'fallback_json', usedSqlite: false }));
  const searchProtocolsIndex = typeof deps.searchProtocolsIndex === 'function'
    ? deps.searchProtocolsIndex
    : (async () => ({ items: [], source: 'fallback_json', usedSqlite: false }));
  const buildInventorySearchTerms = typeof deps.buildInventorySearchTerms === 'function'
    ? deps.buildInventorySearchTerms
    : (() => []);
  const getDefaultDataFilePath = typeof deps.getDefaultDataFilePath === 'function'
    ? deps.getDefaultDataFilePath
    : (() => '');
  const retrieveProjectEvidence = typeof deps.retrieveProjectEvidence === 'function'
    ? deps.retrieveProjectEvidence
    : (() => null);
  const buildPaperSearchableDocs = typeof deps.buildPaperSearchableDocs === 'function'
    ? deps.buildPaperSearchableDocs
    : (() => []);
  const retrievePaperCandidates = typeof deps.retrievePaperCandidates === 'function'
    ? deps.retrievePaperCandidates
    : (() => []);
  const managedPythonSandboxRuntime = deps.managedPythonSandboxRuntime && typeof deps.managedPythonSandboxRuntime.execute === 'function'
    ? deps.managedPythonSandboxRuntime
    : { execute: async () => ({ sandbox: { ok: false, error: 'Managed Python sandbox runtime is not configured.' } }) };
  const annotateWithBlast = typeof deps.annotateWithBlast === 'function'
    ? deps.annotateWithBlast
    : null;
  const literatureSearchRuntime = deps.literatureSearchRuntime && typeof deps.literatureSearchRuntime === 'object'
    ? deps.literatureSearchRuntime
    : createLiteratureSearchRuntime(deps.literatureSearchDeps || {});
  const paperDownloadRuntime = deps.paperDownloadRuntime && typeof deps.paperDownloadRuntime === 'object'
    ? deps.paperDownloadRuntime
    : createPaperDownloadRuntime(deps.paperDownloadDeps || {});
  const toolboxExecutors = deps.toolboxExecutors && typeof deps.toolboxExecutors === 'object'
    ? deps.toolboxExecutors
    : {};
  const renderPromptTemplate = typeof deps.renderPromptTemplate === 'function'
    ? deps.renderPromptTemplate
    : ((template, vars = {}) => String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => String(vars[key] ?? '')));
  const DEFAULT_AGENT_SYSTEM_PROMPT = String(deps.DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE || '').trim()
    || DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE;
  const DEFAULT_AGENT_SYNTHESIS_PROMPT = String(deps.DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE || '').trim()
    || DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE;

  function clamp(number, min, max) {
    return Math.max(min, Math.min(max, number));
  }

  function cloneJson(value, fallback = {}) {
    if (value === undefined) {
      return fallback;
    }
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function normalizeJsonPayload(payload, fallback = {}) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return payload;
    }
    if (typeof payload === 'string') {
      const parsed = safeParseJson(payload, null);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  function normalizeToolInvocationArgs(rawArgs) {
    const payload = normalizeJsonPayload(rawArgs, {});
    if (payload.input && typeof payload.input === 'object' && !Array.isArray(payload.input)) {
      return payload.input;
    }
    if (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)) {
      return payload.args;
    }
    if (payload.arguments && typeof payload.arguments === 'object' && !Array.isArray(payload.arguments)) {
      return payload.arguments;
    }
    if (typeof payload.input_json === 'string') {
      return normalizeJsonPayload(payload.input_json, payload);
    }
    return payload;
  }

  function normalizeChemicalStorePayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const locationCodeMap = source.locationCodeMap && typeof source.locationCodeMap === 'object'
      ? Object.fromEntries(
        Object.entries(source.locationCodeMap)
          .map(([key, value]) => [cleanText(key, 240).toLowerCase(), cleanText(value, 32).toUpperCase()])
          .filter(([key, value]) => key && value)
      )
      : {};
    const locationCodeNextByLocation = source.locationCodeNextByLocation && typeof source.locationCodeNextByLocation === 'object'
      ? Object.fromEntries(
        Object.entries(source.locationCodeNextByLocation)
          .map(([key, value]) => [cleanText(key, 240).toLowerCase(), Number(value) || 0])
          .filter(([key, value]) => key && value > 0)
      )
      : {};
    return {
      chemicals: asArray(source.chemicals),
      blocks: asArray(source.blocks),
      lastLocationNumber: Number(source.lastLocationNumber) || 0,
      locationCodeMap,
      locationCodeNextByLocation
    };
  }

  function normalizeInventorySearchMetadata(rawInventorySearch) {
    const source = rawInventorySearch && typeof rawInventorySearch === 'object' ? rawInventorySearch : {};
    return {
      normalized_query: cleanText(source.normalized_query, 220),
      candidate_terms: uniqueStrings(source.candidate_terms, 10),
      aliases: uniqueStrings(source.aliases, 10),
      search_mode: cleanText(source.search_mode, 60)
    };
  }

  function buildInventoryToolArgs({
    message,
    routing = {},
    args = {}
  } = {}) {
    const normalizedArgs = normalizeToolInvocationArgs(args);
    const planInventorySearch = normalizeInventorySearchMetadata(routing?.plan?.inventory_search);
    const argInventorySearch = normalizeInventorySearchMetadata(normalizedArgs);
    const normalizedQuery = cleanText(
      argInventorySearch.normalized_query || planInventorySearch.normalized_query,
      220
    );
    const candidateTerms = uniqueStrings([
      ...asArray(argInventorySearch.candidate_terms),
      ...asArray(planInventorySearch.candidate_terms)
    ], 10);
    const aliases = uniqueStrings([
      ...asArray(argInventorySearch.aliases),
      ...asArray(planInventorySearch.aliases)
    ], 10);
    const searchMode = cleanText(argInventorySearch.search_mode || planInventorySearch.search_mode, 60);
    const fallbackQuery = cleanText(normalizedArgs.query, 220) || cleanText(message, 220);
    const searchTerms = buildInventorySearchTerms({
      inventorySearch: {
        normalized_query: normalizedQuery,
        candidate_terms: candidateTerms,
        aliases,
        search_mode: searchMode
      },
      fallbackQuery,
      maxTerms: 10
    });
    return {
      ...normalizedArgs,
      query: searchTerms[0] || normalizedQuery || fallbackQuery,
      normalized_query: normalizedQuery || null,
      candidate_terms: candidateTerms,
      aliases,
      search_mode: searchMode || null,
      search_terms: searchTerms
    };
  }

  function summarizeSchemaShape(schema) {
    const source = schema && typeof schema === 'object' ? schema : {};
    const properties = source.properties && typeof source.properties === 'object'
      ? source.properties
      : {};
    const required = asArray(source.required);
    const keys = Object.keys(properties).slice(0, 10);
    if (!keys.length) {
      return '{}';
    }
    const rows = keys.map((key) => {
      const item = properties[key] && typeof properties[key] === 'object' ? properties[key] : {};
      const type = cleanText(item.type, 24) || 'any';
      const marker = required.includes(key) ? '!' : '?';
      return `${key}${marker}:${type}`;
    });
    return `{ ${rows.join(', ')} }`;
  }

  function buildStandardAgentToolOutputSchema() {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['items', 'citations', 'summary'],
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['source', 'pointer', 'reason'],
            properties: {
              source: { type: 'string' },
              pointer: { type: 'string' },
              reason: { type: 'string' }
            }
          }
        },
        summary: { type: 'string' }
      }
    };
  }

  function buildMainAgentToolMetadata() {
    const makeTool = (name, description, limitMax = 20) => ({
      name,
      description,
      input_schema: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: limitMax }
        }
      },
      output_schema: buildStandardAgentToolOutputSchema()
    });

    return [
      makeTool('search_projects', 'Read project records by semantic keyword or exact term.'),
      makeTool('search_protocols', 'Read protocol records, including names and step snippets.'),
      makeTool('search_notebook_entries', 'Read notebook entries with result summaries and timestamps.'),
      makeTool('search_workflows', 'Read workflow records with project links, block summaries, and recent step previews.'),
      makeTool('search_assays', 'Read assay runs with plate metadata and compact numeric summaries.'),
      makeTool('search_gel_analyses', 'Read gel analysis runs with confidence, calibration, and warning summaries.'),
      makeTool('search_inventory', 'Read chemical and personal inventory records.', 25),
      makeTool('search_papers', 'Read uploaded paper summaries, methods, and reagent extraction notes.'),
      makeTool('search_uniprot', 'Search UniProtKB protein knowledgebase records by keyword, accession, or gene/protein term.', 25),
      makeTool('search_pubmed', 'Search PubMed literature records and return article metadata for biomedical queries.', 25),
      makeTool('search_crossref', 'Search Crossref works metadata by title, DOI, author, or keyword.', 25),
      makeTool('search_europe_pmc', 'Search Europe PMC literature records with PubMed/PMCID/DOI metadata.', 25),
      makeTool('search_web', 'Search generic web sources and return source URLs/snippets for recency-aware fallback.', 20),
      {
        name: 'toolbox_molarity_calculator',
        description: 'Compute molarity, mass, volume, concentration, or dilution conversions used in the Toolbox Molarity Calculator.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['operation'],
          properties: {
            operation: {
              type: 'string',
              enum: [
                'mass_from_concentration_volume',
                'volume_from_mass_concentration',
                'concentration_from_mass_volume',
                'dilution_c1v1'
              ]
            },
            concentration_value: { type: 'number' },
            concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
            volume_value: { type: 'number' },
            volume_unit: { type: 'string', enum: ['uL', 'mL', 'L'] },
            mass_value: { type: 'number' },
            mass_unit: { type: 'string', enum: ['ug', 'mg', 'g', 'kg'] },
            molecular_weight_g_mol: { type: 'number' },
            stock_concentration_value: { type: 'number' },
            stock_concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
            target_concentration_value: { type: 'number' },
            target_concentration_unit: { type: 'string', enum: ['fM', 'pM', 'nM', 'uM', 'mM', 'M'] },
            target_volume_value: { type: 'number' },
            target_volume_unit: { type: 'string', enum: ['uL', 'mL', 'L'] },
            output_unit: { type: 'string' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_peptide_properties',
        description: 'Compute peptide mass, pI, net charge, residue counts, and extinction coefficients.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sequence_text'],
          properties: {
            sequence_text: { type: 'string' },
            ph: { type: 'number' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_buffer_preparer',
        description: 'Compute required masses or liquid volumes for buffer preparation.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['volume_ml', 'components'],
          properties: {
            volume_ml: { type: 'number' },
            components: { type: 'array', items: { type: 'object' } }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_dna_to_protein',
        description: 'Translate DNA/RNA sequence to protein in selected frame and stop mode.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sequence_text'],
          properties: {
            sequence_text: { type: 'string' },
            sequence_type: { type: 'string', enum: ['DNA', 'RNA'] },
            frame: { type: 'integer', minimum: -3, maximum: 3 },
            stop_mode: { type: 'string', enum: ['star', 'trim'] }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_protein_to_dna',
        description: 'Reverse-translate protein sequence to DNA with optional restriction-site constraints.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['protein_sequence'],
          properties: {
            protein_sequence: { type: 'string' },
            organism: { type: 'string' },
            append_stop_codon: { type: 'boolean' },
            restriction_sites: { type: 'array', items: { type: 'string' } }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_oligo_properties',
        description: 'Compute oligo molecular weight, extinction coefficient, and Tm.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sequence_text'],
          properties: {
            sequence_text: { type: 'string' },
            oligo_type: { type: 'string', enum: ['DNA', 'RNA'] }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_extinction_coefficient',
        description: 'Compute extinction coefficient for protein/peptide or DNA/RNA sequences.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sequence_type', 'sequence_text'],
          properties: {
            sequence_type: { type: 'string', enum: ['protein', 'DNA', 'RNA'] },
            sequence_text: { type: 'string' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_qpcr_efficiency',
        description: 'Compute qPCR efficiency from slope or standard-curve points.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            slope: { type: 'number' },
            points: { type: 'array', items: { type: 'object' } }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_plannotate',
        description: 'Run pLannotate-like annotation from plain-text sequence input only (no file/blob input).',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['sequence_text'],
          properties: {
            sequence_text: { type: 'string' },
            topology: { type: 'string', enum: ['circular', 'linear'] },
            detailed: { type: 'boolean' },
            min_identity: { type: 'number', minimum: 50, maximum: 100 },
            min_coverage: { type: 'number', minimum: 0.05, maximum: 1 },
            min_hit_length: { type: 'integer', minimum: 12, maximum: 2000 },
            max_hits: { type: 'integer', minimum: 1, maximum: 200 },
            record_name: { type: 'string' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'toolbox_crispr_sgrna_designer',
        description: 'Design CRISPR sgRNA candidates from target sequence text and scoring parameters.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['targets_text'],
          properties: {
            targets_text: { type: 'string' },
            reference_genome_id: { type: 'string' },
            pam_pattern: { type: 'string' },
            guide_length: { type: 'integer', minimum: 18, maximum: 24 },
            top_count: { type: 'integer', minimum: 1, maximum: 100 },
            min_gc: { type: 'number', minimum: 0, maximum: 100 },
            max_gc: { type: 'number', minimum: 0, maximum: 100 },
            selected_target_ids: { type: 'array', items: { type: 'string' } }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'run_python_sandbox',
        description: 'Run Python code in an isolated temporary sandbox for deterministic calculations and data transforms.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['code'],
          properties: {
            code: { type: 'string' },
            files: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['path', 'content'],
                properties: {
                  path: { type: 'string' },
                  content: { type: 'string' }
                }
              }
            },
            timeout_ms: { type: 'integer', minimum: 500, maximum: 15000 },
            readback_paths: { type: 'array', items: { type: 'string' } },
            artifact_paths: { type: 'array', items: { type: 'string' } },
            persist_artifacts: { type: 'boolean' },
            task_type: { type: 'string' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      },
      {
        name: 'download_paper_pdf',
        description: 'Write tool. Download a paper PDF and optional SI PDFs into the configured storage path.',
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['linked_type', 'linked_name', 'paper_pdf_url'],
          properties: {
            linked_type: { type: 'string', enum: ['project', 'journal-club'] },
            linked_name: { type: 'string' },
            paper_pdf_url: { type: 'string' },
            paper_file_name: { type: 'string' },
            si_pdf_urls: { type: 'array', items: { type: 'string' } },
            si_file_names: { type: 'array', items: { type: 'string' } },
            storage_path: { type: 'string' }
          }
        },
        output_schema: buildStandardAgentToolOutputSchema()
      }
    ];
  }

  function buildAgentToolPrompt(toolMetadata = []) {
    const tools = asArray(toolMetadata);
    if (!tools.length) {
      return '';
    }
    const rows = tools.map((tool) => {
      const name = cleanText(tool?.name, 120) || 'unknown_tool';
      const inputShape = summarizeSchemaShape(tool?.input_schema);
      const outputShape = summarizeSchemaShape(tool?.output_schema);
      return `- ${name} input ${inputShape} output ${outputShape}`;
    });
    return `Registered agent tools\n${rows.join('\n')}`;
  }

  function buildProjectRecordIndex({ snapshot } = {}) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const projects = asArray(source.projects);
    const protocols = asArray(source.protocols);
    const workflows = asArray(source.workflows);
    const notebookEntries = asArray(source.notebookEntries);
    const papers = asArray(source.papers);

    const byProjectId = {};
    const byProjectName = {};

    const ensureProjectBucket = (projectId, projectName) => {
      const normalizedId = cleanText(projectId, 120);
      const normalizedName = cleanText(projectName, 220);
      const idKey = normalizedId ? normalizedId.toLowerCase() : '';
      const nameKey = normalizedName ? normalizedName.toLowerCase() : '';

      if (idKey && !byProjectId[idKey]) {
        byProjectId[idKey] = {
          project: {
            id: normalizedId,
            name: normalizedName || normalizedId
          },
          protocols: [],
          workflows: [],
          notebook_entries: [],
          papers: []
        };
      } else if (idKey && normalizedName && !byProjectId[idKey].project.name) {
        byProjectId[idKey].project.name = normalizedName;
      }

      if (nameKey && !byProjectName[nameKey]) {
        byProjectName[nameKey] = {
          project_name: normalizedName,
          project_ids: [],
          protocols: [],
          workflows: [],
          notebook_entries: [],
          papers: []
        };
      }

      if (idKey && nameKey && !byProjectName[nameKey].project_ids.includes(normalizedId)) {
        byProjectName[nameKey].project_ids.push(normalizedId);
      }

      return { idKey, nameKey };
    };

    const pushUnique = (bucket, key, value) => {
      const normalized = cleanText(value, 160);
      if (!normalized || !Array.isArray(bucket[key]) || bucket[key].includes(normalized)) {
        return;
      }
      bucket[key].push(normalized);
    };

    const pickEntryId = (entry) => cleanText(
      entry?.id
        || entry?.protocolId
        || entry?.protocol_id
        || entry?.workflowId
        || entry?.workflow_id
        || entry?.entryId
        || entry?.entry_id
        || entry?.paperId
        || entry?.paper_id
        || entry?.title
        || entry?.name,
      220
    );

    const resolveProjectRef = (entry) => ({
      id: cleanText(
        entry?.projectId
          || entry?.project_id
          || entry?.project?.id
          || entry?.project_ref?.id
          || '',
        120
      ),
      name: cleanText(
        entry?.projectName
          || entry?.project_name
          || entry?.project?.name
          || entry?.project_ref?.name
          || '',
        220
      )
    });

    projects.forEach((project) => {
      ensureProjectBucket(project?.id, project?.name);
    });

    const attachRows = (rows, field) => {
      rows.forEach((row) => {
        const { id, name } = resolveProjectRef(row);
        const { idKey, nameKey } = ensureProjectBucket(id, name);
        const rowId = pickEntryId(row);
        if (idKey && byProjectId[idKey]) {
          pushUnique(byProjectId[idKey], field, rowId);
        }
        if (nameKey && byProjectName[nameKey]) {
          pushUnique(byProjectName[nameKey], field, rowId);
        }
      });
    };

    attachRows(protocols, 'protocols');
    attachRows(workflows, 'workflows');
    attachRows(notebookEntries, 'notebook_entries');
    attachRows(papers, 'papers');

    return {
      by_project_id: byProjectId,
      by_project_name: byProjectName
    };
  }

  function normalizeAgentSnapshot(rawSnapshot) {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object' ? rawSnapshot : {};
    const experimentData = snapshot.experimentData && typeof snapshot.experimentData === 'object'
      ? snapshot.experimentData
      : {};
    const normalizedPersonalInventory = Array.isArray(snapshot.inventory?.personal)
      ? asArray(snapshot.inventory.personal).slice(0, 40)
      : snapshot.inventory?.personal && typeof snapshot.inventory.personal === 'object'
        ? Object.entries(snapshot.inventory.personal)
          .slice(0, 40)
          .map(([zone, items]) => ({
            zone: cleanText(zone, 80),
            items: asArray(items).slice(0, 60)
          }))
        : [];
    const assays = asArray(snapshot.assays).length
      ? asArray(snapshot.assays).slice(0, 80)
      : asArray(experimentData.assay_runs).slice(0, 80);
    const gelAnalyses = asArray(snapshot.gelAnalyses).length
      ? asArray(snapshot.gelAnalyses).slice(0, 80)
      : asArray(experimentData.gel_runs).slice(0, 80);
    const normalizedChemicalInventory = asArray(snapshot.inventory?.chemicals).length
      ? asArray(snapshot.inventory.chemicals).slice(0, 220)
      : asArray(snapshot.labInventory?.chemicals).slice(0, 220);
    const normalizedExperimentData = {
      schema_name: cleanText(experimentData.schema_name, 80) || 'enana_experiment_json',
      schema_version: cleanText(experimentData.schema_version, 20) || '1.0',
      generated_utc: cleanText(experimentData.generated_utc, 80) || cleanText(snapshot.timestamp, 80),
      notebook_runs: asArray(experimentData.notebook_runs).slice(0, 120),
      assay_runs: asArray(experimentData.assay_runs).slice(0, 80),
      gel_runs: asArray(experimentData.gel_runs).slice(0, 80)
    };
    if (!normalizedExperimentData.assay_runs.length && assays.length) {
      normalizedExperimentData.assay_runs = assays;
    }
    if (!normalizedExperimentData.gel_runs.length && gelAnalyses.length) {
      normalizedExperimentData.gel_runs = gelAnalyses;
    }
    const normalizedSnapshot = {
      projects: asArray(snapshot.projects).slice(0, 40),
      protocols: asArray(snapshot.protocols).slice(0, 100),
      notebookEntries: asArray(snapshot.notebookEntries).slice(0, 180),
      workflows: asArray(snapshot.workflows).slice(0, 120),
      assays,
      gelAnalyses,
      experimentData: normalizedExperimentData,
      papers: asArray(snapshot.papers).slice(0, 80),
      inventory: snapshot.inventory && typeof snapshot.inventory === 'object'
        ? {
          personal: normalizedPersonalInventory,
          chemicals: normalizedChemicalInventory
        }
        : {
          personal: [],
          chemicals: normalizedChemicalInventory
        },
      labInventory: normalizeChemicalStorePayload(snapshot.labInventory),
      settings: {
        storagePath: cleanText(snapshot?.settings?.storagePath || snapshot?.storagePath, 1200)
      },
      data_file_path: cleanText(snapshot.data_file_path || snapshot.dataFilePath, 1600),
      timestamp: cleanText(snapshot.timestamp, 80)
    };
    normalizedSnapshot.projectIndex = buildProjectRecordIndex({ snapshot: normalizedSnapshot });
    return normalizedSnapshot;
  }

  function scoreByQuery(text, queryTokens) {
    if (!queryTokens.length) {
      return 1;
    }
    const haystack = String(text || '').toLowerCase();
    return queryTokens.reduce((score, token) => (haystack.includes(token) ? score + 1 : score), 0);
  }

  function normalizeQuery(value) {
    const query = cleanText(value, 300).toLowerCase();
    const tokens = query
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .slice(0, 12);
    return { query, tokens };
  }

  function pickTopMatches(items, buildSearchText, query, limit) {
    const { tokens } = normalizeQuery(query);
    const scored = asArray(items).map((item) => ({
      item,
      score: scoreByQuery(buildSearchText(item), tokens)
    }));
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, clamp(Number(limit) || 6, 1, 25))
      .map((entry) => entry.item);
  }

  function normalizeAgentToolResultPayload(rawResult) {
    const source = rawResult && typeof rawResult === 'object' ? rawResult : {};
    return {
      items: asArray(source.items),
      citations: asArray(source.citations).map((citation) => ({
        source: cleanText(citation?.source, 120),
        pointer: cleanText(citation?.pointer, 180),
        reason: cleanText(citation?.reason, 220)
      })),
      summary: cleanText(source.summary, 320) || 'No summary was generated.'
    };
  }

  function buildAgentToolOutputEnvelope(toolName, args, rawResult, options = {}) {
    const normalizedArgs = normalizeToolInvocationArgs(args);
    const normalizedResult = normalizeAgentToolResultPayload(rawResult);
    const ok = options.ok !== false;
    const error = cleanText(options.error, 600);
    return {
      ok,
      schema_name: AGENT_TOOL_OUTPUT_SCHEMA_NAME,
      schema_version: AGENT_TOOL_OUTPUT_SCHEMA_VERSION,
      tool_name: cleanText(toolName, 120),
      input: cloneJson(normalizedArgs, {}),
      result: normalizedResult,
      items: normalizedResult.items,
      citations: normalizedResult.citations,
      summary: normalizedResult.summary,
      generated_at: new Date().toISOString(),
      ...(error ? { error } : {})
    };
  }

  const AGENT_TOOL_METADATA = buildMainAgentToolMetadata();
  const AGENT_TOOL_DEFINITION_MAP = new Map(AGENT_TOOL_METADATA.map((tool) => [cleanText(tool?.name, 120), tool]));
  const AGENT_TOOL_DEFINITIONS = AGENT_TOOL_METADATA.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: cloneJson(tool.input_schema, { type: 'object', additionalProperties: false, properties: {} })
  }));
  const AGENT_TOOL_DEFINITION_INPUT_MAP = new Map(AGENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));
  const AGENT_TOOL_PROMPT = buildAgentToolPrompt(AGENT_TOOL_METADATA);

  async function executeLocalSearchTool(name, normalizedArgs, snapshot, limit) {
    const query = cleanText(normalizedArgs?.query, 300);
    if (name === 'search_projects') {
      const items = pickTopMatches(
        snapshot.projects,
        (project) => `${project?.name || ''} ${project?.summary || ''}`,
        query,
        limit
      ).map((project) => ({
        id: cleanText(project?.id, 80),
        name: cleanText(project?.name, 200),
        summary: cleanText(project?.summary, 300)
      }));
      return {
        items,
        citations: items.map((project) => ({
          source: 'project',
          pointer: project.id || project.name,
          reason: 'Matched project metadata.'
        })),
        summary: `Found ${items.length} matching projects.`
      };
    }

    if (name === 'search_protocols') {
      const protocolSearch = await searchProtocolsIndex({
        dataFilePath: cleanText(snapshot?.data_file_path, 1600),
        fallbackDataFilePath: getDefaultDataFilePath(),
        query,
        limit,
        snapshot
      });
      const items = asArray(protocolSearch.items).slice(0, limit).map((item) => ({
        id: cleanText(item?.id, 80),
        name: cleanText(item?.name, 180),
        category: cleanText(item?.category, 80),
        steps: asArray(item?.steps).slice(0, 8).map((step) => cleanText(step?.text || step?.instruction || step, 220)).filter(Boolean)
      })).filter((item) => item.name || item.id);
      return {
        items,
        citations: items.map((protocol) => ({
          source: 'protocol',
          pointer: protocol.id || protocol.name,
          reason: protocolSearch.usedSqlite
            ? 'Matched protocol index (SQLite) with deterministic JS ranking.'
            : 'Matched protocol metadata from snapshot fallback.'
        })),
        summary: cleanText(
          `Found ${items.length} matching protocols.${protocolSearch.usedSqlite ? ' Source: SQLite index.' : ' Source: snapshot fallback.'}`,
          320
        )
      };
    }

    if (name === 'search_notebook_entries') {
      const notebookSearch = await searchNotebookEntriesIndex({
        dataFilePath: cleanText(snapshot?.data_file_path, 1600),
        fallbackDataFilePath: getDefaultDataFilePath(),
        query,
        limit,
        snapshot
      });
      const items = asArray(notebookSearch.items).slice(0, limit).map((entry) => ({
        id: cleanText(entry?.id, 80),
        protocolName: cleanText(entry?.protocolName, 180),
        result: cleanText(entry?.result, 400),
        updatedAt: cleanText(entry?.updatedAt, 80)
      })).filter((entry) => entry.id || entry.protocolName);
      return {
        items,
        citations: items.map((entry) => ({
          source: 'notebook_entry',
          pointer: entry.id || entry.protocolName,
          reason: notebookSearch.usedSqlite
            ? 'Matched notebook index (SQLite) with deterministic JS ranking.'
            : 'Matched notebook summary/results from snapshot fallback.'
        })),
        summary: cleanText(
          `Found ${items.length} matching notebook entries.${notebookSearch.usedSqlite ? ' Source: SQLite index.' : ' Source: snapshot fallback.'}`,
          320
        )
      };
    }

    if (name === 'search_workflows') {
      const scopedEvidence = retrieveProjectEvidence({
        message: query,
        entities: {
          project: cleanText(normalizedArgs?.project_name || normalizedArgs?.project, 180),
          workflow_step: cleanText(normalizedArgs?.workflow_step, 180),
          protocol: cleanText(normalizedArgs?.protocol, 180),
          activity: query
        },
        selectedProjectId: cleanText(normalizedArgs?.project_id, 80),
        selectedProjectName: cleanText(normalizedArgs?.project_name, 180),
        snapshot,
        maxPerSource: limit,
        allowAmbiguousScope: true
      });
      const evidenceRows = asArray(scopedEvidence?.packs?.workflows).map((workflow) => ({
        id: cleanText(workflow?.id, 80),
        name: cleanText(workflow?.name, 180),
        project_name: cleanText(workflow?.project_name, 180),
        description: cleanText(workflow?.description, 400),
        block_count: Number(workflow?.block_count) || 0,
        link_count: Number(workflow?.link_count) || 0,
        steps_preview: asArray(workflow?.steps_preview).map((step) => cleanText(step, 220)).filter(Boolean).slice(0, 8),
        updated_at: cleanText(workflow?.updated_at, 80)
      })).filter((workflow) => workflow.id || workflow.name);

      const fallbackRows = pickTopMatches(
        snapshot.workflows,
        (workflow) => [
          workflow?.name,
          workflow?.description,
          asArray(workflow?.blocks).map((block) => block?.text || block?.protocolId).join(' ')
        ].join(' '),
        query,
        limit
      ).map((workflow) => ({
        id: cleanText(workflow?.id, 80),
        name: cleanText(workflow?.name, 180),
        project_name: cleanText(
          asArray(snapshot.projects).find((project) => project.id === cleanText(workflow?.projectId, 80))?.name,
          180
        ),
        description: cleanText(workflow?.description, 400),
        block_count: asArray(workflow?.blocks).length,
        link_count: asArray(workflow?.links).length,
        steps_preview: asArray(workflow?.blocks).map((block) => cleanText(block?.text || block?.protocolId, 220)).filter(Boolean).slice(0, 8),
        updated_at: cleanText(workflow?.updatedAt || workflow?.createdAt, 80)
      }));
      const items = evidenceRows.length ? evidenceRows : fallbackRows;
      return {
        items: items.slice(0, limit),
        citations: items.slice(0, limit).map((workflow) => ({
          source: 'workflow',
          pointer: workflow.id || workflow.name,
          reason: 'Matched workflow graph metadata and step previews.'
        })),
        summary: `Found ${items.slice(0, limit).length} matching workflows.`
      };
    }

    if (name === 'search_assays') {
      const items = pickTopMatches(
        snapshot.assays,
        (assay) => [
          assay?.assay_number,
          assay?.name,
          assay?.project_name,
          assay?.notebook_entry_protocol_name,
          assay?.notes
        ].join(' '),
        query,
        limit
      ).map((assay) => ({
        id: cleanText(assay?.id, 80),
        assay_number: cleanText(assay?.assay_number, 80),
        name: cleanText(assay?.name, 180),
        project_name: cleanText(assay?.project_name, 180),
        notebook_entry_protocol_name: cleanText(assay?.notebook_entry_protocol_name, 180),
        result_well_count: Number(assay?.result_summary?.result_well_count) || 0,
        numeric_count: Number(assay?.result_summary?.numeric_count) || 0,
        updated_at: cleanText(assay?.updated_at, 80)
      }));
      return {
        items,
        citations: items.map((assay) => ({
          source: 'assay',
          pointer: assay.id || assay.name || assay.assay_number,
          reason: 'Matched assay metadata or axis annotations.'
        })),
        summary: `Found ${items.length} matching assays.`
      };
    }

    if (name === 'search_gel_analyses') {
      const items = pickTopMatches(
        snapshot.gelAnalyses,
        (analysis) => [
          analysis?.name,
          analysis?.analysis_type,
          analysis?.project_name,
          analysis?.notebook_entry_protocol_name,
          analysis?.image_name,
          asArray(analysis?.warnings).join(' ')
        ].join(' '),
        query,
        limit
      ).map((analysis) => ({
        id: cleanText(analysis?.id, 80),
        name: cleanText(analysis?.name, 180),
        analysis_type: cleanText(analysis?.analysis_type, 40),
        project_name: cleanText(analysis?.project_name, 180),
        notebook_entry_protocol_name: cleanText(analysis?.notebook_entry_protocol_name, 180),
        image_name: cleanText(analysis?.image_name, 220),
        lane_count: Number(analysis?.lane_count) || 0,
        band_count: Number(analysis?.band_count) || 0,
        confidence_label: cleanText(analysis?.confidence?.label, 80),
        confidence_score: Number.isFinite(Number(analysis?.confidence?.score))
          ? Number(analysis?.confidence?.score)
          : null,
        warnings: asArray(analysis?.warnings).slice(0, 4).map((warning) => cleanText(warning, 220)),
        updated_at: cleanText(analysis?.updated_at, 80)
      }));
      return {
        items,
        citations: items.map((analysis) => ({
          source: 'gel_analysis',
          pointer: analysis.id || analysis.name,
          reason: 'Matched gel metadata, warnings, or confidence fields.'
        })),
        summary: `Found ${items.length} matching gel analyses.`
      };
    }

    if (name === 'search_inventory') {
      const searchMode = cleanText(normalizedArgs?.search_mode, 60) || 'exact_then_alias_then_fuzzy';
      const searchTerms = uniqueStrings(
        asArray(normalizedArgs?.search_terms).length
          ? normalizedArgs.search_terms
          : buildInventorySearchTerms({
            inventorySearch: {
              normalized_query: cleanText(normalizedArgs?.normalized_query, 220),
              candidate_terms: asArray(normalizedArgs?.candidate_terms),
              aliases: asArray(normalizedArgs?.aliases),
              search_mode: searchMode
            },
            fallbackQuery: query,
            maxTerms: 10
          }),
        10
      );
      const termsToTry = searchTerms.length ? searchTerms : [query];
      const inventorySearch = await searchInventoryIndex({
        dataFilePath: cleanText(snapshot?.data_file_path, 1600),
        fallbackDataFilePath: getDefaultDataFilePath(),
        query,
        limit,
        searchTerms: termsToTry,
        snapshot
      });
      const items = asArray(inventorySearch.items).slice(0, limit).map((item) => ({
        kind: cleanText(item?.kind, 40),
        zone: cleanText(item?.zone, 80),
        id: cleanText(item?.id, 80),
        name: cleanText(item?.name, 180),
        quantity: cleanText(item?.quantity, 80),
        amount: cleanText(item?.amount, 80),
        cas: cleanText(item?.cas, 80),
        location: cleanText(item?.location, 120),
        supplier: cleanText(item?.supplier, 160),
        matched_term: cleanText(item?.matched_term, 140)
      }));
      const termsSummary = asArray(inventorySearch.termsUsed).length
        ? asArray(inventorySearch.termsUsed).map((term) => cleanText(term, 120)).filter(Boolean).slice(0, 5)
        : termsToTry.map((term) => cleanText(term, 120)).filter(Boolean).slice(0, 5);
      return {
        items,
        citations: items.map((item) => ({
          source: item.kind || 'inventory',
          pointer: item.id || item.name,
          reason: cleanText(
            `Matched inventory metadata using "${cleanText(item?.matched_term, 120) || cleanText(query, 120) || 'query'}".`,
            220
          )
        })),
        summary: cleanText(
          `Found ${items.length} matching inventory records.${termsSummary.length ? ` Terms tried: ${termsSummary.join(', ')}.` : ''}${inventorySearch.usedSqlite ? ' Source: SQLite index.' : ' Source: snapshot fallback.'}`,
          320
        )
      };
    }

    if (name === 'search_papers') {
      const docs = buildPaperSearchableDocs({
        papers: asArray(snapshot.papers),
        projects: asArray(snapshot.projects)
      });
      const ranked = retrievePaperCandidates({
        message: query || 'paper',
        entities: {
          paper_title: cleanText(normalizedArgs?.paper_title || normalizedArgs?.title, 220),
          project: cleanText(normalizedArgs?.project_name || normalizedArgs?.project, 180),
          protein: cleanText(normalizedArgs?.protein, 140),
          compound: cleanText(normalizedArgs?.compound, 140)
        },
        docs,
        maxCandidates: limit
      });
      const items = asArray(ranked).slice(0, limit).map((paper) => ({
        id: cleanText(paper?.paper_id || paper?.id, 80),
        title: cleanText(paper?.paper_title || paper?.title, 220),
        summary: cleanText(paper?.summary, 500),
        methods: asArray(paper?.methods).slice(0, 4).map((method) => ({
          title: cleanText(method?.title, 180),
          steps: asArray(method?.steps).slice(0, 6).map((step) => cleanText(step, 200)).filter(Boolean),
          citations: asArray(method?.citations).slice(0, 6).map((citation) => cleanText(citation, 140)).filter(Boolean)
        })),
        availability_status: cleanText(paper?.availability_status, 80),
        deep_read_ready: paper?.deep_read_ready === true,
        ingestion_status: cleanText(paper?.ingestion_status, 80),
        key_figures: asArray(paper?.key_figures).map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 8),
        linked_project_name: cleanText(paper?.linked_project_name, 220),
        updated_at: cleanText(paper?.updated_at, 80)
      }));
      const deepReadyCount = items.filter((item) => item.deep_read_ready === true).length;
      return {
        items,
        citations: items.map((paper) => ({
          source: 'paper',
          pointer: paper.id || paper.title,
          reason: 'Matched paper title, summary, methods, reagents, or key-figure metadata.'
        })),
        summary: `Found ${items.length} matching papers (${deepReadyCount} deep-ready).`
      };
    }

    return null;
  }

  async function executeLiteratureSearchTool(name, normalizedArgs, limit) {
    const query = cleanText(normalizedArgs?.query, 300);
    if (!query) {
      return {
        items: [],
        citations: [],
        summary: `No query was provided for ${name.replace(/^search_/, '').replace(/_/g, ' ')} search.`
      };
    }

    if (name === 'search_web') {
      const items = await literatureSearchRuntime.searchWebRecords(query, limit);
      return {
        items: asArray(items).slice(0, limit).map((item) => ({
          title: cleanText(item?.title, 320),
          url: cleanText(item?.url, 1800),
          snippet: cleanText(item?.snippet, 900),
          source_domain: cleanText(item?.source_domain, 160).toLowerCase(),
          published_at: cleanText(item?.published_at, 80)
        })),
        citations: asArray(items).slice(0, limit).map((item, index) => ({
          source: 'web_source',
          pointer: cleanText(item?.url || item?.title, 220) || `web_result_${index + 1}`,
          reason: `Matched generic web source from ${cleanText(item?.source_domain, 120) || 'unknown domain'}.`
        })),
        summary: `Found ${Math.min(asArray(items).length, limit)} matching web sources.`
      };
    }

    const runtimeMethodMap = {
      search_uniprot: 'searchUniProtRecords',
      search_pubmed: 'searchPubMedRecords',
      search_crossref: 'searchCrossrefRecords',
      search_europe_pmc: 'searchEuropePmcRecords'
    };
    const citationSourceMap = {
      search_uniprot: 'uniprot',
      search_pubmed: 'pubmed',
      search_crossref: 'crossref',
      search_europe_pmc: 'europe_pmc'
    };
    const pointerMap = {
      search_uniprot: (item) => item?.accession || item?.entry_id,
      search_pubmed: (item) => item?.pmid,
      search_crossref: (item) => item?.doi || item?.url || item?.title,
      search_europe_pmc: (item) => item?.pmid || item?.pmcid || item?.doi || item?.id
    };
    const methodName = runtimeMethodMap[name];
    const method = methodName ? literatureSearchRuntime[methodName] : null;
    if (typeof method !== 'function') {
      throw new Error(`${name} runtime is not configured.`);
    }
    const items = await method(query, limit);
    return {
      items,
      citations: asArray(items).slice(0, limit).map((item) => ({
        source: citationSourceMap[name],
        pointer: cleanText(pointerMap[name](item), 220),
        reason: `Matched ${citationSourceMap[name]} literature metadata.`
      })),
      summary: `Found ${Math.min(asArray(items).length, limit)} matching ${citationSourceMap[name]} records.`
    };
  }

  async function executeToolboxTool(name, normalizedArgs) {
    if (name === 'toolbox_plannotate') {
      const sequenceText = String(normalizedArgs?.sequence_text || '');
      if (!sequenceText.trim()) {
        return {
          items: [],
          citations: [],
          summary: 'No plain-text sequence was provided for pLannotate.'
        };
      }
      if (typeof annotateWithBlast !== 'function') {
        throw new Error('pLannotate executor is not configured.');
      }
      const result = await annotateWithBlast({
        sequenceText,
        topology: String(normalizedArgs?.topology || '') === 'linear' ? 'linear' : 'circular',
        detailed: normalizedArgs?.detailed === true,
        minIdentity: clamp(Number(normalizedArgs?.min_identity) || 85, 50, 100),
        minCoverage: clamp(Number(normalizedArgs?.min_coverage) || 0.25, 0.05, 1),
        minHitLength: Math.round(clamp(Number(normalizedArgs?.min_hit_length) || 24, 12, 2000)),
        maxHits: Math.round(clamp(Number(normalizedArgs?.max_hits) || 60, 1, 200)),
        recordName: cleanText(normalizedArgs?.record_name, 120) || 'plasmid'
      });
      const resultLimit = Math.round(clamp(Number(normalizedArgs?.max_hits) || 20, 1, 200));
      const items = asArray(result?.hits).slice(0, resultLimit).map((hit, index) => ({
        id: cleanText(`${hit?.sseqid || hit?.Feature || 'hit'}_${index + 1}`, 120),
        feature: cleanText(hit?.Feature, 180),
        type: cleanText(hit?.Type, 80),
        start: Number(hit?.qstart || 0) + 1,
        end: Number(hit?.qend || 0),
        strand: Number(hit?.sframe || 1) === -1 ? '-' : '+',
        identity_percent: Number(hit?.pident || 0),
        coverage_percent: Number(hit?.percmatch || 0),
        source_db: cleanText(hit?.db, 60),
        fragment: hit?.fragment === true
      }));
      return {
        items,
        citations: items.slice(0, 20).map((item) => ({
          source: 'plannotate',
          pointer: item.id || item.feature || 'hit',
          reason: 'Annotated pLannotate feature hit from plain-text sequence.'
        })),
        summary: `Annotated ${items.length} feature hit(s) from plain-text sequence${asArray(result?.warnings).length ? ` with ${asArray(result?.warnings).length} warning(s)` : ''}.`
      };
    }

    const customExecutor = toolboxExecutors[name];
    if (typeof customExecutor !== 'function') {
      throw new Error(`Tool executor is not configured for "${name}".`);
    }
    return customExecutor(normalizedArgs);
  }

  async function executePythonSandboxTool(normalizedArgs, options) {
    const managedResult = await managedPythonSandboxRuntime.execute(normalizedArgs, {
      parentRequestId: cleanText(options?.requestId, 160)
    });
    const sandboxResult = managedResult?.sandbox && typeof managedResult.sandbox === 'object'
      ? managedResult.sandbox
      : {};
    const item = {
      run_id: cleanText(sandboxResult.run_id, 120),
      status: cleanText(sandboxResult.status, 40),
      timeout_ms: Number(sandboxResult.timeout_ms) || 0,
      python_executable: cleanText(sandboxResult.python_executable, 140),
      exit_code: Number.isFinite(Number(sandboxResult.exit_code)) ? Number(sandboxResult.exit_code) : null,
      signal: cleanText(sandboxResult.signal, 40),
      timed_out: sandboxResult.timed_out === true,
      stdout: cleanText(sandboxResult.stdout, 12000),
      stderr: cleanText(sandboxResult.stderr, 12000),
      files_written: asArray(sandboxResult.files_written).map((value) => cleanText(value, 240)).filter(Boolean),
      readback_files: asArray(sandboxResult.readback_files).map((file) => ({
        path: cleanText(file?.path, 260),
        content: cleanText(file?.content, 12000),
        truncated: file?.truncated === true
      })),
      warnings: asArray(sandboxResult.warnings).map((value) => cleanText(value, 220)).filter(Boolean),
      python_task_type: cleanText(normalizedArgs?.task_type, 80),
      artifact_paths: asArray(normalizedArgs?.artifact_paths).map((value) => cleanText(value, 220)).filter(Boolean),
      persist_artifacts: normalizedArgs?.persist_artifacts === true,
      sub_agent: cloneJson(managedResult?.sub_agent, null)
    };
    return {
      payload: {
        items: [item],
        citations: [{
          source: 'python_sandbox',
          pointer: item.run_id || 'python_sandbox',
          reason: sandboxResult.ok
            ? 'Executed Python code in isolated sandbox.'
            : 'Python sandbox execution returned an error.'
        }],
        summary: cleanText(managedResult?.summary, 320)
          || cleanText(sandboxResult.summary, 320)
          || (sandboxResult.ok ? 'Python sandbox execution completed.' : 'Python sandbox execution failed.')
      },
      options: {
        ok: sandboxResult.ok === true,
        error: sandboxResult.ok
          ? ''
          : cleanText(sandboxResult.error || sandboxResult.stderr, 600)
      }
    };
  }

  async function executePaperDownloadTool(normalizedArgs, snapshot, allowWriteTools) {
    if (!allowWriteTools) {
      return {
        payload: {
          items: [],
          citations: [],
          summary: 'Write action blocked: explicit approval is required before downloading files.'
        },
        options: {
          ok: false,
          error: 'Write action blocked: explicit approval is required.'
        }
      };
    }
    const result = await paperDownloadRuntime.execute({
      action: 'download',
      linked_type: cleanText(normalizedArgs?.linked_type, 40).toLowerCase() === 'journal-club' ? 'journal-club' : 'project',
      linked_name: cleanText(normalizedArgs?.linked_name, 180) || 'Uncategorized',
      storage_path: cleanText(normalizedArgs?.storage_path, 1200) || cleanText(snapshot?.settings?.storagePath, 1200),
      paper_pdf_url: cleanText(normalizedArgs?.paper_pdf_url, 2200),
      paper_file_name: cleanText(normalizedArgs?.paper_file_name, 240),
      si_pdf_urls: asArray(normalizedArgs?.si_pdf_urls).map((value) => cleanText(value, 2200)).filter(Boolean),
      si_file_names: asArray(normalizedArgs?.si_file_names).map((value) => cleanText(value, 240)).filter(Boolean)
    });
    return {
      payload: {
        items: [cloneJson(result, {})],
        citations: [{
          source: 'paper_download',
          pointer: cleanText(result?.relative_path || result?.file_name || result?.download_id, 240),
          reason: result?.ok ? 'Paper download completed through paper download runtime.' : 'Paper download returned an error.'
        }],
        summary: cleanText(result?.summary || result?.error, 320) || 'Paper download completed.'
      },
      options: {
        ok: result?.ok === true,
        error: result?.ok === true ? '' : cleanText(result?.error, 600)
      }
    };
  }

  async function runAgentTool(name, args, rawSnapshot, options = {}) {
    const snapshot = rawSnapshot && typeof rawSnapshot === 'object'
      ? rawSnapshot
      : normalizeAgentSnapshot(rawSnapshot);
    const normalizedArgs = normalizeToolInvocationArgs(args);
    const query = cleanText(normalizedArgs?.query, 300);
    const requestedLimit = Number(normalizedArgs?.limit);
    const toolDefinition = AGENT_TOOL_DEFINITION_MAP.get(name);
    const schemaLimit = Number(toolDefinition?.input_schema?.properties?.limit?.maximum);
    const limitCap = Number.isFinite(schemaLimit) && schemaLimit > 0 ? schemaLimit : 25;
    const limit = clamp(Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 6, 1, limitCap);
    const allowWriteTools = options?.allowWriteTools === true;

    try {
      const searchPayload = await executeLocalSearchTool(name, normalizedArgs, snapshot, limit);
      if (searchPayload) {
        return buildAgentToolOutputEnvelope(name, normalizedArgs, searchPayload);
      }

      if ([
        'search_web',
        'search_uniprot',
        'search_pubmed',
        'search_crossref',
        'search_europe_pmc'
      ].includes(name)) {
        const literaturePayload = await executeLiteratureSearchTool(name, normalizedArgs, limit);
        return buildAgentToolOutputEnvelope(name, normalizedArgs, literaturePayload);
      }

      if (name === 'run_python_sandbox') {
        const pythonResult = await executePythonSandboxTool(normalizedArgs, options);
        return buildAgentToolOutputEnvelope(name, normalizedArgs, pythonResult.payload, pythonResult.options);
      }

      if (name === 'download_paper_pdf') {
        const paperDownloadResult = await executePaperDownloadTool(normalizedArgs, snapshot, allowWriteTools);
        return buildAgentToolOutputEnvelope(name, normalizedArgs, paperDownloadResult.payload, paperDownloadResult.options);
      }

      if (name.startsWith('toolbox_')) {
        const toolboxPayload = await executeToolboxTool(name, normalizedArgs, query);
        return buildAgentToolOutputEnvelope(name, normalizedArgs, toolboxPayload);
      }
    } catch (error) {
      return buildAgentToolOutputEnvelope(
        name,
        normalizedArgs,
        {
          items: [],
          citations: [],
          summary: `${name} failed.`
        },
        {
          ok: false,
          error: cleanText(error?.message || error, 600)
        }
      );
    }

    return buildAgentToolOutputEnvelope(
      name,
      normalizedArgs,
      {
        items: [],
        citations: [],
        summary: `Unknown tool: ${name}`
      },
      {
        ok: false,
        error: `Unknown tool: ${name}`
      }
    );
  }

  function resolveAgentToolDefinitions(selectedToolNames = []) {
    const names = asArray(selectedToolNames).map((name) => cleanText(name, 120)).filter(Boolean);
    if (!names.length) {
      return AGENT_TOOL_DEFINITIONS;
    }
    const picked = names
      .map((name) => AGENT_TOOL_DEFINITION_INPUT_MAP.get(name))
      .filter(Boolean);
    return picked.length ? picked : AGENT_TOOL_DEFINITIONS;
  }

  function buildAgentSystemPrompt(projectName, prompts) {
    const projectScope = projectName ? `Scoped project: ${projectName}.` : 'Scope: all projects.';
    const template = String(prompts?.agent?.systemPromptTemplate || '').trim() || DEFAULT_AGENT_SYSTEM_PROMPT;
    const basePrompt = renderPromptTemplate(template, { projectScope });
    if (!AGENT_TOOL_PROMPT) {
      return basePrompt;
    }
    return [
      basePrompt,
      AGENT_TOOL_PROMPT,
      `Tool output envelope: ${AGENT_TOOL_OUTPUT_SCHEMA_NAME}@${AGENT_TOOL_OUTPUT_SCHEMA_VERSION}.`,
      'Always send tool arguments as JSON and read tool results from result/items/citations/summary.'
    ].join('\n\n');
  }

  function buildAgentSynthesisPrompt(requiresApproval, prompts) {
    const template = String(prompts?.agent?.synthesisPromptTemplate || '').trim() || DEFAULT_AGENT_SYNTHESIS_PROMPT;
    return renderPromptTemplate(template, { writeIntent: requiresApproval ? 'yes' : 'no' });
  }

  function normalizeAgentOutput(raw, fallbackText) {
    const parsed = safeParseJson(raw, null);
    if (parsed && typeof parsed === 'object') {
      return {
        answer: cleanText(parsed.answer, 12000) || fallbackText || 'No answer generated.',
        confidence: Number.isFinite(parsed.confidence) ? clamp(Number(parsed.confidence), 0, 1) : 0.55,
        requiresApproval: parsed.requires_approval === true,
        proposedWriteActions: asArray(parsed.proposed_write_actions),
        citations: asArray(parsed.citations),
        decisionRecord: parsed.decision_record && typeof parsed.decision_record === 'object'
          ? parsed.decision_record
          : { assumptions: [], open_questions: [], verification_notes: [] }
      };
    }

    return {
      answer: fallbackText || 'No answer generated.',
      confidence: 0.55,
      requiresApproval: false,
      proposedWriteActions: [],
      citations: [],
      decisionRecord: {
        assumptions: [],
        open_questions: [],
        verification_notes: ['Structured synthesis was unavailable; returned plain-text fallback.']
      }
    };
  }

  function toPromptConversationTranscript(conversation) {
    const rows = asArray(conversation).map((item, index) => {
      const role = item?.role === 'assistant' ? 'assistant' : 'user';
      return `${index + 1}. ${role}: ${cleanText(item?.text, 2400)}`;
    }).filter(Boolean);
    return rows.length ? rows.join('\n') : 'No prior messages.';
  }

  return {
    AGENT_TOOL_METADATA,
    AGENT_TOOL_DEFINITIONS,
    AGENT_TOOL_OUTPUT_SCHEMA_NAME,
    AGENT_TOOL_OUTPUT_SCHEMA_VERSION,
    AGENT_TOOL_PROMPT,
    AGENT_RESULT_SCHEMA,
    DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE: DEFAULT_AGENT_SYSTEM_PROMPT,
    DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE: DEFAULT_AGENT_SYNTHESIS_PROMPT,
    buildStandardAgentToolOutputSchema,
    buildMainAgentToolMetadata,
    buildAgentToolPrompt,
    buildInventoryToolArgs,
    normalizeAgentSnapshot,
    normalizeAgentOutput,
    toPromptConversationTranscript,
    buildAgentSystemPrompt,
    buildAgentSynthesisPrompt,
    resolveAgentToolDefinitions,
    runAgentTool,
    pickTopMatches,
    normalizeQuery,
    scoreByQuery,
    normalizeJsonPayload,
    normalizeToolInvocationArgs,
    normalizeRoutingPayload
  };
}

module.exports = {
  AGENT_TOOL_OUTPUT_SCHEMA_NAME,
  AGENT_TOOL_OUTPUT_SCHEMA_VERSION,
  AGENT_RESULT_SCHEMA,
  DEFAULT_AGENT_SYSTEM_PROMPT_TEMPLATE,
  DEFAULT_AGENT_SYNTHESIS_PROMPT_TEMPLATE,
  createMainAgentToolRegistry
};
