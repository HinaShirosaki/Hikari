# Agent Context Debug Export

Generated at: 2026-05-15T20:47:39.211Z

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
      "state_id": "science_intake-1778878059201-2f09d0",
      "created_at": "2026-05-15T20:47:39.201Z",
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
      "state_id": "science_direct_answer-1778878059201-1fc635",
      "created_at": "2026-05-15T20:47:39.201Z",
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
    "pre_synthesize_answer": "Based on the evidence so far, I am drafting a tentative answer.",
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

Execution mode: direct answer only.

1. Answer directly without entering the deterministic science reasoning loop.
2. Provide a complete answer: lead with the main conclusion, then explain the key reasoning and any important caveats.
3. Do not be artificially terse unless the user explicitly asked for a short answer.
4. Do not call tools or ask to enter a reasoning loop.
5. Use stable scientific knowledge plus the provided context only.
6. Do not fabricate project records, literature results, or computation outputs.
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

Execution mode: direct answer only.

1. Answer directly without entering the deterministic science reasoning loop.
2. Provide a complete answer: lead with the main conclusion, then explain the key reasoning and any important caveats.
3. Do not be artificially terse unless the user explicitly asked for a short answer.
4. Do not call tools or ask to enter a reasoning loop.
5. Use stable scientific knowledge plus the provided context only.
6. Do not fabricate project records, literature results, or computation outputs.
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
    "literature-search",
    "web-search",
    "paper-analysis",
    "protocol-generation",
    "python-sandbox"
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
      "state_id": "science_intake-1778878059202-1090e0",
      "created_at": "2026-05-15T20:47:39.202Z",
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
      "state_id": "science_clarification-1778878059203-2d8b56",
      "created_at": "2026-05-15T20:47:39.203Z",
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

If the latest user message is a continuation or intensification directive (for example "think harder", "go deeper", "explain more", "continue", "keep going", "what else", "elaborate") without a new scientific topic, anchor clarified_input to the scientific target of the prior assistant answer in the transcript. Preserve the specific entities (organisms, proteins, mechanisms, projects) from that prior answer so downstream stages inherit the real topic. Do not treat the directive itself as the clarified request.

Intent: general_science_question

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

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

If the latest user message is a continuation or intensification directive (for example "think harder", "go deeper", "explain more", "continue", "keep going", "what else", "elaborate") without a new scientific topic, anchor clarified_input to the scientific target of the prior assistant answer in the transcript. Preserve the specific entities (organisms, proteins, mechanisms, projects) from that prior answer so downstream stages inherit the real topic. Do not treat the directive itself as the clarified request.

Intent: general_science_question

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

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
    "literature-search",
    "web-search",
    "paper-analysis",
    "protocol-generation",
    "python-sandbox"
  ],
  "project": null
}
```

### Final Result

```json
{
  "status": "completed",
  "answer": "LLM Response\n\nRemaining gaps: LLM Response.\n\nLatest tool summary: API response",
  "confidence": 0.71,
  "citations": [
    {
      "source": "protocol-generation",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ],
  "decision_record": {
    "assumptions": [
      "The evaluator judged the collected evidence sufficient for a grounded answer.",
      "The answer is grounded in 1 citation-backed evidence item(s).",
      "general_science_question used the shared science reasoning loop.",
      "Citation count=1."
    ],
    "open_questions": [
      "LLM Response"
    ],
    "verification_notes": [
      "LLM Response",
      "protocol-generation: API response",
      "The evaluator marked the evidence as sufficient before final synthesis."
    ]
  },
  "response_type": "",
  "confidence_label": "",
  "source_summary": {
    "total_sources": 1,
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
      },
      {
        "step_label": "step-3",
        "objective": "LLM Response",
        "suggested_tools": [
          "paper-analysis"
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
        "query_hint": "LLM Response debug-context-export"
      },
      {
        "tool_name": "web-search",
        "priority": 2,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "paper-analysis",
        "priority": 3,
        "when_to_use": "LLM Response",
        "reason": "LLM Response",
        "query_hint": "LLM Response"
      },
      {
        "tool_name": "protocol-generation",
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
      "The current evidence directly supports a grounded answer to the clarified request."
    ],
    "required_evidence": [
      "LLM Response"
    ],
    "continue_when": [
      "LLM Response",
      "A blocking gap remains between the clarified request and the collected evidence."
    ],
    "can_exit_with_limitations_when": [
      "LLM Response",
      "A limitation-qualified answer is acceptable when the remaining uncertainty is stated explicitly."
    ],
    "preferred_next_tools": [
      "literature-search",
      "web-search",
      "paper-analysis",
      "protocol-generation",
      "python-sandbox"
    ],
    "reasoning_notes": "LLM Response",
    "trace_sentence": "I am defining what evidence must exist before the reasoning loop can safely stop."
  },
  "tool_trace": [
    {
      "round": 1,
      "call_id": "debug-call-science-loop-1",
      "tool_name": "protocol-generation",
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
          "source": "protocol-generation",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "loaded_context_blocks": []
    }
  ],
  "intermediate_states": [
    {
      "state_id": "science_intake-1778878059204-8fe479",
      "created_at": "2026-05-15T20:47:39.204Z",
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
      "state_id": "science_clarification-1778878059204-e080b6",
      "created_at": "2026-05-15T20:47:39.204Z",
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
      "state_id": "science_route_plan-1778878059205-fd2a1b",
      "created_at": "2026-05-15T20:47:39.205Z",
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
        },
        {
          "action_type": "read",
          "tool_name": "paper-analysis",
          "risk_level": "low",
          "reason": "LLM Response"
        },
        {
          "action_type": "read",
          "tool_name": "protocol-generation",
          "risk_level": "low",
          "reason": "LLM Response"
        }
      ],
      "confidence": 0.64
    },
    {
      "state_id": "science_exit_criteria-1778878059206-acb311",
      "created_at": "2026-05-15T20:47:39.206Z",
      "stage": "science_exit_criteria",
      "goal": "Generated exit criteria for the reasoning loop.",
      "assumptions": [
        "LLM Response",
        "The current evidence directly supports a grounded answer to the clarified request."
      ],
      "open_questions": [
        "LLM Response",
        "A blocking gap remains between the clarified request and the collected evidence."
      ],
      "evidence": [],
      "proposed_actions": [],
      "confidence": 0.62
    },
    {
      "state_id": "science_tool_round-1778878059207-3e5f86",
      "created_at": "2026-05-15T20:47:39.207Z",
      "stage": "science_tool_round",
      "goal": "Executed protocol-generation in round 1.",
      "assumptions": [
        "Executed protocol-generation for this round.",
        "This round returned usable tool evidence."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "protocol-generation",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_tool_round_satisfaction-1778878059208-74e369",
      "created_at": "2026-05-15T20:47:39.208Z",
      "stage": "science_tool_round_satisfaction",
      "goal": "Main agent committed to a synthesis-ready answer after the latest tool round.",
      "assumptions": [
        "Main agent produced a post-tool response without another tool call."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1778878059208-336aaa",
      "created_at": "2026-05-15T20:47:39.208Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized answer before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_synthesis-1778878059210-404c17",
      "created_at": "2026-05-15T20:47:39.210Z",
      "stage": "science_synthesis",
      "goal": "Synthesized final science answer from tool evidence.",
      "assumptions": [
        "Final answer was produced after evaluator satisfaction.",
        "Total citations=1."
      ],
      "open_questions": [
        "LLM Response"
      ],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.71
    }
  ],
  "rounds_executed": 1,
  "reasoning_effort": 2,
  "follow_up_questions": [
    "Could you clarify: LLM Response"
  ],
  "thinking_trace": {
    "intent_parse_question": "LLM Response",
    "question_clarifier": "I am clarifying the user request into an execution-ready science question.",
    "criteria_generate": "I am sketching a lightweight route so the loop can start with the most targeted evidence step. I am defining what evidence must exist before the reasoning loop can safely stop.",
    "tool_rounds": [
      {
        "round": 1,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use protocol-generation to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      }
    ],
    "pre_synthesize_answer": "LLM Response",
    "judge": "I am confirming that the current evidence is sufficient for the loop to stop.",
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
  "name": "protocol-generation",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

**Agent Request**

```json
{
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nExecution hints:\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: literature-search | web-search | paper-analysis\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n- Required evidence: LLM Response\n- Continue when: LLM Response\n- Limitations rule: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.\n3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.",
  "message": "LLM Response",
  "feedback_message": "",
  "conversation": [
    {
      "role": "user",
      "text": "What does the latest evidence suggest about this science question?"
    },
    {
      "role": "assistant",
      "text": "Could you clarify: LLM Response"
    }
  ],
  "tool_definitions": [
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
    }
  ]
}
```

**Agent Request Raw Payload**

```json
{
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nExecution hints:\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: literature-search | web-search | paper-analysis\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n- Required evidence: LLM Response\n- Continue when: LLM Response\n- Limitations rule: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call one or more independent tools or answer directly if you already have sufficient evidence.\n3. If multiple tool calls would help, keep them tightly scoped and independent so they can be executed in parallel as one evidence round.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool or tool batch on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.",
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
  "tool_name": "protocol-generation",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "protocol-generation",
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
        "source": "protocol-generation",
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
      "name": "protocol-generation",
      "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
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
- protocol-generation (ok) | summary: API response

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

### 2. After protocol-generation round 1

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- protocol-generation (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 3. After follow-up question was recorded

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: LLM Response

Latest tool outputs:
- protocol-generation (ok) | summary: API response

Task summary:
Task type: science_reasoning_loop
Intent: general_science_question
Status: active
Follow-up questions: Could you clarify: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Unresolved questions: Could you clarify: LLM Response

Long-term memory:

No recalled long-term memory.
```

### 4. Final context

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: LLM Response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Recent completed tasks: LLM Response

Remaining gaps: LLM Response.

Latest tool summary: API response | LLM Response

Remaining gaps: LLM Response.

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

If the latest user message is a continuation or intensification directive (for example "think harder", "go deeper", "explain more", "continue", "keep going", "what else", "elaborate") without a new scientific topic, anchor clarified_input to the scientific target of the prior assistant answer in the transcript. Preserve the specific entities (organisms, proteins, mechanisms, projects) from that prior answer so downstream stages inherit the real topic. Do not treat the directive itself as the clarified request.

Intent: general_science_question

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

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

Allowed tools: literature-search | web-search | paper-analysis | protocol-generation | python-sandbox

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
    },
    {
      "step_label": "step-3",
      "objective": "LLM Response",
      "suggested_tools": [
        "paper-analysis"
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
    },
    {
      "tool_name": "paper-analysis",
      "priority": 3,
      "when_to_use": "LLM Response",
      "reason": "LLM Response",
      "query_hint": "LLM Response"
    },
    {
      "tool_name": "protocol-generation",
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

Allowed tools: literature-search | web-search | paper-analysis | protocol-generation | python-sandbox

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
    "web-search",
    "paper-analysis",
    "protocol-generation"
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

Execution hints:
- Loop goal: LLM Response
- Route summary: LLM Response
- Preferred tools: literature-search | web-search | paper-analysis
- Route suggestions are guidance only.
- Objective: LLM Response
- Exit when: LLM Response
- Required evidence: LLM Response
- Continue when: LLM Response
- Limitations rule: LLM Response

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
    "text": "Could you clarify: LLM Response"
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
  }
]
```

**Planned Tool Call**

```json
{
  "name": "protocol-generation",
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
    "name": "protocol-generation",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:1 - API response
- protocol-generation: API response

Return JSON only.
```

### 7. science_loop_exit_judge_sub_agent

Kind: `structured-json`

Stub response: `LLM Response`

**System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized answer is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Judge sufficiency, not perfection: stop when the evidence supports the main answer and remaining gaps can be stated as caveats without changing the conclusion.

Continue only when a missing requirement is truly blocking for the clarified request.

Do not require exhaustive literature coverage, every selected paper to be fully read, or extra citations unless the exit criteria explicitly require them.

For stable general science, citation-backed anchors plus well-established background knowledge can be enough; project facts still require project/tool evidence.

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
- The current evidence directly supports a grounded answer to the clarified request.
Required evidence:
- LLM Response
Continue when:
- LLM Response
- A blocking gap remains between the clarified request and the collected evidence.
Can exit with limitations when:
- LLM Response
- A limitation-qualified answer is acceptable when the remaining uncertainty is stated explicitly.
Preferred next tools: literature-search | web-search | paper-analysis

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- protocol-generation returned 1 item(s).
- protocol-generation: debug:1 - API response
- protocol-generation: API response
Logical verification:
Part 1:
- Context: API response | protocol-generation returned 1 item(s).
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
    "tool_name": "protocol-generation",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
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

If the latest user message is a continuation or intensification directive (for example "think harder", "go deeper", "explain more", "continue", "keep going", "what else", "elaborate") without a new scientific topic, anchor clarified_input to the scientific target of the prior assistant answer in the transcript. Preserve the specific entities (organisms, proteins, mechanisms, projects) from that prior answer so downstream stages inherit the real topic. Do not treat the directive itself as the clarified request.

Intent: general_science_question

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

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

Allowed tools: literature-search | web-search | paper-analysis | protocol-generation | python-sandbox

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

Allowed tools: literature-search | web-search | paper-analysis | protocol-generation | python-sandbox

Return JSON only.
```

### 4. science_agent_session_start

Kind: `agent-session-start`

**Raw System Prompt**

```text
You are a debug-only Enana agent runtime.

Execution hints:
- Loop goal: LLM Response
- Route summary: LLM Response
- Preferred tools: literature-search | web-search | paper-analysis
- Route suggestions are guidance only.
- Objective: LLM Response
- Exit when: LLM Response
- Required evidence: LLM Response
- Continue when: LLM Response
- Limitations rule: LLM Response

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
    "name": "protocol-generation",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:1 - API response
- protocol-generation: API response

Return JSON only.
```

### 7. science_loop_exit_judge_sub_agent

Kind: `structured-json`

**Raw System Prompt**

```text
You are a specialized sub-agent that judges whether a science reasoning loop should exit.

A lightweight pre-synthesized answer is provided so you can see the current best answer, supporting basis, and unresolved issues before judging.

Judge the pre-synthesized answer only against the provided exit criteria and clarified request.

Do not impose any citation, source, or tool-specific requirement unless it is explicitly stated in the exit criteria.

Judge sufficiency, not perfection: stop when the evidence supports the main answer and remaining gaps can be stated as caveats without changing the conclusion.

Continue only when a missing requirement is truly blocking for the clarified request.

Do not require exhaustive literature coverage, every selected paper to be fully read, or extra citations unless the exit criteria explicitly require them.

For stable general science, citation-backed anchors plus well-established background knowledge can be enough; project facts still require project/tool evidence.

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
- The current evidence directly supports a grounded answer to the clarified request.
Required evidence:
- LLM Response
Continue when:
- LLM Response
- A blocking gap remains between the clarified request and the collected evidence.
Can exit with limitations when:
- LLM Response
- A limitation-qualified answer is acceptable when the remaining uncertainty is stated explicitly.
Preferred next tools: literature-search | web-search | paper-analysis

Pre-synthesized answer:
Current best answer: LLM Response
Supporting basis:
- API response
- protocol-generation returned 1 item(s).
- protocol-generation: debug:1 - API response
- protocol-generation: API response
Logical verification:
Part 1:
- Context: API response | protocol-generation returned 1 item(s).
- Pre-synthesized answer: LLM Response

Rounds executed: 1/2

Return JSON only.
```

### Internal API Calls

### 1. protocol-generation

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
  "tool_name": "protocol-generation",
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
      "source": "protocol-generation",
      "pointer": "debug:1",
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
8. `science_round_started` [started] Science reasoning round 1 started with protocol-generation.
9. `science_tool_round_satisfied` [ok] Main agent produced a post-tool response without another tool call.
10. `science_evaluator_satisfied` [ok] LLM Response
11. `science_intent_completed` [ok] Science reasoning loop completed successfully.