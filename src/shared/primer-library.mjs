// Shared by the renderer cache and the workspace's durable primer library.
const text = (value, limit = 160) => String(value ?? '').replace(/[\t\r\n]+/g, ' ').trim().slice(0, limit);

export function normalizePrimerLibraryEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  const sequence = String(value.primerSequence || value.sequence || '').replace(/\s/g, '').toUpperCase().replace(/U/g, 'T');
  if (!id || !name || !sequence || !/^[ACGTRYSWKMBDHVN]+$/.test(sequence)) return null;
  return {
    id, name, sequence,
    sourceName: text(value.sourceName, 240),
    createdAt: text(value.createdAt, 80),
    updatedAt: text(value.updatedAt || value.createdAt, 80)
  };
}

export function normalizePrimerLibrary(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map(normalizePrimerLibraryEntry).filter(entry => {
    if (!entry || seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

export function addPrimersToLibrary(existing, primers, { sourceName = '', createId, nowIso = new Date().toISOString() } = {}) {
  const entries = normalizePrimerLibrary(existing);
  const ids = new Set(entries.map(entry => entry.id));
  const savedIds = [];
  let added = 0;
  let invalid = 0;
  for (const [index, primer] of (Array.isArray(primers) ? primers : []).entries()) {
    let id = text(typeof createId === 'function' ? createId() : '');
    if (!id || ids.has(id)) {
      do { id = `primer_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`}`; } while (ids.has(id));
    }
    const entry = normalizePrimerLibraryEntry({
      ...primer, id, name: text(primer?.name) || `Primer ${index + 1}`,
      sourceName: primer?.sourceName || sourceName, createdAt: nowIso, updatedAt: nowIso
    });
    if (!entry) { invalid += 1; continue; }
    const duplicate = entries.find(row => row.name === entry.name && row.sequence === entry.sequence);
    if (duplicate) { savedIds.push(duplicate.id); continue; }
    entries.push(entry);
    ids.add(id);
    savedIds.push(id);
    added += 1;
  }
  return { entries, added, invalid, savedIds: [...new Set(savedIds)] };
}
