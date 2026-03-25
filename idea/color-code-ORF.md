For each amino acid, add a unique color to it.

Add optional TAG/TAA/TGA translation.

Make amino acid code align in the center.
# Color-Coded ORF Visualization Idea

## Goal
Create an ORF visualization mode in which each amino acid is displayed with its own unique color.

The feature should make translated protein regions easier to scan visually, especially when users are comparing ORFs, checking frame continuity, or reviewing long coding regions.

## Core idea
- Assign a distinct color to each amino acid.
- Render the translated amino acid sequence directly above or aligned with the nucleotide sequence.
- Keep the display consistent across the app so the same amino acid always uses the same color.

## Display requirements
- Each amino acid character should be visually centered inside its display cell.
- The color scheme should remain readable on both light and dark backgrounds.
- Colors should be distinguishable enough to avoid confusion between similar residues.
- The feature should work for long sequences without making the viewer cluttered.

## Optional behavior
- Allow optional translation of stop codons:
  - `TAG`
  - `TAA`
  - `TGA`
- This should be configurable, since some workflows may want to treat stop codons as translation endpoints, while others may want to display them explicitly.

## Suggested options
Possible user-configurable settings:
- toggle amino-acid color mode on or off
- choose whether stop codons are shown as symbols, labels, or translated placeholders
- switch between one-letter and three-letter amino acid display
- adjust cell size or spacing for readability

## Use cases
This feature would be useful for:
- ORF inspection
- checking translated reading frames
- identifying repeated amino acid patterns
- spotting stop codons quickly
- comparing coding regions across constructs

## Future extensions
Possible follow-up improvements:
- custom user-defined amino acid color palettes
- highlighting hydrophobic, polar, acidic, and basic residue classes
- frame-specific color overlays
- exportable ORF visualization for figures or reports