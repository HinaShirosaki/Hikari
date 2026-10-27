// Real notebook placeholder interaction and popup geometry with isolated fixture data.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-notebook-suggestions-'));
  try {
    const result = require('node:child_process').spawnSync(require('electron'), [__filename, temp], {encoding:'utf8',timeout:60000});
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.status !== 0) throw result.error || new Error(`Electron check failed: ${result.status} (${result.signal || ''})`);
  } finally { fs.rmSync(temp, {recursive:true,force:true}); }
} else {
  const { app, BrowserWindow } = require('electron');
  const temp = process.argv[2];
  app.setPath('userData', path.join(temp,'profile'));
  app.whenReady().then(async () => {
    const url = file => pathToFileURL(path.join(root,file)).href;
    const fixture = path.join(temp,'fixture.html');
    fs.writeFileSync(fixture, `<!doctype html><html><head><link rel="stylesheet" href="${url('styles.css')}">
      <style>body{display:block;padding:2rem}main{max-width:44rem;margin:auto}.step{padding:1rem;border-bottom:1px solid var(--theme-border);overflow:hidden}#steps{line-height:2}h2{margin-bottom:1rem}</style>
      </head><body><main id="biology-notebook-view"><h2>Biology Notebook</h2><h3>Plasmid preparation</h3><div id="steps"></div><textarea id="notes">Existing notes</textarea><button id="outside">Notes</button></main></body></html>`);
    const win = new BrowserWindow({width:900,height:620,show:false,webPreferences:{contextIsolation:true,sandbox:false}});
    await win.loadFile(fixture);
    win.show();
    win.focus();
    try {
      const result = await win.webContents.executeJavaScript(`(async () => {
        const {createNotebookControllers} = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/notebook/controllers.js'))});
        const {createNotebookResultFiles} = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/notebook/result-files.js'))});
        const {buildInlinePlaceholderHtml} = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/protocol/step-renderer.js'))});
        const helpers = await import(${JSON.stringify(url('src/renderer/modules/biology-notebook/samples/sample-helpers.js'))});
        const host = document.getElementById('steps');
        const notes = document.getElementById('notes');
        const assert = (condition,message) => {if(!condition) throw new Error(message);};
        const settle = () => new Promise(resolve => setTimeout(resolve,30));
        const settings = {sampleTypeLabels:{custom_lysate:'Lysate'}};
        let samples = [
          {id:'p1',code:'P-01',name:'pET28a',type:'plasmid',lot:'A',location:{storageType:'freezer',freezer:'-20 Degree',box:'Box A'}},
          {id:'p2',code:'P-02',name:'pETDuet-1',type:'plasmid',lot:'B',inventoryLink:{section:'-80 Degree',containerId:'box-b',wellIndex:0}},
          {id:'p3',code:'P-03',name:'pET<img onerror=alert(1)>',type:'plasmid'},
          {id:'c1',code:'C-01',name:'HEK293',type:'cell_line'},
          {id:'x1',code:'X-01',name:'HEK293 lysate',type:'custom_lysate'}
        ];
        const state = {settings, get samples() {return samples;}, inventory:{'-80 Degree':[{id:'box-b',name:'Box B',wells:[{name:'A1'}]}]}};
        let links = new Map(), saved = null, commits = 0, persistCalls = 0;
        const safeText = text => String(text || '').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
        function render(values = {}) {
          const aliases = helpers.buildSamplePlaceholderTypeAliases(settings);
          host.innerHTML = ['Plasmid','Cell Line','Lysate','Volume'].map((name,i)=>'<div class="step">'+(i+1)+'. '+(i===0?'Prepare ':'Add ')+buildInlinePlaceholderHtml({
            key:'step:'+i,name,value:values['step:'+i] || '',sampleLink:links.get('step:'+i),safeText,
            resolveType:name=>helpers.resolveSampleTypeForPlaceholder(name,aliases),getSampleLabel:type=>helpers.getSampleTypeLabel(type,settings),formatLinkValue:helpers.formatSampleLinkValue
          })+' to the reaction.</div>').join('');
        }
        const persist = () => {
          persistCalls++;
          saved = JSON.parse(JSON.stringify({values:Object.fromEntries([...host.querySelectorAll('[data-nb-key]')].map(input=>[input.dataset.nbKey,input.value])),sampleLinks:[...links.values()],result:notes.value}));
        };
        const {appendNotebookResultLine} = createNotebookResultFiles({elements:{notebookResult:notes}});
        const {inlinePlaceholders} = createNotebookControllers({
          elements:{notebookSteps:host}, state, safeText, getSampleLinkDrafts:()=>links,
          appendNotebookResultLine, persistActiveEntrySampleLinks:persist, maybeGenerateNotebookPageName:()=>commits++
        });
        inlinePlaceholders.bindEvents();
        render();
        const wrap = i => host.querySelectorAll('[data-inline-placeholder]')[i];
        const editor = i => wrap(i).querySelector('[data-inline-input]');
        const hidden = i => wrap(i).querySelector('[data-nb-key]');
        const token = i => wrap(i).querySelector('[data-inline-token]');
        const popup = () => document.querySelector('.biology-notebook-sample-suggestions');
        const type = (i,value) => {if(editor(i).hidden) token(i).click();editor(i).value=value;editor(i).dispatchEvent(new Event('input',{bubbles:true}));};
        const key = (i,value,composing=false) => editor(i).dispatchEvent(new KeyboardEvent('keydown',{key:value,isComposing:composing,bubbles:true,cancelable:true}));
        type(0,'pet');
        assert(popup().querySelectorAll('[role=option]').length===3,'Plasmid type filters records');
        assert(!popup().querySelector('img'),'Sample names render as text');
        assert(popup().textContent.includes('Lot: A'),'Candidate includes stock details');
        const nextTop = host.children[1].getBoundingClientRect().top;
        key(0,'Escape');
        assert(!popup() && !editor(0).hidden && editor(0).value==='pet','Escape dismisses the popup without committing');
        assert(host.children[1].getBoundingClientRect().top===nextTop,'Popup does not shift notebook steps');
        key(0,'Escape'); assert(editor(0).hidden && hidden(0).value==='','Second Escape cancels the edit');
        type(0,'pet'); key(0,'ArrowDown'); key(0,'Enter',true);
        assert(!editor(0).hidden && !links.size,'IME Enter does not select');
        key(0,'Enter');
        assert(hidden(0).value==='P-01 - pET28a' && links.get('step:0').sampleId==='p1','Keyboard selection fills and links the sample');
        assert(saved.values['step:0']==='P-01 - pET28a' && saved.sampleLinks[0].sampleLot==='A','Save includes value and metadata');
        assert(saved.result==='Existing notes'+String.fromCharCode(10)+'Linked sample P-01 - pET28a (Plasmid) to Plasmid. Saved in: -20 Degree / Box A.','Location note preserves existing notes, omits the timestamp and is saved with the sample');
        assert(commits===1 && persistCalls===1,'Selection commits and persists exactly once');
        assert(token(0).classList.contains('is-linked-sample'),'Linked token styling');
        links = new Map(helpers.normalizeNotebookSampleLinks(saved.sampleLinks).map(link=>[link.placeholderKey,link]));
        notes.value = saved.result;
        render(saved.values); assert(token(0).textContent==='P-01 - pET28a' && wrap(0).dataset.linkedSampleId==='p1','Saved sample reopens linked');
        const originalNotes = notes.value;
        type(0,'P-01'); key(0,'ArrowDown'); key(0,'Enter');
        assert(notes.value===originalNotes,'Reselecting the same sample does not duplicate its location note');
        type(0,'P-01 - pET28a'); key(0,'Enter');
        assert(notes.value===originalNotes && links.get('step:0').sampleId==='p1','Committing an unchanged linked value does not duplicate its location note');
        const beforeMove = notes.value;
        samples[0].location.box = 'Box C';
        type(0,'P-01'); key(0,'ArrowDown'); key(0,'Enter');
        assert(notes.value!==beforeMove && saved.result.includes('Saved in: -20 Degree / Box C.'),'Reselecting a relocated sample records its new location');
        type(0,'P-02');
        const row=popup().querySelector('[role=option]');
        row.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true})); row.click();
        assert(links.get('step:0').sampleId==='p2' && hidden(0).value==='P-02 - pETDuet-1','Pointer replaces linked sample');
        assert(saved.result.includes('Linked sample P-02 - pETDuet-1 (Plasmid) to Plasmid. Saved in: -80 Degree / Box B / A1.'),'Pointer selection records the inventory container and well');
        const linkedNotes = notes.value;
        type(0,'custom name'); assert(document.activeElement===editor(0),'Custom editor focus: '+document.activeElement.outerHTML); document.getElementById('outside').focus();
        assert(hidden(0).value==='custom name' && !links.has('step:0'),'Free text unlinks the prior sample on blur: '+JSON.stringify({value:hidden(0).value,linked:links.has('step:0'),editorHidden:editor(0).hidden,focus:document.activeElement.outerHTML}));
        assert(notes.value===linkedNotes && saved.result===linkedNotes,'Unlinking preserves the existing location notes');
        type(1,'hek'); assert(popup().querySelectorAll('[role=option]').length===1 && popup().textContent.includes('C-01'),'Cell Line matches only cell lines');
        key(1,'ArrowUp');key(1,'Enter');assert(links.get('step:1').sampleId==='c1','Cell selection saves correct identity');
        assert(saved.result.includes('Linked sample C-01 - HEK293 (Cell Line) to Cell Line. Saved in: No storage location recorded.'),'Samples without a location record that fact');
        type(2,'hek');assert(popup().textContent.includes('X-01'),'Configured custom sample type');
        key(2,'Escape');key(2,'Escape');
        type(3,'pet'); assert(!popup(),'Unrecognized placeholder gets no sample suggestions');key(3,'Escape');
        type(0,'not found'); assert(!popup(),'No matches preserve custom input');
        type(0,' '); assert(!popup(),'Blank input has no suggestions');
        type(0,'P-02'); samples=samples.filter(sample=>sample.id!=='p2'); popup().querySelector('[role=option]').click();
        assert(!links.has('step:0') && !editor(0).hidden,'Deleted candidates cannot be linked');
        type(0,'pet'); host.dispatchEvent(new Event('scroll')); assert(!popup(),'Scrolling closes the floating list');
        type(0,'pet'); window.dispatchEvent(new Event('resize')); assert(!popup(),'Resize closes the list');
        type(0,'pet'); render(); await settle(); assert(!popup(),'Page rerender removes the popup');
        samples=samples.filter(sample=>sample.id!=='p3');
        samples.push({id:'p2',code:'P-02',name:'pETDuet-1',type:'plasmid',lot:'B'});
        type(0,'pet'); await settle();
        const bounds=popup().getBoundingClientRect(), inputBounds=editor(0).getBoundingClientRect();
        assert(bounds.top>=inputBounds.bottom && bounds.bottom>host.children[0].getBoundingClientRect().bottom,'Popup overlaps clipped step boundary below the input');
        assert(popup().contains(document.elementFromPoint(bounds.left+10,bounds.bottom-10)),'Overlay remains clickable outside the clipped step');
        assert(bounds.left>=0 && bounds.right<=innerWidth && bounds.bottom<=innerHeight,'Popup fits the viewport');
        return {checks:'Type/name/code filtering, custom types, free text, IME, keyboard/pointer selection, location notes, inventory wells, missing locations, deduplication, sample moves, Escape, blur, save/reopen, single commit, deletion, scroll/resize/rerender, top-layer geometry'};
      })()`);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const output=path.join(root,'artifacts/notebook-placeholder-suggestions'); fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,'suggestions.png'),(await win.webContents.capturePage()).toPNG());
      const point = await win.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.biology-notebook-sample-suggestions [role="option"]').getBoundingClientRect();
        return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)};
      })()`);
      win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
      win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
      const clicked = await win.webContents.executeJavaScript(`new Promise(resolve => setTimeout(() => resolve(document.querySelector('[data-inline-placeholder]').dataset.linkedSampleId), 50))`);
      if (clicked !== 'p1') throw new Error('Native mouse selection did not link the candidate');
      console.log(JSON.stringify(result));app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
  });
}
