import { DEFAULT_LADDER_PRESET_ID } from '../constants.js';
import { normalizeEnhancementSettings } from '../analysis/image-processing.js';
import { normalizeManualOverrides } from '../shared.js';
import { inferBlotPlacement } from './model.js';

// Keep the complete saved library in navigation without decoding every image
// or counting unopened records against the figure's layer limit.
export function createSavedGelNavigation({ getRecords, getRows, restoreImage, createId }) {
  function entries() {
    const used = new Set(getRows().map(row => row.draft.controls['gel-id']).filter(Boolean));
    const seen = new Set();
    return getRecords().filter(record => {
      if (!record?.id || used.has(record.id) || seen.has(record.id)) return false;
      seen.add(record.id); return true;
    }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0))
      .map(record => ({ id: `saved:${record.id}`, label: record.name || record.imageName || 'Untitled gel', record }));
  }
  async function load(id) {
    const entry = entries().find(row => row.id === id);
    if (!entry) return null;
    const { record } = entry;
    const restored = await restoreImage(record);
    if (!restored.image) {
      const error = new Error(`Could not restore "${entry.label}". ${restored.error?.message || 'Its saved image is unavailable.'}`);
      error.code = 'GEL_IMAGE_UNAVAILABLE'; throw error;
    }
    const parameters = record.parameters || {};
    const enhancement = normalizeEnhancementSettings(parameters.enhancement || {});
    const draft = {
      token: createId(), currentImage: restored.image, originalImage: restored.image, originalFile: null,
      controls: {
        'gel-id': record.id, 'gel-name': entry.label,
        'gel-type': ['western', 'agarose'].includes(record.analysisType) ? record.analysisType : 'sds-page',
        'gel-ladder-preset': parameters.ladderPreset || DEFAULT_LADDER_PRESET_ID,
        'gel-denoise-strength': String(enhancement.denoiseStrength),
        'gel-contrast-strength': String(enhancement.contrastBoost), 'gel-expected-lane-count': ''
      },
      manualOverrides: normalizeManualOverrides(record.manualOverrides || parameters.manualOverrides),
      currentReport: record.report || null, cropApplied: false, viewerMode: 'original',
      pendingNotebookLink: { notebookEntryId: record.notebookEntryId || '', projectId: record.projectId || '' }
    };
    return { id: entry.id, label: entry.label, draft, placement: inferBlotPlacement(draft) };
  }
  return { entries, load };
}
