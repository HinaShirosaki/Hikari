const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyIllustrationMenu({ tool, evaluate, check, win, pause, waitFor, temp }) {
  const before = await tool({ action: 'read' }), original = before.illustration_id;
  const applied = await tool({ action: 'apply', illustration_id: original, expected_revision: before.revision, request_id: randomUUID(),
    operations: [{ op: 'upsert', object: { id: 'menu-label', type: 'text', text: 'Artwork from clicked row', x: 90, y: 90 } }] });
  check(applied.ok, applied.error || 'Save artwork in the original figure');
  const created = await tool({ action: 'create', expected_library_revision: applied.library_revision, request_id: randomUUID(), title: 'Current figure' });
  check(created.ok, created.error || 'Open a separate figure');
  const active = created.illustration_id;
  const row = id => `[data-illustration-id="${id}"]`;
  const menu = '#illustration-context-menu';
  const dialog = '#illustration-action-dialog';
  const find = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const mouse = async (selector, button) => {
    const point = await evaluate(`(() => { const rect = ${find(selector)}.getBoundingClientRect(); return { x: rect.left + Math.min(40, rect.width / 2), y: rect.top + rect.height / 2 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, ...point, button, buttons: type === 'mousePressed' ? (button === 'right' ? 2 : 1) : 0, clickCount: 1
    });
  };
  const click = selector => mouse(selector, 'left');
  const action = key => click(`${menu} [data-context-action="${key}"]`);
  const open = async id => {
    await mouse(row(id), 'right');
    await waitFor(() => evaluate(`!${find(menu)}.hidden`), 'Right-click did not open the illustration menu');
  };
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp']) await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
      type, key, code: key, windowsVirtualKeyCode: code, modifiers,
      ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {})
    });
  };
  win.webContents.debugger.attach('1.3');
  try {
    await open(original);
    check(await evaluate(`[...${find(menu)}.querySelectorAll('[role="menuitem"]')].map(button => button.dataset.contextAction).join(',') === 'export,duplicate,rename,delete'`), 'The row menu shows the four illustration actions');
    check((await tool({ action: 'list' })).active_illustration_id === active, 'Right-clicking an inactive row leaves the current figure open');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(temp, 'illustration-row-menu.png'), (await win.webContents.capturePage()).toPNG());
    await key('Escape', 27);
    check(await evaluate(`${find(menu)}.hidden && document.activeElement === ${find(row(original))}`), 'Escape returns focus to the clicked row');
    await key('F10', 121, 8);
    check(await evaluate(`!${find(menu)}.hidden && document.activeElement.dataset.contextAction === 'export'`), 'Shift+F10 opens the row menu for keyboard navigation');
    await key('ArrowDown', 40); await key('ArrowDown', 40); await key('Enter', 13);
    await waitFor(() => evaluate(`${find(dialog)}.open && document.activeElement.id === 'illustration-new-name'`), 'Rename did not focus the name field');
    await evaluate('document.getElementById("illustration-new-name").value = "Renamed menu figure"');
    await key('Enter', 13);
    await waitFor(() => evaluate(`!${find(dialog)}.open`), 'Enter did not save the new name');
    let library = await tool({ action: 'list' });
    check(library.active_illustration_id === active && library.illustrations.find(item => item.id === original)?.title === 'Renamed menu figure', 'Rename edits the clicked figure while keeping the current one open');

    for (const [format, signature] of [['svg', /Artwork from clicked row/], ['png', /^\x89PNG/], ['pptx', /^PK/]]) {
      await open(original); await action('export');
      await waitFor(() => evaluate(`${find(dialog)}.open && document.getElementById('illustration-action-name').textContent === 'Renamed menu figure'`), 'Export did not display the clicked figure');
      await click(`${dialog} button[value="${format}"]`);
      await waitFor(() => evaluate(`document.getElementById('status').textContent === 'Exported ${format.toUpperCase()}'`), `The row did not export ${format}`);
      const data = await fs.readFile(path.join(temp, `Renamed_menu_figure.${format}`));
      check(signature.test(data.toString('latin1')), `The real save flow exports the clicked illustration as ${format}`);
    }
    check((await tool({ action: 'list' })).active_illustration_id === active, 'Exporting from the row leaves the current figure open');
    await open(original); await action('duplicate');
    await waitFor(async () => (await tool({ action: 'list' })).active_illustration_id !== active, 'Duplicate did not open the copy');
    const copy = await tool({ action: 'read' });
    check(copy.illustration_id !== original && copy.title === 'Renamed menu figure copy' && copy.objects[0]?.text === 'Artwork from clicked row', 'Duplicate opens a separate editable copy of the clicked figure');

    await open(original); await action('delete');
    await waitFor(() => evaluate(`${find(dialog)}.open && document.activeElement.id === 'cancel-illustration-action'`), 'Delete did not focus Cancel');
    await click('#cancel-illustration-action');
    check((await tool({ action: 'list' })).illustrations.some(item => item.id === original), 'Cancel leaves the illustration in the library');
    await open(original); await action('delete'); await pause(30);
    await click(`${dialog} button[data-illustration-task="delete"]`);
    await waitFor(() => evaluate(`!${find(dialog)}.open`), 'The delete dialog did not finish');
    library = await tool({ action: 'list' });
    check(library.active_illustration_id === copy.illustration_id && !library.illustrations.some(item => item.id === original), 'Delete removes only the confirmed row');
    await open(copy.illustration_id); await action('delete'); await pause(30);
    await click(`${dialog} button[data-illustration-task="delete"]`);
    await waitFor(() => evaluate(`!${find(dialog)}.open`), 'Deleting the open copy did not finish');
    check((await tool({ action: 'list' })).active_illustration_id === active, 'Deleting the active illustration opens the neighboring row');
  } finally { win.webContents.debugger.detach(); }
}

async function verifyLibraryNavigation({ tool, evaluate, check, win, pause, waitFor, temp }) {
  await verifyIllustrationMenu({ tool, evaluate, check, win, pause, waitFor, temp });
  const created = await evaluate(`(async () => {
    const results = [];
    for (let i = 1; i <= 26; i++) results.push(await illustrationWorkspace.manage('create', undefined, 'Navigation figure '+i));
    return results.every(result => result.ok);
  })()`);
  check(created, 'Create a scrollable library in temporary storage');
  win.setSize(1300, 650); await pause(80);
  const railLayout = () => evaluate(`(() => {
    const rail=document.getElementById('illustrations-rail'),list=document.getElementById('illustrations'),pinned=rail.querySelector('.left-rail-template__pinned');
    const box=node=>{const b=node.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom}};
    return {rail:box(rail),list:box(list),pinned:box(pinned),borderRight:parseFloat(getComputedStyle(rail).borderRightWidth),borderBottom:parseFloat(getComputedStyle(rail).borderBottomWidth),
      scrolling:list.scrollHeight>list.clientHeight,listScroll:list.scrollTop,railScroll:rail.scrollTop,gutter:getComputedStyle(list).scrollbarGutter};
  })()`);
  check(await evaluate('!document.getElementById("illustration-count")'), 'The rail has no illustration-count footer');
  const initialLayout = await railLayout();
  check(initialLayout.scrolling && Math.abs(initialLayout.list.right+initialLayout.borderRight-initialLayout.rail.right)<1
    && Math.abs(initialLayout.list.bottom-initialLayout.rail.bottom)<1 && initialLayout.gutter==='stable', 'The list fills the rail to its border and reserves its scrollbar at the outer edge');
  await evaluate('document.getElementById("illustrations").scrollTop=200');
  const scrolledLayout = await railLayout();
  check(scrolledLayout.listScroll>0 && scrolledLayout.railScroll===0 && scrolledLayout.pinned.top===initialLayout.pinned.top
    && scrolledLayout.pinned.bottom===initialLayout.pinned.bottom, 'Scrolling illustrations keeps the heading and search pinned');
  const clickVisibleRow = async () => {
    const target = await evaluate(`(() => {
      const list=document.getElementById('illustrations');
      list.scrollTop=(list.scrollHeight-list.clientHeight)*0.65;
      const bounds=list.getBoundingClientRect();
      const button=[...list.children].find(row=>{
        const rect=row.getBoundingClientRect();
        return row.getAttribute('aria-pressed')!=='true' && rect.top>=bounds.top && rect.bottom<=bounds.bottom;
      });
      if(!button) throw new Error('No visible illustration to select');
      button.focus({preventScroll:true});
      const before=list.scrollTop,id=button.dataset.illustrationId;
      button.click();return {before,id};
    })()`);
    check(target.before > 100, 'Select a figure after scrolling beyond the first rows');
    await waitFor(async () => (await tool({ action: 'list' })).active_illustration_id === target.id, 'The clicked illustration did not open');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return target;
  };
  const selected = await clickVisibleRow();
  const position = await evaluate('document.getElementById("illustrations").scrollTop');
  check(Math.abs(position - selected.before) < 1, `Opening a scrolled illustration preserves navigation position (${selected.before} → ${position})`);
  check(await evaluate(`document.activeElement?.dataset.illustrationId===${JSON.stringify(selected.id)} && document.activeElement.getAttribute('aria-pressed')==='true'`), 'Selection retains keyboard focus on the active illustration');
  const current = await tool({ action: 'read' });
  const edited = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: randomUUID(), operations: [{ op: 'title', title: 'Renamed navigation figure' }] });
  check(edited.ok, edited.error || 'Rename the selected illustration');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  check(Math.abs(await evaluate('document.getElementById("illustrations").scrollTop') - selected.before) < 1, 'Saving the selected figure also preserves navigation position');
  await evaluate('document.getElementById("illustration-search").value="navigation figure";document.getElementById("illustration-search").dispatchEvent(new Event("input"))');
  check(await evaluate('document.getElementById("illustrations").scrollTop===0'), 'Changing the search starts at the first matching illustration');
  const filtered = await clickVisibleRow();
  check(await evaluate('document.getElementById("illustration-search").value==="navigation figure"'), 'Opening a filtered illustration preserves the search');
  check(Math.abs(await evaluate('document.getElementById("illustrations").scrollTop') - filtered.before) < 1, 'Selection preserves scroll within filtered results');
  for (const width of [480, 320]) {
    win.setSize(width, 800); await pause(80);
    const layout = await railLayout();
    check(layout.scrolling && Math.abs(layout.list.right-layout.rail.right)<1
      && Math.abs(layout.list.bottom+layout.borderBottom-layout.rail.bottom)<1
      && layout.list.top>=layout.pinned.bottom && await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    `${width}px keeps the list scrollbar at the rail edge beneath pinned controls`);
  }
}

module.exports = { verifyLibraryNavigation };
