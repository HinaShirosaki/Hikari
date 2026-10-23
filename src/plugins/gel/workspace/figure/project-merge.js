const imageKeys = new WeakMap();
async function imageKey(image) {
  if (!imageKeys.has(image)) imageKeys.set(image, (async () => {
    const hash = await crypto.subtle.digest('SHA-256', image.imageData.data);
    return `${image.width}:${image.height}:` + [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
  })());
  return imageKeys.get(image);
}

// Portable files may come from another storage folder. A record reference is
// reconnected only after its actual image agrees, never by a name alone.
export async function reconnectProjectRecords(project, records, restoreImage) {
  const restored = new Map();
  async function key(record) {
    if (!restored.has(record.id)) restored.set(record.id, (async () => {
      try { const result = await restoreImage(record); return result.image ? imageKey(result.image) : ''; }
      catch { return ''; }
    })());
    return restored.get(record.id);
  }
  for (const row of project.rows) {
    const target = await imageKey(row.draft.originalImage);
    const reference = records.find(record => record.id === row.recordId);
    if (reference && await key(reference) === target) { row.draft.controls['gel-id'] = reference.id; continue; }
    const matches = [];
    for (const record of records) if (await key(record) === target) matches.push(record);
    const named = matches.filter(record => record.name === row.label || record.name === row.draft.controls['gel-name']);
    const match = named.length === 1 ? named[0] : matches.length === 1 ? matches[0] : null;
    row.draft.controls['gel-id'] = match?.id || '';
  }
}

export function mergeBlotProject(project, rows, stacks, limit) {
  const ids = new Map();
  const addedRows = [];
  const replacements = [];
  for (const row of project.rows) {
    // A second opening keeps the version already being edited on the board.
    const existing = rows.find(item => item.id === row.id)
      || rows.find(item => row.draft.controls['gel-id'] && item.draft.controls['gel-id'] === row.draft.controls['gel-id']);
    ids.set(row.id, existing?.id || row.id);
    if (!existing) addedRows.push(row);
    else if (existing.libraryBaseline && !existing.navigationMoved
      && JSON.stringify({ id: existing.id, label: existing.label, placement: existing.placement, token: existing.draft.token }) === existing.libraryBaseline) {
      replacements.push({ existing, row: { ...row, id: existing.id } });
    }
  }
  if (rows.length + addedRows.length > limit) throw new Error(`The project exceeds ${limit} gel layers.`);
  const addedStacks = [];
  for (const stack of project.stacks) {
    const members = stack.layerIds.map(id => ids.get(id));
    const existing = stacks.find(item => item.id === stack.id)
      || stacks.find(item => item.name === stack.name && item.layoutName === stack.layoutName
        && JSON.stringify(item.layerIds) === JSON.stringify(members));
    if (existing) { stack.mergedId = existing.id; continue; }
    const assigned = new Set([...stacks, ...addedStacks].flatMap(item => item.layerIds));
    addedStacks.push({ ...stack, layerIds: members.filter(id => !assigned.has(id)) });
    stack.mergedId = stack.id;
  }
  return { rows: addedRows, stacks: addedStacks, replacements, firstId: ids.get(project.rows[0]?.id) || '',
    activeStackId: project.stacks.find(stack => stack.id === project.activeStackId)?.mergedId || '' };
}
