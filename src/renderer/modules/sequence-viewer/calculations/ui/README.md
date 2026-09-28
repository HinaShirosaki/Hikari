# Sequence Calculation UI Adapters

`crispr-tool.js` is a UI adapter for the CRISPR guide calculations in `../crispr.js`. No view mounts it today: the Tools workspace has no CRISPR panel, and its other sequence panels live in `modules/tool-box/` and import the calculation cores directly. Calculation logic stays one directory above.
