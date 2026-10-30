// Real Settings save/discard/reload over disposable workspace IPC. No fixtures
// register a language: this exercises the bundled product catalogs.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-language-setting-'));
app.setPath('userData', path.join(scratch, 'profile'));
app.setPath('sessionData', path.join(scratch, 'session'));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
let win;
const timeout = setTimeout(() => { console.error('Language settings test timed out'); app.exit(1); }, 60000);
async function main() {
  await app.whenReady();
  const fixture = path.join(scratch, 'index.html');
  const base = pathToFileURL(root + '/').href;
  fs.writeFileSync(fixture, fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace('<head>', `<head><base href="${base}">`)
    .replace(/<script type="module" src="src\/renderer\/renderer.js"><\/script>/, ''));
  for (const folder of ['src','vendor']) fs.symlinkSync(path.join(root,folder),path.join(scratch,folder),'junction');
  win = new BrowserWindow({ show: false, width: 1300, height: 950, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
  let checks = 0;
  async function boot() {
    await win.loadFile(fixture);
    return win.webContents.executeJavaScript(`(async () => {
      const base = ${JSON.stringify(base)};
      const { defaultState, STORAGE_KEY } = await import(base + 'src/renderer/modules/app-state/index.js');
      if (!localStorage.getItem(STORAGE_KEY)) {
        const state = structuredClone(defaultState);
        state.settings.storagePath = '/fixture/language-workspace'; state.settings.plugins = [];
        delete state.settings.locale;
        state.projects = [{ id: 'language-project', name: 'My project <&>', description: 'Keep this note in English.' }];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      }
      window.qaNativeLocales = []; window.qaInputEvents = 0;
      window.hikariApi = {
        ensureStorageDirectory: async () => ({ok:true}), importStorageRoot: async () => ({ok:true,statePatch:{},summary:{}}),
        autoSaveDataFile: async () => ({ok:true}), agentChatLogListSessions: async () => ({ok:true,items:[]}),
        agentChatLogGetSession: async () => ({ok:true,messages:[]}), getCodexLlmStatus: async () => ({ok:true,loggedIn:false,source:'none',cliAvailable:true}),
        sequenceLibraryList: async () => ({ok:true,entries:[],folders:[]}), listPaperFindingTasks: async () => ({ok:true,tasks:[]}),
        setUiLocale: async locale => { qaNativeLocales.push(locale); return {ok:true,locale}; }, reportError() {}
      };
      const { startHikariCore } = await import(base + 'src/renderer/core/start-hikari-core.js');
      const { i18n } = await import(base + 'src/renderer/lib/i18n/index.js');
      const core = startHikariCore(); if (!(await core.whenReady()).ok) throw new Error('Renderer failed to boot');
      core.navigationShell.showView('setting-view');
      window.qaLanguage = { core, i18n, STORAGE_KEY };
      const deadline=performance.now()+3000;
      while(document.getElementById('app-loading-cover')){if(performance.now()>deadline)throw new Error('Loading cover did not close');await new Promise(resolve=>setTimeout(resolve,20));}
      return { locale: i18n.getLocale(), saved: core.state.settings.locale, value: document.getElementById('setting-language').value, native: qaNativeLocales };
    })().catch(error => { throw new Error(error.stack); })`);
  }
  assert.deepEqual(await boot(), { locale:'en',saved:'en',value:'en',native:['en'] }); checks++;
  checks += await win.webContents.executeJavaScript(`(async () => {
    let checks = 0; const check = (ok,message) => { if(!ok)throw new Error(message);checks++; };
    const {core,i18n,STORAGE_KEY}=qaLanguage;
    const language=document.getElementById('setting-language'), form=document.getElementById('appearance-form');
    const startup=document.getElementById('setting-startup-default-view'), notes=document.getElementById('biology-notebook-result');
    const font=document.getElementById('setting-font-size'); const status=form.querySelector('[data-settings-save-status]');
    const modules=Object.entries(core.moduleRuntime.modules);
    notes.value='Unsaved notes — Español <&>\\nKeep exactly.';
    startup.value='papers-view';startup.dispatchEvent(new Event('change',{bubbles:true}));
    font.value='18';font.dispatchEvent(new Event('change',{bubbles:true}));
    const noteDraft=notes.value, project=JSON.stringify(core.state.projects);
    const savedStartup=core.state.settings.startup.defaultViewId;
    document.addEventListener('input',event=>{if(event.target===notes||event.target===startup)qaInputEvents++;});
    document.addEventListener('change',event=>{if(event.target===notes||event.target===startup)qaInputEvents++;});
    language.value='es';language.dispatchEvent(new Event('change',{bubbles:true}));
    check(i18n.getLocale()==='en'&&core.state.settings.locale==='en','Language stays saved until Save changes');
    form.querySelector('[data-settings-discard]').click();
    check(language.value==='en'&&font.value==='16'&&startup.value==='papers-view','Discard restores only Appearance drafts');
    language.value='es';language.dispatchEvent(new Event('change',{bubbles:true}));
    font.value='18';font.dispatchEvent(new Event('change',{bubbles:true}));
    form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(core.state.settings.locale==='es'&&i18n.getLocale()==='es'&&document.documentElement.lang==='es','Save applies Spanish immediately');
    check(document.querySelector('[data-settings-panel="appearance"] h3').textContent.trim()==='Apariencia','Production Spanish catalogs translate Settings');
    check(document.querySelector('label[for="setting-language"]').textContent==='Idioma','Language label translates');
    check(status.textContent==='Cambios guardados','Saved state uses the selected language');
    check(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.locale==='es','Language is durably stored in preferences');
    check(qaNativeLocales.join(',')==='en,es','Native dialogs follow the saved language once');
    check(notes.value===noteDraft&&startup.value==='papers-view'&&qaInputEvents===0,'Other drafts survive without synthesized edit events');
    check(JSON.stringify(core.state.projects)===project&&core.state.settings.startup.defaultViewId===savedStartup,'Record data and other settings are not saved accidentally');
    check(core.state.settings.appearance.fontSize===18,'Other saved Appearance preferences are preserved');
    check(modules.every(([key,value])=>core.moduleRuntime.modules[key]===value),'Language changes do not recreate modules');
    const startupStatus=document.getElementById('startup-form').querySelector('[data-settings-save-status]');
    check(startupStatus.textContent==='Cambios sin guardar','Existing dirty-form feedback translates live');
    return checks;
  })().catch(error => { throw new Error(error.stack); })`);
  const output=path.join(root,'artifacts/i18n-language-setting');fs.mkdirSync(output,{recursive:true});
  for(const width of [1300,800,600]) {
    win.setSize(width,950);
    const bounds=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const e=document.getElementById('setting-language');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();resolve({left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth})})))`);
    assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.scroll<=bounds.width,`${width}px language control fits`);checks++;
    fs.writeFileSync(path.join(output,`spanish-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(await boot(),{locale:'es',saved:'es',value:'es',native:['es']});checks++;
  checks += await win.webContents.executeJavaScript(`(async()=>{
    const {core,i18n}=qaLanguage,form=document.getElementById('appearance-form'),language=document.getElementById('setting-language');
    language.value='en';language.dispatchEvent(new Event('change',{bubbles:true}));form.querySelector('[data-settings-discard]').click();
    if(language.value!=='es'||i18n.getLocale()!=='es')throw new Error('Discard must keep the saved Spanish language');
    language.value='en';language.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit();await new Promise(r=>setTimeout(r,30));
    if(core.state.settings.locale!=='en'||i18n.getLocale()!=='en'||document.querySelector('label[for="setting-language"]').textContent!=='Language')throw new Error('English can be restored from Spanish Settings');
    return 2;
  })()`);
  assert.deepEqual(await boot(),{locale:'en',saved:'en',value:'en',native:['en']});checks++;
  win.setSize(1300,950);
  await win.webContents.executeJavaScript("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  fs.writeFileSync(path.join(output,'english-1300.png'),(await win.webContents.capturePage()).toPNG());
  console.log(`Language settings: ${checks} checks passed for save/discard, production Spanish, native sync, preserved drafts/data, reload, and 1300/800/600px layouts. Screenshots: ${output}`);
}
main().then(()=>{clearTimeout(timeout);win?.destroy();app.quit();}).catch(error=>{console.error(error);clearTimeout(timeout);win?.destroy();app.exit(1);});
