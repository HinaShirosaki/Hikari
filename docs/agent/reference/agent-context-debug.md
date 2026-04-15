# Agent Context Debug Export

Generated at: 2026-04-12T22:32:13.963Z

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
      "state_id": "science_intake-1776033133951-122cbd",
      "created_at": "2026-04-12T22:32:13.951Z",
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
      "state_id": "science_direct_answer-1776033133951-225236",
      "created_at": "2026-04-12T22:32:13.951Z",
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
    "question_clarifier": "The user wants to understand: What does the latest evidence suggest about this science question?",
    "criteria_generate": "I am defining what evidence would be enough to answer safely.",
    "tool_rounds": [],
    "pre_synthesize_answer": "LLM Response",
    "judge": "I am checking whether the evidence is sufficient or whether a key gap remains.",
    "final_synthesize": "I have gathered enough information and I am ready to synthesize the final answer.",
    "final_synthesized_question": "What does the latest evidence suggest about this science question?"
  },
  "final_synthesized_question": "What does the latest evidence suggest about this science question?"
}
```

### Round Contexts

_No round-by-round context was captured._

### Context Snapshots

### 1. Initial context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 2. Final context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Recent completed tasks: LLM Response | LLM Response

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

Intent: general_science_question

Reasoning effort: 0

Execution mode: direct answer only.

Execution hints:
- Retrieval preference: literature_first_web_last.
- Use an external citation when the clarified request depends on freshness or recency.
- Make at least one evidence-gathering attempt before answering.
- A limitation-qualified answer is acceptable after a best-effort evidence attempt.

1. You are handling a reasoning_effort=0 science request.
2. Answer directly without entering the deterministic science reasoning loop.
3. Provide a complete answer: lead with the main conclusion, then explain the key reasoning and any important caveats.
4. Do not be artificially terse unless the user explicitly asked for a short answer.
5. Do not call tools or ask to enter a reasoning loop.
6. Use stable scientific knowledge plus the provided context only.
7. Do not fabricate project records, literature results, or computation outputs.
8. For general science questions, prefer the most targeted citation-backed evidence path available.
9. This request was classified as reasoning_effort=0.
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

### Exact Raw Prompt Payloads

### 1. science_agent_session_start

Kind: `agent-session-start`

**Raw System Prompt**

```text
You are a debug-only Enana agent runtime.

Intent: general_science_question

Reasoning effort: 0

Execution mode: direct answer only.

Execution hints:
- Retrieval preference: literature_first_web_last.
- Use an external citation when the clarified request depends on freshness or recency.
- Make at least one evidence-gathering attempt before answering.
- A limitation-qualified answer is acceptable after a best-effort evidence attempt.

1. You are handling a reasoning_effort=0 science request.
2. Answer directly without entering the deterministic science reasoning loop.
3. Provide a complete answer: lead with the main conclusion, then explain the key reasoning and any important caveats.
4. Do not be artificially terse unless the user explicitly asked for a short answer.
5. Do not call tools or ask to enter a reasoning loop.
6. Use stable scientific knowledge plus the provided context only.
7. Do not fabricate project records, literature results, or computation outputs.
8. For general science questions, prefer the most targeted citation-backed evidence path available.
9. This request was classified as reasoning_effort=0.
```

**Raw Message**

```text
What does the latest evidence suggest about this science question?
```

**Raw Conversation**

```json
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  }
]
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
    "inventory-lookup",
    "record-lookup",
    "protocol-matching",
    "notebook-generation",
    "notebook-draft",
    "python-sandbox",
    "command-line",
    "sub-agent",
    "memory",
    "literature-search",
    "purchase-recommendation",
    "paper-download",
    "paper-analysis",
    "protocol-generation"
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
      "state_id": "science_intake-1776033133952-293196",
      "created_at": "2026-04-12T22:32:13.952Z",
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
      "state_id": "science_clarification-1776033133952-187022",
      "created_at": "2026-04-12T22:32:13.952Z",
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
    "question_clarifier": "I need one blocking clarification before I can continue the science reasoning loop.",
    "criteria_generate": "I am defining what evidence would be enough to answer safely.",
    "tool_rounds": [],
    "pre_synthesize_answer": "Based on the evidence so far, I am drafting a tentative answer.",
    "judge": "I am checking whether the evidence is sufficient or whether a key gap remains.",
    "final_synthesize": "I have gathered enough information and I am ready to synthesize the final answer.",
    "final_synthesized_question": "LLM Response"
  },
  "final_synthesized_question": "LLM Response"
}
```

### Round Contexts

_No round-by-round context was captured._

### Context Snapshots

### 1. Initial context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 2. After follow-up question was recorded

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Task summary:
Task type: science_reasoning_loop
Intent: general_science_question
Status: active
Follow-up questions: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: LLM Response

Long-term memory:

No recalled long-term memory.
```

### 3. Final context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: LLM Response

Task summary:
Task type: science_reasoning_loop
Intent: general_science_question
Status: active
Follow-up questions: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: LLM Response

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

Include trace_sentence as one short sentence describing what you are doing at this step.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

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

### Exact Raw Prompt Payloads

### 1. science_input_clarification

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Clarify the user request for the science reasoning loop.

Rewrite the request into a self-contained, execution-ready input for the next module.

Ask at most one follow-up question, and only when the missing detail is truly blocking.

Include trace_sentence as one short sentence describing what you are doing at this step.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

User message:
What does the latest evidence suggest about this science question?

Return JSON only.
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
    "inventory-lookup",
    "record-lookup",
    "protocol-matching",
    "notebook-generation",
    "notebook-draft",
    "python-sandbox",
    "command-line",
    "sub-agent",
    "memory",
    "literature-search",
    "purchase-recommendation",
    "paper-download",
    "paper-analysis",
    "protocol-generation"
  ],
  "project": null
}
```

### Final Result

```json
{
  "status": "completed",
  "answer": "LLM Response\n\nRemaining gaps: The current evidence directly supports the core answer to the clarified request..\n\nLatest tool summary: API response",
  "confidence": 0.74,
  "citations": [
    {
      "source": "python-sandbox",
      "pointer": "debug:1",
      "reason": "API response"
    },
    {
      "source": "inventory-lookup",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ],
  "decision_record": {
    "assumptions": [
      "The evaluator judged the collected evidence sufficient for a grounded answer.",
      "The answer is grounded in 2 citation-backed evidence item(s).",
      "general_science_question used the shared science reasoning loop.",
      "Citation count=2."
    ],
    "open_questions": [
      "The current evidence directly supports the core answer to the clarified request."
    ],
    "verification_notes": [
      "LLM Response",
      "python-sandbox: API response",
      "inventory-lookup: API response",
      "The evaluator marked the evidence as sufficient before final synthesis."
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
    "follow_up_reason": "LLM Response",
    "trace_sentence": "I am clarifying the user request into an execution-ready science question."
  },
  "route_plan": {
    "goal": "LLM Response",
    "route_summary": "LLM Response",
    "step_sequence": [
      {
        "step_label": "step-1",
        "objective": "LLM Response",
        "suggested_tools": [
          "inventory-lookup"
        ],
        "reason": "LLM Response"
      },
      {
        "step_label": "step-2",
        "objective": "LLM Response",
        "suggested_tools": [
          "record-lookup"
        ],
        "reason": "LLM Response"
      },
      {
        "step_label": "step-3",
        "objective": "LLM Response",
        "suggested_tools": [
          "protocol-matching"
        ],
        "reason": "LLM Response"
      }
    ],
    "tool_call_suggestions": [
      {
        "tool_name": "inventory-lookup",
        "priority": 1,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "record-lookup",
        "priority": 2,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "protocol-matching",
        "priority": 3,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "notebook-generation",
        "priority": 4,
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
    "reference_only": true,
    "trace_sentence": "I am sketching a lightweight route so the loop can start with the most targeted evidence step."
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
      "inventory-lookup",
      "record-lookup",
      "protocol-matching",
      "notebook-generation",
      "notebook-draft",
      "python-sandbox"
    ],
    "reasoning_notes": "LLM Response",
    "trace_sentence": "I am defining what evidence must exist before the reasoning loop can safely stop."
  },
  "tool_trace": [
    {
      "round": 1,
      "call_id": "debug-call-science-loop-1",
      "tool_name": "python-sandbox",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "status": "",
      "run_id": "",
      "summary": "API response",
      "multi_tool_round": false,
      "tool_index_in_round": 1,
      "tool_count_in_round": 1,
      "truncated_multi_call": false,
      "error": "",
      "stdout": "",
      "stderr": "",
      "render_outputs": [],
      "citations": [
        {
          "source": "python-sandbox",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "loaded_context_blocks": []
    },
    {
      "round": 2,
      "call_id": "debug-call-science-loop-2",
      "tool_name": "inventory-lookup",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "status": "",
      "run_id": "",
      "summary": "API response",
      "multi_tool_round": false,
      "tool_index_in_round": 1,
      "tool_count_in_round": 1,
      "truncated_multi_call": false,
      "error": "",
      "stdout": "",
      "stderr": "",
      "render_outputs": [],
      "citations": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "loaded_context_blocks": []
    }
  ],
  "intermediate_states": [
    {
      "state_id": "science_intake-1776033133954-cc2a1a",
      "created_at": "2026-04-12T22:32:13.954Z",
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
      "state_id": "science_clarification-1776033133954-91679f",
      "created_at": "2026-04-12T22:32:13.954Z",
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
      "state_id": "science_route_plan-1776033133955-bc236b",
      "created_at": "2026-04-12T22:32:13.955Z",
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
          "tool_name": "inventory-lookup",
          "risk_level": "low",
          "reason": "LLM Response"
        },
        {
          "action_type": "read",
          "tool_name": "record-lookup",
          "risk_level": "low",
          "reason": "LLM Response"
        },
        {
          "action_type": "read",
          "tool_name": "protocol-matching",
          "risk_level": "low",
          "reason": "LLM Response"
        },
        {
          "action_type": "read",
          "tool_name": "notebook-generation",
          "risk_level": "low",
          "reason": "LLM Response"
        }
      ],
      "confidence": 0.64
    },
    {
      "state_id": "science_exit_criteria-1776033133955-4e7bdc",
      "created_at": "2026-04-12T22:32:13.955Z",
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
      "state_id": "science_tool_round-1776033133957-c5266d",
      "created_at": "2026-04-12T22:32:13.957Z",
      "stage": "science_tool_round",
      "goal": "Executed python-sandbox in round 1.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "At least one tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "python-sandbox",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "python-sandbox",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1776033133958-8cf28c",
      "created_at": "2026-04-12T22:32:13.958Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "python-sandbox",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1776033133961-c15bff",
      "created_at": "2026-04-12T22:32:13.961Z",
      "stage": "science_tool_round",
      "goal": "Executed inventory-lookup in round 2.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "At least one tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "inventory-lookup",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1776033133961-2159e3",
      "created_at": "2026-04-12T22:32:13.961Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_synthesis-1776033133962-552f10",
      "created_at": "2026-04-12T22:32:13.962Z",
      "stage": "science_synthesis",
      "goal": "Synthesized final science answer from tool evidence.",
      "assumptions": [
        "Final answer was produced after evaluator satisfaction.",
        "Total citations=2."
      ],
      "open_questions": [
        "The current evidence directly supports the core answer to the clarified request."
      ],
      "evidence": [
        {
          "source": "python-sandbox",
          "pointer": "debug:1",
          "reason": "API response"
        },
        {
          "source": "inventory-lookup",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.74
    }
  ],
  "rounds_executed": 2,
  "reasoning_effort": 2,
  "follow_up_questions": [
    "Could you clarify: The current evidence directly supports the core answer to the clarified request."
  ],
  "thinking_trace": {
    "intent_parse_question": "LLM Response",
    "question_clarifier": "I am clarifying the user request into an execution-ready science question.",
    "criteria_generate": "I am sketching a lightweight route so the loop can start with the most targeted evidence step. I am defining what evidence must exist before the reasoning loop can safely stop.",
    "tool_rounds": [
      {
        "round": 1,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use python-sandbox to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 2,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use inventory-lookup to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      }
    ],
    "pre_synthesize_answer": "LLM Response",
    "judge": "I am checking whether the current evidence is sufficient or whether a blocking gap remains.",
    "final_synthesize": "I am synthesizing the final grounded answer from the evidence collected so far.",
    "final_synthesized_question": "LLM Response"
  },
  "final_synthesized_question": "LLM Response"
}
```

### Round Contexts

### Round 1

Selection mode: `random`

**Selected Tool**

```json
{
  "name": "python-sandbox",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

**Agent Request**

```json
{
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nIntent: general_science_question\n\nReasoning effort: 2\n\nExecution hints:\n- Retrieval preference: literature_first_web_last.\n- Use an external citation when the clarified request depends on freshness or recency.\n- Make at least one evidence-gathering attempt before answering.\n- A limitation-qualified answer is acceptable after a best-effort evidence attempt.\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: inventory-lookup | record-lookup | protocol-matching\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.\n3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.\n10. For general science questions, prefer the most targeted citation-backed evidence path available.",
  "message": "LLM Response",
  "feedback_message": "",
  "conversation": [
    {
      "role": "user",
      "text": "What does the latest evidence suggest about this science question?"
    },
    {
      "role": "assistant",
      "text": "Could you clarify: The current evidence directly supports the core answer to the clarified request."
    }
  ],
  "tool_definitions": [
    {
      "name": "inventory-lookup",
      "description": "Debug-only tool definition for inventory-lookup.",
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
      "name": "record-lookup",
      "description": "Debug-only tool definition for record-lookup.",
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
      "name": "protocol-matching",
      "description": "Debug-only tool definition for protocol-matching.",
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
      "name": "notebook-generation",
      "description": "Debug-only tool definition for notebook-generation.",
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
      "name": "notebook-draft",
      "description": "Debug-only tool definition for notebook-draft.",
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
      "name": "python-sandbox",
      "description": "Debug-only tool definition for python-sandbox.",
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
      "name": "command-line",
      "description": "Debug-only tool definition for command-line.",
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
      "name": "sub-agent",
      "description": "Debug-only tool definition for sub-agent.",
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
      "name": "memory",
      "description": "Debug-only tool definition for memory.",
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
      "name": "purchase-recommendation",
      "description": "Debug-only tool definition for purchase-recommendation.",
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
      "name": "paper-download",
      "description": "Debug-only tool definition for paper-download.",
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
      "name": "paper-analysis",
      "description": "Debug-only tool definition for paper-analysis.",
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
      "name": "protocol-generation",
      "description": "Debug-only tool definition for protocol-generation.",
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
}
```

**Agent Request Raw Payload**

```json
{
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nIntent: general_science_question\n\nReasoning effort: 2\n\nExecution hints:\n- Retrieval preference: literature_first_web_last.\n- Use an external citation when the clarified request depends on freshness or recency.\n- Make at least one evidence-gathering attempt before answering.\n- A limitation-qualified answer is acceptable after a best-effort evidence attempt.\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: inventory-lookup | record-lookup | protocol-matching\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.\n3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.\n10. For general science questions, prefer the most targeted citation-backed evidence path available.",
  "message": "LLM Response",
  "feedback_message": "",
  "conversation": [
    {
      "role": "user",
      "text": "What does the latest evidence suggest about this science question?"
    }
  ],
  "tool_definitions": [
    {
      "name": "inventory-lookup",
      "description": "Debug-only tool definition for inventory-lookup.",
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
      "name": "record-lookup",
      "description": "Debug-only tool definition for record-lookup.",
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
      "name": "protocol-matching",
      "description": "Debug-only tool definition for protocol-matching.",
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
      "name": "notebook-generation",
      "description": "Debug-only tool definition for notebook-generation.",
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
      "name": "notebook-draft",
      "description": "Debug-only tool definition for notebook-draft.",
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
      "name": "python-sandbox",
      "description": "Debug-only tool definition for python-sandbox.",
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
      "name": "command-line",
      "description": "Debug-only tool definition for command-line.",
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
      "name": "sub-agent",
      "description": "Debug-only tool definition for sub-agent.",
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
      "name": "memory",
      "description": "Debug-only tool definition for memory.",
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
      "name": "purchase-recommendation",
      "description": "Debug-only tool definition for purchase-recommendation.",
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
      "name": "paper-download",
      "description": "Debug-only tool definition for paper-download.",
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
      "name": "paper-analysis",
      "description": "Debug-only tool definition for paper-analysis.",
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
      "name": "protocol-generation",
      "description": "Debug-only tool definition for protocol-generation.",
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
}
```

**Context Before Round**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "python-sandbox",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "python-sandbox",
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
        "source": "python-sandbox",
        "pointer": "debug:1",
        "reason": "API response"
      }
    ]
  }
}
```

**Agent Continuation After Tool**

```json
{
  "tool_outputs": [
    {
      "callId": "debug-call-science-loop-1",
      "name": "python-sandbox",
      "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
    }
  ],
  "assistant_after_tool": "LLM Response"
}
```

**Context After Round**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- python-sandbox (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 2

Selection mode: `random`

**Selected Tool**

```json
{
  "name": "inventory-lookup",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

**Agent Request**

```json
{
  "system_prompt": "",
  "message": "What does the latest evidence suggest about this science question?",
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: python-sandbox.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best tool call or tightly scoped parallel tool batch, or answer directly only if the evidence is now sufficient.",
  "conversation": [
    {
      "role": "user",
      "text": "What does the latest evidence suggest about this science question?"
    },
    {
      "role": "assistant",
      "text": "Could you clarify: The current evidence directly supports the core answer to the clarified request."
    }
  ],
  "tool_definitions": [
    {
      "name": "inventory-lookup",
      "description": "Debug-only tool definition for inventory-lookup.",
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
      "name": "record-lookup",
      "description": "Debug-only tool definition for record-lookup.",
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
      "name": "protocol-matching",
      "description": "Debug-only tool definition for protocol-matching.",
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
      "name": "notebook-generation",
      "description": "Debug-only tool definition for notebook-generation.",
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
      "name": "notebook-draft",
      "description": "Debug-only tool definition for notebook-draft.",
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
      "name": "python-sandbox",
      "description": "Debug-only tool definition for python-sandbox.",
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
      "name": "command-line",
      "description": "Debug-only tool definition for command-line.",
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
      "name": "sub-agent",
      "description": "Debug-only tool definition for sub-agent.",
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
      "name": "memory",
      "description": "Debug-only tool definition for memory.",
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
      "name": "purchase-recommendation",
      "description": "Debug-only tool definition for purchase-recommendation.",
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
      "name": "paper-download",
      "description": "Debug-only tool definition for paper-download.",
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
      "name": "paper-analysis",
      "description": "Debug-only tool definition for paper-analysis.",
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
      "name": "protocol-generation",
      "description": "Debug-only tool definition for protocol-generation.",
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
}
```

**Agent Request Raw Payload**

```json
{
  "system_prompt": "",
  "message": "What does the latest evidence suggest about this science question?",
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: python-sandbox.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best tool call or tightly scoped parallel tool batch, or answer directly only if the evidence is now sufficient.",
  "conversation": [
    {
      "role": "user",
      "text": "What does the latest evidence suggest about this science question?"
    }
  ],
  "tool_definitions": [
    {
      "name": "inventory-lookup",
      "description": "Debug-only tool definition for inventory-lookup.",
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
      "name": "record-lookup",
      "description": "Debug-only tool definition for record-lookup.",
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
      "name": "protocol-matching",
      "description": "Debug-only tool definition for protocol-matching.",
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
      "name": "notebook-generation",
      "description": "Debug-only tool definition for notebook-generation.",
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
      "name": "notebook-draft",
      "description": "Debug-only tool definition for notebook-draft.",
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
      "name": "python-sandbox",
      "description": "Debug-only tool definition for python-sandbox.",
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
      "name": "command-line",
      "description": "Debug-only tool definition for command-line.",
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
      "name": "sub-agent",
      "description": "Debug-only tool definition for sub-agent.",
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
      "name": "memory",
      "description": "Debug-only tool definition for memory.",
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
      "name": "purchase-recommendation",
      "description": "Debug-only tool definition for purchase-recommendation.",
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
      "name": "paper-download",
      "description": "Debug-only tool definition for paper-download.",
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
      "name": "paper-analysis",
      "description": "Debug-only tool definition for paper-analysis.",
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
      "name": "protocol-generation",
      "description": "Debug-only tool definition for protocol-generation.",
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
}
```

**Context Before Round**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- python-sandbox (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "inventory-lookup",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "inventory-lookup",
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
        "source": "inventory-lookup",
        "pointer": "debug:2",
        "reason": "API response"
      }
    ]
  }
}
```

**Agent Continuation After Tool**

```json
{
  "tool_outputs": [
    {
      "callId": "debug-call-science-loop-2",
      "name": "inventory-lookup",
      "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
    }
  ],
  "assistant_after_tool": "LLM Response"
}
```

**Context After Round**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- inventory-lookup (ok) | summary: API response
- python-sandbox (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Context Snapshots

### 1. Initial context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 2. After python-sandbox round 1

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- python-sandbox (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 3. After inventory-lookup round 2

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- inventory-lookup (ok) | summary: API response
- python-sandbox (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 4. After follow-up question was recorded

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Latest tool outputs:
- inventory-lookup (ok) | summary: API response
- python-sandbox (ok) | summary: API response

Task summary:
Task type: science_reasoning_loop
Intent: general_science_question
Status: active
Follow-up questions: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Long-term memory:

No recalled long-term memory.
```

### 5. Final context

**Real Context**

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

Remaining gaps: The current evidence directly supports the core answer to the clarified request..

Latest tool summary: API response | LLM Response

Remaining gaps: The current evidence directly supports the core answer to the clarified request..

Latest tool summary: API response

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

Include trace_sentence as one short sentence describing what you are doing at this step.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

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

Include trace_sentence as one short sentence describing what you are doing at this step.

Prefer only tools that are already allowed by policy or tool scope.

For literature-search query_hint, return short keyword phrases rather than a full sentence.

Clarified request:
LLM Response

Reasoning effort 2: a broader multi-step route is acceptable, but do not over-plan.

Intent: general_science_question

Reasoning effort: 2

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Allowed tools: inventory-lookup | record-lookup | protocol-matching | notebook-generation | notebook-draft | python-sandbox

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
        "inventory-lookup"
      ],
      "reason": "LLM Response"
    },
    {
      "step_label": "step-2",
      "objective": "LLM Response",
      "suggested_tools": [
        "record-lookup"
      ],
      "reason": "LLM Response"
    },
    {
      "step_label": "step-3",
      "objective": "LLM Response",
      "suggested_tools": [
        "protocol-matching"
      ],
      "reason": "LLM Response"
    }
  ],
  "tool_call_suggestions": [
    {
      "tool_name": "inventory-lookup",
      "priority": 1,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "record-lookup",
      "priority": 2,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "protocol-matching",
      "priority": 3,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "notebook-generation",
      "priority": 4,
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

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Intent: general_science_question

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Allowed tools: inventory-lookup | record-lookup | protocol-matching | notebook-generation | notebook-draft | python-sandbox

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
    "inventory-lookup",
    "record-lookup",
    "protocol-matching",
    "notebook-generation"
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

Intent: general_science_question

Reasoning effort: 2

Execution hints:
- Retrieval preference: literature_first_web_last.
- Use an external citation when the clarified request depends on freshness or recency.
- Make at least one evidence-gathering attempt before answering.
- A limitation-qualified answer is acceptable after a best-effort evidence attempt.
- Loop goal: LLM Response
- Route summary: LLM Response
- Preferred tools: inventory-lookup | record-lookup | protocol-matching
- Route suggestions are guidance only.
- Objective: LLM Response
- Exit when: LLM Response

The clarified execution request is provided separately as the session message.

1. You are inside a deterministic science reasoning loop.
2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.
3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.
4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.
5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.
6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.
7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.
8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.
9. Do not fabricate project records, literature results, or computation outputs.
10. For general science questions, prefer the most targeted citation-backed evidence path available.
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
    "name": "inventory-lookup",
    "description": "Debug-only tool definition for inventory-lookup.",
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
    "name": "record-lookup",
    "description": "Debug-only tool definition for record-lookup.",
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
    "name": "protocol-matching",
    "description": "Debug-only tool definition for protocol-matching.",
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
    "name": "notebook-generation",
    "description": "Debug-only tool definition for notebook-generation.",
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
    "name": "notebook-draft",
    "description": "Debug-only tool definition for notebook-draft.",
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
    "name": "python-sandbox",
    "description": "Debug-only tool definition for python-sandbox.",
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
    "name": "command-line",
    "description": "Debug-only tool definition for command-line.",
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
    "name": "sub-agent",
    "description": "Debug-only tool definition for sub-agent.",
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
    "name": "memory",
    "description": "Debug-only tool definition for memory.",
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
    "name": "purchase-recommendation",
    "description": "Debug-only tool definition for purchase-recommendation.",
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
    "name": "paper-download",
    "description": "Debug-only tool definition for paper-download.",
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
    "name": "paper-analysis",
    "description": "Debug-only tool definition for paper-analysis.",
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
    "name": "protocol-generation",
    "description": "Debug-only tool definition for protocol-generation.",
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
  "name": "python-sandbox",
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
    "name": "python-sandbox",
    "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
  }
]
```

### 6. science_loop_logic_extraction

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Extract the short logical structure from the current pre-synthesized answer.

Deductive means a direct conclusion from the stated basis.

Inductive means a pattern or generalization from the available evidence.

Abductive means the current best explanation or hypothesis.

Return a short context, the short pre-synthesized answer, and a short logic_list.

Each logic_list item should contain one reasoning_type and one short logic string.

Do not add evidence or alternatives that are not already in the provided answer state.

Clarified request:
LLM Response

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- python-sandbox returned 1 item(s).
- python-sandbox: debug:1 - API response
- python-sandbox: API response

Return JSON only.
```

### 7. science_loop_exit_judge_sub_agent

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**User Prompt / Context**

```text
Judge whether the reasoning loop should stop now or continue.

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Exit criteria:
Objective: LLM Response
Exit conditions:
- LLM Response
- The current evidence directly supports the core answer to the clarified request.
- The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support.
Required evidence:
- LLM Response
- At least one evidence-gathering round has run before the loop exits.
Continue when:
- LLM Response
- A blocking evidence gap still prevents a grounded answer.
Can exit with limitations when:
- LLM Response
- A best-effort answer is allowed when the main remaining gaps are stated explicitly.
- Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated.
Preferred next tools: inventory-lookup | record-lookup | protocol-matching

Pre-synthesized question:
Current best answer: LLM Response
Supporting basis:
- API response
- python-sandbox returned 1 item(s).
- python-sandbox: debug:1 - API response
- python-sandbox: API response
Logical verification:
Part 1:
- Context: API response | python-sandbox returned 1 item(s).
- Pre-synthesized answer: LLM Response

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
    "tool_name": "python-sandbox",
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
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: python-sandbox.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best tool call or tightly scoped parallel tool batch, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "inventory-lookup",
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
    "name": "inventory-lookup",
    "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
  }
]
```

### 10. science_loop_logic_extraction

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
Return valid JSON only.
```

**User Prompt / Context**

```text
Extract the short logical structure from the current pre-synthesized answer.

Deductive means a direct conclusion from the stated basis.

Inductive means a pattern or generalization from the available evidence.

Abductive means the current best explanation or hypothesis.

Return a short context, the short pre-synthesized answer, and a short logic_list.

Each logic_list item should contain one reasoning_type and one short logic string.

Do not add evidence or alternatives that are not already in the provided answer state.

Clarified request:
LLM Response

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- inventory-lookup returned 1 item(s).
- inventory-lookup: debug:2 - API response
- python-sandbox: debug:1 - API response

Return JSON only.
```

### 11. science_loop_exit_judge_sub_agent

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**User Prompt / Context**

```text
Judge whether the reasoning loop should stop now or continue.

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Exit criteria:
Objective: LLM Response
Exit conditions:
- LLM Response
- The current evidence directly supports the core answer to the clarified request.
- The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support.
Required evidence:
- LLM Response
- At least one evidence-gathering round has run before the loop exits.
Continue when:
- LLM Response
- A blocking evidence gap still prevents a grounded answer.
Can exit with limitations when:
- LLM Response
- A best-effort answer is allowed when the main remaining gaps are stated explicitly.
- Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated.
Preferred next tools: inventory-lookup | record-lookup | protocol-matching

Pre-synthesized question:
Current best answer: LLM Response
Supporting basis:
- API response
- inventory-lookup returned 1 item(s).
- inventory-lookup: debug:2 - API response
- python-sandbox: debug:1 - API response
Logical verification:
Part 1:
- Context: API response | inventory-lookup returned 1 item(s).
- Pre-synthesized answer: LLM Response

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

### Exact Raw Prompt Payloads

### 1. science_input_clarification

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Clarify the user request for the science reasoning loop.

Rewrite the request into a self-contained, execution-ready input for the next module.

Ask at most one follow-up question, and only when the missing detail is truly blocking.

Include trace_sentence as one short sentence describing what you are doing at this step.

Preserve the scientific intent, any request for recent/current evidence, and any need for deterministic computation.

Intent: general_science_question

User message:
What does the latest evidence suggest about this science question?

Return JSON only.
```

### 2. science_route_planner

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Draft a reference route plan for the science reasoning loop.

This plan is guidance only. The agent may deviate when real tool outputs or evidence suggest a better path.

Keep the route concise, practical, and tool-aware.

Suggest a likely order of evidence-gathering steps, optional tool calls, and when the route should adapt.

Include trace_sentence as one short sentence describing what you are doing at this step.

Prefer only tools that are already allowed by policy or tool scope.

For literature-search query_hint, return short keyword phrases rather than a full sentence.

Clarified request:
LLM Response

Reasoning effort 2: a broader multi-step route is acceptable, but do not over-plan.

Intent: general_science_question

Reasoning effort: 2

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Allowed tools: inventory-lookup | record-lookup | protocol-matching | notebook-generation | notebook-draft | python-sandbox

Return JSON only.
```

### 3. science_loop_exit_criteria

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Generate exit criteria for a science reasoning loop.

The criteria will be used later by a separate judge sub-agent to decide whether the loop should stop.

Be concrete about what evidence must exist before exit, when the loop should continue, and when a limitation-qualified answer is acceptable.

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Intent: general_science_question

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Allowed tools: inventory-lookup | record-lookup | protocol-matching | notebook-generation | notebook-draft | python-sandbox

Return JSON only.
```

### 4. science_agent_session_start

Kind: `agent-session-start`

**Raw System Prompt**

```text
You are a debug-only Enana agent runtime.

Intent: general_science_question

Reasoning effort: 2

Execution hints:
- Retrieval preference: literature_first_web_last.
- Use an external citation when the clarified request depends on freshness or recency.
- Make at least one evidence-gathering attempt before answering.
- A limitation-qualified answer is acceptable after a best-effort evidence attempt.
- Loop goal: LLM Response
- Route summary: LLM Response
- Preferred tools: inventory-lookup | record-lookup | protocol-matching
- Route suggestions are guidance only.
- Objective: LLM Response
- Exit when: LLM Response

The clarified execution request is provided separately as the session message.

1. You are inside a deterministic science reasoning loop.
2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.
3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.
4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.
5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.
6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.
7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.
8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.
9. Do not fabricate project records, literature results, or computation outputs.
10. For general science questions, prefer the most targeted citation-backed evidence path available.
```

**Raw Message**

```text
LLM Response
```

**Raw Conversation**

```json
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  }
]
```

**Raw Tool Definitions**

```json
[
  {
    "name": "inventory-lookup",
    "description": "Debug-only tool definition for inventory-lookup.",
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
    "name": "record-lookup",
    "description": "Debug-only tool definition for record-lookup.",
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
    "name": "protocol-matching",
    "description": "Debug-only tool definition for protocol-matching.",
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
    "name": "notebook-generation",
    "description": "Debug-only tool definition for notebook-generation.",
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
    "name": "notebook-draft",
    "description": "Debug-only tool definition for notebook-draft.",
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
    "name": "python-sandbox",
    "description": "Debug-only tool definition for python-sandbox.",
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
    "name": "command-line",
    "description": "Debug-only tool definition for command-line.",
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
    "name": "sub-agent",
    "description": "Debug-only tool definition for sub-agent.",
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
    "name": "memory",
    "description": "Debug-only tool definition for memory.",
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
    "name": "purchase-recommendation",
    "description": "Debug-only tool definition for purchase-recommendation.",
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
    "name": "paper-download",
    "description": "Debug-only tool definition for paper-download.",
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
    "name": "paper-analysis",
    "description": "Debug-only tool definition for paper-analysis.",
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
    "name": "protocol-generation",
    "description": "Debug-only tool definition for protocol-generation.",
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

### 5. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-1",
    "name": "python-sandbox",
    "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
  }
]
```

### 6. science_loop_logic_extraction

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Extract the short logical structure from the current pre-synthesized answer.

Deductive means a direct conclusion from the stated basis.

Inductive means a pattern or generalization from the available evidence.

Abductive means the current best explanation or hypothesis.

Return a short context, the short pre-synthesized answer, and a short logic_list.

Each logic_list item should contain one reasoning_type and one short logic string.

Do not add evidence or alternatives that are not already in the provided answer state.

Clarified request:
LLM Response

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- python-sandbox returned 1 item(s).
- python-sandbox: debug:1 - API response
- python-sandbox: API response

Return JSON only.
```

### 7. science_loop_exit_judge_sub_agent

Kind: `structured-json`

**Raw System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**Raw User Prompt**

```text
Judge whether the reasoning loop should stop now or continue.

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Exit criteria:
Objective: LLM Response
Exit conditions:
- LLM Response
- The current evidence directly supports the core answer to the clarified request.
- The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support.
Required evidence:
- LLM Response
- At least one evidence-gathering round has run before the loop exits.
Continue when:
- LLM Response
- A blocking evidence gap still prevents a grounded answer.
Can exit with limitations when:
- LLM Response
- A best-effort answer is allowed when the main remaining gaps are stated explicitly.
- Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated.
Preferred next tools: inventory-lookup | record-lookup | protocol-matching

Pre-synthesized question:
Current best answer: LLM Response
Supporting basis:
- API response
- python-sandbox returned 1 item(s).
- python-sandbox: debug:1 - API response
- python-sandbox: API response
Logical verification:
Part 1:
- Context: API response | python-sandbox returned 1 item(s).
- Pre-synthesized answer: LLM Response

Rounds executed: 1/2

Return JSON only.
```

### 8. science_agent_session_after_feedback

Kind: `agent-session-feedback`

**Raw Message**

```text
What does the latest evidence suggest about this science question?
```

**Raw Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: python-sandbox.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best tool call or tightly scoped parallel tool batch, or answer directly only if the evidence is now sufficient.
```

**Raw Conversation**

```json
[
  {
    "role": "user",
    "text": "What does the latest evidence suggest about this science question?"
  }
]
```

**Raw Tool Definitions**

```json
[
  {
    "name": "inventory-lookup",
    "description": "Debug-only tool definition for inventory-lookup.",
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
    "name": "record-lookup",
    "description": "Debug-only tool definition for record-lookup.",
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
    "name": "protocol-matching",
    "description": "Debug-only tool definition for protocol-matching.",
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
    "name": "notebook-generation",
    "description": "Debug-only tool definition for notebook-generation.",
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
    "name": "notebook-draft",
    "description": "Debug-only tool definition for notebook-draft.",
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
    "name": "python-sandbox",
    "description": "Debug-only tool definition for python-sandbox.",
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
    "name": "command-line",
    "description": "Debug-only tool definition for command-line.",
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
    "name": "sub-agent",
    "description": "Debug-only tool definition for sub-agent.",
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
    "name": "memory",
    "description": "Debug-only tool definition for memory.",
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
    "name": "purchase-recommendation",
    "description": "Debug-only tool definition for purchase-recommendation.",
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
    "name": "paper-download",
    "description": "Debug-only tool definition for paper-download.",
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
    "name": "paper-analysis",
    "description": "Debug-only tool definition for paper-analysis.",
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
    "name": "protocol-generation",
    "description": "Debug-only tool definition for protocol-generation.",
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

### 9. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-2",
    "name": "inventory-lookup",
    "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
  }
]
```

### 10. science_loop_logic_extraction

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Extract the short logical structure from the current pre-synthesized answer.

Deductive means a direct conclusion from the stated basis.

Inductive means a pattern or generalization from the available evidence.

Abductive means the current best explanation or hypothesis.

Return a short context, the short pre-synthesized answer, and a short logic_list.

Each logic_list item should contain one reasoning_type and one short logic string.

Do not add evidence or alternatives that are not already in the provided answer state.

Clarified request:
LLM Response

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- inventory-lookup returned 1 item(s).
- inventory-lookup: debug:2 - API response
- python-sandbox: debug:1 - API response

Return JSON only.
```

### 11. science_loop_exit_judge_sub_agent

Kind: `structured-json`

**Raw System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized question is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Be conservative: continue when a blocking evidence requirement is still missing.

Return JSON only and do not invent evidence.
```

**Raw User Prompt**

```text
Judge whether the reasoning loop should stop now or continue.

Include trace_sentence as one short sentence describing what you are doing at this step.

Clarified request:
LLM Response

Exit criteria:
Objective: LLM Response
Exit conditions:
- LLM Response
- The current evidence directly supports the core answer to the clarified request.
- The answer is grounded in the strongest available evidence, which may include external sources, trusted provided context, or prior retrieved support.
Required evidence:
- LLM Response
- At least one evidence-gathering round has run before the loop exits.
Continue when:
- LLM Response
- A blocking evidence gap still prevents a grounded answer.
Can exit with limitations when:
- LLM Response
- A best-effort answer is allowed when the main remaining gaps are stated explicitly.
- Stable background questions can be answered without a fresh citation when the answer is already well grounded and any freshness limits are stated.
Preferred next tools: inventory-lookup | record-lookup | protocol-matching

Pre-synthesized question:
Current best answer: LLM Response
Supporting basis:
- API response
- inventory-lookup returned 1 item(s).
- inventory-lookup: debug:2 - API response
- python-sandbox: debug:1 - API response
Logical verification:
Part 1:
- Context: API response | inventory-lookup returned 1 item(s).
- Pre-synthesized answer: LLM Response

Rounds executed: 2/2

Return JSON only.
```

### Internal API Calls

### 1. python-sandbox

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
  "tool_name": "python-sandbox",
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
      "source": "python-sandbox",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ]
}
```

### 2. inventory-lookup

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
  "tool_name": "inventory-lookup",
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
      "source": "inventory-lookup",
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
8. `science_round_started` [started] Science reasoning round 1 started with python-sandbox.
9. `science_evaluator_continue` [started] LLM Response
10. `science_round_started` [started] Science reasoning round 2 started with inventory-lookup.
11. `science_evaluator_satisfied` [ok] LLM Response
12. `science_intent_completed` [ok] Science reasoning loop completed successfully.