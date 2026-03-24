Agent can generate potential experiment to be done.

It is a tool call.

Agent will prefill the notebook page. Users can add notes to it. 

Should be a button for these future pages: "Executed"
# Notebook Draft and Proposed Experiment Idea

## Goal
Allow the agent to propose plausible next experiments and generate notebook drafts for them before the work is actually performed.

The purpose is to help users plan upcoming experiments faster while still keeping the final notebook under user control.

## Core concept
The agent should be able to generate a **proposed experiment entry** based on available context, such as:
- current project
- active workflow
- recent notebook entries
- protocol history
- experimental progress so far

This should be implemented through a **tool call**, not as free-form chat text only.

## Expected behavior

### 1. Agent proposes a future experiment
The agent may suggest an experiment that is likely to be performed next.

Examples:
- the next protocol in a workflow
- a follow-up validation step after a successful result
- a logical continuation of an unfinished experiment
- a control experiment or troubleshooting step

### 2. Agent pre-fills a notebook page
Once the proposed experiment is selected, the agent should generate a notebook draft with pre-filled content.

The pre-filled draft may include:
- title
- linked project
- linked protocol
- expected purpose
- planned materials
- drafted step sequence
- placeholders for values the user still needs to enter
- optional predicted notes or checkpoints

The user should then be able to review and edit the notebook draft before using it.

### 3. User adds real notes during execution
The notebook page should remain editable.

Users should be able to:
- add observations
- fill placeholders
- change steps if the real experiment differs from the draft
- attach results and files
- revise the draft into the final experimental record

## Proposed notebook states
To distinguish planning from actual execution, notebook pages should support explicit states such as:
- **Draft / Planned**
- **Executed**
- optionally **Abandoned** or **Superseded** in the future

## UI idea
For notebook pages that were generated in advance, include a clear button such as:
- **Executed**

Pressing this button would indicate that the planned page has moved from a proposed experiment into a real executed experiment.

This helps separate:
- experiments the agent suggested
- experiments the user actually carried out

## Benefits
- speeds up experiment planning
- reduces notebook setup time
- helps users continue workflows without rebuilding context manually
- keeps human control over the final record
- creates a bridge between workflow planning and notebook execution

## Future extensions
Possible future improvements:
- confidence score for proposed experiments
- multiple candidate next experiments instead of a single suggestion
- auto-linking to workflow state
- reminders for unexecuted draft pages
- conversion of executed drafts into timeline or dashboard progress