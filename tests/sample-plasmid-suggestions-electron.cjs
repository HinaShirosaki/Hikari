// Run with node; exercises the real sample editors and combobox in isolated Electron.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-plasmid-suggestions-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {
      encoding: 'utf8', timeout: 60000
    });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw result.error || new Error(`Electron check failed: ${result.status}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp, 'profile'));
  app.whenReady().then(async () => {
    const url = (file) => pathToFileURL(path.join(root, file)).href;
    const fixture = path.join(temp, 'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}">
      <style>body{display:block;padding:2rem}main{max-width:32rem;margin:auto}</style>
      </head><body><main><h2>Samples</h2><div id="inventory-sections"></div></main></body></html>`);
    const win = new BrowserWindow({ width: 720, height: 940, show: false,
      webPreferences: { contextIsolation: true, sandbox: false } });
    await win.loadFile(fixture);
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const { bindPlasmidNameSuggestions, matchPlasmidNames } = await import(${JSON.stringify(url('src/renderer/modules/personal-inventory/name-suggestions.js'))});
        const { createSingleContainerEditorRenderer } = await import(${JSON.stringify(url('src/renderer/modules/personal-inventory/detail-single-editor.js'))});
        const { createWellEditorRenderer } = await import(${JSON.stringify(url('src/renderer/modules/personal-inventory/detail-well-editor.js'))});
        const { bindSingleSampleEvents } = await import(${JSON.stringify(url('src/renderer/modules/personal-inventory/single-sample-events.js'))});
        const assert = (value, message) => { if (!value) throw new Error(message); };
        const wait = (ms = 45) => new Promise(resolve => setTimeout(resolve, ms));
        const host = document.getElementById('inventory-sections');
        const safeText = text => String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        const state = { settings: { storagePath: '/fixture-library' }, projects: [], samples: [] };
        const entries = ['pET28a', 'pETDuet-1', 'pUC19', 'pET28a', 'XpET<img onerror=alert(1)>'].map(name => ({name}));
        const requests = [];
        let handler = async () => ({ok: true, entries});
        const getBridge = () => ({ sequenceLibraryList: payload => { requests.push(payload); return handler(payload); } });
        bindPlasmidNameSuggestions(host, state, {getBridge, delay: 15});
        const uiState = { editingSampleId: '', selectedContainer: {section:'-20 Degree', containerId:'tube-1'} };
        const container = {id:'tube-1', name:'Plasmid stocks', wells:[{}]};
        let linked = [];
        const helpers = {
          getLinkedSamples: () => linked,
          renderSampleTypeOptions: type => ['plasmid','protein','cell_line'].map(value => '<option value="'+value+'"'+(type === value ? ' selected' : '')+'>'+value+'</option>').join(''),
          getWellDataForType: () => ({name:'A1'})
        };
        const options = {safeText, uiState, helpers, renderStructureAction: () => ''};
        const single = createSingleContainerEditorRenderer(options);
        const well = createWellEditorRenderer(options);
        const input = (element, value) => { element.focus(); element.value = value; element.dispatchEvent(new Event('input', {bubbles:true})); };
        const key = (element, name) => element.dispatchEvent(new KeyboardEvent('keydown', {key:name,bubbles:true,cancelable:true}));
        const list = element => document.getElementById(element.getAttribute('aria-controls'));
        const sample = {id:'s1', name:'Original', type:'plasmid'};
        for (const kind of ['single','well']) {
          for (const existing of [false,true]) {
            linked = existing ? [sample] : []; uiState.editingSampleId = existing ? sample.id : '';
            host.innerHTML = kind === 'single' ? single.renderSingleContainerEditor('-20 Degree', container) : well.renderWellEditor('-20 Degree',container,0);
            const prefix = '[data-'+kind+'-sample-'+(existing ? '' : 'new-');
            const name = host.querySelector(prefix+'name]');
            const type = host.querySelector(prefix+'type]');
            name.focus();
            const typeTop = type.getBoundingClientRect().top;
            input(name, 'pet'); await wait();
            assert(type.getBoundingClientRect().top === typeTop, 'Suggestions must not move the Type field in '+prefix);
            assert(list(name).querySelectorAll('[role=option]').length === 3, 'Matching/deduplication in '+prefix);
            assert(!list(name).querySelector('img'), 'Names must be rendered as text');
            assert(requests.at(-1).storagePath === '/fixture-library', 'Current storage path');
            key(name,'ArrowDown'); key(name,'Enter');
            assert(name.value === 'pET28a' && list(name).hidden, 'Keyboard selection');
            input(name,'puc'); await wait(); list(name).querySelector('[role=option]').click();
            assert(name.value === 'pUC19' && list(name).hidden, 'Pointer selection');
            input(name,'pet'); await wait(); key(name,'Escape');
            assert(name.value === 'pet' && list(name).hidden, 'Escape preserves text');
            const before = requests.length;
            type.value = 'protein'; type.dispatchEvent(new Event('change',{bubbles:true}));
            input(name,'pet'); await wait();
            assert(list(name).hidden && requests.length === before, 'Non-plasmids do not search');
            type.value = 'plasmid'; type.dispatchEvent(new Event('change',{bubbles:true})); await wait();
            assert(!list(name).hidden, 'Changing to plasmid searches current name');
            input(name,'custom unmatched name'); await wait(); assert(list(name).hidden, 'Custom names remain valid');
            input(name,''); await wait(); assert(list(name).hidden, 'Empty names close suggestions');
          }
        }
        const name = host.querySelector('[data-well-sample-name]');
        const pending = [];
        handler = () => new Promise(resolve => pending.push(resolve));
        input(name,'pet'); await wait(); input(name,'puc'); await wait();
        pending[1]({ok:true,entries}); await wait(); pending[0]({ok:true,entries}); await wait();
        assert(list(name).textContent === 'pUC19', 'Stale searches cannot replace the current query');
        input(name,'pet'); await wait(); name.blur(); pending[2]({ok:true,entries}); await wait();
        assert(list(name).hidden, 'Blur cancels pending results');
        input(name,'pet'); await wait(); state.settings.storagePath = '/other-library';
        pending[3]({ok:true,entries}); await wait(); assert(list(name).hidden, 'Storage changes invalidate pending searches');
        input(name,'pet'); await wait(); host.replaceChildren(); pending[4]({ok:true,entries}); await wait();
        assert(list(name) === null, 'Detached editors cannot render stale results');
        handler = async () => {throw new Error('offline');};
        host.innerHTML = single.renderSingleContainerEditor('-20 Degree',container);
        const retryName = host.querySelector('[data-single-sample-name]');
        input(retryName,'pet'); await wait(); assert(list(retryName).textContent.includes('Type again to retry'), 'Search errors are actionable');
        handler = async () => ({ok:true,entries}); input(retryName,'puc'); await wait();
        assert(list(retryName).textContent === 'pUC19', 'Search retries recover');
        // Save a selected name through the existing single-container handler.
        linked = []; host.innerHTML = single.renderSingleContainerEditor('-20 Degree',container);
        let persisted = null;
        const ctx = { state, uiState, elements:{inventorySections:host}, pendingStructureDrafts:new Map(),
          helpers:{...helpers,ensureSamples(){},getContainer:()=>container,normalizeSampleCode:value=>value || '',makeDefaultSampleCode:()=> 'S-1',normalizeSampleType:value=>value,buildAutoLocationFromLink:()=>({})},
          persist:()=>persisted=JSON.parse(JSON.stringify(state.samples)),renderSections(){},isChemicalSampleType:()=>false,getPendingStructureKey:()=>'' };
        bindSingleSampleEvents(ctx);
        const saveName = host.querySelector('[data-single-sample-new-name]');
        input(saveName,'pet'); await wait(); key(saveName,'ArrowDown'); key(saveName,'Enter');
        host.querySelector('[data-single-sample-create]').click();
        assert(persisted[0].name === 'pET28a' && persisted[0].inventoryLink.wellIndex === null, 'Selected name follows existing save and linkage');
        assert(matchPlasmidNames(entries,'PET28A').join() === 'pET28a', 'Case-insensitive exact matching');
        assert(matchPlasmidNames(Array.from({length:30},(_,i)=>({name:'pET'+i})),'pet').length === 12, 'Results are bounded');
        handler = async () => ({ok:true,entries:entries.filter(entry => !entry.name.includes('<'))});
        input(saveName,'pet'); await wait();
        const bounds = list(saveName).getBoundingClientRect();
        const inputBounds = saveName.getBoundingClientRect();
        assert(bounds.top >= inputBounds.bottom - 1 && Math.abs(bounds.width-inputBounds.width) < 2, 'Dropdown is below input at matching width');
        const typeBounds = host.querySelector('[data-single-sample-new-type]').getBoundingClientRect();
        assert(bounds.bottom > typeBounds.top, 'Dropdown overlaps the Type field');
        assert(list(saveName).contains(document.elementFromPoint(bounds.left + 10, typeBounds.top + 2)), 'Suggestions receive pointer events above the Type field');
        assert(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow');
        return {checks:'All four editors, keyboard/pointer selection, free text, type gating, stale requests, blur/storage changes, failure/retry, save persistence, geometry', options:list(saveName).textContent};
      })()`);
      const output = path.join(root, 'artifacts/sample-plasmid-suggestions');
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, 'suggestions.png'), (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify(result));
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
}
