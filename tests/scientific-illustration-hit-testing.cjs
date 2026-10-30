const { randomUUID } = require('node:crypto');

async function verifyArtworkHitTesting({ tool, evaluate, check, win, pause }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const original = await read();
  const created = await tool({ action: 'create', title: 'Transparent pixel selection QA',
    expected_library_revision: original.library_revision, request_id: randomUUID() });
  check(created.ok, created.error || 'Create an isolated hit-testing figure');
  const apply = async operations => {
    const current = await read();
    await tool({ action: 'asset_list' });
    const result = await tool({ action: 'apply', illustration_id: current.illustration_id,
      expected_revision: current.revision, request_id: randomUUID(), operations });
    check(result.ok, result.error || 'Save hit-testing fixture');
    await pause(100);
    return result;
  };
  const raster = await evaluate(`(() => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
    const context=canvas.getContext('2d');context.fillStyle='#6699bb';context.fillRect(20,20,60,60);
    context.clearRect(40,40,20,20);context.clearRect(25,25,5,5);
    context.fillStyle='rgba(0,0,0,0.02)';context.fillRect(25,25,5,5);
    // Visible corner pixels prevent the agent's normal outer-alpha trim.
    context.fillRect(0,0,1,1);context.fillRect(99,99,1,1);
    return canvas.toDataURL();
  })()`);
  const solid = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#dda066"/></svg>';
  const hollow = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#6699bb" fill-rule="evenodd" d="M20 20H80V80H20Z M40 40H60V60H40Z"/></svg>';
  await apply([
    { op: 'canvas', canvas: 'main', patch: { width: 800, height: 600 } },
    { op: 'upsert', object: { id: 'hit-back', type: 'vector', x: 100, y: 100, width: 200, height: 200, svg: solid } },
    { op: 'upsert', object: { id: 'hit-front', type: 'raster', x: 100, y: 100, width: 200, height: 200, dataUrl: raster, textFree: true } }
  ]);
  await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
  const selected = () => evaluate('[...document.querySelectorAll("#main-canvas [data-object-id][aria-pressed=true]")].map(node=>node.dataset.objectId).sort()');
  const screen = (id, x, y) => evaluate(`(() => {
    const node=document.querySelector('#main-canvas [data-object-id="${id}"]');
    const point=new DOMPoint(${x},${y}).matrixTransform(node.getScreenCTM());return {x:point.x,y:point.y};
  })()`);
  win.webContents.debugger.attach('1.3');
  const mouse = async (type, point, button = 'left', modifiers = 0) => {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point,
      button: type === 'mouseMoved' ? 'none' : button,
      buttons: type === 'mousePressed' ? button === 'right' ? 2 : 1 : 0, modifiers,
      clickCount: type === 'mouseMoved' ? 0 : 1 });
    await pause(25);
  };
  const click = async (x, y, expected, message, button = 'left', modifiers = 0) => {
    const point = await screen('hit-front', x, y);
    await mouse('mouseMoved', point);
    await mouse('mousePressed', point, button, modifiers);
    await mouse('mouseReleased', point, button, modifiers);
    const actual = await selected();
    check(JSON.stringify(actual) === JSON.stringify(expected), `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    if (button === 'right') await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  };
  try {
    await click(60, 65, ['hit-front'], 'Opaque raster pixels select the foreground component');
    await click(100, 100, ['hit-back'], 'An internal transparent raster hole selects the component underneath');
    await click(10, 75, ['hit-back'], 'Transparent outer padding passes through to the component underneath');
    await click(54, 54, ['hit-front'], 'Faint nonzero-alpha pixels remain selectable');
    await click(100, 100, ['hit-back'], 'Transparent pixels in an already selected raster still pass through');
    await click(60, 65, ['hit-front'], 'Foreground can be reselected normally');
    await click(100, 100, ['hit-back', 'hit-front'], 'Shift-click uses visible underlying pixels', 'left', 8);
    await click(10, 75, ['hit-back', 'hit-front'], 'Right-click through transparent padding retains selected underlying members', 'right');
    // A selected background keeps the existing selection when right-clicking
    // empty space, so first clear it before testing an unselected menu target.
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await click(100, 100, ['hit-back'], 'Right-click resolves the visible component under a transparent hole', 'right');

    const before = await read(), start = await screen('hit-front', 100, 100);
    await mouse('mousePressed', start);
    await mouse('mouseMoved', { x: start.x + 18, y: start.y + 12 });
    await mouse('mouseReleased', { x: start.x + 18, y: start.y + 12 });
    await pause(100);
    const after = await read();
    check(after.objects.find(object => object.id === 'hit-back').x > before.objects.find(object => object.id === 'hit-back').x
      && JSON.stringify(after.objects.find(object => object.id === 'hit-front')) === JSON.stringify(before.objects.find(object => object.id === 'hit-front')),
    'Dragging through a transparent hole moves only the visible underlying component');

    await apply([{ op: 'update', id: 'hit-back', patch: { x: 100, y: 100 } },
      { op: 'update', id: 'hit-front', patch: { rotation: 37 } }]);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));document.getElementById("zoom-in").click()');
    await click(100, 100, ['hit-back'], 'Raster holes pass through after rotation and zoom');
    await click(60, 65, ['hit-front'], 'Painted raster pixels remain accurate after rotation and zoom');

    await apply([{ op: 'upsert', object: { id: 'hit-front', type: 'vector', x: 100, y: 100, width: 200, height: 200, svg: hollow } }]);
    await click(100, 100, ['hit-back'], 'Vector holes pass through to visible artwork underneath');
    await click(60, 65, ['hit-front'], 'Painted vector regions remain selectable');
    await click(10, 75, ['hit-back'], 'Empty vector padding passes through');
    const masked = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><mask id="cutout"><rect width="100" height="100" fill="white"/><rect x="40" y="40" width="20" height="20" fill="black"/></mask></defs><rect width="100" height="100" fill="#6699bb" mask="url(#cutout)"/></svg>';
    await apply([{ op: 'update', id: 'hit-front', patch: { svg: masked } }]);
    await click(100, 100, ['hit-back'], 'SVG mask transparency passes through');
    await click(60, 65, ['hit-front'], 'Visible masked SVG pixels remain selectable');
    const outlined = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="20" width="60" height="60" fill="none" stroke="#6699bb" stroke-width="8"/></svg>';
    await apply([{ op: 'update', id: 'hit-front', patch: { svg: outlined } }]);
    await click(100, 100, ['hit-back'], 'Unfilled SVG interiors pass through');
    await click(42, 65, ['hit-front'], 'Visible SVG strokes remain selectable');
    await apply([{ op: 'update', id: 'hit-front', patch: { svg: solid } }]);
    await click(100, 100, ['hit-front'], 'Editing artwork refreshes its hit pixels');
    await apply([{ op: 'update', id: 'hit-front', patch: { opacity: 0 } }]);
    await click(100, 100, ['hit-back'], 'Fully transparent component opacity passes through');
    await apply([{ op: 'delete', id: 'hit-back' },
      { op: 'update', id: 'hit-front', patch: { opacity: 1, svg: hollow } }]);
    await evaluate('document.getElementById("main-canvas").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
    await click(100, 100, [], 'Transparent pixels over empty canvas do not select the component');
    await click(100, 100, [], 'Right-click on transparent empty pixels does not select the component', 'right');
    const revision = (await read()).revision;
    const point = await screen('hit-front', 100, 100);
    await mouse('mousePressed', point);
    check(await evaluate('document.getElementById("main-canvas").classList.contains("is-area-selecting")'), 'Transparent empty pixels begin the normal area-selection gesture');
    await mouse('mouseReleased', point);
    check((await read()).revision === revision, 'Pixel hit testing does not mutate saved artwork');
    await evaluate(`document.getElementById('main-canvas').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));
      document.querySelector('#main-canvas [data-object-id=hit-front]').focus()`);
    check(JSON.stringify(await selected()) === JSON.stringify(['hit-front']), 'Keyboard focus still selects components independently of pointer pixels');
  } finally { win.webContents.debugger.detach(); }
  const current = await read();
  check((await tool({ action: 'open', illustration_id: original.illustration_id,
    expected_library_revision: current.library_revision, request_id: randomUUID() })).ok, 'Restore the originating illustration');
}

module.exports = { verifyArtworkHitTesting };
