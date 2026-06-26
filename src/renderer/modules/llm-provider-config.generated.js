/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */
/* Source config: config/llm-providers.json */

const RAW_LLM_PROVIDER_CONFIGS = [
  {
    "id": "openai",
    "key": "OPENAI",
    "label": "OpenAI",
    "defaultEndpoint": "https://api.openai.com/v1/responses",
    "defaultModel": "gpt-5-mini",
    "modelPlaceholder": "e.g. gpt-5-mini",
    "apiKeyPlaceholder": "sk-...",
    "requiresApiKey": true,
    "endpointHints": [
      "openai.com",
      "/openai/"
    ],
    "models": [
      {
        "id": "gpt-5.2",
        "label": "GPT-5.2",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-5.1",
        "label": "GPT-5.1",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-5",
        "label": "GPT-5",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-5-mini",
        "label": "GPT-5 mini",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-5-nano",
        "label": "GPT-5 nano",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-5-pro",
        "label": "GPT-5 pro",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-4.1",
        "label": "GPT-4.1",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-4.1-mini",
        "label": "GPT-4.1 mini",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gpt-4.1-nano",
        "label": "GPT-4.1 nano",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      }
    ]
  },
  {
    "id": "gemini",
    "key": "GEMINI",
    "label": "Gemini",
    "defaultEndpoint": "https://generativelanguage.googleapis.com/v1beta",
    "defaultModel": "gemini-2.5-flash",
    "modelPlaceholder": "e.g. gemini-2.5-pro",
    "apiKeyPlaceholder": "sk-...",
    "requiresApiKey": true,
    "endpointHints": [
      "generativelanguage.googleapis.com",
      "ai.google"
    ],
    "models": [
      {
        "id": "gemini-2.5-pro",
        "label": "Gemini 2.5 Pro",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gemini-2.5-flash",
        "label": "Gemini 2.5 Flash",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "gemini-2.5-flash-lite",
        "label": "Gemini 2.5 Flash-Lite",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      }
    ]
  },
  {
    "id": "claude",
    "key": "CLAUDE",
    "label": "Claude",
    "defaultEndpoint": "https://api.anthropic.com/v1/messages",
    "defaultModel": "claude-sonnet-4-5",
    "modelPlaceholder": "e.g. claude-sonnet-4-5",
    "apiKeyPlaceholder": "sk-...",
    "requiresApiKey": true,
    "endpointHints": [
      "anthropic.com"
    ],
    "models": [
      {
        "id": "claude-opus-4-1",
        "label": "Claude Opus 4.1",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-opus-4",
        "label": "Claude Opus 4",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-sonnet-4-5",
        "label": "Claude Sonnet 4.5",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-sonnet-4",
        "label": "Claude Sonnet 4",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-3-7-sonnet-latest",
        "label": "Claude 3.7 Sonnet (latest)",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-3-5-sonnet-latest",
        "label": "Claude 3.5 Sonnet (latest)",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "claude-3-5-haiku-latest",
        "label": "Claude 3.5 Haiku (latest)",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      }
    ]
  },
  {
    "id": "deepseek",
    "key": "DEEPSEEK",
    "label": "DeepSeek",
    "defaultEndpoint": "https://api.deepseek.com",
    "defaultModel": "deepseek-v4-flash",
    "modelPlaceholder": "e.g. deepseek-v4-pro",
    "apiKeyPlaceholder": "DeepSeek API key",
    "requiresApiKey": true,
    "endpointHints": [
      "api.deepseek.com",
      "deepseek.com"
    ],
    "models": [
      {
        "id": "deepseek-v4-flash",
        "label": "DeepSeek V4 Flash",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "deepseek-v4-pro",
        "label": "DeepSeek V4 Pro",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "deepseek-chat",
        "label": "DeepSeek Chat (legacy)",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      },
      {
        "id": "deepseek-reasoner",
        "label": "DeepSeek Reasoner (legacy)",
        "reasoningEfforts": [],
        "defaultReasoningEffort": ""
      }
    ]
  },
  {
    "id": "codex",
    "key": "CODEX",
    "label": "Codex Agent (CLI)",
    "defaultEndpoint": "",
    "defaultModel": "",
    "modelPlaceholder": "optional, e.g. gpt-5.4",
    "apiKeyPlaceholder": "Handled by `codex login`",
    "requiresApiKey": false,
    "endpointHints": [],
    "models": [
      {
        "id": "gpt-5.4",
        "label": "gpt-5.4",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.4-mini",
        "label": "gpt-5.4-mini",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.3-codex",
        "label": "gpt-5.3-codex",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.2-codex",
        "label": "gpt-5.2-codex",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.2",
        "label": "gpt-5.2",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.1-codex-max",
        "label": "gpt-5.1-codex-max",
        "reasoningEfforts": [
          "low",
          "medium",
          "high",
          "xhigh"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.1-codex",
        "label": "gpt-5.1-codex",
        "reasoningEfforts": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.1",
        "label": "gpt-5.1",
        "reasoningEfforts": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5-codex",
        "label": "gpt-5-codex",
        "reasoningEfforts": [
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5",
        "label": "gpt-5",
        "reasoningEfforts": [
          "minimal",
          "low",
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5.1-codex-mini",
        "label": "gpt-5.1-codex-mini",
        "reasoningEfforts": [
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      },
      {
        "id": "gpt-5-codex-mini",
        "label": "gpt-5-codex-mini",
        "reasoningEfforts": [
          "medium",
          "high"
        ],
        "defaultReasoningEffort": "medium"
      }
    ]
  }
];

const LLM_PROVIDER_CONFIGS = Object.freeze(
  RAW_LLM_PROVIDER_CONFIGS.map((provider) => Object.freeze({
    ...provider,
    endpointHints: Object.freeze(Array.isArray(provider.endpointHints) ? [...provider.endpointHints] : []),
    models: Object.freeze(
      (Array.isArray(provider.models) ? provider.models : []).map((model) => Object.freeze({
        ...model,
        reasoningEfforts: Object.freeze(Array.isArray(model.reasoningEfforts) ? [...model.reasoningEfforts] : [])
      }))
    )
  }))
);

const LLM_PROVIDER_OPTIONS = Object.freeze(
  LLM_PROVIDER_CONFIGS.map((provider) => Object.freeze({
    value: provider.id,
    label: provider.label
  }))
);

const LLM_MODEL_OPTIONS_BY_PROVIDER = Object.freeze(
  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [
    provider.id,
    Object.freeze(provider.models.map((model) => Object.freeze({
      value: model.id,
      label: model.label
    })))
  ]))
);

const PROVIDER_CONFIG_BY_ID = Object.freeze(
  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider]))
);

const MODEL_CONFIG_BY_PROVIDER_ID = Object.freeze(
  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [
    provider.id,
    Object.freeze(Object.fromEntries(provider.models.map((model) => [model.id, model])))
  ]))
);

const LLM_PROVIDERS = Object.freeze({
  OPENAI: "openai",
  GEMINI: "gemini",
  CLAUDE: "claude",
  DEEPSEEK: "deepseek",
  CODEX: "codex"
});

const ALLOW_API_AGENT = false;
const DEFAULT_LLM_PROVIDER = "openai";
const DEFAULT_AGENT_LLM_PROVIDER = LLM_PROVIDERS.CODEX || DEFAULT_LLM_PROVIDER;
const AGENT_LLM_PROVIDER_OPTIONS = Object.freeze(
  ALLOW_API_AGENT
    ? [...LLM_PROVIDER_OPTIONS]
    : LLM_PROVIDER_OPTIONS.filter((provider) => provider.value === DEFAULT_AGENT_LLM_PROVIDER)
);
const DEFAULT_LLM_ENDPOINTS = Object.freeze(
  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider.defaultEndpoint]))
);
const DEFAULT_AGENT_MODELS = Object.freeze(
  Object.fromEntries(LLM_PROVIDER_CONFIGS.map((provider) => [provider.id, provider.defaultModel]))
);

function inferLlmProviderFromEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  if (value.startsWith('codex://') || value.includes('codex cli') || value.includes('codex agent')) {
    return LLM_PROVIDERS.CODEX;
  }
  for (const provider of LLM_PROVIDER_CONFIGS) {
    const hints = Array.isArray(provider.endpointHints) ? provider.endpointHints : [];
    if (hints.some((hint) => value.includes(String(hint || '').trim().toLowerCase()))) {
      return provider.id;
    }
  }
  return '';
}

function normalizeLlmProvider(provider, endpoint = '') {
  const clean = String(provider || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PROVIDER_CONFIG_BY_ID, clean)) {
    return clean;
  }
  return inferLlmProviderFromEndpoint(endpoint) || DEFAULT_LLM_PROVIDER;
}

function normalizeAgentLlmProvider(provider, endpoint = '') {
  const resolved = normalizeLlmProvider(provider, endpoint);
  if (ALLOW_API_AGENT || resolved === LLM_PROVIDERS.CODEX) {
    return resolved;
  }
  return DEFAULT_AGENT_LLM_PROVIDER;
}

function getLlmProviderConfig(provider, endpoint = '') {
  const resolved = normalizeLlmProvider(provider, endpoint);
  return PROVIDER_CONFIG_BY_ID[resolved] || PROVIDER_CONFIG_BY_ID[DEFAULT_LLM_PROVIDER] || null;
}

function getLlmProviderModelOptions(provider, endpoint = '') {
  const resolved = getLlmProviderConfig(provider, endpoint)?.id || DEFAULT_LLM_PROVIDER;
  return LLM_MODEL_OPTIONS_BY_PROVIDER[resolved] || Object.freeze([]);
}

function getLlmModelConfig(provider, model, endpoint = '') {
  const resolvedProvider = getLlmProviderConfig(provider, endpoint)?.id || DEFAULT_LLM_PROVIDER;
  const resolvedModel = String(model || '').trim();
  if (!resolvedModel) {
    return null;
  }
  return MODEL_CONFIG_BY_PROVIDER_ID[resolvedProvider]?.[resolvedModel] || null;
}

function defaultLlmEndpointForProvider(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.defaultEndpoint || '';
}

function defaultAgentModelForProvider(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.defaultModel || '';
}

function defaultReasoningEffortForModel(provider, model, endpoint = '') {
  return getLlmModelConfig(provider, model, endpoint)?.defaultReasoningEffort || '';
}

function normalizeReasoningEffort(provider, model, reasoningEffort, endpoint = '') {
  const config = getLlmModelConfig(provider, model, endpoint);
  const clean = String(reasoningEffort || '').trim().toLowerCase();
  const supported = Array.isArray(config?.reasoningEfforts) ? config.reasoningEfforts : [];
  if (!supported.length) {
    return clean;
  }
  if (clean && supported.includes(clean)) {
    return clean;
  }
  return '';
}

function providerLabelForId(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.label || '';
}

function modelPlaceholderForProvider(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.modelPlaceholder || '';
}

function apiKeyPlaceholderForProvider(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.apiKeyPlaceholder || '';
}

function providerRequiresApiKey(provider, endpoint = '') {
  return getLlmProviderConfig(provider, endpoint)?.requiresApiKey !== false;
}

export {
  LLM_PROVIDER_CONFIGS,
  LLM_PROVIDER_OPTIONS,
  LLM_MODEL_OPTIONS_BY_PROVIDER,
  PROVIDER_CONFIG_BY_ID,
  MODEL_CONFIG_BY_PROVIDER_ID,
  LLM_PROVIDERS,
  ALLOW_API_AGENT,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_AGENT_LLM_PROVIDER,
  AGENT_LLM_PROVIDER_OPTIONS,
  DEFAULT_LLM_ENDPOINTS,
  DEFAULT_AGENT_MODELS,
  inferLlmProviderFromEndpoint,
  normalizeLlmProvider,
  normalizeAgentLlmProvider,
  getLlmProviderConfig,
  getLlmProviderModelOptions,
  getLlmModelConfig,
  defaultLlmEndpointForProvider,
  defaultAgentModelForProvider,
  defaultReasoningEffortForModel,
  normalizeReasoningEffort,
  providerLabelForId,
  modelPlaceholderForProvider,
  apiKeyPlaceholderForProvider,
  providerRequiresApiKey
};
