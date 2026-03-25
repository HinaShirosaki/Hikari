For each protocol, use a prompt to output estimated duration.

Then in the home page, show the predicted next step of protocol or next protocol of a workflow, assuming what has been done.
# Next-Step Prediction Idea

## Goal
Add a prediction layer that estimates protocol duration and uses that information to suggest the most likely next experimental step on the home page.

The feature should help users quickly understand what they are likely to do next, based on the protocol or workflow they are currently following and what has already been completed.

## Core concept

### 1. Estimate protocol duration
For each protocol, run a prompt or structured analysis step that outputs an estimated duration.

This estimate could include:
- total expected duration
- estimated duration for each major step
- optional hands-on time versus waiting/incubation time

The duration estimate should be stored as structured metadata so it can be reused later instead of recalculated every time.

### 2. Predict the next step
On the home page, use current progress information to predict what the user should do next.

This prediction may come from:
- the next incomplete step in the current protocol
- the next protocol in a linked workflow
- the next actionable block in a workflow graph after upstream dependencies are complete

The system should assume the user has completed the steps already recorded in the notebook, workflow, or dashboard progress state.

## Home page behavior
The home page should display a concise suggestion such as:
- next step in the current protocol
- next protocol in the workflow
- estimated time required
- optional reason for why this is the next recommended action

Example outputs:
- “Next step: incubate lysate with resin for 30 minutes.”
- “Next protocol: run SDS-PAGE analysis.”
- “Waiting step in progress. Estimated remaining time: 18 minutes.”

## Data sources
The prediction system can combine information from:
- saved protocol definitions
- notebook entries that indicate what has already been done
- workflow block completion state
- dashboard progress tracking
- protocol duration metadata generated earlier

## Suggested logic
A simple first version could follow rules like these:
1. identify the active workflow or current protocol
2. find completed versus incomplete steps
3. choose the first valid next step
4. attach the stored duration estimate
5. surface the result on the home page

If a workflow is active, workflow state should take priority over protocol-only prediction.

## Benefits
- gives users a clearer sense of immediate next actions
- reduces friction when resuming interrupted experiments
- makes the dashboard feel more proactive and useful
- creates a foundation for future scheduling and reminder features

## Future extensions
Possible future improvements:
- confidence score for the predicted next step
- automatic timer suggestions for waiting steps
- day planning based on estimated protocol durations
- prediction of parallelizable next tasks
- learning from the user’s real completion times to improve estimates