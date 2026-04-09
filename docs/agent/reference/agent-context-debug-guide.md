# Reading The Agent Context Debug Export

This guide explains how to read the debug export file at `docs/agent/reference/agent-context-debug.md`.

If the exporter writes to a different location, the file format is still the same. The section meanings below still apply.

## What this file is for

The debug export is a readable snapshot of how the science agent loop built and used context.

It is meant to answer questions like:

- What inputs did the runtime start with?
- What did the agent believe the current context was before each round?
- Which tool was selected in each round?
- What information was sent to the LLM-facing boundary?
- What information came back from the internal tool/API boundary?
- Why did the loop stop with `completed`, `partial`, or `needs_more_info`?

The export is intentionally stubbed:

- Every LLM-facing output is replaced with `LLM Response`.
- Every internal tool/API-facing output is replaced with `API response`.

That means the file is for context debugging, not model-quality evaluation.

## How to read it quickly

Use this order when skimming:

1. Read the scenario JSON near the top of the file.
2. Read `Final Result` to see how the run ended.
3. Read `Round Contexts` to inspect the loop round by round.
4. Read `Exact Raw Prompt Payloads` if you want the untruncated prompt payloads sent to the LLM boundary.
5. Read `LLM Calls` if you want a more readable prompt/context view.
6. Read `Internal API Calls` if you want the exact tool call arguments and returned tool results.
7. Read `Lifecycle` last if you want the stage-by-stage execution summary.

## File layout

The export is organized into these main sections.

### Scenario Header

This is the JSON block directly under a scenario title such as `Science Loop`.

Important fields:

- `intent`: which runtime path was exercised
- `mode`: direct answer, clarification, or loop
- `message`: the user request that seeded the run
- `reasoning_effort`: how deep the science loop was allowed to reason
- `iterations`: the externally requested loop count for debug runs
- `max_rounds`: the round budget enforced by the runtime
- `tool_sequence`: the allowed tool pool for the run
- `project`: resolved project context, if any

Unless you pass `--tool-sequence`, the exporter now uses the full allowed science-runtime tool pool for that intent.

For loop mode, the actual tool used in each round may differ from the listed order, because the debug runner may choose randomly from the allowed tool set.

### Final Result

This is the best single summary of how the run ended.

Important fields:

- `status`: final runtime state
- `answer`: final answer text placeholder
- `citations`: normalized evidence references gathered during the run
- `decision_record`: assumptions, open questions, and verification notes
- `input_clarification`: normalized clarification output before tool use
- `route_plan`: the reference plan for the loop
- `exit_criteria`: what the evaluator was looking for before stopping
- `tool_trace`: compact record of executed tool rounds
- `intermediate_states`: internal milestones captured by the runtime
- `rounds_executed`: how many tool rounds actually ran
- `thinking_trace`: a compact step-by-step reasoning summary

How to interpret `status`:

- `completed`: the loop judged the available evidence sufficient
- `partial`: the loop stopped before full sufficiency and returned a best-effort result
- `needs_more_info`: the loop stopped because required clarification was missing

### Round Contexts

This is the most useful section for context debugging.

Each round shows:

- `Selected Tool`: the tool chosen for that round
- `Agent Request`: the system prompt, conversation, tool definitions, and optional feedback used to choose the next action
- `Agent Request Raw Payload`: the same request fields without the exporter’s display trimming
- `Context Before Round`: the real rendered context right before tool selection
- `Tool/API Result`: the stubbed tool call and returned tool result
- `Agent Continuation After Tool`: the tool output sent back into the session and the stubbed assistant continuation
- `Context After Round`: the real rendered context after the tool result was recorded

When debugging loop behavior, compare `Context Before Round` and `Context After Round`. That shows exactly what was added to the working context after each tool execution.

### Context Snapshots

This section is a broader timeline of important context checkpoints, not just loop rounds.

Typical snapshots include:

- the initial context
- a checkpoint after each tool round
- a final context after completion or clarification

Each snapshot now shows only the rendered real context, which is the form a prompt builder would actually consume.

Important distinction:

- these context snapshots are not the literal final payload sent to the LLM
- use `Exact Raw Prompt Payloads` when you need the actual prompt payload captured at the LLM boundary

### LLM Calls

This section shows a readable view of what crossed the LLM-facing boundary.

Depending on the run, it may include:

- structured JSON helper calls such as clarification, route planning, exit criteria, final synthesis, and thinking trace
- agent session start messages
- follow-up messages after tool outputs

Useful fields:

- `stage`: which step made the call
- `system_prompt`: the active system instructions
- `user_prompt` or `message`: the request payload sent to that step
- `tool_definitions`: the tool schema list available at that point
- `tool_call`: the selected tool call, if that turn proposed one

This section is trimmed for readability, so it is not guaranteed to be byte-for-byte identical to the raw captured payload. Because outputs are stubbed, it is best used to inspect input context, not result quality.

### Exact Raw Prompt Payloads

This section is the closest thing to the literal payload sent across the LLM boundary.

For each call, it shows the untruncated raw values captured by the exporter, such as:

- `Raw System Prompt`
- `Raw User Prompt`
- `Raw Message`
- `Raw Feedback Message`
- `Raw Conversation`
- `Raw Tool Definitions`
- `Raw Tool Outputs`

Use this section when you need to answer questions like:

- “Was this exact sentence really sent to the model?”
- “Did the exporter trim the readable `LLM Calls` view?”
- “Was the conversation embedded directly, or only the prompt block summary?”

### Internal API Calls

This section shows the tool-facing boundary.

For each call, check:

- `tool_name`: which tool executed
- `arguments`: what the runtime passed into the tool
- `debug_envelope`: the normalized tool result recorded back into the loop

This section pairs well with `Round Contexts` because it explains exactly which tool result caused the context to change.

### Lifecycle

This is the shortest execution log.

It is useful when you only need the stage order:

- clarification started/completed
- route planner started/completed
- round started
- evaluator continue/satisfied
- budget exhausted
- intent completed

Read this section when you want a compact timeline before drilling into the larger JSON blocks.

## How to inspect one round

For a single round, use this checklist:

1. Open the round in `Round Contexts`.
2. Read `Selected Tool`.
3. Read `Context Before Round`.
4. Read `Tool/API Result`.
5. Read `Context After Round`.
6. Compare the `tool_trace` entry in `Final Result` for the same round number.

That gives you the complete chain from available context to tool selection to updated context.

## How to inspect why a run stopped

Start with `Final Result`:

- Check `status`.
- Check `decision_record.open_questions`.
- Check `exit_criteria`.
- Check `rounds_executed`.

Then confirm with:

- `Lifecycle` for the stopping stage
- the last item in `Round Contexts`
- the last relevant `LLM Calls` entry for the evaluator or final synthesis

## Common reading patterns

If you want to know why the wrong tool was chosen:

- read `Round Contexts`
- then read `Exact Raw Prompt Payloads`
- then read `LLM Calls`
- focus on the round's `Agent Request`, `tool_definitions`, and `Selected Tool`

If you want to know whether context was missing:

- read `Context Before Round`
- then compare it to `Context After Round`
- check whether the needed detail only appeared after a later tool result

If you want to know why the run ended as `partial`:

- read `Final Result.decision_record.open_questions`
- then read `exit_criteria`
- then read the last round's `Tool/API Result`

If you want to know whether the export is working as intended:

- confirm that every model-facing output says `LLM Response`
- confirm that every tool-facing output says `API response`
- confirm that round-by-round context changes appear in `Round Contexts`

## Practical note

The debug export is best read as a context trace, not as a transcript of intelligence.

The important question is not "Was the answer good?"

The important question is "Given this exact context, what did the runtime think it knew at each step?"
