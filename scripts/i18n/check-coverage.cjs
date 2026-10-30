// Check source-owned UI boundaries. Dynamic record/provider fields are not
// English copy and are intentionally outside this literal-copy check.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const espree = require(require.resolve('espree', { paths: [path.dirname(require.resolve('eslint'))] }));
const { sourceMarkup } = require('./markup.cjs');
const root = path.resolve(__dirname, '../..');
const areas = { 'home-dashboard': 'home', settings: 'settings', 'biology-notebook': 'notebook', assay: 'plate', 'sequence-viewer': 'dna', 'agent-chat': 'agent', papers: 'papers', workflow: 'workflow', protocol: 'protocol', 'personal-inventory': 'samples', 'lab-common-inventory': 'chemicals', 'tool-box': 'tools' };
const plugins = { 'plugins/scientific-illustration': 'figura', 'plugins/qpcr-analysis': 'qpcr', 'src/plugins/gel': 'gel' };
const filesIn = dir => fs.readdirSync(path.join(root, dir), { recursive: true }).filter(f => /\.(?:js|mjs)$/.test(f) && !/(?:^|\/)vendor\/|(?:^|\/)tests\/|(?:^|\/)locales\//.test(f) && !/generated|(?:^|\/)i18n(?:\.mjs|\.js|\/)/.test(f)).map(f => path.join(dir, f));
const human = text => typeof text === 'string' && /[A-Za-z]{3}/.test(text) && !/^\s*(?:https?:|data:|[#./])/.test(text) && !/^[A-Z_\d\s/().+%-]{1,14}$/.test(text) && !['Hikari', 'OpenAI', 'Codex', 'Plotly', 'Tabulator', 'GenBank', 'CropperJS'].includes(text);
// Persisted record names and exported PowerPoint metadata use canonical data.
const canonicalAssignments = new Set(['plugins/scientific-illustration/workspace.mjs#next.title', 'src/plugins/gel/workspace/figure/powerpoint.js#pptx.title']);
const literals = node => node?.type === 'Literal' && typeof node.value === 'string' ? [node.value] : node?.type === 'ConditionalExpression' ? [...literals(node.consequent), ...literals(node.alternate)] : node?.type === 'LogicalExpression' && ['||', '??'].includes(node.operator) ? literals(node.right) : [];
function walk(node, visit, parents = []) {
  if (!node || typeof node !== 'object') return;
  if (node.type) visit(node, parents);
  for (const [key, value] of Object.entries(node)) if (!['loc', 'range', 'tokens', 'comments'].includes(key)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, [...parents, node]));
    else if (value && typeof value === 'object') walk(value, visit, [...parents, node]);
  }
}
async function main() {
  const catalogs = {}, errors = [];
  const issue = (file, node, reason) => errors.push(`${file}:${node.loc?.start.line || 1}: ${reason}`);
  // Check catalogs with the renderer's own key function; every other runtime copy must agree with it.
  const { presentationKey: keyFor } = await import(pathToFileURL(path.join(root, 'src/renderer/lib/i18n/presentation.js')));
  const pluginRuntimes = Object.keys(plugins).map(folder => fs.readFileSync(path.join(root, folder, 'i18n.js'), 'utf8'));
  if (new Set(pluginRuntimes).size !== 1) errors.push('Plugin i18n.js runtimes differ: keep the three copies identical.');
  const probe = 'Key probe é 🔥', pluginRuntime = {};
  vm.runInNewContext(pluginRuntimes[0], pluginRuntime);
  if (pluginRuntime.HikariUi.keyFor(probe) !== keyFor(probe) || require(path.join(root, 'src/main/lib/i18n.js')).keyFor(probe) !== keyFor(probe).replace('full.', 'ui.')) {
    errors.push('Renderer, plugin and native i18n key hashes disagree.');
  }
  const { shellEnglish } = await import(pathToFileURL(path.join(root, 'src/renderer/lib/i18n/shell-en.js')));
  catalogs.shell = shellEnglish;
  const { commonEnglish } = await import(pathToFileURL(path.join(root, 'src/renderer/lib/i18n/en.js')));
  catalogs.common = commonEnglish;
  for (const [module, ns] of Object.entries(areas)) {
    const exports = await import(pathToFileURL(path.join(root, `src/renderer/modules/${module}/locales/en.js`)));
    catalogs[ns] = Object.values(exports)[0];
  }
  for (const [folder, ns] of Object.entries(plugins)) {
    const context = {}; vm.runInNewContext(fs.readFileSync(path.join(root, folder, 'locales/en.js'), 'utf8'), context);
    catalogs[ns] = context.HikariUiEnglish[ns];
  }
  const sources = [...filesIn('src/renderer'), ...Object.keys(plugins).flatMap(filesIn)];
  let messages = 0, bindings = 0;
  for (const file of sources) {
    if (/\/lib\/i18n\/|\/localization\.js$|\/locales\//.test(file)) continue;
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const ast = espree.parse(source, { ecmaVersion: 'latest', sourceType: 'module', loc: true, range: true });
    const namespace = source.match(/(?:const|let) i18nUi = (?:[\w.]+\.)?createPresentation\(['"]([a-z]+)['"]\)/)?.[1];
    walk(ast, (node, parents) => {
      if (!/src\/renderer\/modules\/(?:app-state|pdf-export)\//.test(file)
        && node.type === 'TemplateLiteral' && parents.at(-1)?.type !== 'TaggedTemplateExpression'
        && node.quasis.some(part => /<[a-z][\w-]*(?:\s|>)/i.test(part.value.raw))) {
        let body = ''; node.quasis.forEach((part, index) => { body += part.value.raw; if (index < node.expressions.length) body += '\uE000' + index + '\uE001'; });
        for (const fragment of body.matchAll(/<(?:text|title)\b[^>]*>([\s\S]*?)<\/(?:text|title)>/g)) {
          for (const token of fragment[1].matchAll(/\uE000(\d+)\uE001/g)) if (/i18nUi\.html\(/.test(source.slice(...node.expressions[Number(token[1])].range))) issue(file, node, 'HTML spans cannot be inserted into SVG text or document titles');
        }
        const remaining = [];
        sourceMarkup(body, { namespace: namespace || 'shell', expressions: node.expressions.map(part => source.slice(...part.range)), keyFor, register: text => remaining.push(text) });
        if (remaining.length) issue(file, node, 'Unbound generated markup: ' + [...new Set(remaining)].join(' | '));
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.object.name === 'i18nUi') {
        const method = node.callee.property.name;
        const arg = node.arguments[['attribute'].includes(method) ? 1 : 0];
        if (['message', 'text', 'html', 'svg', 'textBinding', 'plainText', 'attribute'].includes(method)) for (const english of literals(arg)) {
          messages++;
          if (/<\/?(?:button|div|span|img|svg|input|table|tbody|tr|td|p)(?:\s|>)/i.test(english)) issue(file, node, 'HTML must stay in the renderer, outside the message catalog');
          if (!namespace || catalogs[namespace]?.[keyFor(english)] !== english) issue(file, node, `Missing English catalog entry for ${namespace}: ${english}`);
        }
      }
      if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' && ['textContent', 'innerText', 'title', 'placeholder'].includes(node.left.property.name)) {
        if (!canonicalAssignments.has(`${file}#${node.left.object.name}.${node.left.property.name}`)) for (const text of literals(node.right).filter(human)) issue(file, node, `Unbound UI literal: ${text}`);
      }
      if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && node.callee.property.name === 'setAttribute' && ['title','placeholder','aria-label','data-caption','data-hover-caption'].includes(node.arguments[0]?.value)) {
        for (const text of literals(node.arguments[1]).filter(human)) issue(file, node, `Unbound UI attribute: ${text}`);
      }
    });
    for (const match of source.matchAll(/data-i18n(?:-(?:title|placeholder|aria-label|alt|caption|hover-caption|label))?=["']([a-z]+)\.([\w.-]+)["']/g)) {
      const [, ns, key] = match;
      if (key.endsWith('.')) continue; // Runtime suffix is a typed key expression.
      bindings++;
      if (catalogs[ns] && !Object.hasOwn(catalogs[ns], key)) errors.push(`${file}: Missing bound catalog key ${ns}.${key}`);
    }
  }
  const viewNamespaces = { 'home-view':'home', 'setting-view':'settings', 'biology-notebook-view':'notebook', 'assay-view':'plate', 'sequence-viewer-view':'dna', 'sequence-viewer-detail-view':'dna', 'agent-view':'agent', 'papers-view':'papers', 'workflow-management-view':'workflow', 'protocol-management-view':'protocol', 'sample-registry-view':'samples', 'lab-common-inventory-view':'chemicals', 'tool-box-view':'tools' };
  const htmlSources = fs.readdirSync(path.join(root, 'ui/html'), { recursive: true }).filter(f => f.endsWith('.html')).map(f => ['ui/html/' + f, viewNamespaces[path.basename(f, '.html')] || 'shell']);
  for (const [folder, ns] of Object.entries(plugins)) htmlSources.push([folder + '/index.html', ns]);
  htmlSources.push(['src/plugins/gel/vendor/gel-view.html','gel']);
  for (const [file, namespace] of htmlSources) {
    const remaining = [];
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of html.matchAll(/data-i18n(?:-(?:title|placeholder|aria-label|alt|caption|hover-caption|label))?=["']([a-z]+)\.([\w.-]+)["']/g)) {
      const [, ns, key] = match;
      if (!catalogs[ns] || !Object.hasOwn(catalogs[ns], key)) errors.push(file + ': Missing static catalog key ' + ns + '.' + key);
    }
    sourceMarkup(html, { namespace, keyFor, register: text => remaining.push(text) });
    if (remaining.length) errors.push(file + ': Unbound static markup: ' + [...new Set(remaining)].join(' | '));
  }
  // Third-party bundles must keep their original module format. Their own
  // language APIs are separate from Hikari's source-owned presentation layer.
  for (const folder of ['src/plugins/gel/vendor','plugins/scientific-illustration/vendor']) {
    for (const file of fs.readdirSync(path.join(root, folder), { recursive: true }).filter(f => /\.(?:js|mjs)$/.test(f))) {
      if (/i18nUi|createPresentation/.test(fs.readFileSync(path.join(root, folder, file), 'utf8'))) errors.push(folder + '/' + file + ': application translation code reached a third-party bundle');
    }
  }
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`i18n source coverage: ${sources.length} files, ${Object.keys(catalogs).length} namespaces, ${messages} source messages, ${bindings} template bindings, ${htmlSources.length} HTML fragments, and third-party bundle boundaries checked.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
