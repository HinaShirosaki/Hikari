const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifySharedWorkspaceTools({ tool, evaluate, check, win, pause, temp }) {
  const host = code => win.webContents.executeJavaScript(code);
  const read = () => tool({ action: 'read' });
  const apply = async operations => {
    const current = await read();
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save shared-tools fixture'); await pause(80);
  };
  for (let i = 0; i < 50; i++) { if (await host('document.querySelectorAll("#plugin-workspace-tools button").length===13')) break; await pause(40); }
  const viewId = await host('qaRegistry[0].viewId');
  check(await host('document.body.classList.contains("has-plugin-workspace-tools") && document.querySelectorAll("#plugin-workspace-tools button").length===13 && document.querySelectorAll("#agent-chat-rail-toggle-btn").length===1'), 'Illustration tools and the existing chat toggle occupy one host strip');
  check(await evaluate('document.body.classList.contains("has-host-tools") && document.getElementById("workspace-tools").getBoundingClientRect().width===0 && document.querySelector(".toolbar #group-selection,.toolbar #layers-tab")===null'), 'Mounted host tools release the local strip and header space');
  await apply([
    { op: 'upsert', object: { id: 'tool-cell', type: 'vector', x: 180, y: 180, width: 200, height: 160, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 160"><ellipse cx="100" cy="80" rx="98" ry="78" fill="#b6d8c8" stroke="#547966" stroke-width="3"/></svg>' } },
    { op: 'upsert', object: { id: 'tool-label', type: 'text', text: 'Cell', x: 240, y: 370, width: 90, height: 40, fontSize: 28 } }
  ]);
  const before = await read(), previews = await tool({ action: 'render', canvas: 'both' });
  check(await evaluate('(()=>{const title=document.getElementById("figure-title"),controls=document.querySelector(".canvas-controls"),toolbar=document.querySelector(".toolbar"),r=title.getBoundingClientRect(),c=controls.getBoundingClientRect();title.value="A detailed illustration of protein secretion from the endoplasmic reticulum through the Golgi to the cell surface";return controls.closest(".toolbar")===toolbar&&r.width<=288&&Math.abs(r.top+r.height/2-c.top-c.height/2)<2})()'), 'A compact rename field leaves room for canvas settings in the same header row');
  win.webContents.debugger.attach('1.3');
  const click = async selector => {
    const point = await host(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pause(100);
  };
  const clickTool = id => click(`[data-workspace-tool-id="${id}"]`);
  const expanded = () => host('document.body.classList.contains("has-agent-chat-rail-expanded")');
  try {
    await clickTool('layers-tab');
    check(await evaluate('!document.getElementById("layers-panel").hidden && document.getElementById("assets-panel").hidden'), 'Host Layers button opens the existing component editor');
    await clickTool('assets-tab');
    check(await evaluate('document.getElementById("layers-panel").hidden && !document.getElementById("assets-panel").hidden'), 'Host Assets switches the single component panel');
    await click('#agent-chat-rail-toggle-btn');
    check(await expanded() && await evaluate('document.getElementById("layer-inspector").hidden && document.getElementById("prompt-form").hidden'), 'Opening shared chat folds the tools panel and keeps the extra prompt hidden');
    await fs.writeFile(path.join(temp, 'workspace-tools-chat.png'), (await win.webContents.capturePage()).toPNG());
    await clickTool('layers-tab');
    check(!await expanded() && await evaluate('!document.getElementById("layers-panel").hidden'), 'Opening Layers folds chat and keeps only one panel open');
    await evaluate('document.querySelector("[data-layer-id=tool-label] .layer-select").click();document.getElementById("label-content").focus();document.getElementById("close-layers").click()'); await pause(100);
    check(await host('document.activeElement.dataset.workspaceToolId==="layers-tab"'), 'Closing the inspector returns keyboard focus to its host tool');
    await clickTool('freehand-tool');
    check(await evaluate('document.getElementById("selection-tool").value==="freehand"') && await host('document.querySelector("[data-workspace-tool-id=freehand-tool]").getAttribute("aria-pressed")==="true"'), 'Host selection mode reflects the editor state');
    await clickTool('pointer-tool');
    await clickTool('zoom-in'); await clickTool('zoom-fit');
    await clickTool('toggle-scratch');
    check(await evaluate('!document.getElementById("scratch-workspace").hidden'), 'Host Scratch summons the secondary canvas');
    await clickTool('toggle-scratch');
    await clickTool('add-menu');
    check(await evaluate('document.getElementById("add-menu").open && document.activeElement.id==="add-text" && (()=>{const r=document.querySelector("#add-menu .popover-panel").getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()'), 'Host Add opens a usable plugin-owned menu in bounds');
    await evaluate('document.getElementById("add-text").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))'); await pause(80);
    const menuFocus = await host('({tag:document.activeElement.tagName,id:document.activeElement.id,tool:document.activeElement.dataset.workspaceToolId})');
    check(menuFocus.tool === 'add-menu' && await evaluate('!document.getElementById("add-menu").open'), `Escape closes Add and restores focus across the frame boundary: ${JSON.stringify(menuFocus)}`);
    await evaluate('document.querySelector("[data-layer-id=tool-cell] .layer-select").click();document.querySelector("[data-layer-id=tool-label] .layer-select").dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}));document.getElementById("close-layers").click()'); await pause(80);
    await clickTool('group-selection');
    check((await read()).groups.length === 1 && await host('document.querySelector("[data-workspace-tool-id=group-selection]").disabled && !document.querySelector("[data-workspace-tool-id=ungroup-selection]").disabled'), 'Host grouping applies one edit and updates enabled actions');
    await clickTool('ungroup-selection');
    check((await read()).groups.length === 0, 'Host Ungroup preserves independent components');
    await clickTool('undo'); await clickTool('undo');
    check(JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'Host undo returns all fixture objects to their starting geometry');
    await evaluate('document.getElementById("close-layers").click()');
    for (const width of [1300, 980, 720, 480, 320]) {
      win.setSize(width, 850); await pause(100);
      check(await host('(()=>{const r=document.getElementById("universal-agent-chat-rail").getBoundingClientRect(),t=document.getElementById("plugin-workspace-tools").getBoundingClientRect(),w=document.querySelector(".workspace-main").getBoundingClientRect();return r.width<=46&&t.width<=40&&r.right<=innerWidth&&w.right<=r.left+1&&document.documentElement.scrollWidth<=innerWidth})()'), `${width}px uses one slim right strip without horizontal overflow`);
      const layout = await evaluate('(()=>{const stage=document.getElementById("main-canvas").getBoundingClientRect(),bar=document.querySelector(".toolbar").getBoundingClientRect(),status=document.getElementById("status");return {height:innerHeight,bottom:stage.bottom,stageHeight:stage.height,top:stage.top,headerBottom:bar.bottom,controlsInHeader:!!document.querySelector(".canvas-controls").closest(".toolbar"),overflow:document.documentElement.scrollWidth>innerWidth,status:status.textContent,statusHeight:status.getBoundingClientRect().height}})()');
      if (Math.abs(layout.bottom-layout.height)>=1) layout.boxes = await evaluate('Object.fromEntries(["html","body",".illustration-workspace",".workspace",".work-area",".canvas-column",".canvases",".main-stage-wrap","#prompt-form","#scratch-workspace"].map(s=>{const n=document.querySelector(s),r=n.getBoundingClientRect(),c=getComputedStyle(n);return [s,{top:r.top,bottom:r.bottom,height:r.height,display:c.display,rows:c.gridTemplateRows,flex:c.flex,padding:c.padding}]}))');
      check(!layout.overflow && layout.stageHeight>250 && layout.controlsInHeader && layout.headerBottom<=layout.top && Math.abs(layout.bottom-layout.height)<1, `${width}px keeps controls in the header and stretches the canvas workspace to the bottom: ${JSON.stringify(layout)}`);
      await evaluate('document.getElementById("canvas-size").value="custom";document.getElementById("canvas-size").dispatchEvent(new Event("change",{bubbles:true}))'); await pause(60);
      check(await evaluate('(()=>{const r=document.querySelector(".canvas-options .popover-panel").getBoundingClientRect(),bar=document.querySelector(".canvas-controls").getBoundingClientRect();return r.top>=bar.bottom&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&document.activeElement===document.getElementById("canvas-properties").elements.width})()'), `${width}px opens custom size below the top controls in bounds`);
      await evaluate('document.querySelector(".canvas-options").open=false');
      await evaluate('document.getElementById("figure-menu").open=true'); await pause(60);
      check(await evaluate('(()=>{const r=document.querySelector("#figure-menu .popover-panel").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=document.querySelector(".toolbar").getBoundingClientRect().bottom&&r.bottom<=innerHeight&&document.getElementById("image-generation-percent").getBoundingClientRect().width>60})()'), `${width}px keeps the image generation controls accessible in bounds without adding a header row`);
      await evaluate('document.getElementById("figure-menu").open=false');
      await clickTool('assets-tab');
      check(await evaluate('!document.getElementById("assets-panel").hidden'), `${width}px opens the asset panel from the host strip`);
      await clickTool('assets-tab');
    }
    await fs.writeFile(path.join(temp, 'workspace-tools-narrow.png'), (await win.webContents.capturePage()).toPNG());
    for (const width of [720, 320]) {
      win.setSize(width, 850); await pause(80);
      await click('#agent-chat-rail-toggle-btn');
      check(await expanded() && await host('(()=>{const r=document.getElementById("universal-agent-chat-rail").getBoundingClientRect(),c=document.querySelector(".universal-agent-chat-rail__content").getBoundingClientRect(),t=document.getElementById("plugin-workspace-tools").getBoundingClientRect();return c.width>0&&t.width>0&&r.bottom<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth})()'), `${width}px keeps chat and tools usable without horizontal overflow`);
      await click('#agent-chat-rail-toggle-btn');
    }
    win.setSize(1300, 1000); await pause(80);
    await fs.writeFile(path.join(temp, 'workspace-tools-main.png'), (await win.webContents.capturePage()).toPNG());
    const after = await read(), afterPreviews = await tool({ action: 'render', canvas: 'both' });
    check(JSON.stringify(after.objects) === JSON.stringify(before.objects) && JSON.stringify(after.canvases) === JSON.stringify(before.canvases), 'Toolbar and panel layout never transform saved artwork');
    check(JSON.stringify(previews.content.filter(c => c.type === 'image')) === JSON.stringify(afterPreviews.content.filter(c => c.type === 'image')), 'Agent previews stay identical across toolbar layout changes');
  } finally { win.webContents.debugger.detach(); }
  await host(`document.body.dataset.agentAvailability='disconnected';document.dispatchEvent(new CustomEvent('hikari:agent-chat-rail-availability-changed'))`); await pause(60);
  check(await host('!document.getElementById("universal-agent-chat-rail").hidden && document.querySelector("[data-workspace-tool-id=layers-tab]").getBoundingClientRect().width>0'), 'Editing tools stay available when Codex is disconnected');
  await host(`qaRegistry[0].agentChatRail=false;qaRailRuntime.syncState(${JSON.stringify(viewId)})`);
  check(await host('!document.getElementById("universal-agent-chat-rail").hidden && document.getElementById("agent-chat-rail-toggle-btn").getBoundingClientRect().width===0 && document.querySelector("[data-workspace-tool-id=layers-tab]").getBoundingClientRect().width>0'), 'Layout tools work independently of chat permission without exposing a chat toggle');
  await host('qaRegistry[0].agentChatRail=true');
  await host(`document.body.dataset.agentAvailability='connected';document.dispatchEvent(new CustomEvent('hikari:agent-chat-rail-availability-changed'));document.body.dataset.activeView='papers-view'`); await pause(80);
  check(await host('document.getElementById("plugin-workspace-tools").hidden && !document.body.classList.contains("has-plugin-workspace-tools")'), 'Illustration tools do not leak into another module');
  await host(`document.body.dataset.activeView=${JSON.stringify(viewId)}`); await pause(80);
  check(await host('document.querySelectorAll("#plugin-workspace-tools button").length===13'), 'Returning to the illustration restores one copy of each tool');
  await evaluate('location.reload()'); await pause(350);
  check(await host('document.querySelectorAll("#plugin-workspace-tools button").length===13'), 'Reload replaces the configuration without duplicate tools');
}
module.exports = { verifySharedWorkspaceTools };
