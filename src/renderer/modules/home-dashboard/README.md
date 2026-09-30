# Home dashboard

`index.js` (`initHomeDashboard`) hands typed element bundles to independent
widgets and fans `render()` out to them. Each widget owns one tile:

- `timer.js`, `timer-rendering.js`: **Lab timers** — named countdowns and saved
  timer templates.
- `quick-log.js`: **Experiment log** — one box that either saves a dated log
  line or hands the text to the assistant. Log lines live in
  `settings.dashboard.quickLogEntries` and are written to
  `Dashboard/experiment-log.json` in the storage root.
- `notebook-agent.js`: the **Prepare notebook page** dialog the experiment log
  opens. The chat instance comes from the manifest's `createAgent` (built with
  `agent-chat/public-api.js`), so Home never imports Agent Chat internals;
  drafts go through the normal review cards before anything is saved.
- `notebook.js`: **Notebook notes** — the six most recently updated notebook
  pages, with an inline note editor (optionally clarified by the LLM).
- `contribution.js`: **Lab activity** — an 18-week heatmap built from notebook
  entries, workflow step completions, assay analyses, and log lines.
- `passage.js`: **Cell passage** reminders (overdue and upcoming).
- `incubation.js`: **Overnight incubation** — named incubators with an optional
  reminder date, and the location list dialog.
- `paper-finding.js`: **Paper finder** — lists the scheduled literature sweeps
  (`hikariApi.listPaperFindingTasks`), runs one now (`runPaperFindingTask`),
  and downloads a found paper into the library (`downloadFoundPaper`).
  Schedules are created from a Notebook project
  (`biology-notebook/project/paper-finder-controller.js`).
- `utils.js`: date helpers, dashboard-record normalizers, and the
  `ensureDashboardState` guard every widget calls.

Dashboard state lives in `state.settings.dashboard`; the activity heatmap
reads notebook entries, workflows, and assays directly. The manifest is
`src/renderer/module-manifests/home-dashboard.js`.
