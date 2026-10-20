// Only persisted scenes pass through this compatibility adapter. New edits
// still validate against the single-canvas model and cannot add scratch data.
export function migrateStoredDocument(raw) {
  if (raw?.version !== 1 || !raw.canvases?.scratch) return raw;
  return { ...raw,
    canvases: { main: raw.canvases.main },
    objects: Array.isArray(raw.objects) ? raw.objects.map(object => object.canvas === 'scratch' ? { ...object, canvas: 'main' } : object) : raw.objects,
    groups: Array.isArray(raw.groups) ? raw.groups.map(group => group.canvas === 'scratch' ? { ...group, canvas: 'main' } : group) : raw.groups
  };
}
