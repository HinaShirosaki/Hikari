// Build the offline reading view from the chapter's Markdown.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const folder = path.resolve(__dirname, '..');
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
async function main() {
  let modulePath;
  try { modulePath = require.resolve('marked'); }
  catch { throw new Error('The build tool needs marked. Set NODE_PATH to the bundled runtime node_modules directory, or a directory providing marked.'); }
  const { marked } = await import(pathToFileURL(modulePath).href);
  const markdown = fs.readFileSync(path.join(folder, 'plate.md'), 'utf8');
  const headings = [];
  const ids = new Set();
  let body = marked.parse(markdown, { gfm: true, breaks: false });
  body = body.replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (_match, level, title) => {
    const text = title.replace(/<[^>]+>/g, '')
      .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_entity, value) => String.fromCodePoint(value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value)))
      .replace(/&(amp|quot|apos|lt|gt);/g, (_entity, name) => ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[name]);
    const id = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
    if (ids.has(id)) throw new Error(`Duplicate chapter anchor: ${id}`);
    ids.add(id);
    if (level === '2') headings.push({ title: text, id });
    return `<h${level} id="${id}">${title}<a class="heading-link" href="#${id}" aria-label="Link to ${escape(text)}">#</a></h${level}>`;
  });
  let images = 0;
  body = body.replace(/<p>(<img\s[^>]+>)<\/p>/g, (_match, tag) => {
    images++;
    const alt = tag.match(/alt="([^"]*)"/)?.[1] || '';
    return `<figure><button class="screenshot" type="button" aria-label="Enlarge screenshot ${images}">${tag.replace('<img ', '<img loading="lazy" ')}</button><figcaption><span>Figure ${images}.</span> ${alt} <span class="enlarge-hint">Click to enlarge.</span></figcaption></figure>`;
  });
  body = body.replace(/<table>/g, '<div class="table-scroll"><table>').replace(/<\/table>/g, '</table></div>');
  const nav = headings.map(item => `<a href="#${item.id}">${escape(item.title)}</a>`).join('\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="A detailed illustrated tutorial for Hikari Plate, with highlighted screenshots and step-by-step instructions."><title>Plate · Hikari tutorials</title><link rel="stylesheet" href="tutorial.css"></head>
<body><a class="skip-link" href="#chapter">Skip to tutorial</a>
<aside class="sidebar"><a class="brand" href="../index.html">Hikari <span>/ Tutorials</span></a><p class="chapter-number">CHAPTER 09</p><p class="chapter-name">Plate</p><nav aria-label="Chapter contents">${nav}</nav></aside>
<main id="chapter"><div class="eyebrow">HIKARI / ILLUSTRATED TUTORIAL</div><article>${body}</article><footer class="page-footer">Hikari tutorials · Chapter 09 · Plate</footer></main>
<dialog id="image-viewer" aria-label="Enlarged tutorial screenshot"><div class="viewer-toolbar"><span id="viewer-label">Screenshot</span><button id="viewer-zoom" type="button">Actual size</button><button id="viewer-close" type="button" aria-label="Close enlarged screenshot">Close ×</button></div><div class="viewer-body"><img id="viewer-image" alt=""></div></dialog>
<script>
const viewer = document.getElementById('image-viewer');
const enlarged = document.getElementById('viewer-image');
const zoom = document.getElementById('viewer-zoom');
for (const button of document.querySelectorAll('.screenshot')) button.addEventListener('click', () => {
  const img = button.querySelector('img'); enlarged.src = img.src; enlarged.alt = img.alt;
  document.getElementById('viewer-label').textContent = button.closest('figure').querySelector('figcaption span').textContent;
  viewer.classList.remove('actual-size'); zoom.textContent = 'Actual size'; viewer.showModal();
});
document.getElementById('viewer-close').addEventListener('click', () => viewer.close());
zoom.addEventListener('click', () => { const actual = viewer.classList.toggle('actual-size'); zoom.textContent = actual ? 'Fit to window' : 'Actual size'; });
viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
if ('IntersectionObserver' in window) {
  const links = [...document.querySelectorAll('.sidebar nav a')];
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      for (const link of links) { const active = link.hash === '#' + entry.target.id; link.classList.toggle('current', active); if (active) link.setAttribute('aria-current', 'location'); else link.removeAttribute('aria-current'); }
    }
  }, { rootMargin: '-5% 0px -75% 0px' });
  document.querySelectorAll('article h2').forEach(heading => observer.observe(heading));
}
</script></body></html>\n`;
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  for (const ref of refs) {
    if (ref.startsWith('#')) {
      if (ref !== '#chapter' && !ids.has(ref.slice(1))) throw new Error(`Missing anchor: ${ref}`);
    } else if (!/^(https?:|data:)/.test(ref)) {
      if (!fs.existsSync(path.resolve(folder, ref.split('#')[0]))) throw new Error(`Missing local resource: ${ref}`);
    }
  }
  if (images !== 20 || headings.length !== 14) throw new Error(`Unexpected chapter coverage: ${images} figures, ${headings.length} sections`);
  fs.writeFileSync(path.join(folder, 'index.html'), html);
  console.log(`Built index.html: ${headings.length} sections, ${images} screenshots; all ${refs.length} links and image references resolve.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
