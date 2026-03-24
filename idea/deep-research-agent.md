Build a deep research agent.

Step 1: Clarify the question using a prompt.

Step 2(Optional): Ask some question to start working.

Step 3: Draft solution plan.

Step 4: Execute the plan. May call sub-agent to acclerate it. Context control.

Step 5: Assemble the whole answer. Draft an outline first with a prompt. Then use rolling context window to prevent info dropping out of context window and lose accurancy.
# Deep Research Agent Idea

## Goal
Build a deep research agent that can take a broad or complex user question, refine it into a researchable objective, execute a structured investigation, and return a coherent final answer without losing important context along the way.

The system should be designed for multi-step research tasks where the answer cannot be produced reliably from a single prompt.

## High-level workflow

### Step 1: Clarify the question
Use a dedicated prompt or parser step to determine what the user is actually asking.

This stage should identify:
- the main research goal
- scope boundaries
- missing constraints
- expected output style
- whether the request is exploratory, analytical, comparative, or decision-oriented

### Step 2: Ask targeted follow-up questions when needed
This step is optional.

If the request is underspecified, the agent should ask only the minimum number of questions needed to begin useful work.

Examples of what may need clarification:
- time range
- domain focus
- depth of analysis
- desired format
- decision criteria

The agent should avoid unnecessary back-and-forth and should begin working as soon as the task is sufficiently defined.

### Step 3: Draft a research plan
Before executing, the agent should generate a structured plan.

The plan should include:
- key subquestions
- search directions
- evidence types needed
- possible tools or data sources
- risks or uncertainty areas
- checkpoints for synthesis

This plan gives the system a controllable intermediate representation of the task before heavy execution begins.

### Step 4: Execute the plan
The agent should carry out the research plan step by step.

This stage may include:
- searching sources
- reading documents
- extracting structured findings
- comparing conflicting evidence
- using sub-agents to parallelize independent subproblems
- managing context aggressively so partial findings remain accessible without overflowing the working window

A strong context-control strategy is important here. The system should summarize intermediate findings in a way that preserves evidence quality and traceability.

Need to spawn a sub-agent with a prompt to check whether the end critera is met or not.
### Step 5: Assemble the final answer
The final response should not be generated in one uncontrolled pass.

Instead, the system should:
1. draft an answer outline first
2. map collected findings into the outline
3. write the final response section by section
4. use a rolling or layered context window so important evidence does not fall out of scope during synthesis

This step should prioritize completeness, coherence, and factual consistency.

## Key design principles
- Use explicit intermediate representations instead of relying on a single long reasoning chain.
- Separate planning from execution.
- Preserve important findings through structured summaries.
- Use sub-agents only when parallelism clearly improves speed or coverage.
- Control context growth so the system does not lose important earlier findings.
- Treat answer synthesis as its own stage rather than an afterthought.

## Important implementation concerns

### 1. Context control
Long research tasks can easily exceed the usable context window.

Possible strategies:
- rolling summaries
- hierarchical memory
- section-specific evidence buffers
- retrieval of prior intermediate results during final writing
- compressed but source-linked research notes

### 2. Accuracy preservation
Compression and summarization can introduce drift.

The system should preserve:
- source attribution
- uncertainty markers
- contradictions between sources
- exact claims that are load-bearing for the final answer

### 3. Sub-agent usage
Sub-agents can accelerate execution, but they should be used selectively.

Good use cases include:
- parallel research on separate subquestions
- independent source review
- separate passes for extraction, comparison, and synthesis

The parent agent should remain responsible for final integration.

### 4. Final synthesis quality
The answer assembly stage should be treated like report writing, not just chat completion.

This means:
- build an outline first
- assign evidence to sections
- keep citations or references attached to claims
- avoid losing earlier high-value findings during later drafting

## Future extensions
Possible future improvements:
- confidence scoring by section
- citation-aware synthesis
- automatic contradiction detection
- dynamic replanning when evidence is weak
- source credibility ranking
- reusable research memory across sessions