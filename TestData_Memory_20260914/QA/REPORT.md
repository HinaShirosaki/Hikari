# Packaged memory verification

Tested: 2026-09-15T03:37:56.902Z

## Result

- Rebuilt Hikari successfully. All 9 inspected memory files match current source.
- **27 packaged runtime assertions passed**, through the shipped main agent service, HTTP app host, and stdio MCP server.
- A separate process restart retained global and project records and kept the deleted record absent.
- Both memory selfchecks passed against modules imported from the package. These cover concurrent loading/writing, failed reads/writes, rollback, storage-root changes, scope, model-evidence separation, stale-source checks, retry and regeneration.
- Existing PDF, markdown, and intake copied from TestData3; original and copied hashes remain identical.

## Passed assertions

- Packaged stdio server advertises memory
- Fresh workspace starts empty
- Global preference persisted through app host
- Selected project stable ID is persisted
- Second project memory persisted
- Project recall contains project plus global
- Project B does not leak into project A
- Unfiltered forget rejected through full MCP chain
- Healthy call after rejected deletion
- Ranked recall uses words in either order
- Exact-key forget removes only selected record
- App path resolves inside isolated storage
- Disk contains four intended records
- Packaged notebook generation pipeline executed
- Manual project note preserved
- Existing paper intake summary enters project memory
- Notebook publishes recorded evidence
- Unsupported model interpretation is not published
- Provenance saved
- Proposed summary retained separately
- Packaged stdio server advertises memory
- Project A persists after complete process restart
- Global preferences persist after process restart
- Deleted record stays deleted after restart
- Project B persists independently
- Evidence cache reused after process restart
- Project memory remains grounded after restart

## Test boundaries

- Packaged modules loaded directly from app.asar using Electron 40.7.0; desktop UI not exercised.
- MCP host and stdio processes restarted; interactive desktop app was not restarted.
- Existing PDF and intake reused; PDF was not re-analyzed.
- Notebook generation was deterministic; live model test requires approval.
- The standalone server correctly returns executor_unavailable without its app host; connected-host tests passed.

## Pending live-agent check

Automatic approval review rejected the planned live Codex request because it would copy login credentials into a temporary private profile and send synthetic QA memory to Codex. The script did not run; no credentials were copied and no live request was sent.

## Evidence

- [Summary](summary.json)
- [Initial runtime checks](seed-report.json)
- [Process restart checks](restart-report.json)
- [Package file comparison](package-inspection.json)
- [Reused PDF and intake provenance](copied-sources.json)

Workspace: /Users/shiyifan/Projects/Enana/TestData_Memory_20260914

All notebook values and stored markers in this workspace are synthetic QA data.
