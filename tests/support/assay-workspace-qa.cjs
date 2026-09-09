// Builds an isolated page from the production Assay markup and module.
module.exports = function workspacePage({ root, url }) {
  const fs = require('node:fs');
  const path = require('node:path');
  const markup = fs.readFileSync(path.join(root, 'ui/html/views/assay-view.html'), 'utf8');
  return `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="${url('vendor/tabulator/tabulator.min.css')}">
    <link rel="stylesheet" href="${url('styles.css')}">
    <style>body{display:block;margin:0}#assay-view{display:block!important;height:100vh;padding:0}
    #assay-view .assay-results-layout{height:100vh}[hidden]{display:none!important}</style>
    <script src="${url('vendor/plotly/plotly.min.js')}"></script>
    <script src="${url('vendor/tabulator/tabulator.min.js')}"></script>
    <button id="assay-mode-create-btn" hidden>Setup</button><button id="assay-mode-results-btn" hidden>Analyze</button>
    ${markup}
    <script type="module">
      import {initAssay} from '${url('src/renderer/modules/assay/index.js')}';
      let pending=Promise.resolve();const react=Plotly.react.bind(Plotly);
      Plotly.react=(...args)=>pending=react(...args);
      const layout=[],results={};
      for(let r=0;r<2;r++)for(let c=0;c<8;c++){
        const well=String.fromCharCode(65+r)+(c+1);
        layout.push({well,sampleId:'Compound '+(r?'B':'A'),concentration:String([1,10,100,1000][Math.floor(c/2)])});
        results[well]=String(([95,80,35,9][Math.floor(c/2)]+r*4+(c%2?1:-1)));
      }
      const state=JSON.parse(localStorage.getItem('assay-workspace-state')||'null')||{
        assays:[{id:'qa-workspace-assay',name:'Reporter dose response',plateType:'96',sampleAxis:'row',wellLayout:layout,resultValues:results}],
        projects:[],notebookEntries:[],settings:{}
      };
      const safeText=value=>{const e=document.createElement('span');e.textContent=String(value??'');return e.innerHTML;};
      const module=initAssay({state,persist:()=>localStorage.setItem('assay-workspace-state',JSON.stringify(state)),createId:()=>crypto.randomUUID(),safeText});
      module.render();
      await new Promise(resolve=>setTimeout(resolve,150));
      document.getElementById('assay-mode-results-btn').click();
      await new Promise(resolve=>setTimeout(resolve,150));
      const select=document.getElementById('assay-results-assay-select');
      if(select.value!=='qa-workspace-assay'){
        select.value='qa-workspace-assay';select.dispatchEvent(new Event('change',{bubbles:true}));
      }
      await new Promise(resolve=>setTimeout(resolve,150));
      const kind=document.getElementById('assay-analysis-kind');kind.value='linear';kind.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('assay-analysis-panel').open=false;
      document.getElementById('assay-chart-format-panel').open=true;
      const q=key=>document.querySelector('[data-cc="'+key+'"]');
      window.qa={state,module,ready:()=>pending,
        get host(){return document.querySelector('[data-assay-analysis-chart]')},
        getStyle:()=>state.assays[0].chartStyle,
        set:(key,value)=>{const field=q(key);if(field.type==='checkbox')field.checked=value;else field.value=value;field.dispatchEvent(new Event('change',{bubbles:true}));},
        tab:id=>document.querySelector('[data-cc-tab="'+id+'"]').click()
      };
    </script>`;
};
