// Only tool-published raster data URLs are renderable; never fetch arbitrary URLs or local paths.
const MAX_DATA_URL_LENGTH = Math.ceil(5 * 1024 * 1024 / 3) * 4 + 40;

export function normalizeAgentImageArtifact(source) {
  if (!source || source.type !== 'image' || typeof source.data_url !== 'string'
    || source.data_url.length > MAX_DATA_URL_LENGTH
    || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(source.data_url)
    || !source.id || !source.alt) return null;
  return {
    type: 'image', id: String(source.id).slice(0, 100),
    title: String(source.title || '').slice(0, 220), alt: String(source.alt).slice(0, 2000),
    caption: String(source.caption || '').slice(0, 2000), data_url: source.data_url,
    mime_type: source.data_url.slice(5, source.data_url.indexOf(';'))
  };
}

export function mergeAgentImageArtifacts(existing = [], incoming = []) {
  const images = new Map();
  for (const value of [...existing, ...incoming]) {
    const image = normalizeAgentImageArtifact(value);
    if (image) images.set(image.id, image);
  }
  return [...images.values()];
}

export function renderAgentImages(meta, safeText) {
  const images = mergeAgentImageArtifacts([], Array.isArray(meta?.image_artifacts) ? meta.image_artifacts : []);
  if (!images.length) return '';
  return `<div class="agent-output-images">${images.map(image => `
    <figure class="agent-output-image">
      ${image.title ? `<div class="agent-output-image-title">${safeText(image.title)}</div>` : ''}
      <img src="${safeText(image.data_url)}" alt="${safeText(image.alt)}" decoding="async" />
      ${image.caption ? `<figcaption>${safeText(image.caption)}</figcaption>` : ''}
    </figure>`).join('')}</div>`;
}
