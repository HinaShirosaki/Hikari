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
  for (const [locale, heading, label, saved, settingsLabel] of [
    ['zh-Hans', '外观', '语言', '更改已保存', '设置'],
    ['zh-Hant', '外觀', '語言', '變更已儲存', '設定'],
    ['ja', '外観', '言語', '変更を保存しました', '設定']
  ]) {
    checks += await win.webContents.executeJavaScript(`(async () => {
      const {core,i18n,STORAGE_KEY}=qaLanguage;
      let checks=0;const check=(ok,message)=>{if(!ok)throw new Error(message);checks++;};
      const locale=${JSON.stringify(locale)},form=document.getElementById('appearance-form'),language=document.getElementById('setting-language');
      const previous=i18n.getLocale(),notes=document.getElementById('biology-notebook-result');
      const modules=Object.entries(core.moduleRuntime.modules),project=JSON.stringify(core.state.projects);
      notes.value='未保存の実験記録 · 未儲存的筆記 <&>';notes.focus();notes.setSelectionRange(2,7);
      const draft=notes.value;
      check([...language.options].map(option=>option.value).join(',')==='en,es,zh-Hans,zh-Hant,ja','Every product language is selectable');
      language.value=locale;language.dispatchEvent(new Event('change',{bubbles:true}));
      check(i18n.getLocale()===previous&&core.state.settings.locale===previous,'Language remains a draft before save');
      form.querySelector('[data-settings-discard]').click();
      check(language.value===previous&&i18n.getLocale()===previous,'Discard restores the saved language');
      language.value=locale;language.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit();
      await new Promise(resolve=>setTimeout(resolve,30));
      check(i18n.getLocale()===locale&&core.state.settings.locale===locale&&document.documentElement.lang===locale,'Save applies '+locale+' live');
      check(document.querySelector('[data-settings-panel="appearance"] h3').textContent.trim()===${JSON.stringify(heading)},'Appearance heading is translated');
      check(document.querySelector('label[for="setting-language"]').textContent===${JSON.stringify(label)},'Language label is translated');
      check(form.querySelector('[data-settings-save-status]').textContent===${JSON.stringify(saved)},'Save feedback is translated');
      check(i18n.t('shell.app.settings')===${JSON.stringify(settingsLabel)},'Navigation catalog is bundled');
      const base=${JSON.stringify(base)};
      const featureModules={agent:'agent-chat',plate:'assay',notebook:'biology-notebook',home:'home-dashboard',chemicals:'lab-common-inventory',papers:'papers',samples:'personal-inventory',protocol:'protocol',dna:'sequence-viewer',tools:'tool-box',workflow:'workflow'};
      for(const [namespace,module] of Object.entries(featureModules)) {
        const messages=Object.values(await import(base+'src/renderer/modules/'+module+'/locales/'+locale+'.js'))[0];
        const params={count:3,name:'User <&>',p0:'sample',index:2};
        for(const [key,message] of Object.entries(messages)) {
          const expected=Object.entries(params).reduce((text,[name,value])=>text.split('{'+name+'}').join(String(value)),message);
          check(i18n.t(namespace+'.'+key,params)===expected,'Production catalog is registered: '+locale+' '+namespace+'.'+key);
        }
      }
      check(i18n.t('settings.codex.cliDescription').startsWith('Hikari needs Codex CLI'),'Untranslated preview copy uses English');
      check(JSON.parse(localStorage.getItem(STORAGE_KEY)).settings.locale===locale,'Language is durably stored');
      check(qaNativeLocales.at(-1)===locale,'Native dialogs follow the selected language');
      check(notes.value===draft&&notes.selectionStart===2&&notes.selectionEnd===7,'Non-Latin draft and selection survive');
      check(JSON.stringify(core.state.projects)===project&&modules.every(([key,value])=>core.moduleRuntime.modules[key]===value),'Records and module instances survive');
      const {notebookEnglish}=await import(base+'src/renderer/modules/biology-notebook/locales/en.js');
      const toolbox=document.getElementById('biology-notebook-tool-sidebar');
      for(const button of toolbox.querySelectorAll('[data-i18n-hover-caption]')) {
        const key=button.getAttribute('data-i18n-hover-caption'),caption=button.getAttribute('data-hover-caption');
        check(caption===i18n.t(key)&&caption!==notebookEnglish[key.slice('notebook.'.length)],'Notebook toolbox caption translates: '+locale+' '+key);
        check(button.getAttribute('aria-label')===i18n.t(button.getAttribute('data-i18n-aria-label')),'Notebook toolbox accessibility label follows the caption');
      }
      const {mountChartControls}=await import(base+'src/renderer/modules/assay/plotly/chart-controls.js');
      const {createChartStyleStore}=await import(base+'src/renderer/modules/assay/plotly/chart-style-store.js');
      const {presentationKey}=await import(base+'src/renderer/lib/i18n/presentation.js');
      const host=document.createElement('div');host.style.cssText='position:fixed;z-index:9999;top:100px;left:400px;width:320px;height:600px;overflow:auto;background:white';document.body.append(host);
      const store=createChartStyleStore({initialStyle:{title:'User chart title <&>'}});
      store.setContext({method:'agent_plotly',chartType:'line',headers:['Auto','Frame','Custom'],numericHeaders:['Custom'],seriesLabels:['All series','Frame']});
      const elements=[{id:'user-label',type:'label',text:'Title',coordinates:'plot',x:0.5,y:0.8,fontSize:12,color:'#222222'},{id:'ref',type:'line',axis:'y',value:3,color:'#222222',width:1,dash:'solid'}];
      const controls=mountChartControls(host,{store,agentElements:{getStyle:()=>({plotElements:elements}),apply(){throw new Error('Language checks must not edit plot elements');}}});
      const field=key=>host.querySelector('[data-cc="'+key+'"]');
      for(const node of host.querySelectorAll('[data-i18n]')) {
        if(node.children.length||node.matches('input,textarea,select'))continue;
        const params=JSON.parse(node.getAttribute('data-i18n-params')||'{}');
        check(node.textContent===i18n.t(node.dataset.i18n,params),'Plot setting translates: '+locale+' '+node.dataset.i18n);
      }
      check(field('presetSelect').options[0].textContent!=='Custom','Built-in Custom preset translates');
      check(field('presetSelect').options[1].textContent!=='Figure Classic','Built-in chart preset translates');
      check(field('xColumn').querySelector('option[value="auto"]').textContent!=='Auto','Built-in Auto option translates');
      check(field('xColumn').querySelector('option[value="Auto"]').textContent==='Auto','User column named Auto remains literal');
      check(field('seriesTarget').querySelector('option[value="0"]').textContent==='All series','User series named All series remains literal');
      check(field('seriesTarget').querySelector('option[value=""]').textContent!=='All series','All series control translates');
      check(host.querySelector('[data-plot-element="selected"] option[value="user-label"]').textContent==='Title','User plot annotation remains literal');
      check(host.querySelector('[data-plot-element="newType"]').getAttribute('aria-label')!=='Add plot element','Elements control translates');
      const bold=host.querySelector('[data-i18n-hover-caption="plate.'+presentationKey('Bold')+'"]');
      check(bold&&bold.getAttribute('data-hover-caption')!=='Bold'&&bold.getAttribute('aria-label')===bold.getAttribute('data-hover-caption'),'Plot text toolbar caption translates');
      controls.selectTab('text');const title=field('titleText');title.value='Unsaved chart title <&>';title.focus();title.setSelectionRange(2,7);
      field('frameWidth').value='913';const plotBefore=JSON.stringify(store.getStyle()),contextBefore=JSON.stringify(store.getContext());
      i18n.setLocale('en');i18n.setLocale(locale);
      check(title.value==='Unsaved chart title <&>'&&title.selectionStart===2&&title.selectionEnd===7&&document.activeElement===title,'Plot settings preserve an active title draft across language switches');
      check(field('frameWidth').value==='913'&&JSON.stringify(store.getStyle())===plotBefore&&JSON.stringify(store.getContext())===contextBefore,'Language switching preserves numeric drafts, chart settings and source columns');
      check(bold.getAttribute('data-hover-caption')===i18n.t('plate.'+presentationKey('Bold')),'Existing Plotly captions refresh live');
      controls.destroy();host.remove();
      return checks;
    })().catch(error=>{throw new Error(error.stack);})`);
    for (const width of [1300,800,600]) {
      win.setSize(width,950);
      const bounds=await win.webContents.executeJavaScript(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{const e=document.getElementById('setting-language');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();resolve({left:r.left,right:r.right,width:innerWidth,scroll:document.documentElement.scrollWidth})})))`);
      assert.ok(bounds.left>=0&&bounds.right<=bounds.width&&bounds.scroll<=bounds.width,`${locale} at ${width}px fits`);checks++;
      fs.writeFileSync(path.join(output,`${locale}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(await boot(),{locale,saved:locale,value:locale,native:[locale]});checks++;
  }
  await win.webContents.executeJavaScript(`(async()=>{const form=document.getElementById('appearance-form'),language=document.getElementById('setting-language');language.value='en';language.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit();await new Promise(r=>setTimeout(r,30));})()`);
  assert.deepEqual(await boot(),{locale:'en',saved:'en',value:'en',native:['en']});checks++;
  win.setSize(1300,950);
  await win.webContents.executeJavaScript("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
  fs.writeFileSync(path.join(output,'english-1300.png'),(await win.webContents.capturePage()).toPNG());
  console.log(`Language settings: ${checks} checks passed for save/discard, Spanish/Chinese/Japanese catalogs, native sync, preserved drafts/data, reload, and 1300/800/600px layouts. Screenshots: ${output}`);
}
main().then(()=>{clearTimeout(timeout);win?.destroy();app.quit();}).catch(error=>{console.error(error);clearTimeout(timeout);win?.destroy();app.exit(1);});
