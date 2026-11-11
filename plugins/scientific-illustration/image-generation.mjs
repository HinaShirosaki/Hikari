// null preserves the automatic SVG-first policy of existing illustrations.
export const IMAGE_GENERATION_PRESETS = Object.freeze({
  0: { label: 'SVG only', guidance: 'Do not call image_gen. Use SVG for new artwork or reuse suitable existing artwork.' },
  25: { label: 'Mostly SVG', guidance: 'Assign about one quarter of the eligible artwork area to image generation and the remainder to SVG.' },
  50: { label: 'Balanced', guidance: 'Split the eligible artwork area roughly evenly between image generation and SVG.' },
  75: { label: 'Mostly image generation', guidance: 'Assign about three quarters of the eligible artwork area to image generation and the remainder to SVG.' },
  100: { label: 'All eligible artwork', guidance: 'Assign every eligible component to image generation, including flat or simple subjects. Generate directly when no compatible generated asset is available. The ability to draw a component in SVG does not justify switching it to SVG.' }
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
    ? 'Image generation: Automatic (SVG-first). Use SVG by default. Use image_gen when SVG cannot clearly depict the required appearance. When unsure in Automatic, try one simple SVG draft at the final size, then switch if it cannot convey the intended subject.'
    : `Image generation target: ${percent}% of eligible illustrative artwork area (${imageGenerationSummary(percent)}). ${IMAGE_GENERATION_PRESETS[percent]?.guidance || 'Assign this approximate share of eligible artwork area to image generation and the remainder to SVG.'}`;
  const plan = percent > 0 ? `
Plan the renderer for each eligible component before drawing. Estimate the share from visible placed area, using whole components. This is an area target, not a quota of assets or tool calls. Choose components that suit the requested composition and style. Use image_gen or reuse compatible generated assets for the share assigned to image generation. Check the actual mix for this request in the final artwork review. In the final reply, explain any material shortfall, including the specific reason if the requested artwork contains zero generated components.` : '';
  return `Renderer choice applies to new and explicitly replaced artwork. Preserve existing artwork unless the user asks to replace it. An explicit SVG or image-generation choice for one new component overrides the saved renderer mix for that addition only. Keep the saved target unless the user asks to change it.
Keep boxes, arrows, connectors, panel frames, scale bars, schematic symbols and exact scientific geometry as separate SVG layers. Keep labels as separate editable text and data plots as Plotly layers. Use known values or verified structures for scale bars and atom/bond diagrams. Use vectors for shapes the user needs to edit precisely or recolor independently.
A component is eligible for image generation if a separate text-free image can represent it accurately at the required size and placement. This includes flat and stylized subjects within schematics. Image layers can be moved, resized and rotated independently. Use the requested style and detail for either renderer. Keep exact boundaries and connections on separate vector layers when needed.
${target}${plan}`;
}
