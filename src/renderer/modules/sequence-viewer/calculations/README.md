# Sequence Calculations

This folder owns renderer-side sequence calculations used by Sequence Viewer and the Toolbox sequence screens (`tool-box/translation-tool.js`, `oligo-tool.js`, `peptide-tool.js`, `extinction-tool.js`).

- `sequence.js`: normalization, complements, translation, codon usage, and reverse translation.
- `oligo.js`: oligo molecular weight, extinction coefficient, and melting temperature.
- `fold.js`: MFE secondary structure (dot-bracket + dG) for DNA or RNA oligos.
- `codon-optimizer.js`: reverse translation by codon usage, then synonymous swaps that
  relieve mRNA secondary structure (`sequence.js` + `fold.js`; nothing new to configure).
- `protein.js`: peptide mass, composition, and related protein properties.
- `crispr.js`: IUPAC/PAM matching and CRISPR guide calculations. Near-match counting only covers the submitted sequences; nothing here reads a reference genome.
- `sequence-tables/`: lookup tables shared by the cores.

Toolbox files import this package to present calculators, but calculation logic should not be added back under `modules/tool-box/`. `ui/crispr-tool.js` is a CRISPR guide panel that no view mounts today.
