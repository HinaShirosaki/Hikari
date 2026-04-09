# Agent Context Debug Export

Generated at: 2026-04-08T16:20:28.271Z

This export runs the science agent flow with debug shims only.

- Every LLM-facing response is replaced with `LLM Response`.
- Every internal tool/API-facing response is replaced with `API response`.
- The runtime logic stays intact; only the external call boundaries are stubbed.

## Science Loop

```json
{
  "intent": "general_science_question",
  "mode": "loop",
  "message": "What does the latest evidence suggest about this science question?",
  "reasoning_effort": 2,
  "iterations": 8,
  "max_rounds": 8,
  "tool_sequence": [
    "inventory-lookup",
    "record-lookup",
    "protocol-matching",
    "notebook-generation",
    "notebook-draft",
    "python-sandbox",
    "sub-agent",
    "memory",
    "literature-search",
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
  "answer": "LLM Response",
  "confidence": 0.68,
  "citations": [
    {
      "source": "protocol-matching",
      "pointer": "debug:1",
      "reason": "API response"
    },
    {
      "source": "paper-analysis",
      "pointer": "debug:2",
      "reason": "API response"
    },
    {
      "source": "inventory-lookup",
      "pointer": "debug:3",
      "reason": "API response"
    },
    {
      "source": "python-sandbox",
      "pointer": "debug:4",
      "reason": "API response"
    },
    {
      "source": "notebook-draft",
      "pointer": "debug:5",
      "reason": "API response"
    },
    {
      "source": "protocol-generation",
      "pointer": "debug:6",
      "reason": "API response"
    },
    {
      "source": "paper-download",
      "pointer": "debug:7",
      "reason": "API response"
    },
    {
      "source": "protocol-matching",
      "pointer": "debug:8",
      "reason": "API response"
    }
  ],
  "decision_record": {
    "assumptions": [
      "LLM Response",
      "general_science_question used the shared science reasoning loop.",
      "Citation count=8."
    ],
    "open_questions": [
      "The current evidence directly supports the core answer to the clarified request."
    ],
    "verification_notes": [
      "LLM Response",
      "The evaluator marked the evidence as sufficient before final synthesis."
    ]
  },
  "response_type": "",
  "confidence_label": "",
  "source_summary": {
    "total_sources": 8,
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
      "tool_name": "protocol-matching",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "protocol-matching",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 2,
      "call_id": "debug-call-science-loop-2",
      "tool_name": "paper-analysis",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "paper-analysis",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 3,
      "call_id": "debug-call-science-loop-3",
      "tool_name": "inventory-lookup",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:3",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 4,
      "call_id": "debug-call-science-loop-4",
      "tool_name": "python-sandbox",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "python-sandbox",
          "pointer": "debug:4",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 5,
      "call_id": "debug-call-science-loop-5",
      "tool_name": "notebook-draft",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "notebook-draft",
          "pointer": "debug:5",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 6,
      "call_id": "debug-call-science-loop-6",
      "tool_name": "protocol-generation",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "protocol-generation",
          "pointer": "debug:6",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 7,
      "call_id": "debug-call-science-loop-7",
      "tool_name": "paper-download",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "paper-download",
          "pointer": "debug:7",
          "reason": "API response"
        }
      ]
    },
    {
      "round": 8,
      "call_id": "debug-call-science-loop-8",
      "tool_name": "protocol-matching",
      "input": {
        "query": "What does the latest evidence suggest about this science question?"
      },
      "ok": true,
      "summary": "API response",
      "truncated_multi_call": false,
      "error": "",
      "citations": [
        {
          "source": "protocol-matching",
          "pointer": "debug:8",
          "reason": "API response"
        }
      ]
    }
  ],
  "intermediate_states": [
    {
      "state_id": "science_intake-1775665228260-4affb7",
      "created_at": "2026-04-08T16:20:28.260Z",
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
      "state_id": "science_clarification-1775665228260-61b423",
      "created_at": "2026-04-08T16:20:28.260Z",
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
      "state_id": "science_route_plan-1775665228260-58bf62",
      "created_at": "2026-04-08T16:20:28.260Z",
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
      "state_id": "science_exit_criteria-1775665228261-27a1a4",
      "created_at": "2026-04-08T16:20:28.261Z",
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
      "state_id": "science_tool_round-1775665228262-30012e",
      "created_at": "2026-04-08T16:20:28.262Z",
      "stage": "science_tool_round",
      "goal": "Executed protocol-matching in round 1.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-matching",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "protocol-matching",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775665228262-3675ea",
      "created_at": "2026-04-08T16:20:28.262Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-matching",
          "pointer": "debug:1",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228265-a29118",
      "created_at": "2026-04-08T16:20:28.265Z",
      "stage": "science_tool_round",
      "goal": "Executed paper-analysis in round 2.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "paper-analysis",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "paper-analysis",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775665228265-e2be01",
      "created_at": "2026-04-08T16:20:28.265Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "paper-analysis",
          "pointer": "debug:2",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228266-b1472c",
      "created_at": "2026-04-08T16:20:28.266Z",
      "stage": "science_tool_round",
      "goal": "Executed inventory-lookup in round 3.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:3",
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
      "state_id": "science_pre_synthesis-1775665228266-ea865e",
      "created_at": "2026-04-08T16:20:28.266Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "inventory-lookup",
          "pointer": "debug:3",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228267-eba781",
      "created_at": "2026-04-08T16:20:28.267Z",
      "stage": "science_tool_round",
      "goal": "Executed python-sandbox in round 4.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "python-sandbox",
          "pointer": "debug:4",
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
      "state_id": "science_pre_synthesis-1775665228267-386ccd",
      "created_at": "2026-04-08T16:20:28.267Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "python-sandbox",
          "pointer": "debug:4",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228267-2c2e51",
      "created_at": "2026-04-08T16:20:28.267Z",
      "stage": "science_tool_round",
      "goal": "Executed notebook-draft in round 5.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "notebook-draft",
          "pointer": "debug:5",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "notebook-draft",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775665228267-2046ce",
      "created_at": "2026-04-08T16:20:28.267Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "notebook-draft",
          "pointer": "debug:5",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228268-f57f1d",
      "created_at": "2026-04-08T16:20:28.268Z",
      "stage": "science_tool_round",
      "goal": "Executed protocol-generation in round 6.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:6",
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
      "state_id": "science_pre_synthesis-1775665228268-bc7f4d",
      "created_at": "2026-04-08T16:20:28.268Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-generation",
          "pointer": "debug:6",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228269-306d8d",
      "created_at": "2026-04-08T16:20:28.269Z",
      "stage": "science_tool_round",
      "goal": "Executed paper-download in round 7.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "paper-download",
          "pointer": "debug:7",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "paper-download",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775665228269-db944e",
      "created_at": "2026-04-08T16:20:28.269Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "paper-download",
          "pointer": "debug:7",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_tool_round-1775665228269-07e1ff",
      "created_at": "2026-04-08T16:20:28.269Z",
      "stage": "science_tool_round",
      "goal": "Executed protocol-matching in round 8.",
      "assumptions": [
        "Exactly one tool call was executed this round.",
        "Tool execution returned a success envelope."
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-matching",
          "pointer": "debug:8",
          "reason": "API response"
        }
      ],
      "proposed_actions": [
        {
          "action_type": "read",
          "tool_name": "protocol-matching",
          "risk_level": "low",
          "reason": "API response"
        }
      ],
      "confidence": 0.66
    },
    {
      "state_id": "science_pre_synthesis-1775665228269-46ccae",
      "created_at": "2026-04-08T16:20:28.269Z",
      "stage": "science_pre_synthesis",
      "goal": "Prepared a lightweight pre-synthesized question before exit judgement.",
      "assumptions": [
        "Tentative answer: LLM Response"
      ],
      "open_questions": [],
      "evidence": [
        {
          "source": "protocol-matching",
          "pointer": "debug:8",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.64
    },
    {
      "state_id": "science_synthesis-1775665228270-e93eda",
      "created_at": "2026-04-08T16:20:28.270Z",
      "stage": "science_synthesis",
      "goal": "Synthesized final science answer from tool evidence.",
      "assumptions": [
        "Final answer was produced after evaluator satisfaction.",
        "Total citations=8."
      ],
      "open_questions": [
        "The current evidence directly supports the core answer to the clarified request."
      ],
      "evidence": [
        {
          "source": "protocol-matching",
          "pointer": "debug:1",
          "reason": "API response"
        },
        {
          "source": "paper-analysis",
          "pointer": "debug:2",
          "reason": "API response"
        },
        {
          "source": "inventory-lookup",
          "pointer": "debug:3",
          "reason": "API response"
        },
        {
          "source": "python-sandbox",
          "pointer": "debug:4",
          "reason": "API response"
        },
        {
          "source": "notebook-draft",
          "pointer": "debug:5",
          "reason": "API response"
        },
        {
          "source": "protocol-generation",
          "pointer": "debug:6",
          "reason": "API response"
        },
        {
          "source": "paper-download",
          "pointer": "debug:7",
          "reason": "API response"
        },
        {
          "source": "protocol-matching",
          "pointer": "debug:8",
          "reason": "API response"
        }
      ],
      "proposed_actions": [],
      "confidence": 0.68
    }
  ],
  "rounds_executed": 8,
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
        "tool_call": "I want to use protocol-matching to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 2,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use paper-analysis to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 3,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use inventory-lookup to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 4,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use python-sandbox to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 5,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use notebook-draft to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 6,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use protocol-generation to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 7,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use paper-download to investigate \"What does the latest evidence suggest about this science question?\".",
        "tool_results": "LLM Response"
      },
      {
        "round": 8,
        "tool_selection": "LLM Response",
        "tool_call": "I want to use protocol-matching to investigate \"What does the latest evidence suggest about this science question?\".",
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
  "name": "protocol-matching",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

**Agent Request**

```json
{
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nIntent: general_science_question\n\nReasoning effort: 2\n\nExecution hints:\n- Retrieval preference: literature_first_web_last.\n- Use an external citation when the clarified request depends on freshness or recency.\n- Make at least one evidence-gathering attempt before answering.\n- A limitation-qualified answer is acceptable after a best-effort evidence attempt.\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: inventory-lookup | record-lookup | protocol-matching\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.\n3. Do not call more than one tool in a single assistant turn.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.\n10. For general science questions, prefer the most targeted citation-backed evidence path available.",
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
  "system_prompt": "You are a debug-only Enana agent runtime.\n\nIntent: general_science_question\n\nReasoning effort: 2\n\nExecution hints:\n- Retrieval preference: literature_first_web_last.\n- Use an external citation when the clarified request depends on freshness or recency.\n- Make at least one evidence-gathering attempt before answering.\n- A limitation-qualified answer is acceptable after a best-effort evidence attempt.\n- Loop goal: LLM Response\n- Route summary: LLM Response\n- Preferred tools: inventory-lookup | record-lookup | protocol-matching\n- Route suggestions are guidance only.\n- Objective: LLM Response\n- Exit when: LLM Response\n\nThe clarified execution request is provided separately as the session message.\n\n1. You are inside a deterministic science reasoning loop.\n2. At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.\n3. Do not call more than one tool in a single assistant turn.\n4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.\n5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.\n6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.\n7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.\n8. If a tool result is weak or empty, choose a more targeted next tool on the following turn.\n9. Do not fabricate project records, literature results, or computation outputs.\n10. For general science questions, prefer the most targeted citation-backed evidence path available.",
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
  "tool_name": "protocol-matching",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "protocol-matching",
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
        "source": "protocol-matching",
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
      "name": "protocol-matching",
      "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
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
- protocol-matching (ok) | summary: API response

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
  "name": "paper-analysis",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: protocol-matching.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: protocol-matching.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "paper-analysis",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "paper-analysis",
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
        "source": "paper-analysis",
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
      "name": "paper-analysis",
      "output": "{\"ok\":true,\"tool_name\":\"paper-analysis\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-analysis\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
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
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 3

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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: paper-analysis.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: paper-analysis.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

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
          "id": "api-item-3",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-3",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "inventory-lookup",
        "pointer": "debug:3",
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
      "callId": "debug-call-science-loop-3",
      "name": "inventory-lookup",
      "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:3\",\"reason\":\"API response\"}]}"
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
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 4

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
  "system_prompt": "",
  "message": "What does the latest evidence suggest about this science question?",
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: inventory-lookup.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: inventory-lookup.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

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
          "id": "api-item-4",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-4",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "python-sandbox",
        "pointer": "debug:4",
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
      "callId": "debug-call-science-loop-4",
      "name": "python-sandbox",
      "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:4\",\"reason\":\"API response\"}]}"
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
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 5

Selection mode: `random`

**Selected Tool**

```json
{
  "name": "notebook-draft",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: python-sandbox.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: python-sandbox.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "notebook-draft",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "notebook-draft",
    "summary": "API response",
    "result": {
      "summary": "API response",
      "text": "API response",
      "items": [
        {
          "id": "api-item-5",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-5",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "notebook-draft",
        "pointer": "debug:5",
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
      "callId": "debug-call-science-loop-5",
      "name": "notebook-draft",
      "output": "{\"ok\":true,\"tool_name\":\"notebook-draft\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"notebook-draft\",\"pointer\":\"debug:5\",\"reason\":\"API response\"}]}"
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
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 6

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
  "system_prompt": "",
  "message": "What does the latest evidence suggest about this science question?",
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: notebook-draft.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: notebook-draft.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

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
          "id": "api-item-6",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-6",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "protocol-generation",
        "pointer": "debug:6",
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
      "callId": "debug-call-science-loop-6",
      "name": "protocol-generation",
      "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:6\",\"reason\":\"API response\"}]}"
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
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 7

Selection mode: `random`

**Selected Tool**

```json
{
  "name": "paper-download",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: protocol-generation.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: protocol-generation.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "paper-download",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "paper-download",
    "summary": "API response",
    "result": {
      "summary": "API response",
      "text": "API response",
      "items": [
        {
          "id": "api-item-7",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-7",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "paper-download",
        "pointer": "debug:7",
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
      "callId": "debug-call-science-loop-7",
      "name": "paper-download",
      "output": "{\"ok\":true,\"tool_name\":\"paper-download\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-download\",\"pointer\":\"debug:7\",\"reason\":\"API response\"}]}"
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
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### Round 8

Selection mode: `random`

**Selected Tool**

```json
{
  "name": "protocol-matching",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: paper-download.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
  "feedback_message": "Evaluator feedback for general_science_question: the previous result is not sufficient yet.\nReason: LLM Response\nMissing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.\nSuggested next tool: paper-download.\nSuggested query refinement: LLM Response\nWhy: LLM Response\nPlease continue with the next best single tool call, or answer directly only if the evidence is now sufficient.",
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
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

**Tool/API Result**

```json
{
  "tool_name": "protocol-matching",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  },
  "stub_response": "API response",
  "debug_envelope": {
    "ok": true,
    "tool_name": "protocol-matching",
    "summary": "API response",
    "result": {
      "summary": "API response",
      "text": "API response",
      "items": [
        {
          "id": "api-item-8",
          "label": "API response"
        }
      ]
    },
    "items": [
      {
        "id": "api-item-8",
        "label": "API response"
      }
    ],
    "citations": [
      {
        "source": "protocol-matching",
        "pointer": "debug:8",
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
      "callId": "debug-call-science-loop-8",
      "name": "protocol-matching",
      "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:8\",\"reason\":\"API response\"}]}"
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
- protocol-matching (ok) | summary: API response
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response

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

### 2. After protocol-matching round 1

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 3. After paper-analysis round 2

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 4. After inventory-lookup round 3

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 5. After python-sandbox round 4

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 6. After notebook-draft round 5

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 7. After protocol-generation round 6

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 8. After paper-download round 7

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response
- paper-analysis (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 9. After protocol-matching round 8

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?

Latest tool outputs:
- protocol-matching (ok) | summary: API response
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response

Session memory summary:

Goals: Inspect debug context export output

Constraints: All LLM outputs are replaced with LLM Response. | All internal API outputs are replaced with API response.

Long-term memory:

No recalled long-term memory.
```

### 10. After follow-up question was recorded

**Real Context**

```text
Immediate working context:

User request: What does the latest evidence suggest about this science question?

Recent conversation:
1. user: What does the latest evidence suggest about this science question?
2. assistant: Could you clarify: The current evidence directly supports the core answer to the clarified request.

Latest tool outputs:
- protocol-matching (ok) | summary: API response
- paper-download (ok) | summary: API response
- protocol-generation (ok) | summary: API response
- notebook-draft (ok) | summary: API response
- python-sandbox (ok) | summary: API response
- inventory-lookup (ok) | summary: API response

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

### 11. Final context

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
2. At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.
3. Do not call more than one tool in a single assistant turn.
4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.
5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.
6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.
7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.
8. If a tool result is weak or empty, choose a more targeted next tool on the following turn.
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
  "name": "protocol-matching",
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
    "name": "protocol-matching",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:1 - API response
- protocol-matching: API response

Rounds executed: 1/8

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:1 - API response
- protocol-matching: API response

Rounds executed: 1/8

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
    "tool_name": "protocol-matching",
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
Suggested next tool: protocol-matching.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "paper-analysis",
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
    "name": "paper-analysis",
    "output": "{\"ok\":true,\"tool_name\":\"paper-analysis\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-analysis\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
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
- paper-analysis returned 1 item(s).
- paper-analysis: debug:2 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 2/8

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
- paper-analysis returned 1 item(s).
- paper-analysis: debug:2 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 2/8

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
    "tool_name": "paper-analysis",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
}
```

### 12. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: paper-analysis.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 13. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-3",
    "name": "inventory-lookup",
    "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:3\",\"reason\":\"API response\"}]}"
  }
]
```

### 14. science_loop_current_scientific_state

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
- inventory-lookup: debug:3 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 3/8

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

### 15. science_loop_exit_judge_sub_agent

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
- inventory-lookup: debug:3 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 3/8

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
    "tool_name": "inventory-lookup",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
}
```

### 16. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: inventory-lookup.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 17. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-4",
    "name": "python-sandbox",
    "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:4\",\"reason\":\"API response\"}]}"
  }
]
```

### 18. science_loop_current_scientific_state

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
- python-sandbox: debug:4 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 4/8

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

### 19. science_loop_exit_judge_sub_agent

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
- python-sandbox: debug:4 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 4/8

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

### 20. science_agent_session_after_feedback

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
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "notebook-draft",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

### 21. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-5",
    "name": "notebook-draft",
    "output": "{\"ok\":true,\"tool_name\":\"notebook-draft\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"notebook-draft\",\"pointer\":\"debug:5\",\"reason\":\"API response\"}]}"
  }
]
```

### 22. science_loop_current_scientific_state

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
- notebook-draft returned 1 item(s).
- notebook-draft: debug:5 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 5/8

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

### 23. science_loop_exit_judge_sub_agent

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
- notebook-draft returned 1 item(s).
- notebook-draft: debug:5 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 5/8

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
    "tool_name": "notebook-draft",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
}
```

### 24. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: notebook-draft.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 25. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-6",
    "name": "protocol-generation",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:6\",\"reason\":\"API response\"}]}"
  }
]
```

### 26. science_loop_current_scientific_state

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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:6 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 6/8

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

### 27. science_loop_exit_judge_sub_agent

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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:6 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 6/8

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

### 28. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: protocol-generation.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "paper-download",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

### 29. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-7",
    "name": "paper-download",
    "output": "{\"ok\":true,\"tool_name\":\"paper-download\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-download\",\"pointer\":\"debug:7\",\"reason\":\"API response\"}]}"
  }
]
```

### 30. science_loop_current_scientific_state

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
- paper-download returned 1 item(s).
- paper-download: debug:7 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 7/8

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

### 31. science_loop_exit_judge_sub_agent

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
- paper-download returned 1 item(s).
- paper-download: debug:7 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 7/8

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
    "tool_name": "paper-download",
    "query": "LLM Response",
    "reason": "LLM Response"
  },
  "can_answer_with_limitations": false
}
```

### 32. science_agent_session_after_feedback

Kind: `agent-session-feedback`

Stub response: `LLM Response`

**Feedback Message**

```text
Evaluator feedback for general_science_question: the previous result is not sufficient yet.
Reason: LLM Response
Missing requirements: LLM Response; The current evidence directly supports the core answer to the clarified request.
Suggested next tool: paper-download.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
```

**Planned Tool Call**

```json
{
  "name": "protocol-matching",
  "arguments": {
    "query": "What does the latest evidence suggest about this science question?"
  }
}
```

### 33. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

Stub response: `LLM Response`

**Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-8",
    "name": "protocol-matching",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:8\",\"reason\":\"API response\"}]}"
  }
]
```

### 34. science_loop_current_scientific_state

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:8 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 8/8

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

### 35. science_loop_exit_judge_sub_agent

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:8 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 8/8

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

### 36. science_reasoning_final_synthesis

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

Markdown is allowed in the answer field. Use sections, bullets, or tables when they improve clarity, but do not include HTML.

Include trace_sentence as one short sentence describing what you are doing at this step.

The evaluator judged the evidence sufficient. Produce a grounded answer that explains the conclusion, supporting evidence, and any material caveats.

Clarified request:
LLM Response

Intent: general_science_question

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before final answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Rounds executed: 8/8

Evaluator summary:
Satisfied: yes
Should continue: no
Can answer with limitations: yes
Reason: LLM Response
Missing requirements:
- The current evidence directly supports the core answer to the clarified request.

Citations:
- protocol-matching: debug:1 - API response
- paper-analysis: debug:2 - API response
- inventory-lookup: debug:3 - API response
- python-sandbox: debug:4 - API response

Recent tool outputs:
- protocol-generation (ok) | summary: API response
- paper-download (ok) | summary: API response
- protocol-matching (ok) | summary: API response

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
2. At each assistant turn, either call exactly one tool or answer directly if you already have sufficient evidence.
3. Do not call more than one tool in a single assistant turn.
4. Prefer tools in the listed priority order and explain the answer only after sufficient evidence exists.
5. When you give the final answer, include enough detail to explain the conclusion, supporting evidence, and material caveats.
6. Do not compress the final answer to one or two sentences unless the user explicitly asked for brevity.
7. Treat any route plan as non-binding guidance; adapt when the actual evidence suggests a better next step.
8. If a tool result is weak or empty, choose a more targeted next tool on the following turn.
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
    "name": "protocol-matching",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-1\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:1\",\"reason\":\"API response\"}]}"
  }
]
```

### 6. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:1 - API response
- protocol-matching: API response

Rounds executed: 1/8

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:1 - API response
- protocol-matching: API response

Rounds executed: 1/8

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
Suggested next tool: protocol-matching.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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
    "name": "paper-analysis",
    "output": "{\"ok\":true,\"tool_name\":\"paper-analysis\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-2\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-analysis\",\"pointer\":\"debug:2\",\"reason\":\"API response\"}]}"
  }
]
```

### 10. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- paper-analysis returned 1 item(s).
- paper-analysis: debug:2 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 2/8

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
- paper-analysis returned 1 item(s).
- paper-analysis: debug:2 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 2/8

Return JSON only.
```

### 12. science_agent_session_after_feedback

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
Suggested next tool: paper-analysis.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 13. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-3",
    "name": "inventory-lookup",
    "output": "{\"ok\":true,\"tool_name\":\"inventory-lookup\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-3\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"inventory-lookup\",\"pointer\":\"debug:3\",\"reason\":\"API response\"}]}"
  }
]
```

### 14. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- inventory-lookup: debug:3 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 3/8

Return JSON only.
```

### 15. science_loop_exit_judge_sub_agent

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
- inventory-lookup: debug:3 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 3/8

Return JSON only.
```

### 16. science_agent_session_after_feedback

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
Suggested next tool: inventory-lookup.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 17. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-4",
    "name": "python-sandbox",
    "output": "{\"ok\":true,\"tool_name\":\"python-sandbox\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-4\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"python-sandbox\",\"pointer\":\"debug:4\",\"reason\":\"API response\"}]}"
  }
]
```

### 18. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- python-sandbox: debug:4 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 4/8

Return JSON only.
```

### 19. science_loop_exit_judge_sub_agent

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
- python-sandbox: debug:4 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 4/8

Return JSON only.
```

### 20. science_agent_session_after_feedback

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
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 21. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-5",
    "name": "notebook-draft",
    "output": "{\"ok\":true,\"tool_name\":\"notebook-draft\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-5\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"notebook-draft\",\"pointer\":\"debug:5\",\"reason\":\"API response\"}]}"
  }
]
```

### 22. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- notebook-draft returned 1 item(s).
- notebook-draft: debug:5 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 5/8

Return JSON only.
```

### 23. science_loop_exit_judge_sub_agent

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
- notebook-draft returned 1 item(s).
- notebook-draft: debug:5 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 5/8

Return JSON only.
```

### 24. science_agent_session_after_feedback

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
Suggested next tool: notebook-draft.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 25. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-6",
    "name": "protocol-generation",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-generation\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-6\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-generation\",\"pointer\":\"debug:6\",\"reason\":\"API response\"}]}"
  }
]
```

### 26. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:6 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 6/8

Return JSON only.
```

### 27. science_loop_exit_judge_sub_agent

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
- protocol-generation returned 1 item(s).
- protocol-generation: debug:6 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 6/8

Return JSON only.
```

### 28. science_agent_session_after_feedback

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
Suggested next tool: protocol-generation.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 29. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-7",
    "name": "paper-download",
    "output": "{\"ok\":true,\"tool_name\":\"paper-download\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-7\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"paper-download\",\"pointer\":\"debug:7\",\"reason\":\"API response\"}]}"
  }
]
```

### 30. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- paper-download returned 1 item(s).
- paper-download: debug:7 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 7/8

Return JSON only.
```

### 31. science_loop_exit_judge_sub_agent

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
- paper-download returned 1 item(s).
- paper-download: debug:7 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 7/8

Return JSON only.
```

### 32. science_agent_session_after_feedback

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
Suggested next tool: paper-download.
Suggested query refinement: LLM Response
Why: LLM Response
Please continue with the next best single tool call, or answer directly only if the evidence is now sufficient.
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

### 33. science_agent_session_after_tool_output

Kind: `agent-session-tool-output`

**Raw Tool Outputs**

```json
[
  {
    "callId": "debug-call-science-loop-8",
    "name": "protocol-matching",
    "output": "{\"ok\":true,\"tool_name\":\"protocol-matching\",\"summary\":\"API response\",\"result\":{\"summary\":\"API response\",\"text\":\"API response\",\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}]},\"items\":[{\"id\":\"api-item-8\",\"label\":\"API response\"}],\"citations\":[{\"source\":\"protocol-matching\",\"pointer\":\"debug:8\",\"reason\":\"API response\"}]}"
  }
]
```

### 34. science_loop_current_scientific_state

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
Summarize the current scientific state before the exit judge decides whether the reasoning loop should stop.

Keep it compact and grounded only in the provided evidence.

List what is supported now, what is contradicted, what remains unknown, and whether the remaining uncertainty is actually decision-relevant for deciding stop vs continue.

Set uncertainty_decision_relevant to true only when the remaining uncertainty should materially change the loop exit decision.

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:8 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 8/8

Return JSON only.
```

### 35. science_loop_exit_judge_sub_agent

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
- protocol-matching returned 1 item(s).
- protocol-matching: debug:8 - API response
- protocol-matching: debug:1 - API response

Rounds executed: 8/8

Return JSON only.
```

### 36. science_reasoning_final_synthesis

Kind: `structured-json`

**Raw System Prompt**

```text
Return valid JSON only.
```

**Raw User Prompt**

```text
You are the final answer synthesizer for a science reasoning loop.

Answer using only the evidence and tool trace provided by the app.

Do not invent evidence, papers, values, or project facts.

Markdown is allowed in the answer field. Use sections, bullets, or tables when they improve clarity, but do not include HTML.

Include trace_sentence as one short sentence describing what you are doing at this step.

The evaluator judged the evidence sufficient. Produce a grounded answer that explains the conclusion, supporting evidence, and any material caveats.

Clarified request:
LLM Response

Intent: general_science_question

Science policy:
Description: Use literature and web retrieval to answer general science questions with grounded citations.
Retrieval priority: literature_first_web_last
Require external citation when freshness matters: yes
Require retrieval attempt before final answer: yes
Allow limitation-qualified answer after evidence attempt: yes

Rounds executed: 8/8

Evaluator summary:
Satisfied: yes
Should continue: no
Can answer with limitations: yes
Reason: LLM Response
Missing requirements:
- The current evidence directly supports the core answer to the clarified request.

Citations:
- protocol-matching: debug:1 - API response
- paper-analysis: debug:2 - API response
- inventory-lookup: debug:3 - API response
- python-sandbox: debug:4 - API response

Recent tool outputs:
- protocol-generation (ok) | summary: API response
- paper-download (ok) | summary: API response
- protocol-matching (ok) | summary: API response

Return JSON only.
```

### Internal API Calls

### 1. protocol-matching

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
  "tool_name": "protocol-matching",
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
      "source": "protocol-matching",
      "pointer": "debug:1",
      "reason": "API response"
    }
  ]
}
```

### 2. paper-analysis

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
  "tool_name": "paper-analysis",
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
      "source": "paper-analysis",
      "pointer": "debug:2",
      "reason": "API response"
    }
  ]
}
```

### 3. inventory-lookup

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
        "id": "api-item-3",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-3",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "inventory-lookup",
      "pointer": "debug:3",
      "reason": "API response"
    }
  ]
}
```

### 4. python-sandbox

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
        "id": "api-item-4",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-4",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "python-sandbox",
      "pointer": "debug:4",
      "reason": "API response"
    }
  ]
}
```

### 5. notebook-draft

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
  "tool_name": "notebook-draft",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-5",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-5",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "notebook-draft",
      "pointer": "debug:5",
      "reason": "API response"
    }
  ]
}
```

### 6. protocol-generation

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
        "id": "api-item-6",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-6",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "protocol-generation",
      "pointer": "debug:6",
      "reason": "API response"
    }
  ]
}
```

### 7. paper-download

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
  "tool_name": "paper-download",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-7",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-7",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "paper-download",
      "pointer": "debug:7",
      "reason": "API response"
    }
  ]
}
```

### 8. protocol-matching

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
  "tool_name": "protocol-matching",
  "summary": "API response",
  "result": {
    "summary": "API response",
    "text": "API response",
    "items": [
      {
        "id": "api-item-8",
        "label": "API response"
      }
    ]
  },
  "items": [
    {
      "id": "api-item-8",
      "label": "API response"
    }
  ],
  "citations": [
    {
      "source": "protocol-matching",
      "pointer": "debug:8",
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
8. `science_round_started` [started] Science reasoning round 1 started with protocol-matching.
9. `science_evaluator_continue` [started] LLM Response
10. `science_round_started` [started] Science reasoning round 2 started with paper-analysis.
11. `science_evaluator_continue` [started] LLM Response
12. `science_round_started` [started] Science reasoning round 3 started with inventory-lookup.
13. `science_evaluator_continue` [started] LLM Response
14. `science_round_started` [started] Science reasoning round 4 started with python-sandbox.
15. `science_evaluator_continue` [started] LLM Response
16. `science_round_started` [started] Science reasoning round 5 started with notebook-draft.
17. `science_evaluator_continue` [started] LLM Response
18. `science_round_started` [started] Science reasoning round 6 started with protocol-generation.
19. `science_evaluator_continue` [started] LLM Response
20. `science_round_started` [started] Science reasoning round 7 started with paper-download.
21. `science_evaluator_continue` [started] LLM Response
22. `science_round_started` [started] Science reasoning round 8 started with protocol-matching.
23. `science_evaluator_satisfied` [ok] LLM Response
24. `science_intent_completed` [ok] Science reasoning loop completed successfully.