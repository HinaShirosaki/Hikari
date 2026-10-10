# Protocol and notebook MCP verification — 2026-10-08

Tested and repaired the current working tree at `d7b20c9b`, including its existing
uncommitted Markdown migration changes. The changes fix notebook search and
refresh the native Codex MCP connection. Live records were left unchanged.

## Results

| Verification | Result |
| --- | --- |
| Existing Markdown storage, standalone-record, and migration checks | 76 passed |
| Related agent, MCP gateway, notebook/protocol, approval, and storage suites plus the registered MCP selfcheck | 118 passed |
| Real Electron protocol/notebook editors, IPC saves, reload, import, agent lookup, and PDF export | Passed |
| MCP integration checks with the actual SDK server and registered app executors | 12 passed |
| Same integration checks through a child stdio process and authenticated loopback HTTP app host | 12 passed |
| Lint of the new integration test | Passed |
| Fresh MCP client against the running packaged app | 34 tools listed; protocol and Markdown notebook lookup both matched |

The Electron check initially aborted under the filesystem sandbox. Its isolated
run outside the sandbox passed. The HTTP integration checks also ran outside the
sandbox because they bind a temporary loopback listener.

## Fixed functional failures

1. **A project or protocol filter replaces the notebook text query.** Given
   `query: "scopedneedle987654"`, only page `n1` contains that text. Adding
   `project_name: "Migration project"` returns `n1` and `n2`; adding
   `protocol_name: "MCP migration assay"` returns `n1`, `n2`, and `n3`.
   The direct MCP handler and registered executor now pass an explicit text
   query to `agent-notebook-lookup.js` independently of those filters. An empty
   query stays empty for filter-only requests, even with unrelated chat context.
   The regression now returns only `n1` for either filter.

2. **Notebook lookup misses a page when the matching text appears only in its
   experiment title.** Page `n1` is named `Migrated observation`; searching
   `query: "Migrated"` returns no matches despite complete storage access.
   `agent-sub-app-api.js` now includes `experimentName` and the legacy `title`
   field in notebook search text and uses them for the displayed title. The
   regression returns `n1` with or without a project/protocol filter.

Both failures were reproduced with migrated Markdown-only records through both
MCP transports before the fix. Their regressions now pass in the normal
selfcheck suite. This does not establish that the migration introduced them.

## Passing migration behavior

Fixtures migrate synthetic legacy JSON, delete the aggregate source, and verify
that no active `protocol.json` or `page.json` companion is needed. MCP reads
external Markdown edits, preserves placeholder IDs and historical protocol
snapshots, and returns typed tables/formulas, buffer calculations, values,
sample links, and safe attachment descriptions. Disk readback retains assay/gel
links, images, provenance, and additional metadata.

Protocol generation and notebook/append proposals leave files unchanged before
approval. Synthetic approval continuations use the real protocol saver, planned
page adapter, and saved-page append adapter. Records save as `.md`, reload with
their structured data, and reject duplicate page creation and stale append
proposals. Invalid placeholder display-name keys remain unresolved. Damaged
notebook metadata produces incomplete-access warnings and remains unchanged;
available request-snapshot recovery content is explicitly partial.

## Live connection repair

Read-only `protocol_lookup` and valid `notebook_lookup` calls returned
`fetch failed`. The configured Hikari MCP endpoint in Codex points to
`127.0.0.1:60136`; a direct health probe returned `ECONNREFUSED`. The running
Hikari app's MCP host answered `/health` successfully on port `54060`.
The configured stdio server also points to `out/Hikari-darwin-arm64`, while the
running app comes from `out/cloud-drive-icons-package/Hikari-darwin-arm64`.
The marked Hikari block in `/Users/shiyifan/.codex/config.toml` was replaced with
the live managed configuration, preserving the previously configured TestData3
workspace and every unrelated setting. The stdio command now uses the running
app's executable with `--hikari-mcp-stdio`. A private backup was saved alongside
the native configuration. No tokens were printed.

A fresh SDK client using the saved command, arguments, token, and workspace
listed 34 tools, selected a protocol, and matched a notebook page with
`source: "markdown"` and complete storage access. Existing Codex sessions still
need to reload their MCP connection; use Settings > MCP servers > Restart as
described in the [official documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

## Reproduction

```sh
node tests/record-markdown-mcp-selfcheck.js
node tests/record-markdown-mcp-selfcheck.js --http
```

Both commands pass all 12 checks. The script creates and removes temporary
workspace data only and is automatically selected by `test.js`'s `*-selfcheck`
discovery. The fixed code was verified in source and isolated Electron; the
currently running package has not been rebuilt to include the search fixes.
