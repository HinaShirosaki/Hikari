// Pre-render the existing animated sections and align metadata without adding visible sections.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const site=path.resolve(__dirname,'..'),file=path.join(site,'index.html');
let html=fs.readFileSync(file,'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function claims(name){
 const match=html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`));
 if(!match)throw Error('Missing '+name);
 return vm.runInNewContext('('+match[1]+')',Object.create(null),{timeout:1000});
}
const product=claims('CLAIMS'),agent=claims('AGENT_CLAIMS');
for(const [name,prefix,items]of [['PRODUCT','',product],['AGENT','agent-',agent]]){
 const copies=items.map((claim,i)=>`      <div class="feature-copy" data-story-feature="${escape(claim.id)}"${i?' hidden':''}>\n        <h2 id="${prefix+(i?'copy-'+claim.id+'-title':'dTitle')}" data-feature-title tabindex="-1">${escape(claim.t)}</h2>\n        <p id="${prefix+(i?'copy-'+claim.id+'-body':'dBody')}" data-feature-body>${escape(claim.b)}</p>\n        <ul id="${prefix+(i?'copy-'+claim.id+'-list':'dList')}" data-feature-list>${claim.l.map(text=>`<li>${text}</li>`).join('')}</ul>\n      </div>`).join('\n');
 const block=`<!-- ${name}_COPY:START -->\n${copies}\n      <!-- ${name}_COPY:END -->`;
 const pattern=new RegExp(`<!-- ${name}_COPY:START -->[\\s\\S]*?<!-- ${name}_COPY:END -->`);
 if(pattern.test(html))html=html.replace(pattern,block);
 else{
  const pattern=new RegExp(`<div class="feature-copy"><h2 id="${prefix}dTitle"[^>]*>[\\s\\S]*?<ul id="${prefix}dList">[\\s\\S]*?</ul></div>`);
  if(!pattern.test(html))throw Error('Missing existing '+name+' copy container');
  html=html.replace(pattern,block);
 }
}
const title='Hikari — Your Lab, in One App';
const description='Free, local-first lab software for macOS and Windows. Connect an electronic lab notebook, protocols, sample inventory, DNA tools, and results. AI is optional.';
html=html.replace(/<title>.*?<\/title>/,`<title>${escape(title)}</title>`);
for(const [attribute,name,value]of [['name','description',description],['property','og:title',title],['property','og:description',description],['name','twitter:title',title],['name','twitter:description',description]]){
 const pattern=new RegExp(`<meta ${attribute}="${name}" content="[^"]*">`);if(!pattern.test(html))throw Error('Missing '+name);
 html=html.replace(pattern,`<meta ${attribute}="${name}" content="${escape(value)}">`);
}
const match=html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/),data=JSON.parse(match[1]);
const page=data['@graph'].find(item=>item['@type']==='WebPage'),app=data['@graph'].find(item=>item['@type']==='SoftwareApplication');
page.name=title;page.description=description;
const features={
 experiments:'Optional AI agent across lab records',cloning:'DNA cloning and primer design','protein-builder':'Protein constructs and coding DNA',
 calculations:'Notebook calculations and PDF worksheets',protocols:'Electronic lab notebook and reusable protocols',workflows:'Experiment workflows',
 samples:'Sample inventory and storage locations',plugins:'Plugins for additional lab tools'
};
app.featureList=product.map(claim=>{if(!features[claim.id])throw Error('Describe the visible feature '+claim.id+' before adding metadata');return features[claim.id];});
app.description='Free, open-source, local-first electronic lab notebook and lab software for macOS and Windows. Connect reusable protocols, samples, DNA cloning, protein constructs, calculations, workflows, and plugins. An optional AI agent works from your records through Codex CLI with a ChatGPT plan that includes CLI access.';
html=html.replace(match[0],`<script type="application/ld+json">\n${JSON.stringify(data,null,2)}\n</script>`);
const version=crypto.createHash('sha256').update(fs.readFileSync(path.join(site,'trial.js'))).digest('hex').slice(0,12);
html=html.replace(/trial\.js\?v=[^"\s]+/,'trial.js?v='+version);
fs.writeFileSync(file,html);
console.log(`Updated metadata and pre-rendered ${product.length+agent.length} existing feature panels; no sections added.`);
