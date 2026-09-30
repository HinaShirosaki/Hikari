# Scheduled tasks

Recurring Codex tasks that run while Hikari is open. Today the only user-facing
kind is the **paper finder** (Home widget and Notebook project paper finder),
whose task input and result parsing live in `src/main/papers/finding/`.

- `create-scheduled-task-service.js`: the service built in
  `core/main-services.js`. Loads and persists tasks, arms one timer per task,
  runs a task on schedule or on demand (`runTask`), records each run's result,
  and exposes list/get/create/update/delete for `register-scheduled-task-ipc.js`.
- `normalizing.js`: input → stored task, the schedule shape (one-off `runAt`,
  every N minutes, or calendar daily/weekly/monthly at a time of day in a time
  zone), and next-run computation. The clock and id generator are injected so
  runs are reproducible in tests.
- `calendar-recurrence.js`: wall-clock recurrence in a time zone (converted
  through `Intl`, so a daily 09:00 stays 09:00 across DST), clamping a monthly
  day to the last day of short months.
- `codex-task-runner.js`: runs a task as a Codex turn through the agent
  runtime, bound to the task's project folder.
- `constants.js`: storage format, interval bounds (1 minute to 1 year), and the
  catch-up stagger.

## Behavior worth knowing

- Tasks persist in `Config/scheduled-tasks.json` inside the storage root, so
  they travel with the workspace. Before a storage root is chosen they live in
  the app-data folder (`HIKARI_SCHEDULED_TASKS_PATH` overrides both).
- Timers only fire while the app runs. When Hikari starts, overdue tasks are
  armed with a fixed 5-second stagger so they do not all run at once.
- `start()` and `stop()` are called from the main-services lifecycle;
  `reload()` re-reads the file after the storage root changes.
