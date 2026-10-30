// Source-template audit/extraction primitive. Expressions are opaque, and only
// UI text and the explicit text-attribute allowlist are eligible for bindings.
const ATTRIBUTES = ['title','placeholder','aria-label','alt','data-caption','data-hover-caption','label'];
const opaque = /\uE000(\d+)\uE001/g;
const human = value => /[A-Za-z]{3}/.test(value) && !/^[A-Z_\d]{2,12}$|^(?:[munpfkM]?(?:g|L|mol|M)|aa|bp|kDa|Da|px|pt)$/.test(value) && !/^(?:https?:|data:|[./])/.test(value) && !['Hikari','Codex','OpenAI','Plotly','Tabulator','GenBank','CropperJS'].includes(value);
const decode = text => text.replace(/&(?:amp|lt|gt|quot|apos|nbsp|rarr|#\d+|#x[0-9a-f]+);/gi, token => ({ '&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':'\u00a0','&rarr;':'→' }[token] ?? String.fromCodePoint(parseInt(token.slice(token[2]?.toLowerCase() === 'x' ? 3 : 2, -1), token[2]?.toLowerCase() === 'x' ? 16 : 10))));
function sourceMarkup(body, { namespace, expressions = [], register, keyFor, escapedExpression = value => value }) {
  const patches = [], stack = [];
  const message = text => { register(text); return `i18nUi.html(${JSON.stringify(text)})`; };
  const tokens = /<!--[\s\S]*?-->|<(?:[^"'<>]|"[^"]*"|'[^']*')*>|[^<]+/g;
  let token;
  while ((token = tokens.exec(body))) {
    const raw = token[0], start = token.index;
    if (raw.startsWith('<!--')) continue;
    if (raw.startsWith('<')) {
      const match = raw.match(/^<(\/)?([\w-]+)/); if (!match) continue;
      const [,closing,tagName] = match, tag = tagName.toLowerCase();
      if (closing) { const index = stack.map(n => n.tag).lastIndexOf(tag); if (index >= 0) stack.length = index; continue; }
      const skip = stack.some(n => n.skip) || ['script','style','svg','pre','code','textarea'].includes(tag) || /\bcontenteditable\b/.test(raw);
      const node = { tag, skip, bound: /\bdata-i18n(?:-parts)?=/.test(raw), start, end: start + raw.length, raw };
      if (!skip) {
        for (const attr of ATTRIBUTES) {
          if (attr === 'label' && tag !== 'optgroup') continue;
          const binding = 'data-i18n-' + attr.replace(/^data-/, '');
          if (raw.includes(binding + '=') || [...raw.matchAll(opaque)].some(m => /Attributes\(|attributeMessage\(|i18nUi\.attribute\(/.test(expressions[Number(m[1])] || ''))) continue;
          const re = new RegExp(`\\b${attr}=(['"])(.*?)\\1`, 's'), attribute = re.exec(raw);
          if (!attribute) continue;
          const content = decode(attribute[2]);
          if (!human(content.replace(opaque, '').trim())) continue;
          if (content.includes('\uE000')) {
            let index = 0; const params = [];
            const english = content.replace(opaque, (_match, number) => { const name = 'p' + index++; params.push(name + ': ' + escapedExpression(expressions[Number(number)])); return '{' + name + '}'; });
            register(english);
            patches.push([start + attribute.index, start + attribute.index + attribute[0].length, '${i18nUi.attributeMessage(' + JSON.stringify(attr) + ', i18nUi.message(' + JSON.stringify(english) + ', { ' + params.join(', ') + ' }))}']);
          } else {
            register(content);
            const at = node.end - (raw.endsWith('/>') ? 2 : 1);
            patches.push([at,at,` ${binding}="${namespace}.${keyFor(content)}"`]);
          }
        }
      }
      if (!/\/\s*>$/.test(raw) && !['input','img','br','hr','meta','link','path','use','source','col','wbr'].includes(tag)) stack.push(node);
      continue;
    }
    const parent = stack.at(-1);
    if (!parent || parent.skip || parent.bound) continue;
    if (parent.tag === 'option') {
      if (!/\bvalue=/.test(parent.raw) || raw.includes('\uE000')) continue;
      const text = decode(raw.trim()); if (!human(text)) continue;
      register(text);
      patches.push([parent.end - 1,parent.end - 1,` data-i18n="${namespace}.${keyFor(text)}"`]);
      continue;
    }
    let cursor = 0;
    for (const match of raw.matchAll(opaque)) {
      addText(raw.slice(cursor,match.index), start + cursor);
      cursor = match.index + match[0].length;
    }
    addText(raw.slice(cursor), start + cursor);
  }
  function addText(raw, start) {
    const body = raw.trim(); if (!human(decode(body))) return;
    const lead = raw.slice(0, raw.length - raw.trimStart().length), tail = raw.slice(raw.trimEnd().length);
    patches.push([start,start + raw.length,lead + '${' + message(decode(body)) + '}' + tail]);
  }
  let result = body;
  for (const [a,b,text] of patches.sort((a,b) => b[0]-a[0])) result = result.slice(0,a) + text + result.slice(b);
  return { body: result, count: patches.length };
}
module.exports = { sourceMarkup, human };
