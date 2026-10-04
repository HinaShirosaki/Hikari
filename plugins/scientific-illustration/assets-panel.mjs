import { icon } from './icons.mjs';

export function initAssetsPanel({ workspace, getSelection, getCanvas, getIllustrationId, selectCopies, showAssets, status }) {
  const $ = id => document.getElementById(id), cache = new Map();
  let library, saveSelection;
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target, id = image.dataset.assetPreview;
      observer.unobserve(image);
      if (!cache.has(id)) cache.set(id, workspace.request({ action: 'asset_render', asset_id: id }).then(result => {
        if (!result.ok) throw new Error(result.error);
        return result.previews[0].data_url;
      }).catch(error => { cache.delete(id); throw error; }));
      void cache.get(id).then(url => { if (image.isConnected) image.src = url; }).catch(() => { image.hidden = true; });
    }
  }, { root: $('saved-assets') });
  function show() { showAssets(); }
  async function insert(entry, button) {
    const illustrationId = getIllustrationId(), canvas = getCanvas(); button.disabled = true;
    try {
      const current = await workspace.request({ action: 'read', illustration_id: illustrationId });
      if (!current.ok) throw new Error(current.error);
      const dimensions = current.canvases[canvas];
      // Keep native size unless the component would crowd the destination.
      const scale = Math.min(1, dimensions.width * .7 / entry.width, dimensions.height * .7 / entry.height);
      const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(),
        operations: [{ op: 'insert_asset', asset_id: entry.id, canvas, width: entry.width * scale }] });
      if (!result.ok) throw new Error(result.error);
      selectCopies(result.inserted_assets[0].ids); status(`Inserted ${entry.name}`);
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  }
  function render(next = library) {
    if (!next) return;
    library = next; observer.disconnect();
    const focused = document.activeElement?.closest('[data-saved-asset]');
    const focusedId = focused?.dataset.savedAsset, action = document.activeElement?.dataset.assetAction;
    const query = $('asset-search').value.trim().toLowerCase();
    const entries = library.reusable_assets.filter(asset => asset.name.toLowerCase().includes(query));
    $('saved-assets').replaceChildren();
    for (const id of cache.keys()) if (!library.reusable_assets.some(asset => asset.id === id)) cache.delete(id);
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'saved-asset'; row.dataset.savedAsset = entry.id; row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'asset-insert'; button.dataset.assetAction = 'insert';
      button.setAttribute('aria-label', `Insert ${entry.name}`); button.title = `Insert an editable copy of ${entry.name}`;
      const image = document.createElement('img'); image.className = 'asset-preview'; image.alt = ''; image.dataset.assetPreview = entry.id;
      const text = document.createElement('span'); text.className = 'asset-description';
      const name = document.createElement('span'); name.className = 'layer-name'; name.textContent = entry.name;
      const detail = document.createElement('small'); detail.textContent = `${entry.objectCount} ${entry.objectCount === 1 ? 'layer' : 'layers'} · ${Math.round(entry.width)} × ${Math.round(entry.height)}`;
      text.append(name, detail); button.append(image, text); button.addEventListener('click', () => void insert(entry, button));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-button asset-remove danger-button'; remove.dataset.assetAction = 'remove';
      remove.title = `Remove ${entry.name} from Assets`; remove.setAttribute('aria-label', remove.title); remove.append(icon('trash'));
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        const result = await workspace.manageAsset('asset_delete', { asset_id: entry.id });
        if (!result.ok) { status(result.error); remove.disabled = false; }
      });
      row.append(button, remove); $('saved-assets').append(row); observer.observe(image);
    }
    $('assets-hint').textContent = library.reusable_assets.length
      ? `Click to insert on ${getCanvas() === 'main' ? 'Main' : 'Scratch'}. Copies stay editable.` : 'Select components or a group, then choose Save as asset.';
    $('assets-empty').hidden = entries.length > 0;
    $('assets-empty').textContent = library.reusable_assets.length ? 'No assets match your search.' : 'Your reusable components will appear here.';
    if (focusedId && action) ($('saved-assets').querySelector(`[data-saved-asset="${focusedId}"] [data-asset-action="${action}"]`) || $('asset-search')).focus({ preventScroll: true });
  }
  $('asset-search').addEventListener('input', () => render());
  function save() {
    const selection = getSelection(); if (!selection?.ids.length) return;
    saveSelection = { ids: [...selection.ids], illustration_id: getIllustrationId(), expected_revision: workspace.getDocument().revision };
    $('asset-name').value = selection.name; $('asset-save-error').textContent = '';
    $('save-asset-dialog').showModal(); $('asset-name').focus(); $('asset-name').select();
  }
  for (const id of ['save-selection-asset', 'menu-save-selection-asset']) $(id).addEventListener('click', save);
  $('cancel-save-asset').addEventListener('click', () => $('save-asset-dialog').close());
  $('save-asset-dialog').addEventListener('close', () => { saveSelection = null; });
  $('save-asset-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!saveSelection) return;
    const button = $('confirm-save-asset'); button.disabled = true;
    try {
      const result = await workspace.manageAsset('asset_save', { ...saveSelection, name: $('asset-name').value });
      if (!result.ok) throw new Error(result.error);
      $('save-asset-dialog').close(); show(); status('Asset saved for future illustrations');
    } catch (error) { $('asset-save-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  return { render, closeSave: () => $('save-asset-dialog').close() };
}
