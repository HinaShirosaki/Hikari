// Real Plotly/DOM QA, including a second Electron process using an isolated profile.
// Run: node tests/assay-chart-electron.cjs
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hikari-assay-chart-'));
  const output = path.join(root, 'artifacts/assay-chart-style');
  fs.mkdirSync(output, { recursive: true });
  for (const phase of ['edit', 'restart', 'workspace', 'workspace-restart']) {
    const result = spawnSync(require('electron'), [__filename, temp, output, phase], { encoding: 'utf8', timeout: 120000 });
    if (result.status !== 0) {
      process.stderr.write(result.stdout || ''); process.stderr.write(result.stderr || '');
      throw result.error || new Error(`Electron ${phase} failed: ${result.status}`);
    }
    process.stdout.write(result.stdout || '');
  }
  fs.rmSync(temp, { recursive: true, force: true });
  console.log(`Assay chart screenshots and exports: ${output}`);
} else {
  const { app, BrowserWindow } = require('electron');
  const [temp, output, phase] = process.argv.slice(2);
  app.setPath('userData', path.join(temp, 'profile'));
  const url = (file) => pathToFileURL(path.join(root, file)).href;
  const moduleUrl = (file) => url(`src/renderer/modules/assay/plotly/${file}.js`);
  let html = `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>
      body { display:block; margin:0; background:white; }
      #qa { display:grid; grid-template-columns:280px minmax(0,1fr); height:100vh; }
      #rail { overflow:auto; padding:16px; background:var(--theme-surface); }
      #workspace { overflow:auto; min-width:0; padding:24px; }
      #chart { min-height:480px; }
      .qa-heading { margin:0 0 20px; font:600 18px Arial; }
      #chart-title { margin:0; }
    </style>
    <script src="${url('vendor/plotly/plotly.min.js')}"></script></head>
    <body><main id="qa"><aside id="rail"><details id="assay-chart-format-panel" class="foldable-section" open>
      <summary class="foldable-section__summary">Chart Format</summary><div class="foldable-section__body">
      <div id="controls"></div></div></details></aside>
      <section id="workspace"><p class="qa-heading">Assay analysis · dose response</p>
      <div id="toolbar" class="assay-chart-toolbar"></div><div id="chart"></div></section></main>
    <script type="module">
      import {createDefaultChartStyle} from '${moduleUrl('chart-style-model')}';
      import {createChartStyleStore} from '${moduleUrl('chart-style-store')}';
      import {mountChartControls} from '${moduleUrl('chart-controls')}';
      import {mountChartToolbar} from '${moduleUrl('chart-toolbar')}';
      import {createAssayPlotlyRenderer} from '${moduleUrl('plotly-renderer')}';
      const realReact = Plotly.react.bind(Plotly);
      let pending = Promise.resolve();
      Plotly.react = (...args) => pending = realReact(...args);
      const host = document.getElementById('chart');
      let controls, toolbar;
      const fitted = {chartType:'line', xLabel:'Concentration (nM)', yLabel:'Response (%)', showErrorBars:true, series:[
        {label:'Compound A',data:[{x:1,y:96},{x:10,y:81},{x:100,y:34},{x:1000,y:8}],markers:[{x:1,y:95,yVariance:3},{x:10,y:80,yVariance:5},{x:100,y:35,yVariance:4},{x:1000,y:9,yVariance:2}]},
        {label:'Compound B',data:[{x:1,y:98},{x:10,y:94},{x:100,y:75},{x:1000,y:23}],markers:[{x:1,y:99,yVariance:2},{x:10,y:92,yVariance:4},{x:100,y:76,yVariance:5},{x:1000,y:22,yVariance:3}]}]};
      const bars = {chartType:'bar',xLabel:'Treatment',yLabel:'Response (%)',showErrorBars:true,series:[
        {label:'Response',data:[{x:'Vehicle',y:95,yVariance:4,points:[91,95,99]},{x:'Compound A',y:31,yVariance:3,points:[28,31,34]},{x:'Compound B',y:69,yVariance:5,points:[64,69,74]}]}]};
      let model = fitted;
      const saved = JSON.parse(localStorage.getItem('assay-qa-record') || 'null');
      const assay = saved || {id:'qa-assay', chartStyle:{...createDefaultChartStyle(),title:'Reporter response',xScale:'log10'}};
      const renderer = createAssayPlotlyRenderer({onTitleEdit:patch=>store.setStyle(patch)});
      const store = createChartStyleStore({initialStyle:assay.chartStyle, onChange:style=>{
        assay.chartStyle=style;
        localStorage.setItem('assay-qa-record',JSON.stringify(assay));
        render();
      }});
      function render() {
        const info=renderer.render(host,model,store.getStyle());
        store.setContext({...info,hasFittedCurve:model===fitted,headers:['Treatment','Mean'],numericHeaders:['Mean']});
        controls?.refresh(); toolbar?.refresh();
      }
      render();
      controls=mountChartControls(document.getElementById('controls'),{store,promptForName:()=> 'QA style'});
      toolbar=mountChartToolbar(document.getElementById('toolbar'),{store,errorBars:{isApplicable:()=>true,get:()=>model.showErrorBars,toggle:()=>{model.showErrorBars=!model.showErrorBars;render();}},onExport:()=>{}});
      const q=key=>document.querySelector('[data-cc="'+key+'"]');
      window.qa={store,renderer,host,controls,assay,
        ready:()=>pending,
        set:(key,value)=>{const field=q(key);if(field.type==='checkbox')field.checked=value;else field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));},
        click:key=>q(key).click(),
        tab:id=>document.querySelector('[data-cc-tab="'+id+'"]').click(),
        picker:(key,value)=>{q(key).querySelector('button').click();document.querySelector('.assay-chart-picker__menu[style*="display: grid"] [data-value="'+value+'"]').click();},
        textSize:value=>{const field=document.querySelector('[aria-label="Font size (pt)"]');field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));},
        model:type=>{model=type==='bar'?bars:fitted;render();},
        render,
        validation:()=>q('validation').textContent,
        saved:()=>JSON.parse(localStorage.getItem('assay-qa-record')),
        q
      };
    </script></body></html>`;
  if (phase.startsWith('workspace')) html = require('./support/assay-workspace-qa.cjs')({ root, url });
  fs.writeFileSync(path.join(temp, 'qa.html'), html);
  let win;
  const errors = [];
  async function run() {
    await app.whenReady();
    win = new BrowserWindow({ show:false, width:1280, height:800, webPreferences:{contextIsolation:true,nodeIntegration:false} });
    win.webContents.on('console-message', (_event, level, message) => { if (level >= 3 && !String(message).includes('Content Security Policy')) errors.push(message); });
    await win.loadFile(path.join(temp, 'qa.html'));
    const js = (code) => win.webContents.executeJavaScript(code);
    for (let i=0;i<100;i++) {
      if (await js('Boolean(window.qa)')) break;
      await new Promise(resolve=>setTimeout(resolve,50));
    }
    await js('qa.ready()');
    const settle = async () => { await js('qa.ready()'); await new Promise(resolve=>setTimeout(resolve,80)); };
    const edit = async (key,value) => { await js(`qa.set(${JSON.stringify(key)},${JSON.stringify(value)})`); await settle(); };
    const shot = async (name) => { await settle(); fs.writeFileSync(path.join(output,name+'.png'), (await win.webContents.capturePage()).toPNG()); };
    if (phase.startsWith('workspace')) {
      assert.equal(await js('Boolean(qa.host?.data?.length)'),true,'the production Assay module renders the saved plate');
      assert.equal(await js("Boolean(document.querySelector('#assay-result-table .tabulator-row'))"),true,'the production spreadsheet is loaded');
      const rawBefore=await js('JSON.stringify(qa.state.assays[0].resultValues)');
      const dataBefore=await js('JSON.stringify(qa.host.data.map(trace=>({x:trace.x,y:trace.y})))');
      const tableBefore=await js("document.querySelector('#assay-analysis-table table')?.textContent");
      if (phase === 'workspace') {
        await js("qa.tab('frame')");await edit('frameStrokeWidth',2.25);
        assert.equal(await js('qa.state.assays[0].chartStyle.frameStrokeWidth'),3,'real Assay onChartStyleChanged persists the target record');
        await js("qa.tab('text')");await edit('textTarget','yTitle');await edit('titleText','Measured response');
        assert.equal(await js('qa.module.hasUnsavedChanges()'),false,'formatting does not dirty the plate data');
        assert.equal(await js('JSON.stringify(qa.host.data.map(trace=>({x:trace.x,y:trace.y})))'),dataBefore,'formatting preserves plotted scientific data');
        assert.equal(await js("document.querySelector('#assay-analysis-table table')?.textContent"),tableBefore,'formatting preserves analysis results');
        await js("document.querySelector('[data-tb-y-scale=log10]').click()");await settle();
        await js("qa.tab('axis')");
        assert.equal(await js("document.querySelector('[data-cc=yScale]').value"),'log10','toolbar and Axis panel stay synchronized');
        await shot('08-assay-workspace');
        fs.writeFileSync(path.join(temp,'workspace-expected.json'),JSON.stringify(await js('qa.getStyle()')));
      } else {
        const expected=JSON.parse(fs.readFileSync(path.join(temp,'workspace-expected.json'),'utf8'));
        assert.deepEqual(await js('qa.getStyle()'),expected,'production Assay load preserves saved formatting after restart');
        assert.equal(await js('qa.host.layout.annotations[1].text'),'Measured response');
        assert.equal(await js('Object.keys(qa.state.assays[0].resultValues).length'),16,'all well results survive restart');
        await shot('09-assay-workspace-restarted');
      }
      assert.equal(await js('JSON.stringify(qa.state.assays[0].resultValues)'),rawBefore,'plate values remain intact');
      console.log('Production Assay module '+phase+' passed');
    } else if (phase === 'restart') {
      const actual = await js('qa.store.getStyle()');
      const expected = JSON.parse(fs.readFileSync(path.join(temp,'expected.json'),'utf8'));
      assert.deepEqual(actual,expected,'all formatting survives a new Electron process');
      assert.equal(await js('qa.saved().id'),'qa-assay');
      assert.equal(await js('qa.host._fullLayout.yaxis.tickfont.size'),expected.textStyles.yTicks.fontSize);
      await js("qa.tab('axis')");
      assert.equal(await js("qa.q('yTickPreset').value"),'20','saved tick interval restores its preset selection');
      await shot('06-restarted');
      console.log('Electron restart persistence passed');
    } else {
      assert.deepEqual(await js("[...document.querySelectorAll('[role=tab]')].map(e=>e.textContent)"),['Frame','Axis','Data Series','Text']);
      await js("qa.q('frameStyle').querySelector('button').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
      assert.equal(await js("document.activeElement.getAttribute('role')"),'option','frame preview opens from the keyboard');
      await js("document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
      assert.equal(await js("document.activeElement.getAttribute('aria-label')"),'Frame style','Escape returns focus to the picker');
      const menuScroll = await js(`(() => {
        const open = () => { qa.q('frameStyle').querySelector('button').click();
          return [...document.querySelectorAll('.assay-chart-picker__menu')].find((m) => m.style.display === 'grid'); };
        const menu = open();
        menu.dispatchEvent(new Event('scroll'));
        const survivesOwnScroll = menu.style.display === 'grid';
        document.getElementById('workspace').dispatchEvent(new Event('scroll'));
        const closedByAncestorScroll = menu.style.display === 'none';
        return { survivesOwnScroll, closedByAncestorScroll };
      })()`);
      assert.deepEqual(menuScroll,{survivesOwnScroll:true,closedByAncestorScroll:true},'a picker list scrolls itself but closes when the page behind it scrolls');
      const compactFrameInputs = await js(`(() => {
        const swatch = qa.q('frameStroke').getBoundingClientRect();
        const number = qa.q('frameStrokeWidth').getBoundingClientRect();
        const background = qa.q('backgroundColor').getBoundingClientRect();
        const panel = qa.q('backgroundColor').closest('.assay-chart-style-panel').getBoundingClientRect();
        return { swatch: swatch.width, number: number.width, background: background.width, panel: panel.width };
      })()`);
      assert.ok(compactFrameInputs.number <= 96, 'short numeric fields stay compact');
      assert.ok(Math.abs(compactFrameInputs.swatch - compactFrameInputs.number) <= 1, 'a swatch matches the numeric field beside it');
      assert.ok(compactFrameInputs.background <= compactFrameInputs.panel / 2, 'an unpaired swatch stays a chip instead of spanning the panel');
      await shot('01-frame');
      const before = await js('JSON.stringify(qa.store.getStyle())');
      await js("qa.tab('series');qa.set('seriesTarget','1');qa.tab('text');qa.set('textTarget','yTicks')");
      assert.equal(await js('JSON.stringify(qa.store.getStyle())'),before,'target selection does not edit style');
      await js("qa.tab('axis')");
      await edit('yTickPreset','20');
      assert.equal(await js('qa.host.layout.yaxis.dtick'),20,'a linear preset changes the rendered tick spacing');
      assert.equal(await js('qa.store.getStyle().xTick'),null,'Y preset leaves X ticks untouched');
      assert.equal(await js("qa.q('yTick').closest('label').hidden"),true,'custom field stays compact until requested');
      const axisColumns = await js(`(() => {
        const x = qa.q('xScale').getBoundingClientRect(), y = qa.q('yScale').getBoundingClientRect();
        return { sameRow: Math.abs(x.y - y.y) < 1, leftOfY: x.right <= y.left + 1 };
      })()`);
      assert.deepEqual(axisColumns,{sameRow:true,leftOfY:true},'X and Y axis controls sit side by side');
      await shot('10-tick-presets');
      const beforeCustom = await js('JSON.stringify(qa.store.getStyle())');
      await edit('yTickPreset','custom');
      assert.equal(await js('JSON.stringify(qa.store.getStyle())'),beforeCustom,'choosing Custom preserves the current chart');
      assert.equal(await js('document.activeElement.dataset.cc'),'yTick','Custom focuses the numeric entry');
      await edit('yTick',7.5);
      assert.equal(await js('qa.host.layout.yaxis.dtick'),7.5);
      await edit('yTick',0);
      assert.equal(await js('qa.host.layout.yaxis.dtick'),7.5,'invalid custom intervals preserve the last valid chart');
      assert.match(await js('qa.validation()'),/greater than zero/);
      await edit('yTick',7.5);
      await edit('xTickPreset','2');
      assert.equal(await js("qa.q('yTickPreset').value"),'custom','editing one axis retains the other custom interval');
      assert.equal(await js("qa.q('yTick').value"),'7.5');
      assert.equal(await js('qa.host.layout.xaxis.dtick'),2,'each column edits its own axis');
      await edit('xTickPreset','auto');
      await shot('11-tick-custom');
      await edit('yTickPreset','auto');
      assert.equal(await js('qa.store.getStyle().yTick'),null,'Auto clears the explicit interval');
      for (const [scale,base] of [['log10',10],['log2',2],['ln',Math.E]]) {
        await edit('xScale',scale);await edit('xTickPreset','2');
        assert.ok(Math.abs(await js('qa.host.layout.xaxis.dtick') - 2*Math.log10(base)) < 1e-12,'log presets use the selected base');
      }
      await edit('xTickPreset','custom');
      await js("qa.click('resetTabBtn')");await settle();
      assert.equal(await js("qa.q('xTickPreset').value"),'auto','Axis reset restores Auto and exits custom entry');
      await edit('yTickPreset','20');
      await edit('xScale','log10');await edit('xTickPreset','1');
      await edit('xRangeAuto',false);
      assert.equal(await js('qa.store.getStyle().xRange.auto'),true,'incomplete manual range is not committed');
      await edit('xMin',0);await edit('xMax',1000);
      assert.match(await js('qa.validation()'),/greater than zero/);
      await edit('xMin',1);
      assert.deepEqual(await js('qa.host.layout.xaxis.range'),[0,3]);
      await edit('xTickDir','inside');
      assert.equal(await js('qa.host.layout.xaxis.ticks'),'inside');
      assert.equal(await js('qa.host.layout.yaxis.ticks'),'outside');
      await edit('xMin',10000);
      assert.deepEqual(await js('qa.host.layout.xaxis.range'),[0,3],'invalid range retains last valid figure');
      await edit('xMin',1);
      await edit('xTickAngle',20);
      await shot('02-axis');
      await js("qa.tab('series')");
      await edit('seriesTarget','0');await edit('pointSize',7.5);await edit('color','#4575b4');await edit('lineWidth',3);
      await js("qa.picker('pointShape','square')");await settle();
      assert.equal(await js('qa.host.data[1].marker.size'),10);
      assert.equal(await js('qa.host.data[3].marker.size'),6);
      assert.equal(await js('qa.host.data[0].line.width'),4);
      await edit('seriesTarget','');await edit('color','#9b87c9');
      assert.equal(await js('qa.host.data[1].marker.size'),10,'global color preserves size override');
      await edit('seriesTarget','1');await edit('color','#1fc3e6');
      await edit('errorThickness',1.5);
      await shot('03-data-series');
      await js("qa.tab('text')");
      const fontOption = await js(`(() => {
        document.querySelector('.assay-chart-text-bar__font button').click();
        const menu = [...document.querySelectorAll('.assay-chart-picker__menu')].find((m) => m.style.display === 'grid');
        const first = menu.querySelector('.assay-chart-picker__option');
        const shown = { text: first.textContent.trim(), family: first.title };
        document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        return shown;
      })()`);
      assert.equal(fontOption.text,fontOption.family,'a font option names the family once, in its own face');
      await edit('textTarget','yTicks');
      await js('qa.textSize(15)');await settle();
      assert.equal(await js('qa.host.layout.yaxis.tickfont.size'),20);
      assert.equal(await js('qa.host.layout.xaxis.tickfont.size'),40/3);
      await js("document.querySelector('[aria-label=Bold]').click()");await settle();
      assert.equal(await js('qa.host.layout.yaxis.tickfont.weight'),700);
      await edit('textTarget','xTitle');await edit('titleText','Dose (nM)');await edit('titleOffset',42);
      await shot('12-text-title');
      await js("qa.host.emit('plotly_relayout',{'annotations[0].x':0.3})");await settle();
      assert.equal(await js('qa.store.getStyle().xTitlePos'),0.3);
      await edit('textTarget','yTicks');await shot('04-text');
      const frameRect = await js("[...document.querySelectorAll('[role=tab]')].map(e=>{let r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,scroll:e.scrollWidth,client:e.clientWidth}})");
      assert.ok(frameRect.every(r=>r.y===frameRect[0].y && r.scroll<=r.client+1),'tabs stay on one line without clipping');
      await js("document.querySelector('[data-cc-tab=frame]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}))");
      assert.equal(await js('document.activeElement.dataset.ccTab'),'text');
      const styleBeforeReset = await js('qa.store.getStyle()');
      await js("qa.tab('frame');qa.click('resetTabBtn')");await settle();
      assert.deepEqual(await js('qa.store.getStyle().textStyles'),styleBeforeReset.textStyles,'frame reset preserves text');
      await js("qa.click('presetSaveBtn')");
      assert.equal(await js("localStorage.getItem('hikari_assay_chart_presets_v1').includes('QA style')"),true);
      await js('qa.model("bar")');await settle();await js("qa.tab('axis')");
      assert.equal(await js('qa.q("xNumericFields").hidden'),true,'category axis hides numeric controls');
      assert.equal(await js('qa.q("yNumericFields").hidden'),false,'the Y column stays available on a category chart');
      await js("qa.tab('series')");await edit('barLabels',true);await edit('barOutlineWidth',2);
      assert.equal(await js('qa.host.data[0].marker.line.width'),8/3);
      await edit('legendPosition','bottom');await shot('05-bars');
      await js('qa.model("line")');await settle();
      await js("document.getElementById('qa').style.gridTemplateColumns='420px minmax(0,1fr)';qa.render();qa.tab('frame')");await settle();
      const wideRail = await js(`(() => {
        const panel = document.querySelector('[data-cc-panel=frame]');
        const spin = getComputedStyle(qa.q('frameStrokeWidth')).appearance;
        return { height: panel.getBoundingClientRect().height, spin };
      })()`);
      assert.equal(wideRail.spin,'textfield','numeric fields drop their spinners');
      assert.ok(wideRail.height <= 500, 'the Frame panel stays dense on a wide rail');
      await shot('13-wide');
      win.setSize(900,700);await js("document.getElementById('qa').style.gridTemplateColumns='240px minmax(0,1fr)';qa.render();qa.tab('frame')");await settle();
      const narrow = await js("[...document.querySelectorAll('[role=tab]')].map(e=>({y:e.getBoundingClientRect().y,w:e.clientWidth,s:e.scrollWidth}))");
      assert.ok(narrow.every(r=>r.y===narrow[0].y&&r.s<=r.w+1),'tabs fit a 240px rail');
      await shot('07-narrow');
      const scrollBefore = await js("document.getElementById('workspace').scrollTop=60;document.getElementById('workspace').scrollTop");
      await edit('frameStrokeWidth',2);
      assert.equal(await js("document.getElementById('workspace').scrollTop"),scrollBefore,'style edits preserve workspace scrolling');
      for (const format of ['png','svg']) {
        const dataUrl = await js(`qa.renderer.toImage('${format}')`);
        const [meta,encoded] = dataUrl.split(/,(.*)/s);
        const bytes = meta.includes(';base64') ? Buffer.from(encoded,'base64') : Buffer.from(decodeURIComponent(encoded));
        fs.writeFileSync(path.join(output,`chart-export.${format}`),bytes);
        assert.ok(bytes.length>1000,'export contains the figure');
        if (format === 'svg') {
          const geometry = await js(`(() => {
            const wrapper=document.createElement('div');wrapper.style.cssText='position:absolute;left:-10000px;top:0;opacity:0';
            wrapper.innerHTML=${JSON.stringify(bytes.toString())};document.body.appendChild(wrapper);
            const svg=wrapper.querySelector('svg'),outer=svg.getBoundingClientRect();
            const texts=[...svg.querySelectorAll('.gtitle,.xtick text,.ytick text,.annotation-text,.legendtext')];
            const clipped=texts.filter(el=>{const r=el.getBoundingClientRect();return r.left<outer.left-1||r.top<outer.top-1||r.right>outer.right+1||r.bottom>outer.bottom+1}).map(el=>el.textContent);
            const ticks=[...svg.querySelectorAll('.xtick text')].map(el=>el.textContent);
            const liveTicks=[...qa.host.querySelectorAll('.xtick text')].map(el=>el.textContent);
            wrapper.remove();return {clipped,ticks,liveTicks};
          })()`);
          assert.deepEqual(geometry.clipped,[],'exported titles, ticks and legend stay inside the image');
          assert.deepEqual(geometry.ticks,geometry.liveTicks,'export keeps the same endpoint ticks as the live chart');
        }
      }
      fs.writeFileSync(path.join(temp,'expected.json'),JSON.stringify(await js('qa.store.getStyle()')));
      console.log('Electron controls, Plotly rendering, exports and responsive layout passed');
    }
    assert.deepEqual(errors,[],'no renderer errors');
    await win.webContents.session.flushStorageData();
    win.destroy();app.exit(0);
  }
  run().catch(error=>{console.error(error);console.error(errors);app.exit(1);});
}
