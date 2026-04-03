

# Science Question Difficulty Routing and Reasoning Effort

## Goal

The system should not process every scientific question with the same reasoning depth. Instead, it should first estimate the minimum reasoning effort required by the user query, then route the request to an appropriate answer mode. Simple questions should be answered directly for speed and clarity, while more complex questions should enter a structured reasoning loop with evidence synthesis and explicit stopping criteria.

This design improves latency, reduces unnecessary tool usage, and makes reasoning behavior more controllable.

## Core Principle

The routing decision should not be based only on whether a question looks "easy" or "hard" in a human sense. It should be based on the minimum reliable reasoning effort needed to answer the question well.

A question may appear simple on the surface but still require more reasoning if it is ambiguous, high-risk, dependent on evidence integration, or likely to cause overconfident errors if answered directly.

Therefore, the system should first ask:

> What is the minimum reliable reasoning effort required to answer this scientific query?

## High-Level Routing Strategy

The system should use a fast triage layer before entering the main reasoning workflow.

### Level 0: Direct Response

Use direct output when:
- the question is straightforward and fact-based
- little or no multi-step inference is needed
- no tool call is required
- ambiguity is low
- the consequence of a minor mistake is low

Examples:
- What is ELISA?
- What is the difference between affinity and avidity?

### Level 1: Light Reasoning

Use a lightweight reasoning pass when:
- one or two reasoning steps are needed
- the answer still fits in a compact explanatory form
- the system may need limited interpretation but not a full loop

Examples:
- Why does competitive ELISA signal decrease with analyte concentration?
- Why can Avi-tag capture produce cleaner results than passive coating?

### Level 2: Structured Reasoning Loop

Use an iterative reasoning loop when:
- the question requires comparison, troubleshooting, planning, or diagnosis
- multiple explanations are possible
- evidence must be integrated across tool outputs or observations
- uncertainty matters to the quality of the answer

Examples:
- Why did nanobody refolding yield improve while binding activity dropped?
- Design a strategy to distinguish aggregation from epitope damage.
- Compare phage display, yeast display, and mRNA display for a given discovery campaign.

## Difficulty Assessment Dimensions

Instead of using a vague easy-versus-hard label, the system should score the query across several practical dimensions.

Suggested dimensions:
- knowledge retrieval need
- multi-step inference depth
- ambiguity or underspecification
- evidence integration need
- tool-use need
- consequence of error

Each dimension can be scored using a small range such as 0 to 2.

Example:

```json
{
  "retrieval_need": 0,
  "inference_depth": 2,
  "ambiguity": 1,
  "evidence_integration": 2,
  "tool_need": 1,
  "error_cost": 1
}
```

Possible routing thresholds:
- 0 to 2: direct response
- 3 to 5: light reasoning
- 6 to 8: structured reasoning loop

These thresholds should be treated as tunable rather than fixed.


## Dynamic Escalation

The initial routing decision should be fast and approximate, not overly expensive. The system should begin with the cheapest sufficient reasoning mode, then escalate if needed.

Example escalation triggers:
- answer confidence falls below threshold
- a contradiction appears
- tool output reveals missing critical information
- the question is more ambiguous than initially estimated
- the answer requires stronger evidence than expected

This approach is usually better than forcing every question into a deep loop from the start.


## Summary

The system should classify scientific queries by required reasoning effort rather than superficial difficulty alone. Simple, low-risk, unambiguous questions can be answered directly. Questions involving diagnosis, planning, comparison, uncertainty, or evidence synthesis should enter a reasoning loop. After each tool round, the system should synthesize the current evidence state and evaluate exit criteria before deciding whether to continue.

This produces a more efficient, more reliable, and more controllable scientific reasoning workflow.

**Finished**