// Simplified textbook pathway, verified against Reactome's Signaling by EGFR
// (R-HSA-177929) and EGFR downregulation (R-HSA-182971). This is a hybrid
// composition stress test, not a quantitative or exhaustive pathway model.
module.exports = [{
  id: 'complex-4k-flat-egfr', title: 'EGF signaling and receptor trafficking — flat 4K',
  percent: 50, complexity: 'detailed', width: 3840, height: 2160, timeoutMs: 1800000,
  expected: 'hybrid', minRasters: 4, minVectors: 30, minTexts: 30, minArrows: 18,
  flatSvg: true, everyGenerationStyle: true, stylePattern: '\\bflat\\b',
  style: { preset: 'flat', prompt: 'Strict flat scientific illustration: solid uniform color fills, clean dark outlines, no gradients, highlights, shadows, texture or 3D lighting. Coordinated teal, blue, violet and warm gold. White canvas; generated components on transparent backgrounds. Match the SVG components.' },
  labels: ['EGF', 'EGFR', 'Plasma membrane', 'GRB2', 'SOS', 'RAS', 'RAF', 'MEK', 'ERK', 'GAB1', 'PI3K', 'PIP2', 'PIP3', 'AKT', 'CBL', 'Early endosome', 'Recycling', 'Lysosome', 'Nucleus'],
  prompt: `Create a complex 3840 × 2160 educational pathway titled "EGF signaling and receptor trafficking". Follow the saved Flat style throughout. Combine many SVG components, actual image_gen artwork, arrows, inhibition symbols and independent editable text. This is a simplified qualitative overview, not measured data.

Across the top, show EGF binding a membrane-spanning EGFR dimer, with cytoplasmic phosphorylation marks. Under this shared receptor, arrange three spacious branches:
A. MAPK: GRB2/SOS → RAS (GDP → GTP) → RAF → MEK → ERK, then a nucleus and "Gene expression".
B. PI3K–AKT: GAB1 recruits PI3K; PI3K converts PIP2 → PIP3 at the inner membrane. PIP3-dependent recruitment/activation leads to AKT → "Survival and growth". Label the activation step as simplified; PIP3 is not an AKT kinase. PTEN reverses PIP3 → PIP2; show the reverse reaction and negative regulation distinctly. Keep lipid reactions beside the membrane.
C. Trafficking: CBL-associated ubiquitination → receptor internalization → Early endosome. Branch to Recycling back to Plasma membrane and to Lysosome → degradation → reduced signaling.

Generate FOUR separate flat, text-free components with image_gen: an irregular EGF protein ligand, a cutaway nucleus, an early endosome and a lysosome. Each is its own movable raster layer, never a labeled figure or sprite sheet. Use solid fills, clean outlines and irregular internal contours; no gradients, shadows, highlights, texture or 3D lighting. Use SVG for membrane, exact receptor geometry, kinase/adaptor nodes, lipids, phosphate/ubiquitin symbols, branch frames and all reaction arrows, inhibition marks and thin label leaders.

Use teal, blue, violet and gold on white with consistent strokes and ample whitespace. Make titles, A/B/C headings, molecule names, process labels and compartment labels separate text, around 40–48 units with larger headings. Add a small editable legend for activation, inhibition and trafficking. Route arrows around text, with precise endpoints and unambiguous directions. Render, inspect every label and connection, repair collisions or scientific errors, and submit final inspection.`
}];
