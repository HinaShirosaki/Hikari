# Project memory

Writes `Project/<project>/MEMORY.md` in the storage root: the project document
Codex reads at the start of every project-scoped agent run. It is an index,
not a store — one line per record, newest first — so the agent knows what
exists and which tool retrieves the rest.

The storage save (`storage/storage-sidecars.js`) calls `writeProjectMemoryFile`
for every project on each save. On load, `storage/hydration/project-memory.js`
reads the `Key: value` header lines of the generated block (project name, id,
description) so a `Project/<folder>` found on disk maps back to its project
record; the file is never the source of truth for notebook or paper data.

## Layout of the file

- `## Papers`, `## Experiments`, then `## Agent Notes`, each ordered newest
  first and trimmed to fit. A trimmed section says how many older entries it
  left out and which tool (`paper_intake_list_project_summaries`,
  `notebook_lookup`) returns them.
- Experiment lines carry a one-sentence LLM summary followed by a supporting
  quote from the recorded result. A page whose summary could not be generated
  or confirmed says so instead of publishing an extract.
- `## Agent Notes` renders the project-scoped records of the agent's `memory`
  tool. Codex runs read-only, so the agent writes notes through that tool,
  never by editing the file.
- The generated part sits between `<!-- hikari:auto -->` and
  `<!-- /hikari:auto -->`. Text outside those markers is kept on every rewrite,
  and counts against the size budget.
- The whole file stays under 64 KiB (`PROJECT_MEMORY_MAX_BYTES`), Codex's
  project-doc limit (`CODEX_PROJECT_DOC_MAX_BYTES`); past it Codex silently
  stops reading. `project-research-memory-selfcheck` keeps the two constants
  equal.

## Files

- `index.js`: `writeProjectMemoryFile`, workflow memory, and the public exports.
- `project-records.js`, `project-inputs.js`, `notebook-sources.js`: collect a
  project's papers, notebook results, and agent notes into render input.
- `memory-markdown.js`: renders the sections and merges them into an existing
  file between the auto markers.
- `conclusion-request.js`, `conclusion-cache.js`: the LLM request for a notebook
  conclusion, validation of the returned quote, and the cache in
  `Project/<project>/.hikari/research-memory.json` (source paths, hashes,
  quotes, retry state). A failed conclusion is retried on a later save after
  backoff, at most three times per source hash.
- `queues.js`: per-project serial queues, so a slow LLM conclusion never blocks
  the save and two saves never interleave writes to one file.
- `constants.js`, `text-utils.js`: names, markers, limits, and formatting.

More on how the agent uses this file:
[docs/agent/context/context-and-observability.md](../../../docs/agent/context/context-and-observability.md).
