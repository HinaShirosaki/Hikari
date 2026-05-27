export function renderLocationFields(ctx) {
  const { sampleLocationFields, sampleStorageTypeInput } = ctx.dom;
  const type = sampleStorageTypeInput?.value || 'freezer';

  if (type === 'freezer') {
    sampleLocationFields.innerHTML = `
      <label>
        Freezer
        <input id="sample-loc-freezer" placeholder="e.g. -80 Freezer #1" />
      </label>
      <label>
        Rack
        <input id="sample-loc-rack" placeholder="e.g. Rack 3" />
      </label>
      <label>
        Box
        <input id="sample-loc-box" placeholder="e.g. Box B2" />
      </label>
      <label>
        Position
        <input id="sample-loc-position" placeholder="e.g. A7" />
      </label>
    `;
    return;
  }

  if (type === 'fridge') {
    sampleLocationFields.innerHTML = `
      <label>
        Fridge
        <input id="sample-loc-fridge" placeholder="e.g. 4C Fridge A" />
      </label>
      <label>
        Shelf
        <input id="sample-loc-shelf" placeholder="e.g. Shelf 2" />
      </label>
    `;
    return;
  }

  if (type === 'desiccator') {
    sampleLocationFields.innerHTML = `
      <label>
        Desiccator
        <input id="sample-loc-desiccator" placeholder="e.g. Desiccator 1" />
      </label>
      <label>
        Position
        <input id="sample-loc-desiccator-position" placeholder="e.g. Tray B" />
      </label>
    `;
    return;
  }

  sampleLocationFields.innerHTML = `
    <label>
      RT Cabinet
      <input id="sample-loc-cabinet" placeholder="e.g. RT Cabinet 2" />
    </label>
    <label>
      Shelf / Drawer
      <input id="sample-loc-cabinet-slot" placeholder="e.g. Drawer 4" />
    </label>
  `;
}

export function readLocation(ctx) {
  const type = ctx.dom.sampleStorageTypeInput?.value || 'freezer';
  if (type === 'freezer') {
    return {
      storageType: type,
      freezer: document.getElementById('sample-loc-freezer')?.value.trim() || '',
      rack: document.getElementById('sample-loc-rack')?.value.trim() || '',
      box: document.getElementById('sample-loc-box')?.value.trim() || '',
      position: document.getElementById('sample-loc-position')?.value.trim() || ''
    };
  }
  if (type === 'fridge') {
    return {
      storageType: type,
      fridge: document.getElementById('sample-loc-fridge')?.value.trim() || '',
      shelf: document.getElementById('sample-loc-shelf')?.value.trim() || ''
    };
  }
  if (type === 'desiccator') {
    return {
      storageType: type,
      desiccator: document.getElementById('sample-loc-desiccator')?.value.trim() || '',
      position: document.getElementById('sample-loc-desiccator-position')?.value.trim() || ''
    };
  }
  return {
    storageType: type,
    cabinet: document.getElementById('sample-loc-cabinet')?.value.trim() || '',
    slot: document.getElementById('sample-loc-cabinet-slot')?.value.trim() || ''
  };
}

export function fillLocation(ctx, location) {
  const { sampleStorageTypeInput } = ctx.dom;
  sampleStorageTypeInput.value = location?.storageType || 'freezer';
  renderLocationFields(ctx);

  const type = sampleStorageTypeInput.value;
  if (type === 'freezer') {
    document.getElementById('sample-loc-freezer').value = location?.freezer || '';
    document.getElementById('sample-loc-rack').value = location?.rack || '';
    document.getElementById('sample-loc-box').value = location?.box || '';
    document.getElementById('sample-loc-position').value = location?.position || '';
    return;
  }
  if (type === 'fridge') {
    document.getElementById('sample-loc-fridge').value = location?.fridge || '';
    document.getElementById('sample-loc-shelf').value = location?.shelf || '';
    return;
  }
  if (type === 'desiccator') {
    document.getElementById('sample-loc-desiccator').value = location?.desiccator || '';
    document.getElementById('sample-loc-desiccator-position').value = location?.position || '';
    return;
  }
  document.getElementById('sample-loc-cabinet').value = location?.cabinet || '';
  document.getElementById('sample-loc-cabinet-slot').value = location?.slot || '';
}

export function formatLocation(location) {
  if (!location || typeof location !== 'object') {
    return '-';
  }
  if (location.storageType === 'freezer') {
    return [location.freezer, location.rack, location.box, location.position].filter(Boolean).join(' -> ') || '-';
  }
  if (location.storageType === 'fridge') {
    return [location.fridge, location.shelf].filter(Boolean).join(' -> ') || '-';
  }
  if (location.storageType === 'desiccator') {
    return [location.desiccator, location.position].filter(Boolean).join(' -> ') || '-';
  }
  return [location.cabinet, location.slot].filter(Boolean).join(' -> ') || '-';
}

export function isEmptyLocation(location) {
  if (!location || typeof location !== 'object') {
    return true;
  }
  return Object.entries(location)
    .filter(([key]) => key !== 'storageType')
    .every(([, value]) => !String(value || '').trim());
}
