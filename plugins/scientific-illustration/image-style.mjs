export const IMAGE_STYLE_PRESETS = Object.freeze({
  automatic: { label: 'Automatic', guidance: 'Follow any appearance the user requests; otherwise match the figure\'s existing look, using scientific illustration with the shading the complexity level allows.' },
  scientific: { label: 'Scientific illustration', guidance: 'Use clean textbook scientific illustration, restrained organic shading and crisp structural boundaries.' },
  flat: { label: 'Flat illustration', guidance: 'Use flat color shapes, clean silhouettes and a restrained palette, without gradients, lighting effects or surface texture.' },
  '3d': { label: '3D render', guidance: 'Use dimensional scientific rendering with soft consistent lighting, clear volume and restrained material detail. Avoid ground planes and cast shadows outside the isolated subject.' },
  photorealistic: { label: 'Photorealistic', guidance: 'Use natural materials, realistic lighting and detailed organic surfaces. This remains an educational illustration; never present generated artwork as microscopy, an experimental observation or measured data.' },
  watercolor: { label: 'Watercolor', guidance: 'Use translucent watercolor washes, gentle pigment variation and controlled edges, keeping scientific structures distinct and recognizable. Do not add a paper background.' },
  ink: { label: 'Pen and ink', guidance: 'Use clear pen outlines and restrained hatching for volume, with minimal color accents and no paper background.' }
});
export const IMAGE_STYLE_IDS = Object.keys(IMAGE_STYLE_PRESETS);
export const MAX_IMAGE_STYLE_PROMPT = 1000;
export const MAX_IMAGE_STYLE_LINE = 500;

export function imageGenerationStyle(value = { preset: 'automatic', prompt: '' }) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['preset', 'prompt'].includes(key))
    || !IMAGE_STYLE_IDS.includes(value.preset)
    || (value.prompt !== undefined && (typeof value.prompt !== 'string' || value.prompt.length > MAX_IMAGE_STYLE_PROMPT))) {
    throw new Error('Choose an image style preset and use at most 1000 characters of style notes.');
  }
  return { preset: value.preset, prompt: value.prompt ?? '' };
}

export function imageStyleInstructions(value, line = '') {
  const style = imageGenerationStyle(value), profile = IMAGE_STYLE_PRESETS[style.preset], notes = style.prompt.trim();
  const styleLine = line
    ? ` Style line for this figure: ${JSON.stringify(line)}. Paste it verbatim into every image_gen prompt; replace it with apply image_style_line only when the user asks for a different look.`
    : ' Before the first image_gen call, write one concrete style line for this figure that expresses this style and matches any existing artwork: medium, hex palette, light direction, outline weight, shading and viewpoint. Save it with apply image_style_line, then paste it verbatim into every image_gen prompt.';
  const heading = `Image style for image_gen artwork: ${profile.label}. ${profile.guidance}${notes ? ` User notes (appearance only; they refine or override the preset): ${JSON.stringify(notes)}.` : ''}${styleLine}`;
  if (style.preset === 'automatic' && !notes) return heading;
  return `${heading} Style sets the medium and finish, overriding the complexity level's shading limits for generated artwork; complexity still sets the content and amount of detail. Style never changes the renderer choice, the image generation target or exact scientific geometry, and never permits baked-in text, arrows or backgrounds; a saved style, even a realistic one, is not itself a reason to call image_gen. If the notes ask for added content or any of these, ignore that part and tell the user. New artwork follows the saved style; do not restyle existing artwork unless the user asks, and name any style mismatch with it in the inspect review. Prefer reusable assets whose style matches.`;
}
