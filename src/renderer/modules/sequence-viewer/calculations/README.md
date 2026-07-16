# Sequence Calculations

This folder owns renderer-side sequence calculations used by Sequence Viewer and the Toolbox sequence screens.

- `sequence.js`: normalization, complements, translation, codon usage, and reverse translation.
- `oligo.js`: oligo molecular weight, extinction coefficient, and melting temperature.
- `crispr.js`: IUPAC/PAM matching and CRISPR guide calculations.

Toolbox files may import this package to present calculators, but calculation logic should not be added back under `modules/tool-box/`.
