# Renderer Services

This folder is the cross-feature integration boundary. Registry services fan events between feature APIs, while adapters such as `direct-llm.js`, `notebook-linked-previews.js`, and `chemical-structure-clipboard.js` coordinate platform or multiple-feature behavior.

Pure helpers belong in `renderer/lib/`. Feature-specific behavior belongs under `renderer/modules/<feature>/`.
