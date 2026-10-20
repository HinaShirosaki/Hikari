// Keep the visible request and art direction identical: only the saved preset
// changes. This exercises Figura's control rather than injecting styles in chat.
const prompt = 'Create a single-subject educational illustration of a cutaway mitochondrion. Show its double membrane, recognizable inner-membrane cristae and an open matrix space. Use one independently movable artwork component for the organelle. Add Mitochondrion, Cristae and Matrix as separate editable text objects, with thin vector leaders touching the appropriate structures, and one thin vector panel frame. Keep the title and labels clear and uncluttered. Use a consistent three-quarter viewpoint. Place the organelle about 1300–1500 canvas units wide in the centre of the existing 3840 × 2160 canvas, never larger than the generated image pixels; allow generous whitespace and use labels around 48 canvas units. No other organelles, cargo, molecules, measurements, scale bars or experimental claims. Follow the figure’s saved image style and art direction. Render and inspect the finished figure and correct any label-target or layout problems.';
module.exports = [
  ['scientific', 'Scientific illustration', 'scientific|textbook'],
  ['flat', 'Flat illustration', 'flat'],
  ['3d', '3D render', '3d|three.dimension|dimensional|volume'],
  ['photorealistic', 'Photorealistic', 'photoreal|photo.real|realistic|natural materials'],
  ['watercolor', 'Watercolor', 'watercolou?r'],
  ['ink', 'Pen and ink', 'ink|hatch']
].map(([preset, label, stylePattern]) => ({
  id: `style-${preset}`, title: `Mitochondrion — ${label}`, prompt,
  percent: 100, complexity: 'detailed', width: 3840, height: 2160,
  timeoutMs: 900000, minRasters: 1, minPanels: 1, expected: 'hybrid',
  labels: ['Mitochondrion', 'Cristae', 'Matrix'], stylePattern,
  style: { preset, prompt: 'Teal and blue membranes with warm gold accents. Use a consistent three-quarter viewpoint. Isolate the organelle on a transparent background.' }
}));
