# Agent JSON Schemas

This document consolidates the explicit input and output JSON-schema definitions used by `src/main/helpers/agent`.

Scope notes:

- Tool input schemas are centralized in `src/main/helpers/agent/tools/Tool-call.json`.
- Output schemas below are the explicit schema constants used for structured LLM payloads.
- Some runtime return envelopes are normalized in code but do not have a dedicated schema constant. Those are not invented here.

## Input schemas

Source: `src/main/helpers/agent/tools/Tool-call.json`

```json
{
  "$defs": {
    "inventory_search": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "normalized_query": {
          "type": "string"
        },
        "candidate_terms": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 10
        },
        "aliases": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 10
        },
        "search_mode": {
          "type": "string"
        }
      }
    },
    "parser_payload": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "primary_intent": {
          "type": "string"
        },
        "needs_clarification": {
          "type": "boolean"
        },
        "clarification_reason": {
          "type": "string"
        },
        "reasoning_summary": {
          "type": "string"
        },
        "entities": {
          "type": "object",
          "additionalProperties": true
        },
        "inventory_search": {
          "$ref": "#/$defs/inventory_search"
        },
        "protocol_candidates": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8
        }
      }
    },
    "protocol_step": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "instruction": {
          "type": "string"
        },
        "action": {
          "type": "string"
        },
        "placeholders": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "id": {
                "type": "string"
              },
              "name": {
                "type": "string"
              }
            }
          },
          "maxItems": 60
        }
      }
    },
    "protocol_record": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "purpose": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "aliases": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 12
        },
        "steps": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/protocol_step"
          },
          "maxItems": 160
        },
        "project_id": {
          "type": "string"
        },
        "project_name": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        }
      }
    },
    "project_record": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "resolution_source": {
          "type": "string"
        }
      }
    },
    "pending_values": {
      "type": "object",
      "additionalProperties": {
        "type": "string"
      }
    },
    "python_sandbox_file": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "path"
      ],
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 240
        },
        "content": {
          "type": "string"
        }
      }
    },
    "sub_agent_metadata": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "task_type": {
          "type": "string"
        },
        "parent_request_id": {
          "type": "string"
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 12
        }
      }
    },
    "memory_record": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string",
          "maxLength": 160
        },
        "category": {
          "type": "string",
          "maxLength": 120
        },
        "key": {
          "type": "string",
          "maxLength": 220
        },
        "summary": {
          "type": "string",
          "maxLength": 600
        },
        "value": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "array"
            },
            {
              "type": "string"
            },
            {
              "type": "number"
            },
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "project_name": {
          "type": "string",
          "maxLength": 220
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 12
        },
        "source": {
          "type": "string",
          "maxLength": 120
        }
      }
    },
    "paper_record": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "paper_title": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "abstract": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "full_text": {
          "type": "string"
        },
        "methods": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "object",
                "additionalProperties": true
              }
            ]
          },
          "maxItems": 40
        },
        "key_findings": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 20
        }
      }
    },
    "protocol_generation_step": {
      "type": "object",
      "additionalProperties": true,
      "properties": {
        "id": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "instruction": {
          "type": "string"
        },
        "action": {
          "type": "string"
        }
      }
    },
    "literature_source": {
      "type": "string",
      "enum": [
        "auto",
        "web",
        "pubmed",
        "crossref",
        "uniprot",
        "europe_pmc"
      ]
    }
  },
  "inventory-lookup": {
    "description": "Use this tool when the user needs to know whether a reagent, consumable, or personal inventory item exists locally, where it is stored, or how much is available. Prefer it for stock, location, container, quantity, and alias-based reagent lookup. Provide `query` for the main search text, and include `inventory_search` when the parser already extracted normalized candidate terms or search hints.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        },
        "inventory_search": {
          "$ref": "#/$defs/inventory_search"
        },
        "parser_payload": {
          "$ref": "#/$defs/parser_payload"
        }
      }
    }
  },
  "record-lookup": {
    "description": "Use this tool when the user is asking about stored lab records beyond raw inventory, such as projects, protocols, notebook entries, workflows, assays, gels, or linked historical context. Prefer it for 'what did we do last time', 'find the protocol record', or project-specific evidence retrieval. Provide `query` for the entity or topic to search, and pass `parser_payload` when parser entities can help narrow record matching.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        },
        "parser_payload": {
          "$ref": "#/$defs/parser_payload"
        }
      }
    }
  },
  "protocol-matching": {
    "description": "Use this tool to choose the best local protocol for a user-described activity before generating a notebook entry or protocol-driven draft. It ranks candidate protocols against parser hints, protocol names, aliases, purposes, and step overlap. Provide `protocol_candidates` when the parser or caller already identified likely names, and optionally provide `fallback_protocol` only when there is one specific protocol record that should be considered if ranked candidates are weak.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "protocol_candidates": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 5
        },
        "fallback_protocol": {
          "$ref": "#/$defs/protocol_record"
        }
      }
    }
  },
  "notebook-generation": {
    "description": "Use this tool after protocol selection to generate a structured notebook draft from a selected protocol, project context, and known placeholder values. It fills placeholders conservatively, keeps unresolved placeholders visible, and can return follow-up questions when key details are missing. Provide `selected_protocol` when already known, `project` when a project has been resolved, and `pending_values` for explicit user-supplied placeholder answers.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "selected_protocol": {
          "$ref": "#/$defs/protocol_record"
        },
        "project": {
          "$ref": "#/$defs/project_record"
        },
        "pending_values": {
          "$ref": "#/$defs/pending_values"
        }
      }
    }
  },
  "notebook-draft": {
    "description": "Use this tool to propose a likely next experiment and prepare a planned biology notebook draft for explicit confirmation. It should prefer workflow-downstream experiments and recent executed notebook progress, tolerate unresolved placeholders, and return a confirm-before-save draft instead of auto-creating the page.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "project": {
          "$ref": "#/$defs/project_record"
        },
        "workflow_id": {
          "type": "string",
          "maxLength": 160
        },
        "protocol_candidates": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 5
        }
      }
    }
  },
  "python-sandbox": {
    "description": "Use this tool when the agent needs to write and run Python code to compute, transform, inspect, or generate artifacts in a controlled sandbox. The agent should supply complete runnable code in `code`, optionally stage input files in `files`, and request outputs through `readback_paths`. Prefer this for deterministic analysis or file generation, not for calling local lab records that already have dedicated lookup tools.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "code"
      ],
      "properties": {
        "code": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40000
        },
        "timeout_ms": {
          "type": "integer",
          "minimum": 500,
          "maximum": 15000
        },
        "files": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/python_sandbox_file"
          },
          "maxItems": 32
        },
        "readback_paths": {
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240
          },
          "maxItems": 20
        }
      }
    }
  },
  "sub-agent": {
    "description": "Use this tool to manage helper sub-agent sessions for multi-step or delegated work that should persist across turns. `create` starts a managed sub-agent with a system prompt and initial message, `message` sends a follow-up, `get` inspects one session, `list` shows active sessions, and `delete` removes a session. Use it when the agent needs a reusable delegated workspace rather than a one-shot tool execution.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "create",
            "message",
            "delete",
            "get",
            "list"
          ]
        },
        "agent_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "name": {
          "type": "string",
          "maxLength": 160
        },
        "system_prompt": {
          "type": "string",
          "maxLength": 40000
        },
        "message": {
          "type": "string",
          "maxLength": 40000
        },
        "reason": {
          "type": "string",
          "maxLength": 240
        },
        "metadata": {
          "$ref": "#/$defs/sub_agent_metadata"
        }
      }
    }
  },
  "memory": {
    "description": "Use this tool to manage sparse long-term user memory across sessions. `recall` searches previously stored preferences, project names, workflow habits, or other stable context. `remember` stores or updates a structured memory record with `key`, `summary`, and optional `value`. `forget` removes matching memory entries. `list` enumerates stored memory, optionally filtered by category, project, or tags. Use it only for durable facts or preferences, not for replaying whole conversations.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "action"
      ],
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "recall",
            "remember",
            "forget",
            "list"
          ]
        },
        "id": {
          "type": "string",
          "maxLength": 160
        },
        "query": {
          "type": "string",
          "maxLength": 320
        },
        "category": {
          "type": "string",
          "maxLength": 120
        },
        "key": {
          "type": "string",
          "maxLength": 220
        },
        "summary": {
          "type": "string",
          "maxLength": 600
        },
        "value": {
          "anyOf": [
            {
              "type": "object"
            },
            {
              "type": "array"
            },
            {
              "type": "string"
            },
            {
              "type": "number"
            },
            {
              "type": "boolean"
            },
            {
              "type": "null"
            }
          ]
        },
        "project_name": {
          "type": "string",
          "maxLength": 220
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 12
        },
        "source": {
          "type": "string",
          "maxLength": 120
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "record": {
          "$ref": "#/$defs/memory_record"
        }
      }
    }
  },
  "literature-search": {
    "description": "Use this tool when the user wants papers, references, recent literature, external evidence, or protein knowledgebase entries rather than a summary of one already-identified paper. Provide `query` when possible. Use `source` for one source, `sources` for an explicit multi-source batch, or leave them empty for scholarly-first auto mode. `preferred_literature_source` biases auto mode toward one literature database first, and `preferred_web_source` prefers one web domain when web results are used. Auto mode searches literature sources first and only falls back to generic web search when those sources do not produce results. Prefer `pubmed`, `crossref`, and `europe_pmc` for papers, `uniprot` for protein/gene knowledge, and `web` for generic recency-aware external search.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "maxLength": 600
        },
        "topic": {
          "type": "string",
          "maxLength": 240
        },
        "message": {
          "type": "string",
          "maxLength": 1200
        },
        "source": {
          "$ref": "#/$defs/literature_source"
        },
        "sources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/literature_source"
          },
          "maxItems": 6
        },
        "preferred_literature_source": {
          "$ref": "#/$defs/literature_source"
        },
        "preferred_web_source": {
          "type": "string",
          "maxLength": 240
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 25
        },
        "max_per_source": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10
        },
        "allow_web_fallback": {
          "type": "boolean"
        },
        "prefer_recent": {
          "type": "boolean"
        },
        "parser_payload": {
          "$ref": "#/$defs/parser_payload"
        }
      }
    }
  },
  "paper-download": {
    "description": "Use this tool when the user wants a paper PDF downloaded into app storage. `download` performs the full flow in one call, first extracting candidate PDF URLs from the provided fields and then streaming the PDF with progress tracking. `start` begins the download in the background so the caller can poll with `status`. When direct bot fetching is blocked, the tool should fall back to a browser-assisted session, optionally simulate a one-click download, let the user click the site download button if needed, and close the browser session after the file is saved.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "download",
            "start",
            "status"
          ]
        },
        "download_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "paper_pdf_url": {
          "type": "string"
        },
        "pdf_url": {
          "type": "string"
        },
        "page_url": {
          "type": "string"
        },
        "candidate_urls": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 24
        },
        "page_html": {
          "type": "string",
          "maxLength": 400000
        },
        "message": {
          "type": "string",
          "maxLength": 12000
        },
        "paper_title": {
          "type": "string"
        },
        "file_name": {
          "type": "string",
          "maxLength": 240
        },
        "linked_type": {
          "type": "string",
          "maxLength": 80
        },
        "linked_name": {
          "type": "string",
          "maxLength": 220
        },
        "storage_path": {
          "type": "string",
          "maxLength": 2000
        },
        "timeout_ms": {
          "type": "integer",
          "minimum": 1000,
          "maximum": 120000
        },
        "use_browser_fallback": {
          "type": "boolean"
        },
        "simulate_one_click": {
          "type": "boolean"
        },
        "request_headers": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        }
      }
    }
  },
  "paper-analysis": {
    "description": "Use this tool when the user asks to summarize a paper, extract the important findings, explain methods, or pull a protocol candidate out of paper text. Provide the richest available paper context through `paper`, `paper_summary`, `paper_abstract`, or `paper_text`. Set `extract_protocol` when the user explicitly wants procedural extraction, and set `generate_protocol` when the extracted methods should also be converted into an import-ready protocol JSON record.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "paper": {
          "$ref": "#/$defs/paper_record"
        },
        "paper_title": {
          "type": "string"
        },
        "paper_summary": {
          "type": "string"
        },
        "paper_abstract": {
          "type": "string"
        },
        "paper_text": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "extract_protocol": {
          "type": "boolean"
        },
        "generate_protocol": {
          "type": "boolean"
        },
        "protocol_title_hint": {
          "type": "string"
        }
      }
    }
  },
  "protocol-generation": {
    "description": "Use this tool when the agent already has method evidence and needs to synthesize it into the app's import-ready protocol JSON format. It is best for converting extracted paper methods, structured step seeds, or summarized procedures into a protocol with materials, steps, placeholders, timestamps, and troubleshooting text. Provide `method_text`, `steps`, and `materials` when available, plus `title` or `protocol_title_hint` to guide the resulting protocol name.",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "title": {
          "type": "string"
        },
        "protocol_title_hint": {
          "type": "string"
        },
        "purpose": {
          "type": "string"
        },
        "method_text": {
          "type": "string"
        },
        "source_paper_title": {
          "type": "string"
        },
        "source_summary": {
          "type": "string"
        },
        "message": {
          "type": "string"
        },
        "materials": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 40
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "$ref": "#/$defs/protocol_generation_step"
              }
            ]
          },
          "maxItems": 40
        }
      }
    }
  }
}
```

## Output schemas

### Intent parser

Source: `src/main/helpers/agent/intent/agent-intent-parser.js`

#### `INTENT_PARSER_RESPONSE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "primary_intent",
    "needs_clarification",
    "clarification_reason",
    "entities",
    "inventory_search",
    "protocol_candidates",
    "reasoning_summary"
  ],
  "properties": {
    "primary_intent": {
      "type": "string",
      "enum": [
        "protocol_to_notebook",
        "notebook_draft",
        "inventory_lookup",
        "record_lookup",
        "project_science_question",
        "general_science_question",
        "paper_analysis",
        "literature_search",
        "result_analysis",
        "mixed_request",
        "unclear"
      ]
    },
    "needs_clarification": {
      "type": "boolean"
    },
    "clarification_reason": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "entities": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "activity_type",
        "project_name",
        "protocol_name",
        "protein_name",
        "compound_name",
        "inventory_item",
        "cell_line",
        "paper_title",
        "workflow_step",
        "requested_output"
      ],
      "properties": {
        "activity_type": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "project_name": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "protocol_name": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "protein_name": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "compound_name": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "inventory_item": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "cell_line": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "paper_title": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "workflow_step": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "requested_output": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "inventory_search": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "normalized_query",
        "candidate_terms",
        "aliases",
        "search_mode"
      ],
      "properties": {
        "normalized_query": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "candidate_terms": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "aliases": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "search_mode": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "exact_then_alias_then_fuzzy",
                "exact_only",
                "alias_then_fuzzy"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "protocol_candidates": {
      "type": "array",
      "maxItems": 3,
      "items": {
        "type": "string"
      }
    },
    "reasoning_summary": {
      "type": "string"
    }
  }
}
```

### Deep research

Source group:

- `src/main/helpers/agent/deep-research/step-1-clarify-question.js`
- `src/main/helpers/agent/deep-research/step-2-ask-targeted-follow-up.js`
- `src/main/helpers/agent/deep-research/step-3-draft-research-plan.js`
- `src/main/helpers/agent/deep-research/step-4-execute-plan.js`
- `src/main/helpers/agent/deep-research/step-5-assemble-final-answer.js`
- `src/main/helpers/agent/deep-research/sub-agent-usage.js`

#### `CLARIFY_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "research_goal",
    "scope_boundaries",
    "missing_constraints",
    "expected_output_style",
    "request_type",
    "should_ask_follow_up",
    "follow_up_focus",
    "time_sensitive"
  ],
  "properties": {
    "research_goal": {
      "type": "string"
    },
    "scope_boundaries": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "missing_constraints": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "expected_output_style": {
      "type": "string"
    },
    "request_type": {
      "type": "string"
    },
    "should_ask_follow_up": {
      "type": "boolean"
    },
    "follow_up_focus": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "time_sensitive": {
      "type": "boolean"
    }
  }
}
```

#### `FOLLOW_UP_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "needs_follow_up",
    "question",
    "reason"
  ],
  "properties": {
    "needs_follow_up": {
      "type": "boolean"
    },
    "question": {
      "type": "string"
    },
    "reason": {
      "type": "string"
    },
    "blocking_field": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

#### `RESEARCH_PLAN_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "goal",
    "key_subquestions",
    "search_directions",
    "evidence_types_needed",
    "possible_tools_or_sources",
    "risks_or_uncertainty_areas",
    "synthesis_checkpoints",
    "answer_sections",
    "success_criteria"
  ],
  "properties": {
    "goal": {
      "type": "string"
    },
    "key_subquestions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "search_directions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "evidence_types_needed": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "possible_tools_or_sources": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "risks_or_uncertainty_areas": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "synthesis_checkpoints": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "answer_sections": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "success_criteria": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

#### `NEXT_ACTION_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "action",
    "reason",
    "assistant_note"
  ],
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        "tool",
        "answer"
      ]
    },
    "reason": {
      "type": "string"
    },
    "assistant_note": {
      "type": "string"
    },
    "tool_name": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "arguments": {
      "type": "object"
    },
    "answer_fragment": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

#### `OUTLINE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "sections"
  ],
  "properties": {
    "sections": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "title",
          "objective"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "title": {
            "type": "string"
          },
          "objective": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

#### `SECTION_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "section_text"
  ],
  "properties": {
    "section_text": {
      "type": "string"
    }
  }
}
```

#### `COMPLETION_CHECK_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "satisfied",
    "reason",
    "missing_requirements",
    "should_continue",
    "can_answer_with_limitations"
  ],
  "properties": {
    "satisfied": {
      "type": "boolean"
    },
    "reason": {
      "type": "string"
    },
    "missing_requirements": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "should_continue": {
      "type": "boolean"
    },
    "can_answer_with_limitations": {
      "type": "boolean"
    },
    "next_action": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "tool_name": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "query": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "reason": {
              "type": "string"
            }
          }
        }
      ]
    },
    "delegate_sub_agent": {
      "type": "boolean"
    }
  }
}
```

### Science runtime

Source group:

- `src/main/helpers/agent/runtime/agent-science-input-clarification.js`
- `src/main/helpers/agent/runtime/agent-science-loop-exit-criteria.js`
- `src/main/helpers/agent/runtime/agent-science-loop-exit-judge.js`
- `src/main/helpers/agent/runtime/agent-science-final-synthesis.js`
- `src/main/helpers/agent/runtime/science-reasoning-loop/thinking-trace.js`
- `src/main/helpers/agent/runtime/agent-science-reasoning-loop.js`

#### `SCIENCE_INPUT_CLARIFICATION_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "clarified_input",
    "analysis_goal",
    "important_constraints",
    "missing_information",
    "should_ask_follow_up",
    "follow_up_question",
    "follow_up_reason"
  ],
  "properties": {
    "clarified_input": {
      "type": "string"
    },
    "analysis_goal": {
      "type": "string"
    },
    "important_constraints": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "missing_information": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "should_ask_follow_up": {
      "type": "boolean"
    },
    "follow_up_question": {
      "type": "string"
    },
    "follow_up_reason": {
      "type": "string"
    }
  }
}
```

#### `SCIENCE_LOOP_EXIT_CRITERIA_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "objective_summary",
    "exit_conditions",
    "required_evidence",
    "continue_when",
    "can_exit_with_limitations_when",
    "preferred_next_tools",
    "reasoning_notes"
  ],
  "properties": {
    "objective_summary": {
      "type": "string"
    },
    "exit_conditions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "required_evidence": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "continue_when": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "can_exit_with_limitations_when": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "preferred_next_tools": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "reasoning_notes": {
      "type": "string"
    }
  }
}
```

#### `SCIENCE_LOOP_EXIT_JUDGEMENT_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "satisfied",
    "reason",
    "missing_requirements",
    "should_continue",
    "next_tool_hint",
    "can_answer_with_limitations"
  ],
  "properties": {
    "satisfied": {
      "type": "boolean"
    },
    "reason": {
      "type": "string"
    },
    "missing_requirements": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "should_continue": {
      "type": "boolean"
    },
    "next_tool_hint": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "tool_name",
            "reason"
          ],
          "properties": {
            "tool_name": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "query": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "reason": {
              "type": "string"
            }
          }
        }
      ]
    },
    "can_answer_with_limitations": {
      "type": "boolean"
    }
  }
}
```

#### `SCIENCE_FINAL_SYNTHESIS_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "answer",
    "confidence",
    "decision_record",
    "follow_up_questions"
  ],
  "properties": {
    "answer": {
      "type": "string"
    },
    "confidence": {
      "type": "number",
      "minimum": 0,
      "maximum": 1
    },
    "decision_record": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "assumptions",
        "open_questions",
        "verification_notes"
      ],
      "properties": {
        "assumptions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "open_questions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "verification_notes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "follow_up_questions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    }
  }
}
```

#### `SCIENCE_THINKING_TRACE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "intent_parse_question",
    "question_clarifier",
    "criteria_generate",
    "tool_rounds",
    "pre_synthesize_answer",
    "judge",
    "final_synthesize",
    "final_synthesized_question"
  ],
  "properties": {
    "intent_parse_question": {
      "type": "string"
    },
    "question_clarifier": {
      "type": "string"
    },
    "criteria_generate": {
      "type": "string"
    },
    "tool_rounds": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "round",
          "tool_selection",
          "tool_call",
          "tool_results"
        ],
        "properties": {
          "round": {
            "type": "integer"
          },
          "tool_selection": {
            "type": "string"
          },
          "tool_call": {
            "type": "string"
          },
          "tool_results": {
            "type": "string"
          }
        }
      }
    },
    "pre_synthesize_answer": {
      "type": "string"
    },
    "judge": {
      "type": "string"
    },
    "final_synthesize": {
      "type": "string"
    },
    "final_synthesized_question": {
      "type": "string"
    }
  }
}
```

#### `SCIENCE_RESULT_EVALUATION_SCHEMA`

Note: this currently matches the exit-judgement shape used in the reasoning loop.

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "satisfied",
    "reason",
    "missing_requirements",
    "should_continue",
    "next_tool_hint",
    "can_answer_with_limitations"
  ],
  "properties": {
    "satisfied": {
      "type": "boolean"
    },
    "reason": {
      "type": "string"
    },
    "missing_requirements": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "should_continue": {
      "type": "boolean"
    },
    "next_tool_hint": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "tool_name",
            "reason"
          ],
          "properties": {
            "tool_name": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "query": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            },
            "reason": {
              "type": "string"
            }
          }
        }
      ]
    },
    "can_answer_with_limitations": {
      "type": "boolean"
    }
  }
}
```

### Tool-specific structured outputs

Source group:

- `src/main/helpers/agent/tools/agent-notebook-draft.js`
- `src/main/helpers/agent/tools/agent-notebook-generation.js`
- `src/main/helpers/agent/tools/agent-protocol-matching.js`
- `src/main/helpers/agent/tools/agent-protocol-generation.js`
- `src/main/helpers/agent/tools/agent-paper-analysis.js`

#### `NOTEBOOK_DRAFT_SELECTION_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "selected_candidate_id",
    "title",
    "purpose",
    "rationale",
    "planned_materials",
    "checkpoints"
  ],
  "properties": {
    "selected_candidate_id": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "title": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "purpose": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "rationale": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "planned_materials": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "maxItems": 10
    },
    "checkpoints": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "maxItems": 10
    }
  }
}
```

#### `PROTOCOL_NOTEBOOK_FILL_RESPONSE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "filled_values",
    "missing_placeholders",
    "follow_up_questions",
    "result_summary"
  ],
  "properties": {
    "filled_values": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "placeholder_key",
          "value",
          "source"
        ],
        "properties": {
          "placeholder_key": {
            "type": "string"
          },
          "value": {
            "type": "string"
          },
          "source": {
            "type": "string"
          }
        }
      }
    },
    "missing_placeholders": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "placeholder_key",
          "reason"
        ],
        "properties": {
          "placeholder_key": {
            "type": "string"
          },
          "reason": {
            "type": "string"
          }
        }
      }
    },
    "follow_up_questions": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "result_summary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

#### `PROTOCOL_TIEBREAK_RESPONSE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "selected_protocol_id",
    "selected_protocol_name",
    "rationale"
  ],
  "properties": {
    "selected_protocol_id": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "selected_protocol_name": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "rationale": {
      "type": "string"
    }
  }
}
```

#### `PROTOCOL_GENERATION_RESPONSE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "protocol",
    "result_summary"
  ],
  "properties": {
    "protocol": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "name",
        "purpose",
        "materials",
        "steps",
        "troubleshooting"
      ],
      "properties": {
        "name": {
          "type": "string"
        },
        "purpose": {
          "type": "string"
        },
        "materials": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string"
              },
              {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "text"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  },
                  "instruction": {
                    "type": "string"
                  },
                  "action": {
                    "type": "string"
                  },
                  "step_number": {
                    "type": "integer"
                  },
                  "placeholders": {
                    "type": "array",
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "required": [
                        "name"
                      ],
                      "properties": {
                        "id": {
                          "type": "string"
                        },
                        "name": {
                          "type": "string"
                        }
                      }
                    }
                  }
                }
              }
            ]
          }
        },
        "troubleshooting": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            },
            {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                      "problem": {
                        "type": "string"
                      },
                      "possible_cause": {
                        "type": "string"
                      },
                      "possibleCause": {
                        "type": "string"
                      },
                      "solution": {
                        "type": "string"
                      }
                    }
                  }
                ]
              }
            }
          ]
        }
      }
    },
    "result_summary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```

#### `PAPER_ANALYSIS_RESPONSE_SCHEMA`

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": [
    "brief_summary",
    "key_findings",
    "method_overview",
    "protocol_candidate",
    "result_summary"
  ],
  "properties": {
    "brief_summary": {
      "type": "string"
    },
    "key_findings": {
      "type": "array",
      "items": {
        "type": "string"
      }
    },
    "method_overview": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    },
    "protocol_candidate": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "title",
            "purpose",
            "method_text",
            "materials",
            "steps",
            "notes"
          ],
          "properties": {
            "title": {
              "type": "string"
            },
            "purpose": {
              "type": "string"
            },
            "method_text": {
              "type": "string"
            },
            "materials": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "steps": {
              "type": "array",
              "items": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "object",
                    "additionalProperties": true,
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "text": {
                        "type": "string"
                      }
                    }
                  }
                ]
              }
            },
            "notes": {
              "anyOf": [
                {
                  "type": "string"
                },
                {
                  "type": "null"
                }
              ]
            }
          }
        }
      ]
    },
    "result_summary": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ]
    }
  }
}
```
