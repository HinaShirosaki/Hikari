const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function verifyImageGenerationPreference({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read' });
  const before = await read();
  const waitForPercent = async percent => {
    for (let i = 0; i < 80; i++) {
      const current = await read();
      if (current.imageGenerationPercent === percent) return current;
      await pause(40);
    }
    throw new Error(`Image generation preference did not save: ${percent}`);
  };
  check(before.imageGenerationPercent === null && await evaluate('!document.getElementById("image-generation-enabled").checked && document.getElementById("image-generation-percent").disabled && document.getElementById("image-generation-value").textContent==="Auto"'), 'Existing default remains Automatic SVG-first with a disabled percentage slider');
  await evaluate('document.getElementById("figure-menu").open=true;document.getElementById("image-generation-enabled").click();document.getElementById("image-generation-percent").value="77";document.getElementById("image-generation-percent").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("image-generation-percent").dispatchEvent(new Event("change",{bubbles:true}))');
  const changed = await waitForPercent(75);
  check(await evaluate('document.getElementById("figure-menu").open && document.getElementById("image-generation-enabled").checked && !document.getElementById("image-generation-percent").disabled && document.getElementById("image-generation-value").textContent==="75%" && document.getElementById("image-generation-percent").step==="25" && document.getElementById("status").textContent===""'), 'Slider snaps 77 to 75 in quarter steps and saves rapid changes without closing the menu');
  check(changed.agent_contract.instructions.includes('Image generation target: 75%') && changed.agent_contract.instructions.includes('always remain separate SVG or text objects, even at 100%'), 'Actual MCP read supplies the snapped user target and mandatory SVG geometry rules');
  win.webContents.debugger.attach('1.3');
  try {
    await evaluate('document.getElementById("image-generation-percent").focus()');
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type, key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
  } finally { win.webContents.debugger.detach(); }
  await waitForPercent(50);
  check(await evaluate('document.getElementById("image-generation-value").textContent==="50%"'), 'A native arrow-key adjustment moves exactly one quarter step');
  check(await evaluate('document.getElementById("image-generation-summary").textContent==="Balanced"'), 'The selected step has a clear user-facing renderer description');
  await evaluate('location.reload()'); await pause(350);
  check((await read()).imageGenerationPercent === 50 && await evaluate('document.getElementById("image-generation-percent").value==="50" && document.getElementById("image-generation-enabled").checked'), 'Saved stepped target restores in the actual installed plugin after reload');
  await evaluate('document.getElementById("image-generation-percent").value="0";document.getElementById("image-generation-percent").dispatchEvent(new Event("change",{bubbles:true}))');
  const zero = await waitForPercent(0);
  check(zero.agent_contract.instructions.includes('Do not call image_gen') && await evaluate('document.getElementById("image-generation-value").textContent==="0%"'), 'Zero is preserved as a target and disables new generation in the contract');
  check((await tool({ action: 'apply', illustration_id: zero.illustration_id, expected_revision: zero.revision,
    request_id: randomUUID(), operations: [{ op: 'image_generation', imageGenerationPercent: 100 }] })).ok, 'Agent can adjust the percentage through its public operation');
  await pause(80);
  check(await evaluate('document.getElementById("image-generation-percent").value==="100" && document.getElementById("image-generation-value").textContent==="100%"'), 'Agent preference edits update the same user controls');
  for (const [percent, label] of [[25, 'Mostly SVG'], [50, 'Balanced'], [75, 'Mostly image generation'], [100, 'All eligible artwork']]) {
    await evaluate(`document.getElementById("image-generation-percent").value=${JSON.stringify(String(percent))};document.getElementById("image-generation-percent").dispatchEvent(new Event("change",{bubbles:true}))`);
    const current = await waitForPercent(percent);
    check(current.agent_contract.instructions.includes(`(${label})`) && await evaluate(`document.getElementById("image-generation-summary").textContent===${JSON.stringify(label)}`), `${percent}% exposes the same explicit preset guidance to the user and agent`);
  }
  await evaluate('document.getElementById("figure-menu").open=true'); await pause(60);
  await fs.writeFile(path.join(temp, 'image-generation-settings.png'), (await win.webContents.capturePage()).toPNG());
  const existing = await read();
  check((await tool({ action: 'apply', illustration_id: existing.illustration_id, expected_revision: existing.revision,
    request_id: randomUUID(), operations: [{ op: 'image_generation', imageGenerationPercent: 77 }] })).ok, 'Existing custom percentages remain supported by the agent API');
  await pause(80);
  check((await read()).imageGenerationPercent === 77 && await evaluate('document.getElementById("image-generation-percent").dataset.percent==="77" && document.getElementById("image-generation-value").textContent==="77%" && document.getElementById("image-generation-summary").textContent==="Custom target · 77%"'), 'Displaying a stepped slider preserves custom saved targets until the user adjusts it');
  await evaluate('document.getElementById("image-generation-enabled").click()');
  const automatic = await waitForPercent(null);
  check(await evaluate('document.getElementById("image-generation-percent").disabled && document.getElementById("image-generation-value").textContent==="Auto"'), 'Switching off the target returns to Automatic');
  check(JSON.stringify(automatic.objects) === JSON.stringify(before.objects) && JSON.stringify(automatic.canvases) === JSON.stringify(before.canvases), 'Changing rendering preferences never transforms existing artwork or canvas dimensions');
  const waitForStyle = async (preset, prompt) => {
    for (let i = 0; i < 100; i++) {
      const current = await read();
      if (current.imageGenerationStyle.preset === preset && current.imageGenerationStyle.prompt === prompt) return current;
      await pause(40);
    }
    throw new Error(`Image style did not save: ${preset}`);
  };
  check(await evaluate('document.getElementById("image-generation-style").value==="automatic" && document.getElementById("image-generation-style").options.length===7 && document.getElementById("image-generation-style-prompt").value===""'), 'Image style defaults to Automatic with seven available presets and optional notes');
  await evaluate('document.getElementById("image-generation-style").value="3d";document.getElementById("image-generation-style").dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("image-generation-style-prompt").value="Teal and warm gold; soft upper-left lighting ";document.getElementById("image-generation-style-prompt").dispatchEvent(new Event("input",{bubbles:true}))');
  const styled = await waitForStyle('3d', 'Teal and warm gold; soft upper-left lighting ');
  check(styled.imageGenerationPercent === null && styled.agent_contract.instructions.includes('Image generation style: 3D render') && styled.agent_contract.instructions.includes('Teal and warm gold; soft upper-left lighting') && styled.agent_contract.instructions.includes('explicitly in every image_gen prompt'), 'Debounced style notes reach the actual agent contract without enabling a percentage target or losing typed spaces');
  await evaluate('location.reload()'); await pause(350);
  check((await read()).imageGenerationStyle.preset === '3d' && await evaluate('document.getElementById("image-generation-style").value==="3d" && document.getElementById("image-generation-style-prompt").value==="Teal and warm gold; soft upper-left lighting "'), 'The installed plugin restores its saved style and notes after reload');
  await evaluate('document.getElementById("figure-menu").open=true;document.getElementById("image-generation-style").value="watercolor";document.getElementById("image-generation-style").dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("image-generation-style-prompt").value="Pale blue washes";document.getElementById("image-generation-style-prompt").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("image-generation-style").value="ink";document.getElementById("image-generation-style").dispatchEvent(new Event("change",{bubbles:true}))');
  const ink = await waitForStyle('ink', 'Pale blue washes');
  check(ink.agent_contract.instructions.includes('Image generation style: Pen and ink') && JSON.stringify(ink.objects) === JSON.stringify(before.objects), 'Rapid preset and notes edits persist together while existing artwork stays unchanged');
  for (const [width, height] of [[1300, 1000], [480, 600], [320, 480]]) {
    win.setSize(width, height); await pause(80);
    const bounds = await evaluate('(()=>{const p=document.querySelector("#figure-menu .popover-panel"),r=p.getBoundingClientRect(),s=document.getElementById("image-generation-style").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,styleLeft:s.left,styleRight:s.right,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}})()');
    check(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height && bounds.styleLeft >= bounds.left && bounds.styleRight <= bounds.right && bounds.scrollWidth <= bounds.width, `${width}px image style menu stays within the viewport: ${JSON.stringify(bounds)}`);
    if (width === 1300) await fs.writeFile(path.join(temp, 'image-generation-style.png'), (await win.webContents.capturePage()).toPNG());
  }
  win.setSize(1300, 1000); await pause(80);
  await evaluate('document.getElementById("image-generation-style-prompt").value="Freshly typed before blur";document.getElementById("image-generation-style-prompt").dispatchEvent(new Event("input",{bubbles:true}));document.getElementById("image-generation-style-prompt").dispatchEvent(new Event("change",{bubbles:true}))');
  check((await waitForStyle('ink', 'Freshly typed before blur')).illustration_id === before.illustration_id, 'Leaving the notes field flushes the debounce into its originating figure');
  await evaluate('document.getElementById("image-generation-style").value="automatic";document.getElementById("image-generation-style-prompt").value="";document.getElementById("image-generation-style").dispatchEvent(new Event("change",{bubbles:true}))');
  await waitForStyle('automatic', '');
  await evaluate('document.getElementById("figure-menu").open=false');
}
module.exports = { verifyImageGenerationPreference };
