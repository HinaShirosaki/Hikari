Phase 0: Define the scope first

Before writing code, lock down the exact first version.

Step 0.1: Decide the MVP features

For the first working version, I’d recommend only these 5 functions:
	1.	user writes plain text like “I grew cells”
	2.	agent matches protocol
	3.	agent asks follow-up if ambiguous
	4.	agent generates a notebook page
	5.	agent can answer lab data questions through tools in agent-io-contract.json

Do not start by building everything at once.

Step 0.2: Define the supported request types

Create a fixed intent list:
	•	protocol to notebook
	•	inventory lookup
	•	record lookup
	•	project science question
	•	paper analysis
	•	coding / data analysis
	•	general science question

This will become your router.

Step 0.3: Define what “done” means for each feature

For example:
	•	protocol matching is done when top 3 candidate protocols can be returned
	•	notebook generation is done when output follows a fixed JSON schema
	•	inventory lookup is done when tools can be selected from agent-io-contract.json
	•	paper handling is done when uploaded PDFs can be read and non-uploaded papers trigger an upload request

That keeps development concrete.

Phase 2: Build the routing core

The router is the brain of the app. Build this before tool execution.

Step 2.1: Implement an intent classifier

Start simple. Don’t overcomplicate it.

Use either:
	•	rule-based intent classification first
	•	LLM-based classification second

For MVP, a rule-based + LLM fallback approach is best.

Examples:
	•	“I grew cells” → protocol_to_notebook
	•	“What is the MW of biotin?” → inventory_lookup
	•	“Why did project X fail?” → project_science_question
	•	“Summarize this paper” → paper_analysis

Step 2.2: Implement entity extraction

Extract structured values from user text.

You need at least:
	•	activity
	•	project
	•	protein
	•	compound
	•	protocol
	•	cell line
	•	paper title
	•	workflow step

For now, let the LLM produce a normalized JSON object.

Step 2.3: Build a planner

After classification, generate an internal plan:
	•	do I need tools?
	•	do I need protocol search?
	•	do I need notebook retrieval?
	•	do I need PDF reading?
	•	do I need Python?
	•	do I need web search?
	•	do I need clarification?

This plan object will control everything else.

Phase 3: Implement the tool registry and tool caller

Now wire up lab-specific data retrieval.

Step 3.1: Write a tool registry loader

Load agent-io-contract.json into memory.

Create functions like:
	•	loadToolContract()
	•	listAvailableTools()
	•	findToolsByEntityType()
	•	findToolsByTaskType()

Step 3.2: Write a tool selection function

Given intent + entity, select the best tool.

For example:
	•	compound MW → inventory or reagent metadata tool
	•	protein pI → protein registry tool
	•	“what did we do last time” → notebook search tool

Score tools by:
	•	entity compatibility
	•	task compatibility
	•	exactness

Step 3.3: Implement a generic tool executor

Create one abstraction like:

async function executeToolCall(toolName: string, args: Record<string, any>)

This is important because later you may swap local DB, API, or remote tools.

Step 3.4: Add fuzzy retry logic

When exact entity search fails:
	•	try aliases
	•	try normalization
	•	try fuzzy match
	•	then return “no matching record found”

This makes the agent much more usable.

⸻

Phase 4: Build the protocol matching engine

This is the core of the notebook generation feature.

Step 4.1: Store protocols in a searchable format

Each protocol should have:
	•	title
	•	description
	•	tags
	•	linked project
	•	placeholders
	•	steps

Put them in a DB or JSON store.

Step 4.2: Build candidate retrieval

Given user text, retrieve candidate protocols.

Methods:
	•	keyword match
	•	embedding similarity
	•	hybrid search

For MVP, use hybrid:
	•	keyword filter
	•	embedding ranking

Step 4.3: Build candidate scoring

Score each protocol using:
	•	semantic similarity
	•	entity overlap
	•	project relevance
	•	recent workflow relevance

Step 4.4: Define ambiguity thresholds

For example:
	•	if top score < 0.6, ask follow-up
	•	if top 2 scores differ by < 0.1, ask follow-up
	•	otherwise auto-select

Step 4.5: Build follow-up question generation

The question should ask only what is needed.

Bad:
	•	“Please tell me more”

Good:
	•	“Was this HEK293 maintenance, Expi293 expansion, or transient transfection setup?”

⸻

Phase 5: Build notebook generation

Now make the agent actually write notebook pages.

Step 5.1: Build placeholder extraction logic

Protocol placeholders like [] need structured names internally.

Instead of raw [], store something like:

{
  "placeholder_key": "cell_line",
  "display": "[]"
}

Otherwise placeholder filling gets messy.

Step 5.2: Build placeholder filling priority

Use this order:
	1.	user input
	2.	current conversation context
	3.	project records
	4.	tool results
	5.	follow-up answer

Never invent values.

Step 5.3: Build notebook rendering

After protocol selection and placeholder filling:
	•	inject filled values into steps
	•	keep unresolved placeholders visible
	•	output the notebook JSON

Step 5.4: Build notebook save flow

Decide whether to:
	•	auto-save draft
	•	present preview first
	•	ask user to confirm save

For early versions, preview first is safer.

⸻

Phase 6: Build project-aware retrieval

This supports project science questions.

Step 6.1: Build project record storage

Each project should link:
	•	protocols
	•	notebook pages
	•	workflows
	•	papers
	•	constructs
	•	inventory associations if relevant

Step 6.2: Build notebook page search

You need semantic or keyword search over prior notebook entries.

Queries like:
	•	“What did we use last time for PD-1 expression?”
	•	“Find previous biotinylation runs”

Step 6.3: Build workflow retrieval

Create a project workflow representation.

Example:
	•	cloning
	•	transfection
	•	expression
	•	purification
	•	labeling
	•	assay

Then the agent can answer:
	•	“what comes after transfection?”
	•	“which step failed last time?”

Step 6.4: Build project evidence aggregator

When the user asks a project question, gather:
	•	project records
	•	linked notebook pages
	•	workflow steps
	•	linked protocols
	•	linked papers

Then synthesize one grounded answer.

⸻

Phase 7: Build paper reading support

This needs careful guardrails.

Step 7.1: Separate shallow and deep paper reading

Shallow:
	•	metadata
	•	title
	•	abstract
	•	citation
	•	maybe brief summary

Deep:
	•	methods
	•	figures
	•	tables
	•	SI
	•	extraction tasks

Deep reading should require uploaded or machine-readable full text.

Step 7.2: Build uploaded PDF ingestion

When users upload a PDF:
	•	store file
	•	extract text
	•	split into sections
	•	cache parsed content
	•	optionally index figures/tables if available

Step 7.3: Build paper availability checker

Before analysis, determine:
	•	uploaded PDF available?
	•	internal full text available?
	•	only abstract available?
	•	nothing available?

Step 7.4: Implement the upload-required rule

If user asks for deep analysis and only metadata exists, return:
	•	full paper analysis unavailable
	•	please upload the PDF

Do not let the agent pretend it knows the full methods.

Step 7.5: Add paper-task modes

Support tasks like:
	•	summarize paper
	•	extract methods
	•	extract reagents
	•	identify key figures
	•	compare two papers

⸻

Phase 8: Build Python sandbox support

This makes your agent much more powerful.

Step 8.1: Define when Python is allowed

Use Python for:
	•	calculations
	•	parsing files
	•	plotting
	•	ranking results
	•	transforming structured outputs
	•	sequence analysis
	•	lab data analysis

Step 8.2: Build a Python task interface

Create a wrapper like:
	•	input data
	•	task description
	•	code template
	•	execution
	•	output capture

Step 8.3: Support common analysis jobs

I would add these first:
	•	CSV / TSV parsing
	•	growth curve plotting
	•	ELISA analysis
	•	MW / pI calculations
	•	protocol candidate scoring
	•	notebook JSON cleanup
	•	sequence property calculations

Step 8.4: Add result validation

After Python runs:
	•	check for exceptions
	•	check output format
	•	return summary and artifacts

Step 8.5: Save generated artifacts

If Python creates files like:
	•	CSV
	•	PNG
	•	PDF
	•	JSON

store and return them properly.

⸻

Phase 9: Build web search fallback

This should be a controlled fallback, not the first tool.

Step 9.1: Define when web search is allowed

Use web search for:
	•	general science questions needing references
	•	recent literature
	•	current facts
	•	project questions lacking internal evidence

Step 9.2: Build web query generator

Convert the user question into a search query.

Examples:
	•	“recent papers on nanobody affinity maturation PD-L1”
	•	“protein pI calculation method review”
	•	“latest method for intact mass deconvolution”

Step 9.3: Keep internal records higher priority

For project and lab-specific questions, do:
	•	internal data first
	•	web second

Step 9.4: Label source clearly

The answer should distinguish:
	•	lab record
	•	paper
	•	tool result
	•	web source
	•	inference

⸻

Phase 10: Build the response layer

Now make outputs consistent and useful.

Step 10.1: Create response templates

Have different response types:
	•	clarification question
	•	factual answer
	•	notebook draft
	•	project science answer

	•	paper summary
	•	analysis result

Step 10.2: Make responses source-aware

Each answer should indicate where it came from:
	•	tool result
	•	notebook page
	•	workflow record
	•	uploaded paper
	•	web search

Step 10.3: Add confidence labels internally

For example:
	•	high
	•	medium
	•	low

This helps decide whether to ask follow-up.

Step 10.4: Add unresolved field reporting

For notebook generation, explicitly list unresolved placeholders.

⸻

Phase 11: Add validation and safety checks

This is what prevents hallucinations.

Step 11.1: Add pre-response validation

Before replying, check:
	•	did the agent claim a tool result without calling a tool?
	•	did it fabricate a protocol match?
	•	did it fill unsupported placeholders?
	•	did it claim paper details without full text?

Step 11.2: Add ambiguity checks

If ambiguity would materially change the output, force clarification.

Step 11.3: Add provenance checks

Track every statement’s evidence source.

Even a simple source_evidence array helps a lot.

⸻

Phase 12: Build logging and observability

You will need this to debug.

Step 12.1: Log every request lifecycle

Store:
	•	input
	•	classified intent
	•	extracted entities
	•	plan
	•	tools called
	•	tool outputs
	•	final response type

Step 12.2: Log failure reasons

For example:
	•	no protocol candidates
	•	multiple close matches
	•	tool not found
	•	PDF missing
	•	Python exception

Step 12.3: Build a replay mode

This is extremely useful. You should be able to replay one user request and inspect each step.

⸻

Phase 13: Test each module separately

Do not test only end-to-end.

Step 13.1: Test intent classification

Create a dataset of example user inputs.

Step 13.2: Test protocol matching

Use real examples like:
	•	“I grew HEK293 cells”
	•	“I did Expi293 transfection”
	•	“I purified His-tagged PD-1”

Step 13.3: Test notebook generation

Check that:
	•	correct protocol selected
	•	placeholders filled correctly
	•	unknowns remain unresolved

Step 13.4: Test tool selection

Make sure the right tool is chosen from agent-io-contract.json

Step 13.5: Test paper handling

Check:
	•	uploaded paper → deep analysis allowed
	•	metadata only → upload requested

Step 13.6: Test Python analysis

Use real lab-style files and make sure results are stable.

⸻

Phase 14: Build the UI flow

Don’t leave UI until the very end.

Step 14.1: Notebook generation UI

When protocol match is ambiguous:
	•	show candidate protocols
	•	ask one clarifying question
	•	then preview notebook draft

Step 14.2: Tool-answer UI

For inventory or lab records:
	•	show concise answer
	•	optionally expandable raw record

Step 14.3: Paper analysis UI

Show:
	•	paper availability status
	•	summary
	•	upload prompt if needed

Step 14.4: Python result UI

Show:
	•	result summary
	•	plots
	•	downloadable files
	•	executed code if appropriate

⸻

Phase 15: Suggested implementation order

This is the order I recommend actually coding it.

Step 15.1: First milestone

Build:
	•	intent classifier
	•	entity extractor
	•	protocol matcher
	•	notebook generator

This gives you the “I grew cells” workflow.

Step 15.2: Second milestone

Build:
	•	agent-io-contract.json loader
	•	tool selection
	•	inventory and record lookup

This gives you the “what is MW / pI / where is this reagent” workflow.

Step 15.3: Third milestone

Build:
	•	project record retrieval
	•	notebook search
	•	workflow retrieval

This gives you project-aware reasoning.

Step 15.4: Fourth milestone

Build:
	•	uploaded PDF ingestion
	•	paper analysis modes
	•	upload-required fallback

Step 15.5: Fifth milestone

Build:
	•	Python sandbox orchestration
	•	data analysis jobs
	•	artifact generation

Step 15.6: Sixth milestone

Build:
	•	controlled web search fallback
	•	source labeling
	•	better evidence synthesis

Step 15.7: Seventh milestone

Build:
	•	validation
	•	logging
	•	replay
	•	benchmark testing

⸻
