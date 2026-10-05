// null preserves the automatic SVG-first policy of existing illustrations.
export const IMAGE_GENERATION_PRESETS = Object.freeze({
  0: { label: 'SVG only', guidance: 'Do not call image_gen for this request; use SVG or suitable existing artwork. If the requested appearance cannot be achieved, explain the limitation.' },
  25: { label: 'Mostly SVG', guidance: 'Use SVG for most eligible illustrative artwork. Reserve Codex image_gen for key organic or textured components, aiming for about one quarter of their combined visual area.' },
  50: { label: 'Balanced', guidance: 'Aim for roughly equal visual shares of SVG and Codex image_gen among eligible illustrative components. Use generation for organic or textured detail and SVG for simpler forms.' },
  75: { label: 'Mostly image generation', guidance: 'Use Codex image_gen for most eligible illustrative artwork, aiming for about three quarters of its visual area. Keep simpler illustrative components as SVG.' },
  100: { label: 'All eligible artwork', guidance: 'Use Codex image_gen for all eligible illustrative artwork. Mandatory schematic geometry remains SVG and every label remains a separate text object.' }
});

export function imageGenerationPercent(value = null) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error('Image generation percentage must be a whole number from 0 to 100, or null for Automatic.');
  return value;
}

export function imageGenerationSummary(value = null) {
  const percent = imageGenerationPercent(value);
  return percent === null ? 'Automatic · SVG first' : IMAGE_GENERATION_PRESETS[percent]?.label || `Custom target · ${percent}%`;
}

export function imageGenerationInstructions(value = null) {
  const percent = imageGenerationPercent(value);
  const target = percent === null
    ? 'Image generation: Automatic. Follow the SVG-first renderer rules below.'
    : `Image generation target: ${percent}% of eligible illustrative artwork area (${imageGenerationSummary(percent)}). In your internal brief, plan this renderer mix: ${IMAGE_GENERATION_PRESETS[percent]?.guidance || 'Aim for this approximate visual share using Codex image_gen for components that benefit from realistic, organic or textured detail. Use SVG for the remaining artwork.'}`;
  return `${target} The target is a visual preference, not a quota of assets or tool calls, and excludes text, boxes, arrows, connectors, panel frames, charts, scale bars and exact scientific geometry. Those always remain separate SVG or text objects, even at 100%. Never rasterize schematic symbols or invent texture/extra components just to reach a percentage. If the requested content has no eligible raster detail, keep it SVG and explain why the target was not applicable. Apply this setting to new or requested changes; preserve existing artwork unless the user asks to replace it. Check the renderer mix during final inspection and explain any shortfall. Change the saved target only when the user requests it.`;
}
