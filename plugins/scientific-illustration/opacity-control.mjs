// Preview outside the document model; persist one edit when an adjustment ends.
export function createOpacityControl({ document, getContext, preview, save, status }) {
  const range = document.getElementById('opacity-range'), number = document.getElementById('opacity-number');
  let session = null, pending = null, writing = null, previous = '', generation = 0, sequence = 0, ignoreChange = false;
  let queue = Promise.resolve();
  const targetMatches = (a, b) => Boolean(a && b && a.illustrationId === b.illustrationId && a.id === b.object?.id);
  const context = () => { const current = getContext(); return current.object ? current : null; };
  const percent = value => Math.round(value * 1000) / 10;
  function display(value) {
    const text = String(percent(value));
    range.value = number.value = text;
    range.style.setProperty('--opacity-progress', `${text}%`);
    range.setAttribute('aria-valuetext', `${text}%`);
  }
  function sync() {
    const current = context(), key = current ? JSON.stringify([current.illustrationId, current.object.id, current.revision]) : '';
    if (previous !== key) {
      const ownSave = targetMatches(writing, current) && current?.object.opacity === writing.value;
      if (!ownSave) {
        generation++; ignoreChange ||= Boolean(session); session = pending = null;
      }
      previous = key;
    }
    range.disabled = number.disabled = !current;
    if (!current) return;
    const adjustment = session || pending;
    display(adjustment?.value ?? current.object.opacity);
    // A completed earlier save may redraw while a later adjustment is pending.
    if (adjustment) preview(current, adjustment.value);
  }
  function input(event) {
    if (ignoreChange || !event.target.validity.valid || event.target.value === '') return;
    const current = context(); if (!current) return;
    session ||= { illustrationId: current.illustrationId, id: current.object.id };
    if (!targetMatches(session, current)) return;
    session.value = Number(event.target.value) / 100;
    display(session.value); preview(current, session.value);
  }
  function restore() {
    session = null; sync();
    const current = context(); if (current) preview(current, pending?.value ?? current.object.opacity);
  }
  function change(event) {
    if (ignoreChange) { ignoreChange = false; restore(); return; }
    if (!event.target.validity.valid || event.target.value === '') { restore(); return; }
    const current = context(); if (!current) return;
    const intent = { illustrationId: current.illustrationId, id: current.object.id, value: Number(event.target.value) / 100,
      generation, sequence: ++sequence };
    session = null; pending = intent;
    queue = queue.then(async () => {
      const latest = context();
      if (intent.generation !== generation || !targetMatches(intent, latest)) return;
      if (latest.object.opacity === intent.value) return;
      writing = intent;
      try {
        const result = await save({ ...intent, revision: latest.revision });
        if (!result?.ok) throw new Error(result?.error || 'Could not save opacity.');
      } finally { writing = null; }
    }).catch(error => {
      status(error.message);
      if (intent.generation === generation) { generation++; session = pending = null; }
    }).finally(() => {
      if (pending === intent) pending = null;
      sync();
      const latest = context(); if (latest && !session && !pending) preview(latest, latest.object.opacity);
    });
  }
  for (const control of [range, number]) {
    control.addEventListener('pointerdown', () => { ignoreChange = false; });
    control.addEventListener('focus', () => { ignoreChange = false; });
    control.addEventListener('input', input);
    control.addEventListener('change', change);
    control.addEventListener('pointercancel', () => { ignoreChange = true; restore(); });
    control.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); ignoreChange = true; restore(); }
      else {
        ignoreChange = false;
        if (event.key === 'Enter') { event.preventDefault(); change(event); }
      }
    });
  }
  return { sync };
}
