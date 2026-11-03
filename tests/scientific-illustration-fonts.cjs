const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySystemFonts({ tool, evaluate, check, win, pause, temp }) {
  const families = await win.webContents.executeJavaScript('queryLocalFonts().then(fonts=>[...new Set(fonts.map(font=>font.family.trim()).filter(name=>name&&name.length<=100))])');
  check(families.length > 7, `The real host enumerates installed font families (${families.length}) without a user gesture`);
  const suggestions = () => evaluate('[...document.getElementById("fonts").options].map(option=>option.value)');
  for (let i = 0; i < 100; i += 1) {
    if ((await suggestions()).length >= families.length) break;
    await pause(30);
  }
  const names = await suggestions();
  check(families.every(family => names.some(name => name.toLowerCase() === family.toLowerCase())), 'Figura suggests every installed family, beyond the original seven fonts');
  check(names.includes('Inter'), 'Bundled Inter remains available alongside system fonts');
  check(new Set(names.map(name => name.toLowerCase())).size === names.length, 'Font faces are deduplicated by family');
  const framePermission = await evaluate('navigator.permissions.query({name:"local-fonts"}).then(result=>result.state)');
  check(framePermission === 'denied', 'The plugin itself has no raw font enumeration permission');
  const family = families.find(name => !['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Verdana', 'Courier New'].includes(name));
  const current = await tool({ action: 'read' });
  const id = 'system-font-label';
  const applied = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: randomUUID(), operations: [{ op: 'upsert', object: { id, type: 'text', text: 'System font label',
      x: 180, y: 180, width: 420, height: 100, fontSize: 32, fontFamily: 'Inter' } }] });
  check(applied.ok, applied.error || 'Font fixture saved');
  await evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').click()`);
  await evaluate(`(()=>{const input=document.getElementById('text-font');input.focus();input.value=${JSON.stringify(family)};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let saved;
  for (let i = 0; i < 100; i += 1) {
    saved = (await tool({ action: 'read' })).objects.find(object => object.id === id);
    if (saved.fontFamily === family) break;
    await pause(30);
  }
  check(saved.fontFamily === family, 'Choosing a discovered system family persists it in the illustration');
  check(await evaluate(`document.querySelector('#main-canvas [data-object-id="${id}"] text').getAttribute('font-family')===${JSON.stringify(family)}`), 'The canvas applies the selected family');
  await evaluate(`document.querySelector('[data-layer-id="${id}"] .layer-select').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
  check(await evaluate(`getComputedStyle(document.getElementById('canvas-text-editor')).fontFamily.includes(${JSON.stringify(family)})`), 'Inline editing uses the same selected system font');
  await evaluate('document.getElementById("canvas-text-editor").blur()');
  await fs.writeFile(path.join(temp, 'system-font-picker.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, 'system-fonts.json'), JSON.stringify({ families, suggestions: names, selected: family }, null, 2));
}

module.exports = { verifySystemFonts };
