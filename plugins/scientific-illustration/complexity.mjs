export const DEFAULT_COMPLEXITY = 'standard';
export const COMPLEXITY_PROFILES = Object.freeze({
  simple: {
    label: 'Simple',
    summary: 'Essential shapes and relationships, with minimal visual detail.',
    guidance: 'Targets: about 3-8 components in one panel; at most 6 labels, naming key entities only; flat fills, no gradients or shading; no internal structure beyond what identifies a component. Prefer broad forms and generous spacing.'
  },
  standard: {
    label: 'Standard',
    summary: 'Clear mechanisms and recognizable components, with balanced detail.',
    guidance: 'Targets: about 8-20 components in one panel, or two when the request has distinct stages or conditions; label each named component; light shading allowed; show defining internal features (for example a membrane or nucleus). Keep whitespace around labels and arrows.'
  },
  detailed: {
    label: 'Detailed',
    summary: 'Relevant substructures, stages and annotations, with careful organization.',
    guidance: 'Targets: 20 or more components; use multiple panels or insets for stages, scales or zoomed views; label components and their substructures and number sequential steps; shading and gradients allowed. Show canonical substructures (for example organelles or protein domains). Build intricate components on scratch, inspect them, then transfer them to main.'
  }
});
export const COMPLEXITY_LEVELS = Object.keys(COMPLEXITY_PROFILES);

export function complexityLabel(level = DEFAULT_COMPLEXITY) {
  if (!COMPLEXITY_LEVELS.includes(level)) throw new Error('Choose Simple, Standard or Detailed complexity.');
  return COMPLEXITY_PROFILES[level].label;
}

export function complexityInstructions(level = DEFAULT_COMPLEXITY) {
  const label = complexityLabel(level);
  return `Complexity: ${label}. Before drawing, form an internal illustration brief (do not send it to the user): entities, relationships and arrows, layout and panels, and the label list. ${COMPLEXITY_PROFILES[level].guidance} Targets are approximate; content the user explicitly requests overrides them, and the level governs everything else. Labels must stay legible at the canvas size, never below fontSize 12. Add only well-established, textbook-standard structure; never invent mechanisms, quantities or interactions the user did not state. Apply the level to new or changed content; do not restyle or remove existing objects unless asked.`;
}
