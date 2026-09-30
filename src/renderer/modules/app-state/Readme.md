# Renderer State

`index.js` is the stable public facade for loading, normalizing, persisting, and tracking events on the single renderer state object (localStorage key `hikari_state_v1`).

- `defaults.js`: the canonical persisted state shape.
- `appearance.js`: supported theme modes and shared document theme application.
- `state-normalizer.js`: top-level state assembly and compatibility normalization.
- `dashboard-normalizers.js`: dashboard timers, quick logs, incubation locations, and workflow progress.
- `paper-normalizers.js`: paper comments, highlights, and stored-PDF records.
- `sample-normalizers.js`: sample-specific compatibility cleanup.
- `agent-chat-normalizer.js`: agent chat sessions, folders, and messages.
- `storage-path-normalizer.js`: normalizes persisted record paths (used by `persist()` and hydration).
- `growth-events.js`: bounded growth-event tracking.

Feature modules still receive one shared mutable state object. The split only separates ownership of defaults and normalization logic.
