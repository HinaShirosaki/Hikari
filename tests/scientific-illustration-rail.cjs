const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyRailFolding({ tool, evaluate, check, win, pause, temp, reloadPlugin }) {
  const info = () => evaluate('HikariPlugin.hikari.call("app.info")');
  const fold = async folded => {
    const result = await evaluate(`HikariPlugin.hikari.call('app.setLeftRailFolded',{folded:${folded}})`);
    await pause(80); return result.leftRail;
  };
  const measure = () => evaluate(`(() => {
    const rail=document.getElementById('illustrations-rail'),toggle=document.getElementById('toggle-illustrations');
    return {hidden:rail.hidden,inert:rail.inert,width:rail.getBoundingClientRect().width,
      canvasWidth:document.getElementById('main-canvas').getBoundingClientRect().width,
      expanded:toggle.getAttribute('aria-expanded'),label:toggle.getAttribute('aria-label'),
      toggleHidden:toggle.hidden,dividerHidden:document.querySelector('.app-left-rail-handle').hidden};
  })()`);
  const before = await tool({ action: 'read' }), previews = await tool({ action: 'render', canvas: 'both' }), expanded = await measure();
  check((await info()).layout.leftRail.foldable && !expanded.toggleHidden && expanded.expanded === 'true', 'Host advertises folding and the plugin exposes its accessible toggle');
  await evaluate('document.getElementById("illustration-search").focus()');
  await fold(true);
  const collapsed = await measure();
  check(collapsed.hidden && collapsed.inert && collapsed.dividerHidden && collapsed.expanded === 'false' && collapsed.label === 'Show illustrations', 'Folding removes navigation and divider from interaction while keeping a reopen control');
  check(Math.abs(collapsed.canvasWidth - expanded.canvasWidth - expanded.width) < 1, 'The canvas receives all space released by the navigation rail');
  check(await evaluate('document.activeElement===document.getElementById("toggle-illustrations")'), 'Folding externally moves focus out of the hidden rail to its toggle');
  const after = await tool({ action: 'read' }), foldedPreviews = await tool({ action: 'render', canvas: 'both' });
  check(before.revision === after.revision && JSON.stringify(before.objects) === JSON.stringify(after.objects)
    && JSON.stringify(before.canvases) === JSON.stringify(after.canvases), 'Folding leaves saved figure geometry and revision unchanged');
  check(JSON.stringify(previews.content.filter(item => item.type === 'image')) === JSON.stringify(foldedPreviews.content.filter(item => item.type === 'image')), 'Agent images of both canvases remain byte-identical after folding');
  await fs.writeFile(path.join(temp, 'rail-folded.png'), (await win.webContents.capturePage()).toPNG());
  await evaluate('HikariPlugin.hikari.call("app.setLeftRailWidth",{width:336})'); await pause(80);
  check((await info()).layout.leftRail.width === 336 && (await measure()).hidden, 'Expanded width can change while folded without opening the rail');
  await fold(false);
  check((await measure()).width === 336 && !(await measure()).inert, 'Reopening restores the saved expanded width and navigation controls');
  // Real mouse and keyboard activation keep the same toggle usable in both states.
  win.webContents.debugger.attach('1.3');
  try {
    const point = await evaluate('(()=>{const r=document.getElementById("toggle-illustrations").getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()');
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    await pause(80);
    check((await measure()).hidden && await evaluate('document.activeElement.id==="toggle-illustrations"'), 'A real pointer click folds the rail and retains keyboard focus');
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
      ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {})
    });
    await pause(80);
    check(!(await measure()).hidden && (await info()).layout.leftRail.folded === false,
      `Enter reopens the navigation rail through the host API: ${JSON.stringify(await measure())}`);
  } finally { win.webContents.debugger.detach(); }
  await fold(true); await reloadPlugin();
  check((await measure()).hidden && (await info()).layout.leftRail.folded, 'Plugin reload restores Hikari\'s saved folded state');
  check(await win.webContents.executeJavaScript('localStorage.getItem("hikari_plugin_left_rail_folded_v1:scientific-illustration")==="true"'), 'The folded preference is persisted in Hikari rather than plugin figure storage');
  // An older host does not advertise folding. Its plugin keeps a normal rail.
  const currentInfo = await info();
  await win.webContents.executeJavaScript(`qaBridge.broadcast('app.context',${JSON.stringify({ ...currentInfo, layout: { ...currentInfo.layout, leftRail: { ...currentInfo.layout.leftRail, foldable: false } } })})`); await pause(80);
  check((await measure()).toggleHidden && !(await measure()).hidden, 'Without host folding support the rail remains usable and its toggle is hidden');
  await win.webContents.executeJavaScript('qaBridge.broadcastAppContext("layout")'); await pause(80);
  check((await measure()).hidden && !(await measure()).toggleHidden, 'Host context restores the plugin rail preference');
  for (const width of [480, 320]) {
    win.setSize(width, 800); await pause(80); await fold(false);
    check(await evaluate('document.getElementById("illustrations-rail").getBoundingClientRect().bottom<=document.querySelector(".workspace").getBoundingClientRect().top'), `${width}px expanded navigation stacks above the canvas`);
    const top = await evaluate('document.querySelector(".workspace").getBoundingClientRect().top');
    await evaluate('document.getElementById("toggle-illustrations").click()'); await pause(80);
    check((await measure()).hidden && await evaluate(`document.querySelector('.workspace').getBoundingClientRect().top<${top} && document.documentElement.scrollWidth<=innerWidth`), `${width}px folded navigation releases space without horizontal overflow`);
    check(await evaluate('(()=>{const r=document.getElementById("toggle-illustrations").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>0})()'), `${width}px keeps the reopen button reachable`);
  }
  win.setSize(1300, 1000); await pause(80); await fold(false);
  await evaluate('HikariPlugin.hikari.call("app.setLeftRailWidth",{width:280})'); await pause(80);
  await fs.writeFile(path.join(temp, 'rail-expanded.png'), (await win.webContents.capturePage()).toPNG());
  await fs.writeFile(path.join(temp, 'rail-folding.json'), JSON.stringify({ expanded, collapsed, unchangedRevision: before.revision === after.revision, unchangedPreviews: true }, null, 2));
}

module.exports = { verifyRailFolding };
