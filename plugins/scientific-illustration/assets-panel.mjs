import { createPresentation } from "./i18n.mjs";
const i18nUi = createPresentation("figura");
import { icon } from './icons.mjs';
import { oneOffImageStyle } from './image-style.mjs';

export function initAssetsPanel({ workspace, getSelection, getCanvas, getIllustrationId, selectCopies, showAssets, sendToChat, status }) {
  const $ = id => document.getElementById(id), cache = new Map();
  let library, saveSelection, inspectedId;
  // Details live in a docked pane so they never cover the canvas or neighbouring tiles.
  function inspect(entry, row) {
    const changed = entry.id !== inspectedId, preview = row.querySelector('.asset-preview').src;
    inspectedId = entry.id;
    $('saved-assets').querySelector('.is-inspected')?.classList.remove('is-inspected');
    row.classList.add('is-inspected');
    if (preview || changed) $('asset-dock-preview').src = preview;
    i18nUi.setText($('asset-dock').querySelector('.asset-name'), entry.name);
    $('asset-dock').querySelector('.asset-summary').textContent = entry.description || '';
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target, id = image.dataset.assetPreview;
      observer.unobserve(image);
      if (!cache.has(id)) cache.set(id, workspace.request({ action: 'asset_render', asset_id: id }).then(result => {
        if (!result.ok) throw new Error(result.error);
        return result.previews[0].data_url;
      }).catch(error => { cache.delete(id); throw error; }));
      void cache.get(id).then(url => {
        if (!image.isConnected) return;
        image.src = url; if (id === inspectedId) $('asset-dock-preview').src = url;
      }).catch(() => { image.hidden = true; });
    }
  }, { root: $('saved-assets') });
  async function insert(entry, button) {
    const illustrationId = getIllustrationId(), canvas = getCanvas(); button.disabled = true;
    try {
      const current = workspace.getDocument(), dimensions = current.canvases[canvas];
      // Keep native size unless the component would crowd the destination.
      const scale = Math.min(1, dimensions.width * .7 / entry.width, dimensions.height * .7 / entry.height);
      const result = await workspace.request({ action: 'apply', illustration_id: illustrationId, expected_revision: current.revision, request_id: crypto.randomUUID(),
        operations: [{ op: 'insert_asset', asset_id: entry.id, canvas, width: entry.width * scale }] });
      if (!result.ok) throw new Error(result.error);
      selectCopies(result.inserted_assets[0].ids); status(i18nUi.text("Inserted {p0}", { p0: entry.name }));
    } catch (error) { status(error.message); }
    finally { button.disabled = false; }
  }
  function render(next = library) {
    if (!next) return;
    library = next; observer.disconnect();
    const focused = document.activeElement?.closest('[data-saved-asset]');
    const focusedId = focused?.dataset.savedAsset, action = document.activeElement?.dataset.assetAction;
    const query = $('asset-search').value.trim().toLowerCase();
    const entries = library.reusable_assets.filter(asset => `${asset.name}\n${asset.description || ''}`.toLowerCase().includes(query));
    $('saved-assets').replaceChildren();
    for (const id of cache.keys()) if (!library.reusable_assets.some(asset => asset.id === id)) cache.delete(id);
    for (const entry of entries) {
      const row = document.createElement('div'); row.className = 'saved-asset'; row.dataset.savedAsset = entry.id; row.setAttribute('role', 'listitem');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'asset-insert'; button.dataset.assetAction = 'insert';
      i18nUi.setAttribute(button, "aria-label", i18nUi.message("Insert {p0}", { p0: entry.name }));
      button.setAttribute('aria-describedby', 'asset-dock-text');
      const image = document.createElement('img'); image.className = 'asset-preview'; image.alt = entry.name; image.dataset.assetPreview = entry.id;
      button.append(image); button.addEventListener('click', () => void insert(entry, button));
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'icon-button asset-edit'; edit.dataset.assetAction = 'edit';
      const editLabel = { i18nKey: 'figura.assets.editDetails', i18nParams: { name: entry.name } };
      i18nUi.setAttribute(edit, 'title', editLabel); i18nUi.setAttribute(edit, 'aria-label', editLabel); edit.append(icon('info'));
      edit.addEventListener('click', () => openSave({ asset_id: entry.id, expected_assets_revision: library.assets_revision }, entry.name, entry.description));
      row.append(button, edit);
      row.addEventListener('pointerenter', () => inspect(entry, row));
      row.addEventListener('focusin', () => inspect(entry, row));
      $('saved-assets').append(row); observer.observe(image);
    }
    const inspected = entries.find(entry => entry.id === inspectedId) || entries[0];
    $('asset-dock').hidden = !inspected;
    if (inspected) inspect(inspected, $('saved-assets').querySelector(`[data-saved-asset="${inspected.id}"]`));
    // The hint only explains how to fill an empty library.
    $('assets-hint').hidden = library.reusable_assets.length > 0;
    i18nUi.setText($('assets-hint'), i18nUi.message("Import artwork, or right-click components and choose Save as an asset."));
    $('assets-empty').hidden = entries.length > 0;
    i18nUi.setText($('assets-empty'), (library.reusable_assets.length ? i18nUi.message("No assets match your search.") : i18nUi.message("Your reusable components will appear here.")));
    if (focusedId && action) ($('saved-assets').querySelector(`[data-saved-asset="${focusedId}"] [data-asset-action="${action}"]`) || $('asset-search')).focus({ preventScroll: true });
  }
  $('asset-search').addEventListener('input', () => render());
  function openSave(intent, name, description = '') {
    saveSelection = intent;
    i18nUi.setText($('save-asset-title'), intent.asset_id ? { i18nKey: 'figura.assets.details', i18nParams: {} } : i18nUi.message('Save reusable component'));
    $('asset-name').value = name; $('asset-description').value = description;
    i18nUi.setText($('asset-save-error'), '');
    $('remove-asset').hidden = !intent.asset_id;
    if (intent.asset_id) { i18nUi.setAttribute($('remove-asset'), "title", i18nUi.message("Remove {p0} from Assets", { p0: name })); $('remove-asset').setAttribute('aria-label', $('remove-asset').title); }
    $('save-asset-dialog').showModal(); $('asset-name').focus(); $('asset-name').select();
  }
  function save() {
    const selection = getSelection(); if (!selection?.ids.length) return;
    openSave({ ids: [...selection.ids], illustration_id: getIllustrationId(), expected_revision: workspace.getDocument().revision }, selection.name);
  }
  $('cancel-save-asset').addEventListener('click', () => $('save-asset-dialog').close());
  $('remove-asset').addEventListener('click', async () => {
    const button = $('remove-asset'); button.disabled = true;
    try {
      const result = await workspace.manageAsset('asset_delete', { asset_id: saveSelection.asset_id });
      if (!result.ok) throw new Error(result.error);
      $('save-asset-dialog').close(); $('asset-search').focus();
    } catch (error) { i18nUi.setOwnedText($('asset-save-error'), error.message); }
    finally { button.disabled = false; }
  });
  $('save-asset-dialog').addEventListener('close', () => { saveSelection = null; });
  $('save-asset-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!saveSelection || $('confirm-save-asset').disabled) return;
    const button = $('confirm-save-asset'); button.disabled = true;
    try {
      const details = { name: $('asset-name').value, description: $('asset-description').value };
      const updating = Boolean(saveSelection.asset_id);
      const result = updating
        ? await workspace.request({ action: 'asset_update', ...saveSelection, ...details, request_id: crypto.randomUUID() })
        : await workspace.manageAsset('asset_save', { ...saveSelection, ...details });
      if (!result.ok) throw new Error(result.error);
      $('save-asset-dialog').close(); showAssets();
      status(updating ? i18nUi.value({ i18nKey: 'figura.assets.detailsSaved', i18nParams: {} }) : i18nUi.text("Asset saved for future illustrations"));
    } catch (error) { i18nUi.setOwnedText($('asset-save-error'), error.message); }
    finally { button.disabled = false; }
  });
  const savedStyle = () => workspace.getDocument().imageGenerationStyle.preset;
  $('generate-asset').addEventListener('click', () => {
    $('generate-asset-error').textContent = ''; $('generate-asset-style').value = savedStyle();
    $('generate-asset-dialog').showModal(); $('generate-asset-description').focus();
  });
  $('cancel-generate-asset').addEventListener('click', () => $('generate-asset-dialog').close());
  $('generate-asset-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('confirm-generate-asset'); button.disabled = true;
    try {
      const description = $('generate-asset-description').value.trim().replace(/[.\s]+$/, '');
      if (!description) throw new Error('Describe the component to generate.');
      await sendToChat(`Generate a reusable asset: ${description}.${oneOffImageStyle($('generate-asset-style').value, savedStyle())}`);
      $('generate-asset-dialog').close(); $('generate-asset-description').value = '';
      status('Codex is generating the asset. It appears in Assets once saved.');
    } catch (error) { $('generate-asset-error').textContent = error.message; }
    finally { button.disabled = false; }
  });
  return { render, save, closeSave: () => $('save-asset-dialog').close() };
}
