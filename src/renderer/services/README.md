# Renderer Services

This folder is the cross-feature integration boundary. Registry services fan events between feature APIs, while platform-level adapters such as `direct-llm.js` coordinate capabilities shared across features.

Pure helpers belong in `renderer/lib/`. Feature-specific behavior belongs under `renderer/modules/<feature>/`.
