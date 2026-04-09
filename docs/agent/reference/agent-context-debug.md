# Agent Context Debug Export

Generated at: 2026-04-05T19:20:04.508Z

This export runs the science agent flow with debug shims only.

- Every LLM-facing response is replaced with `LLM Response`.
- Every internal tool/API-facing response is replaced with `API response`.
- The runtime logic stays intact; only the external call boundaries are stubbed.

## Direct Answer

```json
{
  "intent": "general_science_question",
  "mode": "direct-answer",
  "message": "What does the latest evidence suggest about this science question?",
  "reasoning_effort": 0,
  "iterations": 0,
  "max_rounds": 0,
  "tool_sequence": [],
  "project": null
}
```

### Final Result

```json
{
  "status": "completed",
  "answer": "LLM Response",
  "confidence": 0.68,
  "citations": [],
  "decision_record": {
    "assumptions": [
      "general_science_question was answered directly at reasoning_effort=0."
    ],
    "open_questions": [],
    "verification_notes": [
      "No reasoning loop or retrieval tool was used."
    ]
  },
  "response_type": "",
  "confidence_label": "",
  "source_summary": {
    "total_sources": 0,
    "groups": []
  },
  "unresolved_fields": [],
  "validation": {
    "passed": true,
    "forced_clarification": false,
    "violations": [],
    "failure_reasons": []
  },
  "provenance": {
    "source_evidence": [],
    "unsupported_statement_count": 0
  },
  "clarified_input": "What does the latest evidence suggest about this science question?",
  "input_clarification": null,
  "route_plan": null,
  "exit_criteria": null,
  "tool_trace": [],
  "intermediate_states": [
    {
      "state_id": "science_intake-1775416804499-386056",
      "created_at": "2026-04-05T19:20:04.499Z",
      "stage": "science_intake",
      "goal": "Start general_science_question handling.",
      "assumptions": [
        "Intent policy=literature_first_web_last.",
        "reasoning_effort=0.",
        "This request should answer directly without entering the reasoning loop."
      ],
      "open_questions": [],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.52
    },
    {
      "state_id": "science_direct_answer-1775416804499-20c70c",
      "created_at": "2026-04-05T19:20:04.499Z",
      "stage": "science_direct_answer",
      "goal": "Answered directly without entering the reasoning loop.",
      "assumptions": [
        "reasoning_effort=0 requested a direct answer path.",
        "No retrieval tools were invoked."
      ],
      "open_questions": [],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.68
    }
  ],
  "rounds_executed": 0,
  "follow_up_questions": [],
  "reasoning_effort": 0,
  "thinking_trace": {
    "intent_parse_question": "LLM Response",
    "question_clarifier": "LLM Response",
    "criteria_generate": "LLM Response",
    "tool_rounds": [],
    "pre_synthesize_answer": "LLM Response",
    "judge": "LLM Response",
    "final_synthesize": "LLM Response",
    "final_synthesized_question": "LLM Response"
  },
  "final_synthesized_question": "LLM Response"
}
```

### Context Snapshots

### 1. Initial context envelope

```json
{
  "session_id": "debug-session-direct-answer",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804495-10f8087f",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [],
    "tool_trace": [],
    "started_at": "2026-04-05T19:20:04.495Z",
    "updated_at": "2026-04-05T19:20:04.495Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": {
        "task_id": "task-1775416804495-10f8087f",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [],
        "tool_trace": [],
        "started_at": "2026-04-05T19:20:04.495Z",
        "updated_at": "2026-04-05T19:20:04.495Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Current task state JSON:
{
  "task_id": "task-1775416804495-10f8087f",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [],
  "tool_trace": [],
  "started_at": "2026-04-05T19:20:04.495Z",
  "updated_at": "2026-04-05T19:20:04.495Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 2. Final context envelope

```json
{
  "session_id": "debug-session-direct-answer",
  "mode": "ready",
  "active_task": null,
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        },
        {
          "role": "assistant",
          "text": "LLM Response"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": null
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "",
      "recent_completed_tasks": [
        {
          "task_id": "task-1775416804495-10f8087f",
          "task_type": "science_reasoning_loop",
          "intent": "general_science_question",
          "status": "completed",
          "summary": "LLM Response",
          "completed_at": "2026-04-05T19:20:04.500Z"
        }
      ]
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Recent completed tasks: LLM Response

Long-term memory:

No recalled long-term memory.
```

### LLM Calls

### 1. science_agent_session_start

Kind: `agent-session-start`

Stub response: `LLM Response`

**System Prompt**

```text
You are a debug-only Enana agent runtime.

Science loop policy JSON:

{
  "intent": "general_science_question",
  "description": "Use literature and web retrieval to answer general science questions with grounded citations.",
  "tool_scope": null,
  "retrieval_priority": "literature_first_web_last",
  "require_external_citation_when_recent": true,
  "require_retrieval_attempt": true,
  "answer_with_limitations_after_attempt": true
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": false,
    "clarification_reason": "",
    "reasoning_effort": 0
  },
  "classifier": {
    "reasoning_effort": 0
  }
}

Reasoning effort: 0

Execution mode: direct answer only.

Original user message:
What does the latest evidence suggest about this science question?

Clarified request for execution:
What does the latest evidence suggest about this science question?

1. You are handling a reasoning_effort=0 science request.
2. Answer directly without entering the deterministic science reasoning loop.
3. Do not call tools or ask to enter a reasoning loop.
4. Use stable scientific knowledge plus the provided context only.
5. Do not fabricate project records, literature results, or computation outputs.
6. For general science questions, prefer the most targeted citation-backed evidence path available.
7. This request was classified as reasoning_effort=0.
```

**Message**

```text
What does the latest evidence suggest about this science question?
```

**Conversation**

```json
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  },
  {
    "role": "assistant",
    "text": "LLM Response"
  }
]
```

### 2. science_thinking_trace

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Generate short workflow-thinking sentences for this science reasoning run.

Return exactly one concise sentence for each named step.

Use only the supplied trace and do not invent tools, papers, computations, or conclusions.

The tone should sound like an internal working note, for example:

- This is a general science question.

- The user wants to understand the mechanism with grounded evidence.

- I am looking at the tool list to pick the most targeted next step.

- I want to search for a focused literature source first.

- Based on the tool result, it seems I still need one broader source.

- I have gathered enough information, and I am ready to synthesize the final answer.

For tool_rounds, create one entry per executed round.

final_synthesized_question must be the best single-sentence formulation of the exact question the workflow answered or tried to answer.

Intent: general_science_question

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
What does the latest evidence suggest about this science question?

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 0,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "LLM Response",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Tool rounds JSON:
[]

Final status: completed

Final answer:
LLM Response

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "intent_parse_question": "LLM Response",
  "question_clarifier": "LLM Response",
  "criteria_generate": "LLM Response",
  "tool_rounds": [],
  "pre_synthesize_answer": "LLM Response",
  "judge": "LLM Response",
  "final_synthesize": "LLM Response",
  "final_synthesized_question": "LLM Response"
}
```

### Internal API Calls

_No internal API calls captured._

### Lifecycle

1. `science_direct_answer_started` [started] Answering general_science_question directly at reasoning_effort=0.
2. `science_direct_answer_completed` [ok] Science direct-answer path completed successfully.
## Clarification Needed

```json
{
  "intent": "general_science_question",
  "mode": "clarification",
  "message": "What does the latest evidence suggest about this science question?",
  "reasoning_effort": 2,
  "iterations": 0,
  "max_rounds": 2,
  "tool_sequence": [
    "literature-search",
    "web-search"
  ],
  "project": null
}
```

### Final Result

```json
{
  "status": "needs_more_info",
  "answer": "LLM Response",
  "confidence": 0.35,
  "citations": [],
  "decision_record": {
    "assumptions": [
      "general_science_question was routed into the shared science reasoning loop.",
      "general_science_question requires clarification before retrieval."
    ],
    "open_questions": [
      "LLM Response"
    ],
    "verification_notes": [
      "Execution stopped before tool use because prerequisite clarification was missing.",
      "No science retrieval tool was executed."
    ]
  },
  "response_type": "",
  "confidence_label": "",
  "source_summary": {
    "total_sources": 0,
    "groups": []
  },
  "unresolved_fields": [],
  "validation": {
    "passed": true,
    "forced_clarification": false,
    "violations": [],
    "failure_reasons": []
  },
  "provenance": {
    "source_evidence": [],
    "unsupported_statement_count": 0
  },
  "tool_trace": [],
  "intermediate_states": [
    {
      "state_id": "science_intake-1775416804500-e5e390",
      "created_at": "2026-04-05T19:20:04.500Z",
      "stage": "science_intake",
      "goal": "Start general_science_question handling.",
      "assumptions": [
        "Intent policy=literature_first_web_last.",
        "reasoning_effort=2.",
        "This request should enter the reasoning loop."
      ],
      "open_questions": [
        "LLM Response"
      ],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.52
    },
    {
      "state_id": "science_clarification-1775416804500-de32a7",
      "created_at": "2026-04-05T19:20:04.500Z",
      "stage": "science_clarification",
      "goal": "Clarified the user request before reasoning.",
      "assumptions": [
        "LLM Response",
        "Intent: general_science_question",
        "Requested output: debug-context-export"
      ],
      "open_questions": [
        "LLM Response"
      ],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.4
    }
  ],
  "rounds_executed": 0,
  "follow_up_questions": [
    "LLM Response"
  ],
  "thinking_trace": {
    "intent_parse_question": "LLM Response",
    "question_clarifier": "LLM Response",
    "criteria_generate": "LLM Response",
    "tool_rounds": [],
    "pre_synthesize_answer": "LLM Response",
    "judge": "LLM Response",
    "final_synthesize": "LLM Response",
    "final_synthesized_question": "LLM Response"
  },
  "final_synthesized_question": "LLM Response"
}
```

### Context Snapshots

### 1. Initial context envelope

```json
{
  "session_id": "debug-session-clarification-needed",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804500-a3b58776",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [],
    "tool_trace": [],
    "started_at": "2026-04-05T19:20:04.500Z",
    "updated_at": "2026-04-05T19:20:04.500Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": {
        "task_id": "task-1775416804500-a3b58776",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [],
        "tool_trace": [],
        "started_at": "2026-04-05T19:20:04.500Z",
        "updated_at": "2026-04-05T19:20:04.500Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Current task state JSON:
{
  "task_id": "task-1775416804500-a3b58776",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [],
  "tool_trace": [],
  "started_at": "2026-04-05T19:20:04.500Z",
  "updated_at": "2026-04-05T19:20:04.500Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 2. After follow-up question was recorded

```json
{
  "session_id": "debug-session-clarification-needed",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804500-a3b58776",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [
      "LLM Response"
    ],
    "tool_trace": [],
    "started_at": "2026-04-05T19:20:04.500Z",
    "updated_at": "2026-04-05T19:20:04.501Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        },
        {
          "role": "assistant",
          "text": "LLM Response"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": {
        "task_id": "task-1775416804500-a3b58776",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [
          "LLM Response"
        ],
        "tool_trace": [],
        "started_at": "2026-04-05T19:20:04.500Z",
        "updated_at": "2026-04-05T19:20:04.501Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [
        "LLM Response"
      ],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Current task state JSON:
{
  "task_id": "task-1775416804500-a3b58776",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [
    "LLM Response"
  ],
  "tool_trace": [],
  "started_at": "2026-04-05T19:20:04.500Z",
  "updated_at": "2026-04-05T19:20:04.501Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: LLM Response

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 3. Final context envelope

```json
{
  "session_id": "debug-session-clarification-needed",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804500-a3b58776",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [
      "LLM Response"
    ],
    "tool_trace": [],
    "started_at": "2026-04-05T19:20:04.500Z",
    "updated_at": "2026-04-05T19:20:04.501Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        },
        {
          "role": "assistant",
          "text": "LLM Response"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": {
        "task_id": "task-1775416804500-a3b58776",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [
          "LLM Response"
        ],
        "tool_trace": [],
        "started_at": "2026-04-05T19:20:04.500Z",
        "updated_at": "2026-04-05T19:20:04.501Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [
        "LLM Response"
      ],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Current task state JSON:
{
  "task_id": "task-1775416804500-a3b58776",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [
    "LLM Response"
  ],
  "tool_trace": [],
  "started_at": "2026-04-05T19:20:04.500Z",
  "updated_at": "2026-04-05T19:20:04.501Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: LLM Response

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### LLM Calls

### 1. science_input_clarification

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Clarify the user request for the science reasoning loop.

Rewrite the request into a self-contained, execution-ready input for the next module.

Ask at most one follow-up question, and only when the missing detail is truly blocking.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": true,
  "clarification_reason": "LLM Response",
  "clarification_question": "LLM Response",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": true,
    "clarification_reason": "LLM Response",
    "reasoning_effort": 2
  },
  "classifier": {
    "reasoning_effort": 2
  }
}

Recent conversation JSON:
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  }
]

User message:
What does the latest evidence suggest about this science question?

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response"
  ],
  "missing_information": [
    "LLM Response"
  ],
  "should_ask_follow_up": true,
  "follow_up_question": "LLM Response",
  "follow_up_reason": "LLM Response"
}
```

### 2. science_thinking_trace

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Generate short workflow-thinking sentences for this science reasoning run.

Return exactly one concise sentence for each named step.

Use only the supplied trace and do not invent tools, papers, computations, or conclusions.

The tone should sound like an internal working note, for example:

- This is a general science question.

- The user wants to understand the mechanism with grounded evidence.

- I am looking at the tool list to pick the most targeted next step.

- I want to search for a focused literature source first.

- Based on the tool result, it seems I still need one broader source.

- I have gathered enough information, and I am ready to synthesize the final answer.

For tool_rounds, create one entry per executed round.

final_synthesized_question must be the best single-sentence formulation of the exact question the workflow answered or tried to answer.

Intent: general_science_question

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": true,
  "clarification_reason": "LLM Response",
  "clarification_question": "LLM Response",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [
    "LLM Response"
  ],
  "should_ask_follow_up": true,
  "follow_up_question": "LLM Response",
  "follow_up_reason": "LLM Response"
}

Tool rounds JSON:
[]

Final status: needs_more_info

Final answer:
LLM Response

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "intent_parse_question": "LLM Response",
  "question_clarifier": "LLM Response",
  "criteria_generate": "LLM Response",
  "tool_rounds": [],
  "pre_synthesize_answer": "LLM Response",
  "judge": "LLM Response",
  "final_synthesize": "LLM Response",
  "final_synthesized_question": "LLM Response"
}
```

### Internal API Calls

_No internal API calls captured._

### Lifecycle

1. `science_clarification_started` [started] Clarifying general_science_question input before tool execution.
2. `science_clarification_completed` [pending] LLM Response
## Science Loop

```json
{
  "intent": "general_science_question",
  "mode": "loop",
  "message": "What does the latest evidence suggest about this science question?",
  "reasoning_effort": 2,
  "iterations": 2,
  "max_rounds": 2,
  "tool_sequence": [
    "literature-search",
    "web-search"
  ],
  "project": null
}
```

### Final Result

```json
{
  "status": "partial",
  "answer": "LLM Response",
  "confidence": 0.68,
  "citations": [
    {
      "source": "literature-search",
      "pointer": "debug:1",
      "reason": "API response"
    },
    {
      "source": "web-search",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ],
  "decision_record": {
    "assumptions": [
      "LLM Response",
      "general_science_question used the shared science reasoning loop.",
      "Citation count=2."
    ],
    "open_questions": [
      "The current evidence directly supports the core answer to the clarified request.",
      "At least one external citation-backed source is still missing."
    ],
    "verification_notes": [
      "LLM Response",
      "The loop stopped with remaining gaps and returned a best-effort answer."
    ]
  },
  "response_type": "",
  "confidence_label": "",
  "source_summary": {
    "total_sources": 2,
    "groups": []
  },
  "unresolved_fields": [],
  "validation": {
    "passed": true,
    "forced_clarification": false,
    "violations": [],
    "failure_reasons": []
  },
  "provenance": {
    "source_evidence": [],
    "unsupported_statement_count": 0
  },
  "clarified_input": "LLM Response",
  "input_clarification": {
    "clarified_input": "LLM Response",
    "analysis_goal": "LLM Response",
    "important_constraints": [
      "LLM Response",
      "Intent: general_science_question",
      "Requested output: debug-context-export"
    ],
    "missing_information": [],
    "should_ask_follow_up": false,
    "follow_up_question": "",
    "follow_up_reason": "LLM Response"
  },
  "route_plan": {
    "goal": "LLM Response",
    "route_summary": "LLM Response",
    "step_sequence": [
      {
        "step_label": "step-1",
        "objective": "LLM Response",
        "suggested_tools": [
          "literature-search"
        ],
        "reason": "LLM Response"
      },
      {
        "step_label": "step-2",
        "objective": "LLM Response",
        "suggested_tools": [
          "web-search"
        ],
        "reason": "LLM Response"
      }
    ],
    "tool_call_suggestions": [
      {
        "tool_name": "literature-search",
        "priority": 1,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "web-search",
        "priority": 2,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      }
    ],
    "decision_points": [
      "LLM Response",
      "If the first evidence step is weak, refine the query before expanding the search surface.",
      "Stop early when the current evidence directly answers the clarified request with stated limitations."
    ],
    "adaptation_notes": [
      "LLM Response",
      "This route is a reference only and can be changed when tool results reveal a better path.",
      "Skip low-yield steps instead of following the sequence mechanically.",
      "Preserve explicit uncertainty whenever evidence is incomplete or conflicting."
    ],
    "reference_only": true
  },
  "exit_criteria": {
    "objective_summary": "LLM Response",
    "exit_conditions": [
      "LLM Response",
      "The current evidence directly supports the core answer to the clarified request.",
      "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
    ],
    "required_evidence": [
      "LLM Response",
      "At least one evidence-gathering round has run before the loop exits."
    ],
    "continue_when": [
      "LLM Response",
      "A blocking evidence gap still prevents a grounded answer."
    ],
    "can_exit_with_limitations_when": [
      "LLM Response",
      "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
      "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
    ],
    "preferred_next_tools": [
      "literature-search",
      "web-search"
    ],
    "reasoning_notes": "LLM Response"
  },
  "tool_trace": [
    {
      "round": 1,
      "call_id": "debug-call-science-loop-1",
      "tool_name": "literature-search",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "literature-search",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 2,
      "call_id": "debug-call-science-loop-2",
      "tool_name": "web-search",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "web-search",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ]
    }
  ],
  "intermediate_states": [
    {
      "state_id": "science_intake-1775416804502-a7dc41",
      "created_at": "2026-04-05T19:20:04.502Z",
      "stage": "science_intake",
      "goal": "Start general_science_question handling.",
      "assumptions": [
        "Intent policy=literature_first_web_last.",
        "reasoning_effort=2.",
        "This request should enter the reasoning loop."
      ],
      "open_questions": [],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.52
    },
    {
      "state_id": "science_clarification-1775416804502-f41553",
      "created_at": "2026-04-05T19:20:04.502Z",
      "stage": "science_clarification",
      "goal": "Clarified the user request before reasoning.",
      "assumptions": [
        "LLM Response",
        "Intent: general_science_question",
        "Requested output: debug-context-export"
      ],
      "open_questions": [],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.66
    },
    {
      "state_id": "science_route_plan-1775416804502-77743a",
      "created_at": "2026-04-05T19:20:04.502Z",
      "stage": "science_route_plan",
      "goal": "Drafted a reference route plan for the reasoning loop.",
      "assumptions": [
        "LLM Response",
        "If the first evidence step is weak, refine the query before expanding the search surface.",
        "Stop early when the current evidence directly answers the clarified request with stated limitations."
      ],
      "open_questions": [
        "LLM Response",
        "This route is a reference only and can be changed when tool results reveal a better path.",
        "Skip low-yield steps instead of following the sequence mechanically.",
        "Preserve explicit uncertainty whenever evidence is incomplete or conflicting."
      ],
      "evidence": [],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "literature-search",
          "risk_level": "low",
          "reason": "LLM Response"
        },
        {
          "action_type": "read",
          "tool_name": "web-search",
          "risk_level": "low",
          "reason": "LLM Response"
        }
      ],
      "confidence": 0.64
    },
    {
      "state_id": "science_exit_criteria-1775416804503-e24640",
      "created_at": "2026-04-05T19:20:04.503Z",
      "stage": "science_exit_criteria",
      "goal": "Generated exit criteria for the reasoning loop.",
      "assumptions": [
        "LLM Response",
        "The current evidence directly supports the core answer to the clarified request.",
        "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
      ],
      "open_questions": [
        "LLM Response",
        "A blocking evidence gap still prevents a grounded answer."
      ],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.62
    },
    {
      "state_id": "science_tool_round-1775416804504-2f6c9b",
      "created_at": "2026-04-05T19:20:04.504Z",
      "stage": "science_tool_round",
      "goal": "Executed literature-search in round 1.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "literature-search",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "literature-search",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775416804504-594467",
      "created_at": "2026-04-05T19:20:04.504Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "literature-search",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775416804507-a20f7c",
      "created_at": "2026-04-05T19:20:04.507Z",
      "stage": "science_tool_round",
      "goal": "Executed web-search in round 2.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "web-search",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "web-search",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775416804507-7c7880",
      "created_at": "2026-04-05T19:20:04.507Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "web-search",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_synthesis-1775416804508-30b2c1",
      "created_at": "2026-04-05T19:20:04.508Z",
      "stage": "science_synthesis",
      "goal": "Synthesized final science answer from tool evidence.",
      "assumptions": [
        "Best-effort answer was produced because the loop stopped before full sufficiency.",
        "Total citations=2."
      ],
      "open_questions": [
        "The current evidence directly supports the core answer to the clarified request.",
        "At least one external citation-backed source is still missing."
      ],
      "evidence": [
        {
          "source": "literature-search",
          "pointer": "debug:1",
          "reason": "API response"
        },
        {
          "source": "web-search",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.68
    }
  ],
  "rounds_executed": 2,
  "reasoning_effort": 2,
  "follow_up_questions": [
    "Could you clarify: The current evidence directly supports the core answer to the clarified request.",
    "Could you clarify: At least one external citation-backed source is still missing."
  ],
  "thinking_trace": {
    "intent_parse_question": "LLM Response",
    "question_clarifier": "LLM Response",
    "criteria_generate": "LLM Response",
    "tool_rounds": [
      {
        "round": 1,
        "tool_selection": "LLM Response",
        "tool_call": "LLM Response",
        "tool_results": "LLM Response"
      },
      {
        "round": 2,
        "tool_selection": "LLM Response",
        "tool_call": "LLM Response",
        "tool_results": "LLM Response"
      }
    ],
    "pre_synthesize_answer": "LLM Response",
    "judge": "LLM Response",
    "final_synthesize": "LLM Response",
    "final_synthesized_question": "LLM Response"
  },
  "final_synthesized_question": "LLM Response"
}
```

### Context Snapshots

### 1. Initial context envelope

```json
{
  "session_id": "debug-session-science-loop",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804501-d62f7fdb",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [],
    "tool_trace": [],
    "started_at": "2026-04-05T19:20:04.501Z",
    "updated_at": "2026-04-05T19:20:04.501Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": {
        "task_id": "task-1775416804501-d62f7fdb",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [],
        "tool_trace": [],
        "started_at": "2026-04-05T19:20:04.501Z",
        "updated_at": "2026-04-05T19:20:04.501Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Current task state JSON:
{
  "task_id": "task-1775416804501-d62f7fdb",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [],
  "tool_trace": [],
  "started_at": "2026-04-05T19:20:04.501Z",
  "updated_at": "2026-04-05T19:20:04.501Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 2. After literature-search round 1

```json
{
  "session_id": "debug-session-science-loop",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804501-d62f7fdb",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [],
    "tool_trace": [
      {
        "tool_name": "literature-search",
        "ok": true,
        "summary": "API response",
        "input": {
          "query": "What does the latest evidence suggest about this science question?"
        },
        "result": {
          "summary": "API response",
          "text": "API response",
          "items": [
            {
              "id": "api-item-1",
              "label": "API response"
            }
          ]
        },
        "recorded_at": "2026-04-05T19:20:04.503Z"
      }
    ],
    "started_at": "2026-04-05T19:20:04.501Z",
    "updated_at": "2026-04-05T19:20:04.503Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        }
      ],
      "latest_tool_outputs": [
        {
          "tool_name": "literature-search",
          "ok": true,
          "summary": "API response",
          "result": {
            "summary": "API response",
            "text": "API response",
            "items": [
              {
                "id": "api-item-1",
                "label": "API response"
              }
            ]
          },
          "recorded_at": "2026-04-05T19:20:04.503Z"
        }
      ],
      "current_task_state": {
        "task_id": "task-1775416804501-d62f7fdb",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [],
        "tool_trace": [
          {
            "tool_name": "literature-search",
            "ok": true,
            "summary": "API response",
            "input": {
              "query": "What does the latest evidence suggest about this science question?"
            },
            "result": {
              "summary": "API response",
              "text": "API response",
              "items": [
                {
                  "id": "api-item-1",
                  "label": "API response"
                }
              ]
            },
            "recorded_at": "2026-04-05T19:20:04.503Z"
          }
        ],
        "started_at": "2026-04-05T19:20:04.501Z",
        "updated_at": "2026-04-05T19:20:04.503Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
1. literature-search: API response

Current task state JSON:
{
  "task_id": "task-1775416804501-d62f7fdb",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [],
  "tool_trace": [
    {
      "tool_name": "literature-search",
      "ok": true,
      "summary": "API response",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "result": {
        "summary": "API response",
        "text": "API response",
        "items": [
          {
            "id": "api-item-1",
            "label": "API response"
          }
        ]
      },
      "recorded_at": "2026-04-05T19:20:04.503Z"
    }
  ],
  "started_at": "2026-04-05T19:20:04.501Z",
  "updated_at": "2026-04-05T19:20:04.503Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 3. After web-search round 2

```json
{
  "session_id": "debug-session-science-loop",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804501-d62f7fdb",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [],
    "tool_trace": [
      {
        "tool_name": "literature-search",
        "ok": true,
        "summary": "API response",
        "input": {
          "query": "What does the latest evidence suggest about this science question?"
        },
        "result": {
          "summary": "API response",
          "text": "API response",
          "items": [
            {
              "id": "api-item-1",
              "label": "API response"
            }
          ]
        },
        "recorded_at": "2026-04-05T19:20:04.503Z"
      },
      {
        "tool_name": "web-search",
        "ok": true,
        "summary": "API response",
        "input": {
          "query": "What does the latest evidence suggest about this science question?"
        },
        "result": {
          "summary": "API response",
          "text": "API response",
          "items": [
            {
              "id": "api-item-2",
              "label": "API response"
            }
          ]
        },
        "recorded_at": "2026-04-05T19:20:04.507Z"
      }
    ],
    "started_at": "2026-04-05T19:20:04.501Z",
    "updated_at": "2026-04-05T19:20:04.507Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        }
      ],
      "latest_tool_outputs": [
        {
          "tool_name": "web-search",
          "ok": true,
          "summary": "API response",
          "result": {
            "summary": "API response",
            "text": "API response",
            "items": [
              {
                "id": "api-item-2",
                "label": "API response"
              }
            ]
          },
          "recorded_at": "2026-04-05T19:20:04.507Z"
        },
        {
          "tool_name": "literature-search",
          "ok": true,
          "summary": "API response",
          "result": {
            "summary": "API response",
            "text": "API response",
            "items": [
              {
                "id": "api-item-1",
                "label": "API response"
              }
            ]
          },
          "recorded_at": "2026-04-05T19:20:04.503Z"
        }
      ],
      "current_task_state": {
        "task_id": "task-1775416804501-d62f7fdb",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [],
        "tool_trace": [
          {
            "tool_name": "literature-search",
            "ok": true,
            "summary": "API response",
            "input": {
              "query": "What does the latest evidence suggest about this science question?"
            },
            "result": {
              "summary": "API response",
              "text": "API response",
              "items": [
                {
                  "id": "api-item-1",
                  "label": "API response"
                }
              ]
            },
            "recorded_at": "2026-04-05T19:20:04.503Z"
          },
          {
            "tool_name": "web-search",
            "ok": true,
            "summary": "API response",
            "input": {
              "query": "What does the latest evidence suggest about this science question?"
            },
            "result": {
              "summary": "API response",
              "text": "API response",
              "items": [
                {
                  "id": "api-item-2",
                  "label": "API response"
                }
              ]
            },
            "recorded_at": "2026-04-05T19:20:04.507Z"
          }
        ],
        "started_at": "2026-04-05T19:20:04.501Z",
        "updated_at": "2026-04-05T19:20:04.507Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
1. web-search: API response
2. literature-search: API response

Current task state JSON:
{
  "task_id": "task-1775416804501-d62f7fdb",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [],
  "tool_trace": [
    {
      "tool_name": "literature-search",
      "ok": true,
      "summary": "API response",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "result": {
        "summary": "API response",
        "text": "API response",
        "items": [
          {
            "id": "api-item-1",
            "label": "API response"
          }
        ]
      },
      "recorded_at": "2026-04-05T19:20:04.503Z"
    },
    {
      "tool_name": "web-search",
      "ok": true,
      "summary": "API response",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "result": {
        "summary": "API response",
        "text": "API response",
        "items": [
          {
            "id": "api-item-2",
            "label": "API response"
          }
        ]
      },
      "recorded_at": "2026-04-05T19:20:04.507Z"
    }
  ],
  "started_at": "2026-04-05T19:20:04.501Z",
  "updated_at": "2026-04-05T19:20:04.507Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 4. After follow-up question was recorded

```json
{
  "session_id": "debug-session-science-loop",
  "mode": "active_task",
  "active_task": {
    "task_id": "task-1775416804501-d62f7fdb",
    "task_type": "science_reasoning_loop",
    "intent": "general_science_question",
    "status": "active",
    "project": null,
    "selected_protocol": null,
    "missing_fields": [],
    "known_values": {},
    "follow_up_questions": [
      "Could you clarify: The current evidence directly supports the core answer to the clarified request.",
      "Could you clarify: At least one external citation-backed source is still missing."
    ],
    "tool_trace": [
      {
        "tool_name": "literature-search",
        "ok": true,
        "summary": "API response",
        "input": {
          "query": "What does the latest evidence suggest about this science question?"
        },
        "result": {
          "summary": "API response",
          "text": "API response",
          "items": [
            {
              "id": "api-item-1",
              "label": "API response"
            }
          ]
        },
        "recorded_at": "2026-04-05T19:20:04.503Z"
      },
      {
        "tool_name": "web-search",
        "ok": true,
        "summary": "API response",
        "input": {
          "query": "What does the latest evidence suggest about this science question?"
        },
        "result": {
          "summary": "API response",
          "text": "API response",
          "items": [
            {
              "id": "api-item-2",
              "label": "API response"
            }
          ]
        },
        "recorded_at": "2026-04-05T19:20:04.507Z"
      }
    ],
    "started_at": "2026-04-05T19:20:04.501Z",
    "updated_at": "2026-04-05T19:20:04.508Z"
  },
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        },
        {
          "role": "assistant",
          "text": "Could you clarify: The current evidence directly supports the core answer to the clarified request."
        }
      ],
      "latest_tool_outputs": [
        {
          "tool_name": "web-search",
          "ok": true,
          "summary": "API response",
          "result": {
            "summary": "API response",
            "text": "API response",
            "items": [
              {
                "id": "api-item-2",
                "label": "API response"
              }
            ]
          },
          "recorded_at": "2026-04-05T19:20:04.507Z"
        },
        {
          "tool_name": "literature-search",
          "ok": true,
          "summary": "API response",
          "result": {
            "summary": "API response",
            "text": "API response",
            "items": [
              {
                "id": "api-item-1",
                "label": "API response"
              }
            ]
          },
          "recorded_at": "2026-04-05T19:20:04.503Z"
        }
      ],
      "current_task_state": {
        "task_id": "task-1775416804501-d62f7fdb",
        "task_type": "science_reasoning_loop",
        "intent": "general_science_question",
        "status": "active",
        "project": null,
        "selected_protocol": null,
        "missing_fields": [],
        "known_values": {},
        "follow_up_questions": [
          "Could you clarify: The current evidence directly supports the core answer to the clarified request.",
          "Could you clarify: At least one external citation-backed source is still missing."
        ],
        "tool_trace": [
          {
            "tool_name": "literature-search",
            "ok": true,
            "summary": "API response",
            "input": {
              "query": "What does the latest evidence suggest about this science question?"
            },
            "result": {
              "summary": "API response",
              "text": "API response",
              "items": [
                {
                  "id": "api-item-1",
                  "label": "API response"
                }
              ]
            },
            "recorded_at": "2026-04-05T19:20:04.503Z"
          },
          {
            "tool_name": "web-search",
            "ok": true,
            "summary": "API response",
            "input": {
              "query": "What does the latest evidence suggest about this science question?"
            },
            "result": {
              "summary": "API response",
              "text": "API response",
              "items": [
                {
                  "id": "api-item-2",
                  "label": "API response"
                }
              ]
            },
            "recorded_at": "2026-04-05T19:20:04.507Z"
          }
        ],
        "started_at": "2026-04-05T19:20:04.501Z",
        "updated_at": "2026-04-05T19:20:04.508Z"
      }
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [
        "Could you clarify: The current evidence directly supports the core answer to the clarified request.",
        "Could you clarify: At least one external citation-backed source is still missing."
      ],
      "current_project_state": null,
      "active_task_summary": "science_reasoning_loop | status=active",
      "recent_completed_tasks": []
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Latest tool outputs:
1. web-search: API response
2. literature-search: API response

Current task state JSON:
{
  "task_id": "task-1775416804501-d62f7fdb",
  "task_type": "science_reasoning_loop",
  "intent": "general_science_question",
  "status": "active",
  "project": null,
  "selected_protocol": null,
  "missing_fields": [],
  "known_values": {},
  "follow_up_questions": [
    "Could you clarify: The current evidence directly supports the core answer to the clarified request.",
    "Could you clarify: At least one external citation-backed source is still missing."
  ],
  "tool_trace": [
    {
      "tool_name": "literature-search",
      "ok": true,
      "summary": "API response",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "result": {
        "summary": "API response",
        "text": "API response",
        "items": [
          {
            "id": "api-item-1",
            "label": "API response"
          }
        ]
      },
      "recorded_at": "2026-04-05T19:20:04.503Z"
    },
    {
      "tool_name": "web-search",
      "ok": true,
      "summary": "API response",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "result": {
        "summary": "API response",
        "text": "API response",
        "items": [
          {
            "id": "api-item-2",
            "label": "API response"
          }
        ]
      },
      "recorded_at": "2026-04-05T19:20:04.507Z"
    }
  ],
  "started_at": "2026-04-05T19:20:04.501Z",
  "updated_at": "2026-04-05T19:20:04.508Z"
}

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: Could you clarify: The current evidence directly supports the core answer to the clarified request. | Could you clarify: At least one external citation-backed source is still missing.

Active task summary: science_reasoning_loop | status=active

Long-term memory:

No recalled long-term memory.
```

### 5. Final context envelope

```json
{
  "session_id": "debug-session-science-loop",
  "mode": "ready",
  "active_task": null,
  "layers": {
    "immediate": {
      "current_user_request": "What does the latest evidence suggest about this science question?",
      "recent_conversation": [
        {
          "role": "user",
          "text": "What does the latest evidence suggest about this science question?"
        },
        {
          "role": "assistant",
          "text": "Could you clarify: The current evidence directly supports the core answer to the clarified request."
        }
      ],
      "latest_tool_outputs": [],
      "current_task_state": null
    },
    "session_memory": {
      "goals": [
        "Inspect debug context export output"
      ],
      "decisions": [],
      "constraints": [
        "All LLM outputs are replaced with LLM Response.",
        "All internal API outputs are replaced with API response."
      ],
      "unresolved_questions": [],
      "current_project_state": null,
      "active_task_summary": "",
      "recent_completed_tasks": [
        {
          "task_id": "task-1775416804501-d62f7fdb",
          "task_type": "science_reasoning_loop",
          "intent": "general_science_question",
          "status": "partial",
          "summary": "LLM Response",
          "completed_at": "2026-04-05T19:20:04.508Z"
        }
      ]
    },
    "long_term_memory": []
  },
  "memory_candidates": [
    {
      "category": "constraint",
      "key": "All LLM outputs are replaced with LLM Response.",
      "summary": "All LLM outputs are replaced with LLM Response.",
      "value": "All LLM outputs are replaced with LLM Response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    },
    {
      "category": "constraint",
      "key": "All internal API outputs are replaced with API response.",
      "summary": "All internal API outputs are replaced with API response.",
      "value": "All internal API outputs are replaced with API response.",
      "project_name": "",
      "tags": [
        "constraint"
      ],
      "source": "session_memory"
    }
  ]
}
```

**Prompt Blocks**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Recent completed tasks: LLM Response

Long-term memory:

No recalled long-term memory.
```

### LLM Calls

### 1. science_input_clarification

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Clarify the user request for the science reasoning loop.

Rewrite the request into a self-contained, execution-ready input for the next module.

Ask at most one follow-up question, and only when the missing detail is truly blocking.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": false,
    "clarification_reason": "",
    "reasoning_effort": 2
  },
  "classifier": {
    "reasoning_effort": 2
  }
}

Recent conversation JSON:
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  }
]

User message:
What does the latest evidence suggest about this science question?

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}
```

### 2. science_route_planner

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Draft a reference route plan for the science reasoning loop.

This plan is guidance only. The agent may deviate when real tool outputs or evidence suggest a better path.

Keep the route concise, practical, and tool-aware.

Suggest a likely order of evidence-gathering steps, optional tool calls, and when the route should adapt.

Prefer only tools that are already allowed by policy or tool scope.

Reasoning effort 2: a broader multi-step route is acceptable, but do not over-plan.

Intent: general_science_question

Reasoning effort: 2

Policy JSON:
{
  "intent": "general_science_question",
  "description": "Use literature and web retrieval to answer general science questions with grounded citations.",
  "tool_scope": null,
  "retrieval_priority": "literature_first_web_last",
  "require_external_citation_when_recent": true,
  "require_retrieval_attempt": true,
  "answer_with_limitations_after_attempt": true
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": false,
    "clarification_reason": "",
    "reasoning_effort": 2
  },
  "classifier": {
    "reasoning_effort": 2
  }
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "goal": "LLM Response",
  "route_summary": "LLM Response",
  "step_sequence": [
    {
      "step_label": "step-1",
      "objective": "LLM Response",
      "suggested_tools": [
        "literature-search"
      ],
      "reason": "LLM Response"
    },
    {
      "step_label": "step-2",
      "objective": "LLM Response",
      "suggested_tools": [
        "web-search"
      ],
      "reason": "LLM Response"
    }
  ],
  "tool_call_suggestions": [
    {
      "tool_name": "literature-search",
      "priority": 1,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "web-search",
      "priority": 2,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    }
  ],
  "decision_points": [
    "LLM Response"
  ],
  "adaptation_notes": [
    "LLM Response"
  ],
  "reference_only": true
}
```

### 3. science_loop_exit_criteria

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Generate exit criteria for a science reasoning loop.

The criteria will be used later by a separate judge sub-agent to decide whether the loop should stop.

Be concrete about what evidence must exist before exit, when the loop should continue, and when a limitation-qualified answer is acceptable.

Intent: general_science_question

Policy JSON:
{
  "intent": "general_science_question",
  "description": "Use literature and web retrieval to answer general science questions with grounded citations.",
  "tool_scope": null,
  "retrieval_priority": "literature_first_web_last",
  "require_external_citation_when_recent": true,
  "require_retrieval_attempt": true,
  "answer_with_limitations_after_attempt": true
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": false,
    "clarification_reason": "",
    "reasoning_effort": 2
  },
  "classifier": {
    "reasoning_effort": 2
  }
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response"
  ],
  "required_evidence": [
    "LLM Response"
  ],
  "continue_when": [
    "LLM Response"
  ],
  "can_exit_with_limitations_when": [
    "LLM Response"
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}
```

### 4. science_agent_session_start

Kind: `agent-session-start`

Stub response: `LLM Response`

**System Prompt**

```text
You are a debug-only Enana agent runtime.

Science loop policy JSON:

{
  "intent": "general_science_question",
  "description": "Use literature and web retrieval to answer general science questions with grounded citations.",
  "tool_scope": null,
  "retrieval_priority": "literature_first_web_last",
  "require_external_citation_when_recent": true,
  "require_retrieval_attempt": true,
  "answer_with_limitations_after_attempt": true
}

Routing JSON:
{
  "intent": "general_science_question",
  "entities": {
    "requested_output": "debug-context-export"
  },
  "plan": {
    "needs_clarification": false,
    "clarification_reason": "",
    "reasoning_effort": 2
  },
  "classifier": {
    "reasoning_effort": 2
  }
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Reference route plan JSON:
{
  "goal": "LLM Response",
  "route_summary": "LLM Response",
  "step_sequence": [
    {
      "step_label": "step-1",
      "objective": "LLM Response",
      "suggested_tools": [
        "literature-search"
      ],
      "reason": "LLM Response"
    },
    {
      "step_label": "step-2",
      "objective": "LLM Response",
      "suggested_tools": [
        "web-search"
      ],
      "reason": "LLM Response"
    }
  ],
  "tool_call_suggestions": [
    {
      "tool_name": "literature-search",
      "priority": 1,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "web-search",
      "priority": 2,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    }
  ],
  "decision_points": [
    "LLM Response",
    "If the first evidence step is weak, refine the query before expanding the search surface.",
    "Stop early when the current evidence directly answers the clarified request with stated limitations."
  ],
  "adaptation_notes": [
    "LLM Response",
    "This route is a reference only and can be changed when tool results reveal a better path.",
    "Skip low-yield steps instead of following the sequence mechanically.",
    "Preserve explicit uncertainty whenever evidence is incomplete or conflicting."
  ],
  "reference_only": true
}

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Reasoning effort: 2

Original user message:
What does the latest evidence suggest about this science question?

Clarified request for execution:
LLM Response

1. You are inside a deterministic science reasoning loop.
2. At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.
3. Do not call more than one tool in a single assistant turn.
4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.
5. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.
6. If a tool result is weak or empty, choose a more targeted next tool on the following turn.
7. Do not fabricate project records, literature results, or computation outputs.
8. For general science questions, prefer the most targeted citation-backed evidence path available.
```

**Message**

```text
LLM Response
```

**Conversation**

```json
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  },
  {
    "role": "assistant",
    "text": "Could you clarify: The current evidence directly supports the core answer to the clarified request."
  }
]
```

**Tool Definitions**

```json
[
  {
    "name": "literature-search",
    "description": "Debug-only tool definition for literature-search.",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query"
      ],
      "properties": {
        "query": {
          "type": "string"
        }
      }
    }
  },
  {
    "name": "web-search",
    "description": "Debug-only tool definition for web-search.",
    "parameters": {
      "type": "object",
      "additionalProperties": false,
      "required": [
        "query"
      ],
      "properties": {
        "query": {
          "type": "string"
        }
      }
    }
  }
]
```

**Planned Tool Call**

```json
{
  "name": "literature-search",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

### 5. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-1",
    "name": "literature-search",
    "output": "{\"ok\":true,\"tool_name\":\"literature-search\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"literature-search\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
  }
]
```

### 6. science_loop_current_scientific_state

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

Intent: general_science_question

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Pre-synthesized question JSON:
{
  "tentative_answer": {
    "current_best_answer": "LLM Response"
  },
  "supporting_basis": [
    "API response",
    "literature-search returned 1 item(s).",
    "literature-search: debug:1 - API response",
    "literature-search: API response"
  ],
  "unresolved_issues": []
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Latest assistant text:
LLM Response

Latest tool result JSON:
{
  "ok": true,
  "tool_name": "literature-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-1",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-1",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "literature-search",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ]
}

Tool trace JSON:
[
  {
    "round": 1,
    "call_id": "debug-call-science-loop-1",
    "tool_name": "literature-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "literature-search",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  }
]

Citations JSON:
[
  {
    "source": "literature-search",
    "pointer": "debug:1",
    "reason": "API response"
  }
]

Rounds executed: 1/2

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "supported_now": [
    "LLM Response"
  ],
  "contradicted": [],
  "remains_unknown": [
    "LLM Response"
  ],
  "uncertainty_decision_relevant": true,
  "uncertainty_decision_reason": "LLM Response"
}
```

### 7. science_loop_exit_judge_sub_agent

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided first so you can see the current best answer, supporting basis, and unresolved issues before judging.

A compact current scientific state is provided to summarize what is supported, contradicted, still unknown, and whether the uncertainty is decision-relevant.

Judge the pre-synthesized answer only against the provided exit criteria and the provided evidence summary.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**User Prompt / Context**

```text
Judge whether the reasoning loop should stop now or continue.

Intent: general_science_question

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Pre-synthesized question JSON:
{
  "tentative_answer": {
    "current_best_answer": "LLM Response"
  },
  "supporting_basis": [
    "API response",
    "literature-search returned 1 item(s).",
    "literature-search: debug:1 - API response",
    "literature-search: API response"
  ],
  "unresolved_issues": []
}

Current scientific state JSON:
{
  "supported_now": [
    "LLM Response",
    "Collected 1 citation-backed evidence item(s).",
    "External evidence is available.",
    "At least one evidence-gathering tool step completed successfully.",
    "API response",
    "literature-search returned 1 item(s).",
    "literature-search: debug:1 - API response",
    "literature-search: API response"
  ],
  "contradicted": [],
  "remains_unknown": [
    "LLM Response"
  ],
  "uncertainty_decision_relevant": true,
  "uncertainty_decision_reason": "LLM Response"
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Latest assistant text:
LLM Response

Latest tool result JSON:
{
  "ok": true,
  "tool_name": "literature-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-1",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-1",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "literature-search",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ]
}

Tool trace JSON:
[
  {
    "round": 1,
    "call_id": "debug-call-science-loop-1",
    "tool_name": "literature-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "literature-search",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  }
]

Citations JSON:
[
  {
    "source": "literature-search",
    "pointer": "debug:1",
    "reason": "API response"
  }
]

Rounds executed: 1/2

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "satisfied": false,
  "reason": "LLM Response",
  "missing_requirements": [
    "LLM Response"
  ],
  "should_continue": true,
  "next_tool_hint": {
    "tool_name": "web-search",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
}
```

### 8. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: Recent/reference-style question still lacks an external citation-backed source.
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.; At least one external citation-backed source is still missing.
Suggested next tool: web-search.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "web-search",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

### 9. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-2",
    "name": "web-search",
    "output": "{\"ok\":true,\"tool_name\":\"web-search\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"web-search\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
  }
]
```

### 10. science_loop_current_scientific_state

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

Intent: general_science_question

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Pre-synthesized question JSON:
{
  "tentative_answer": {
    "current_best_answer": "LLM Response"
  },
  "supporting_basis": [
    "API response",
    "web-search returned 1 item(s).",
    "web-search: debug:2 - API response",
    "literature-search: debug:1 - API response",
    "literature-search: API response",
    "web-search: API response"
  ],
  "unresolved_issues": []
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Latest assistant text:
LLM Response

Latest tool result JSON:
{
  "ok": true,
  "tool_name": "web-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-2",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-2",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "web-search",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ]
}

Tool trace JSON:
[
  {
    "round": 1,
    "call_id": "debug-call-science-loop-1",
    "tool_name": "literature-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "literature-search",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  },
  {
    "round": 2,
    "call_id": "debug-call-science-loop-2",
    "tool_name": "web-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "web-search",
        "pointer": "debug:2",
        "reason": "API response"
      }
    ]
  }
]

Citations JSON:
[
  {
    "source": "literature-search",
    "pointer": "debug:1",
    "reason": "API response"
  },
  {
    "source": "web-search",
    "pointer": "debug:2",
    "reason": "API response"
  }
]

Rounds executed: 2/2

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "supported_now": [
    "LLM Response"
  ],
  "contradicted": [],
  "remains_unknown": [],
  "uncertainty_decision_relevant": false,
  "uncertainty_decision_reason": "LLM Response"
}
```

### 11. science_loop_exit_judge_sub_agent

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided first so you can see the current best answer, supporting basis, and unresolved issues before judging.

A compact current scientific state is provided to summarize what is supported, contradicted, still unknown, and whether the uncertainty is decision-relevant.

Judge the pre-synthesized answer only against the provided exit criteria and the provided evidence summary.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**User Prompt / Context**

```text
Judge whether the reasoning loop should stop now or continue.

Intent: general_science_question

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Pre-synthesized question JSON:
{
  "tentative_answer": {
    "current_best_answer": "LLM Response"
  },
  "supporting_basis": [
    "API response",
    "web-search returned 1 item(s).",
    "web-search: debug:2 - API response",
    "literature-search: debug:1 - API response",
    "literature-search: API response",
    "web-search: API response"
  ],
  "unresolved_issues": []
}

Current scientific state JSON:
{
  "supported_now": [
    "LLM Response",
    "Collected 2 citation-backed evidence item(s).",
    "External evidence is available.",
    "At least one evidence-gathering tool step completed successfully.",
    "API response",
    "web-search returned 1 item(s).",
    "web-search: debug:2 - API response",
    "literature-search: debug:1 - API response"
  ],
  "contradicted": [],
  "remains_unknown": [],
  "uncertainty_decision_relevant": false,
  "uncertainty_decision_reason": "LLM Response"
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Latest assistant text:
LLM Response

Latest tool result JSON:
{
  "ok": true,
  "tool_name": "web-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-2",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-2",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "web-search",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ]
}

Tool trace JSON:
[
  {
    "round": 1,
    "call_id": "debug-call-science-loop-1",
    "tool_name": "literature-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "literature-search",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  },
  {
    "round": 2,
    "call_id": "debug-call-science-loop-2",
    "tool_name": "web-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "web-search",
        "pointer": "debug:2",
        "reason": "API response"
      }
    ]
  }
]

Citations JSON:
[
  {
    "source": "literature-search",
    "pointer": "debug:1",
    "reason": "API response"
  },
  {
    "source": "web-search",
    "pointer": "debug:2",
    "reason": "API response"
  }
]

Rounds executed: 2/2

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "satisfied": true,
  "reason": "LLM Response",
  "missing_requirements": [],
  "should_continue": false,
  "next_tool_hint": null,
  "can_answer_with_limitations": true
}
```

### 12. science_reasoning_final_synthesis

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
You are the final answer synthesizer for a science reasoning loop.

Answer using only the evidence and tool trace provided by the app.

Do not invent evidence, papers, values, or project facts.

The loop stopped before full satisfaction. Produce the best available answer and explicitly name the remaining gaps.

Intent: general_science_question

Policy JSON:
{
  "intent": "general_science_question",
  "description": "Use literature and web retrieval to answer general science questions with grounded citations.",
  "tool_scope": null,
  "retrieval_priority": "literature_first_web_last",
  "require_external_citation_when_recent": true,
  "require_retrieval_attempt": true,
  "answer_with_limitations_after_attempt": true
}

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Rounds executed: 2/2

Evaluator JSON:
{
  "satisfied": false,
  "reason": "Recent/reference-style question still lacks an external citation-backed source.",
  "missing_requirements": [
    "The current evidence directly supports the core answer to the clarified request.",
    "At least one external citation-backed source is still missing."
  ],
  "should_continue": true,
  "next_tool_hint": {
    "tool_name": null,
    "query": "What does the latest evidence suggest about this science question?\nLLM Response",
    "reason": "Retrieve at least one external citation-backed source before answering."
  },
  "can_answer_with_limitations": true
}

Citations JSON:
[
  {
    "source": "literature-search",
    "pointer": "debug:1",
    "reason": "API response"
  },
  {
    "source": "web-search",
    "pointer": "debug:2",
    "reason": "API response"
  }
]

Tool trace JSON:
[
  {
    "round": 1,
    "call_id": "debug-call-science-loop-1",
    "tool_name": "literature-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "literature-search",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  },
  {
    "round": 2,
    "call_id": "debug-call-science-loop-2",
    "tool_name": "web-search",
    "input": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "ok": true,
    "summary": "API response",
    "truncated_multi_call": false,
    "error": "",
    "citations": [
      {
        "source": "web-search",
        "pointer": "debug:2",
        "reason": "API response"
      }
    ]
  }
]

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "answer": "LLM Response",
  "confidence": 0.68,
  "decision_record": {
    "assumptions": [
      "LLM Response"
    ],
    "open_questions": [],
    "verification_notes": [
      "LLM Response"
    ]
  },
  "follow_up_questions": []
}
```

### 13. science_thinking_trace

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Generate short workflow-thinking sentences for this science reasoning run.

Return exactly one concise sentence for each named step.

Use only the supplied trace and do not invent tools, papers, computations, or conclusions.

The tone should sound like an internal working note, for example:

- This is a general science question.

- The user wants to understand the mechanism with grounded evidence.

- I am looking at the tool list to pick the most targeted next step.

- I want to search for a focused literature source first.

- Based on the tool result, it seems I still need one broader source.

- I have gathered enough information, and I am ready to synthesize the final answer.

For tool_rounds, create one entry per executed round.

final_synthesized_question must be the best single-sentence formulation of the exact question the workflow answered or tried to answer.

Intent: general_science_question

Original user message:
What does the latest evidence suggest about this science question?

Clarified request:
LLM Response

Parser payload JSON:
{
  "primary_intent": "general_science_question",
  "reasoning_effort": 2,
  "needs_clarification": false,
  "clarification_reason": "",
  "clarification_question": "",
  "direct_answer": "",
  "reasoning_summary": "LLM Response",
  "entities": {
    "requested_output": "debug-context-export"
  }
}

Clarification JSON:
{
  "clarified_input": "LLM Response",
  "analysis_goal": "LLM Response",
  "important_constraints": [
    "LLM Response",
    "Intent: general_science_question",
    "Requested output: debug-context-export"
  ],
  "missing_information": [],
  "should_ask_follow_up": false,
  "follow_up_question": "",
  "follow_up_reason": "LLM Response"
}

Route plan JSON:
{
  "goal": "LLM Response",
  "route_summary": "LLM Response",
  "step_sequence": [
    {
      "step_label": "step-1",
      "objective": "LLM Response",
      "suggested_tools": [
        "literature-search"
      ],
      "reason": "LLM Response"
    },
    {
      "step_label": "step-2",
      "objective": "LLM Response",
      "suggested_tools": [
        "web-search"
      ],
      "reason": "LLM Response"
    }
  ],
  "tool_call_suggestions": [
    {
      "tool_name": "literature-search",
      "priority": 1,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "web-search",
      "priority": 2,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    }
  ],
  "decision_points": [
    "LLM Response",
    "If the first evidence step is weak, refine the query before expanding the search surface.",
    "Stop early when the current evidence directly answers the clarified request with stated limitations."
  ],
  "adaptation_notes": [
    "LLM Response",
    "This route is a reference only and can be changed when tool results reveal a better path.",
    "Skip low-yield steps instead of following the sequence mechanically.",
    "Preserve explicit uncertainty whenever evidence is incomplete or conflicting."
  ],
  "reference_only": true
}

Exit criteria JSON:
{
  "objective_summary": "LLM Response",
  "exit_conditions": [
    "LLM Response",
    "The current evidence directly supports the core answer to the clarified request.",
    "The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support."
  ],
  "required_evidence": [
    "LLM Response",
    "At least one evidence-gathering round has run before the loop exits."
  ],
  "continue_when": [
    "LLM Response",
    "A blocking evidence gap still prevents a grounded answer."
  ],
  "can_exit_with_limitations_when": [
    "LLM Response",
    "A best-effort answer is allowed when the main remaining gaps are stated explicitly.",
    "Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated."
  ],
  "preferred_next_tools": [
    "literature-search",
    "web-search"
  ],
  "reasoning_notes": "LLM Response"
}

Tool rounds JSON:
[
  {
    "round": 1,
    "assistant_before_tool": "LLM Response",
    "tool_name": "literature-search",
    "tool_arguments": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "tool_summary": "API response",
    "tool_error": "",
    "assistant_after_tool": "LLM Response"
  },
  {
    "round": 2,
    "assistant_before_tool": "LLM Response",
    "tool_name": "web-search",
    "tool_arguments": {
      "query": "What does the latest evidence suggest about this science question?"
    },
    "tool_summary": "API response",
    "tool_error": "",
    "assistant_after_tool": "LLM Response"
  }
]

Pre-synthesized question JSON:
{
  "tentative_answer": {
    "current_best_answer": "LLM Response"
  },
  "supporting_basis": [
    "API response",
    "web-search returned 1 item(s).",
    "web-search: debug:2 - API response",
    "literature-search: debug:1 - API response",
    "literature-search: API response",
    "web-search: API response"
  ],
  "unresolved_issues": []
}

Judge evaluation JSON:
{
  "satisfied": false,
  "reason": "Recent/reference-style question still lacks an external citation-backed source.",
  "missing_requirements": [
    "The current evidence directly supports the core answer to the clarified request.",
    "At least one external citation-backed source is still missing."
  ],
  "should_continue": true,
  "next_tool_hint": {
    "tool_name": null,
    "query": "What does the latest evidence suggest about this science question?\nLLM Response",
    "reason": "Retrieve at least one external citation-backed source before answering."
  },
  "can_answer_with_limitations": true
}

Final status: partial

Final answer:
LLM Response

Return JSON only.
```

**Debug Shim Payload**

```json
{
  "intent_parse_question": "LLM Response",
  "question_clarifier": "LLM Response",
  "criteria_generate": "LLM Response",
  "tool_rounds": [
    {
      "round": 1,
      "tool_selection": "LLM Response",
      "tool_call": "LLM Response",
      "tool_results": "LLM Response"
    },
    {
      "round": 2,
      "tool_selection": "LLM Response",
      "tool_call": "LLM Response",
      "tool_results": "LLM Response"
    }
  ],
  "pre_synthesize_answer": "LLM Response",
  "judge": "LLM Response",
  "final_synthesize": "LLM Response",
  "final_synthesized_question": "LLM Response"
}
```

### Internal API Calls

### 1. literature-search

Stub response: `API response`

**Arguments**

```json
{
  "query": "What does the latest evidence suggest about this science question?"
}
```

**Debug Envelope**

```json
{
  "ok": true,
  "tool_name": "literature-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-1",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-1",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "literature-search",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ]
}
```

### 2. web-search

Stub response: `API response`

**Arguments**

```json
{
  "query": "What does the latest evidence suggest about this science question?"
}
```

**Debug Envelope**

```json
{
  "ok": true,
  "tool_name": "web-search",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-2",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-2",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "web-search",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ]
}
```

### Lifecycle

1. `science_clarification_started` [started] Clarifying general_science_question input before tool execution.
2. `science_clarification_completed` [ok] Science input was clarified and is ready for reasoning.
3. `science_route_planner_started` [started] Drafting a reference route plan for general_science_question.
4. `science_route_planner_completed` [ok] Reference route plan is ready.
5. `science_exit_criteria_started` [started] Generating exit criteria for general_science_question.
6. `science_exit_criteria_completed` [ok] Science loop exit criteria are ready.
7. `science_intent_started` [started] Started shared science reasoning loop for general_science_question.
8. `science_round_started` [started] Science reasoning round 1 started with literature-search.
9. `science_evaluator_continue` [started] Recent/reference-style question still lacks an external citation-backed source.
10. `science_round_started` [started] Science reasoning round 2 started with web-search.
11. `science_budget_exhausted` [failed] Science reasoning loop exhausted its tool round budget.
12. `science_intent_completed` [pending] Science reasoning loop completed with limitations.