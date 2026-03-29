# Module Map

This file is a quick lookup index for `src/main/helpers/agent`.

## Legend

- `Main path`: directly involved in the current `agent:chat` controller flow
- `Support`: consumed by a main-path module but not called by IPC directly
- `Secondary`: real runtime/helper, but not clearly wired into the active controller path

## Root and intent

| File | Status | Notes |
| --- | --- | --- |
| `Readme.md` | Secondary | placeholder file in the source folder |
| `intent/agent-intent.json` | Support | intent catalog consumed by the parser |
| `intent/agent-intent-parser.js` | Main path | parser prompt builder, payload normalization, schema constants |

## Shared

| File | Status | Notes |
| --- | --- | --- |
| `shared/agent-llm-utils.js` | Support | backoff, provider adapters, structured JSON request helper |
| `shared/agent-controller-utils.js` | Main path | provider/model resolution, trace context, parser request, log formatting |
| `shared/agent-observability.js` | Main path | lifecycle recorder, replay, failure classification |
| `shared/agent-runtime-registry.js` | Support | small runtime-factory registry used during assembly |

## Runtime

| File | Status | Notes |
| --- | --- | --- |
| `runtime/agent-runtime-support.js` | Support | snapshot normalization, prompt templates, fuzzy match helpers |
| `runtime/agent-session-runtime.js` | Support | provider-agnostic multi-round session adapter |
| `runtime/agent-lookup-runtime.js` | Main path | controller-facing inventory/record lookup coordinator |
| `runtime/agent-protocol-notebook.js` | Main path | protocol-to-notebook coordinator with pending-session state |
| `runtime/agent-science-main-utils.js` | Support | science response shaping, project/paper evidence helpers |
| `runtime/agent-science-reasoning-loop.js` | Main path | non-deep-research science loop |
| `runtime/agent-codex-runtime.js` | Secondary | instantiated in `main.js` but not currently dispatched |

## Tools

| File | Status | Notes |
| --- | --- | --- |
| `tools/Tools.json` | Support | short tool catalog |
| `tools/Tool-call.json` | Support | input schemas and long descriptions |
| `tools/agent-tool-call.js` | Main path | shared schema-driven tool wrapper used by the controller |
| `tools/agent-inventory-lookup.js` | Main path | concrete inventory lookup logic |
| `tools/agent-record-lookup.js` | Main path | concrete record lookup logic |
| `tools/agent-protocol-matching.js` | Support | protocol ranking and tie-break selection |
| `tools/agent-notebook-generation.js` | Support | placeholder resolution and notebook payload generation |
| `tools/agent-notebook-draft.js` | Main path | planned notebook proposal flow; explicitly registered in `main.js` |
| `tools/agent-literature-search.js` | Secondary | concrete retrieval tool; cataloged, smoke-tested, but not visibly registered on the shared executor |
| `tools/agent-paper-download.js` | Secondary | action-based paper acquisition runtime |
| `tools/agent-paper-analysis.js` | Secondary | paper summarization and protocol extraction |
| `tools/agent-protocol-generation.js` | Secondary | structured protocol generation from methods evidence |
| `tools/agent-sub-agent.js` | Secondary | action-based helper-agent runtime |
| `tools/agent-python-sandbox.js` | Secondary | low-level sandbox plus managed supervisor wrapper |
| `tools/agent-tool-smoke-test.js` | Main path | exposed through developer IPC for manual tool testing |

## Context

| File | Status | Notes |
| --- | --- | --- |
| `context/agent-chat-log.js` | Main path | session storage, assistant message projection, chat history reads |
| `context/agent-context-management.js` | Secondary | layered in-memory context runtime, not currently on the main chat flow |
| `context/agent-memory.js` | Secondary | sparse long-term memory runtime, also not on the main chat flow |

## Deep research

| File | Status | Notes |
| --- | --- | --- |
| `deep-research/index.js` | Main path | entry point for deep research mode |
| `deep-research/step-1-clarify-question.js` | Support | clarify research objective |
| `deep-research/step-2-ask-targeted-follow-up.js` | Support | decide whether a blocking follow-up is still needed |
| `deep-research/step-3-draft-research-plan.js` | Support | structured plan plus candidate tools/sources |
| `deep-research/step-4-execute-plan.js` | Support | iterative execution loop with tool validation |
| `deep-research/step-5-assemble-final-answer.js` | Support | outline-first section synthesis |
| `deep-research/context-control.js` | Support | rolling evidence and section buffers |
| `deep-research/accuracy-preservation.js` | Support | citations, contradictions, uncertainty tracking |
| `deep-research/final-synthesis-quality.js` | Support | default outline and section validation helpers |
| `deep-research/sub-agent-usage.js` | Support | delegation heuristics and completion-check helper |

## Two good places to start in code

If you want to read the code itself after this document set:

1. `src/main/helpers/main/register-agent-ipc.js`
2. `src/main/main.js`

Those two files show how the pieces from `src/main/helpers/agent` are actually composed into the application's live request path.
