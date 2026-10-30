const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const site=path.resolve(__dirname,'..'),file=path.join(site,'index.html'),html=fs.readFileSync(file,'utf8');
const readClaims=name=>Array.from(vm.runInNewContext('('+html.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\n\\]);`))[1]+')',Object.create(null),{timeout:1000}));
const escape=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const metadata=(attribute,name)=>{const values=[...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`,'g'))];assert.equal(values.length,1,name+' occurs once');return values[0][1];};
const title='Hikari — Your Lab, in One App';
assert.equal(html.match(/<title>(.*?)<\/title>/)[1],title);
for(const attribute of [['property','og:title'],['name','twitter:title']])assert.equal(metadata(...attribute),title);
const description=metadata('name','description');assert.equal(metadata('property','og:description'),description);assert.equal(metadata('name','twitter:description'),description);
const structured=JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.equal(structured['@graph'].find(x=>x['@type']==='WebPage').name,title);
const application=structured['@graph'].find(x=>x['@type']==='SoftwareApplication');
assert.equal(application.featureList.length,readClaims('CLAIMS').length);
assert.ok(!application.featureList.some(x=>/chemical|gel/i.test(x)),'Do not advertise features absent from the current sections');
for(const [name,claims]of [['PRODUCT',readClaims('CLAIMS')],['AGENT',readClaims('AGENT_CLAIMS')]]){
 const block=html.match(new RegExp(`<!-- ${name}_COPY:START -->([\\s\\S]*?)<!-- ${name}_COPY:END -->`))[1];
 assert.equal((block.match(/data-story-feature=/g)||[]).length,claims.length);
 assert.equal((block.match(/data-story-feature="[^"]+" hidden/g)||[]).length,claims.length-1,'Only the first existing panel is initially active');
 for(const claim of claims){assert.ok(block.includes(escape(claim.t)),claim.id+' title is in raw HTML');assert.ok(block.includes(escape(claim.b)),claim.id+' description is in raw HTML');for(const bullet of claim.l)assert.ok(block.includes(bullet),claim.id+' highlights are in raw HTML');}
}
assert.ok(!html.includes('id="workspace-features"')&&!html.includes('feature-index.css'),'No added visible feature index');
assert.ok(html.includes('<h1 id="opening-title" class="opening-title"><span class="lead">Hikari is</span> <span class="opening-statement">your lab, in one app.</span></h1>'));
assert.equal((html.match(/rel="canonical"/g)||[]).length,1);assert.ok(html.includes('href="https://hikari-lab-agent.com/"'));
assert.ok(!metadata('name','robots').includes('noindex'));
const body=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');const ids=[...body.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length,'Pre-rendered IDs are unique');
execFileSync(process.execPath,[path.join(__dirname,'build-search-content.cjs')]);assert.equal(fs.readFileSync(file,'utf8'),html,'Regeneration is idempotent');
console.log('PASS: consistent metadata; all 14 existing section copies are in raw HTML; unique IDs, one canonical, no added visible section; regeneration is idempotent.');
