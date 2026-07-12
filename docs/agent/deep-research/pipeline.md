# Deep Research Pipeline

The `deep-research/` folder is a structured multi-step science workflow. It is only used when the controller receives a science intent and `payload.agent.deepResearchEnabled === true`.

## Entry point

`deep-research/index.js` exports `createDeepResearchRuntime(...)` and exposes three intent wrappers:

- `runGeneralScienceQuestion(...)`
- `runProjectScienceQuestion(...)`
- `runResultAnalysis(...)`

All of them delegate into `runDeepResearchIntent(...)`.

## Intent policies

The runtime narrows tool scope by intent:

| Intent | Tool scope |
| --- | --- |
| `general_science_question` | `literature-search`, `sub-agent` |
| `project_science_question` | `notebook-lookup`, `literature-search`, `sub-agent` |
| `result_analysis` | `python-sandbox`, `notebook-lookup`, `literature-search`, `sub-agent` |

That policy table is much closer to the concrete tool catalog than the older shared science loop.

## Step-by-step flow

| Step | File | Purpose |
| --- | --- | --- |
| 1 | `step-1-clarify-question.js` | restate the research objective and tighten the target question |
| 2 | `step-2-ask-targeted-follow-up.js` | decide whether one blocking follow-up question is still required |
| 3 | `step-3-draft-research-plan.js` | create a structured plan with answer sections and possible tools/sources |
| 4 | `step-4-execute-plan.js` | choose tools round-by-round, execute them, and track evidence |
| 5 | `step-5-assemble-final-answer.js` | build an outline and render the final answer section by section |

If Step 2 still needs user clarification, the runtime returns early with a `needs_more_info` result instead of forcing a weak research pass.

## Step 4 is the core loop

`step-4-execute-plan.js` is where most of the orchestration happens.

For each round it:

1. Builds context and accuracy snapshots.
2. Asks the model to choose the next action.
3. Validates tool arguments against the chosen tool schema.
4. Executes the tool or creates a synthetic failure envelope.
5. Extracts citations and appends to `tool_trace`.
6. Updates context-control state.
7. Updates accuracy-preservation state.
8. Runs a completion check.

The loop stops when:

- the completion checker is satisfied
- the model switches to an answer action
- the round budget is exhausted

## Helper modules around Step 4

Three small files make Step 4 much easier to reason about:

| File | Role |
| --- | --- |
| `context-control.js` | rolling summary, evidence buffer, per-section evidence buckets |
| `accuracy-preservation.js` | citation dedupe, contradiction tracking, uncertainty markers, load-bearing claims |
| `sub-agent-usage.js` | whether delegation is justified, how to build sub-agent instructions, and how to run completion checks |

These helpers are not generic utilities for the whole app. They are specific to the deep-research workflow.

## Step 5 synthesis style

Unlike the shared science loop, deep research uses an outline-first final synthesis:

- choose sections
- map evidence to sections
- render each section separately
- validate the section set

That is handled by:

- `step-5-assemble-final-answer.js`
- `final-synthesis-quality.js`

The return payload keeps more internal structure than the shared science loop, including:

- `research_objective`
- `research_plan`
- `answer_outline`
- `rendered_sections`
- `context_snapshot`
- `accuracy_snapshot`
- `completion_checks`

## Important wiring note

The deep-research architecture relies on the shared `runTool(...)` adapter supplied by the controller. The shared generic tool executor now has the full tool suite registered (via `register-agent-tool-executors.js`) — inventory/notebook lookup, protocol matching, notebook generation/draft, web search, sub-agent, memory, literature search, paper download/search/analysis, purchase recommendation, protocol generation, python sandbox, and command line.

So when you read the deep-research code, keep in mind:

- the orchestration workflow lives inside `deep-research/`
- the concrete tools it can call are the ones registered on the controller's shared executor

That distinction explains why the pipeline looks broader than the currently exposed main-path tool integration.
