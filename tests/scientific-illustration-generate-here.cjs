const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function verifyGenerateHere({ tool, evaluate, check, win, pause, temp }) {
  const read = () => tool({ action: 'read', include_assets: true });
  const host = code => win.webContents.executeJavaScript(code);
  const wait = async (predicate, message) => {
    for (let i = 0; i < 100; i++) { if (await predicate()) return; await pause(40); }
    throw new Error(message);
  };
  check(await evaluate('!document.getElementById("add-vector")'), 'The placeholder vector-box action is removed');
  const initial = await read();
  const fixture = await tool({ action: 'apply', illustration_id: initial.illustration_id, expected_revision: initial.revision,
    request_id: randomUUID(), operations: [{ op: 'upsert', object: { id: 'protected-art', type: 'vector', name: 'Existing artwork',
      x: 40, y: 40, width: 160, height: 100, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><ellipse cx="80" cy="50" rx="75" ry="45" fill="#63a69b"/></svg>' } }] });
  check(fixture.ok, fixture.error || 'Create existing artwork');
  await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
  const before = await read();
  const point = () => evaluate(`(()=>{const stage=document.getElementById('main-canvas'),svg=stage.querySelector('svg'),a=stage.getBoundingClientRect(),b=svg.getBoundingClientRect();
    const x=(Math.max(a.left,b.left)+Math.min(a.right,b.right))/2,y=(Math.max(a.top,b.top)+Math.min(a.bottom,b.bottom))/2;
    const p=new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());return {x,y,canvasX:Math.round(p.x*100)/100,canvasY:Math.round(p.y*100)/100}})()`);
  const center = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  win.webContents.debugger.attach('1.3');
  const click = async (p, button = 'left') => {
    for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
      type, x: p.x, y: p.y, button, buttons: type === 'mousePressed' ? button === 'right' ? 2 : 1 : 0, clickCount: 1 });
    await pause(50);
  };
  const open = async () => {
    const target = await point();
    await evaluate(`document.getElementById('main-canvas').addEventListener('contextmenu',event=>{const p=new DOMPoint(event.clientX,event.clientY).matrixTransform(document.querySelector('#main-canvas > svg').getScreenCTM().inverse());window.qaInsertionPoint={canvasX:Math.round(p.x*100)/100,canvasY:Math.round(p.y*100)/100}},{capture:true,once:true})`);
    await click(target, 'right');
    check(await evaluate('!document.querySelector("[data-context-action=generate-here]").hidden && !document.querySelector("[data-context-action=generate-here]").disabled'), 'Right-clicking the canvas offers Generate here with Codex');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await click(await center('[data-context-action=generate-here]'));
    await wait(() => evaluate('document.getElementById("generate-here-dialog").open && document.activeElement.id==="generate-here-description"'), 'The generation dialog did not finish opening').catch(async error => {
      console.error('Generate here state:', await evaluate('({open:document.getElementById("generate-here-dialog").open,focus:document.activeElement.id,disabled:document.getElementById("confirm-generate-here").disabled,menuHidden:document.getElementById("canvas-context-menu").hidden,status:document.getElementById("status").textContent})'));
      await fs.writeFile(path.join(temp, 'generate-here-failure.png'), (await win.webContents.capturePage()).toPNG());
      console.error('Generate here artifacts:', temp); throw error;
    });
    check(await evaluate('document.getElementById("generate-here-dialog").open && document.activeElement.id==="generate-here-description"'), `The action opens a focused description dialog: ${JSON.stringify(await evaluate('({open:document.getElementById("generate-here-dialog").open,focus:document.activeElement.id,disabled:document.getElementById("confirm-generate-here").disabled,menuHidden:document.getElementById("canvas-context-menu").hidden})'))}`);
    return { ...target, ...await evaluate('qaInsertionPoint') };
  };
  const fill = (description, renderer) => evaluate(`document.getElementById('generate-here-description').value=${JSON.stringify(description)};document.getElementById('generate-here-renderer').value=${JSON.stringify(renderer)}`);
  const submit = () => evaluate('document.getElementById("generate-here-form").requestSubmit()');
  try {
    await evaluate('document.getElementById("zoom-fit").click()');
    await open();
    check(await evaluate('[...document.getElementById("generate-here-renderer").options].map(option=>option.value).join(",")==="auto,svg,image"'), 'Automatic, SVG, and image generation are available');
    await fill('Do not submit', 'auto');
    await evaluate('document.getElementById("cancel-generate-here").click()');
    check((await host('qaRequests.length')) === 0 && (await read()).revision === before.revision, 'Cancel sends no agent request and leaves the figure intact');
    for (const [index, renderer] of ['auto', 'svg', 'image'].entries()) {
      await host('qaRailRuntime.setExpanded(false)');
      await evaluate(`document.getElementById('zoom-fit').click();for(let i=0;i<${index};i++)document.getElementById('zoom-in').click();document.getElementById('main-canvas').scrollTo(${index * 90},${index * 55})`);
      const target = await open();
      await fill(`A mitochondrion for ${renderer}`, renderer);
      await pause(60);
      if (renderer === 'image') await fs.writeFile(path.join(temp, 'generate-here-dialog.png'), (await win.webContents.capturePage()).toPNG());
      // A viewport change after opening the dialog must not change its target.
      await evaluate('document.getElementById("zoom-in").click()');
      const count = await host('qaRequests.length'), replies = await host('qaScopedState.agentChat.messages.filter(message=>message.role==="assistant").length');
      await evaluate('document.getElementById("generate-here-form").requestSubmit();document.getElementById("generate-here-form").requestSubmit()');
      await wait(async () => await host('qaRequests.length') === count + 1, 'Generation did not reach the agent');
      await wait(() => evaluate('!document.getElementById("generate-here-dialog").open'), 'The generation dialog did not close after acceptance');
      const request = await host('qaRequests.at(-1)');
      check(request.message.includes(`(${target.canvasX}, ${target.canvasY})`) && request.message.includes(`A mitochondrion for ${renderer}`), `The original clicked position survives zoom and pan through the real chat request: ${JSON.stringify({ target, message: request.message })}`);
      check(request.agent.pluginCanvasIllustrationId === before.illustration_id && request.agent.pluginCanvasId === 'scientific-illustration', 'Codex receives the original illustration scope');
      check(renderer === 'auto' ? request.message.includes('Choose editable SVG or Codex image_gen')
        : renderer === 'svg' ? request.message.includes('do not use image generation') : request.message.includes('Use Codex image_gen for this addition'), `The ${renderer} renderer choice reaches Codex`);
      check((await read()).revision === before.revision && JSON.stringify((await read()).objects) === JSON.stringify(before.objects), 'Submitting generation preserves existing artwork and settings');
      await wait(async () => await host('qaScopedState.agentChat.messages.filter(message=>message.role==="assistant").length') > replies, 'The fixture agent did not settle');
      check(await host('qaRequests.length') === count + 1, 'Repeated submissions start only one generation request');
    }
    await host('qaRailRuntime.setExpanded(false)');
    await open(); await fill('Retry this request', 'svg');
    const accepted = await host('qaRequests.length');
    await host('document.getElementById("agent-rail-message-input").value="An existing draft"');
    await submit();
    await wait(() => evaluate('Boolean(document.getElementById("generate-here-error").textContent)'), 'A chat draft rejection was not reported');
    check(await evaluate('document.getElementById("generate-here-dialog").open && document.getElementById("generate-here-description").value==="Retry this request" && !document.getElementById("confirm-generate-here").disabled')
      && await host('qaRequests.length') === accepted, 'Rejected requests retain the description for retry and never overwrite an existing chat draft');
    await host('document.getElementById("agent-rail-message-input").value=""');
    await submit(); await wait(async () => await host('qaRequests.length') === accepted + 1, 'Retry did not reach the agent');
    await wait(() => evaluate('!document.getElementById("generate-here-dialog").open'), 'Retry dialog did not close');
    await host('qaRailRuntime.setExpanded(false)');
    await open(); await fill('A stale position', 'auto');
    const currentCanvas = await read(), requestsBeforeResize = await host('qaRequests.length');
    const resized = await tool({ action: 'apply', illustration_id: currentCanvas.illustration_id, expected_revision: currentCanvas.revision,
      request_id: randomUUID(), operations: [{ op: 'canvas', canvas: 'main', patch: { width: 1400 } }] });
    check(resized.ok, 'Change the canvas size while the generation dialog is open');
    await submit();
    await wait(() => evaluate('document.getElementById("generate-here-error").textContent.includes("canvas size changed")'), 'A stale canvas position was not rejected');
    check(await host('qaRequests.length') === requestsBeforeResize, 'Changed canvas dimensions require choosing a fresh target before generation');
    await evaluate('document.getElementById("cancel-generate-here").click()');
    await open();
    const listing = await tool({ action: 'list' });
    check((await tool({ action: 'create', title: 'Another illustration', expected_library_revision: listing.library_revision, request_id: randomUUID() })).ok, 'Switch illustrations with a pending insertion dialog');
    check(await evaluate('!document.getElementById("generate-here-dialog").open'), 'Switching illustrations dismisses the old insertion target');
    const current = await read();
    await tool({ action: 'open', illustration_id: before.illustration_id, expected_library_revision: current.library_revision, request_id: randomUUID() });
    await evaluate('document.getElementById("layers-tab").click()');
    await click(await center('[data-layer-id=protected-art] .layer-select'), 'right');
    check(await evaluate('document.querySelector("[data-context-action=generate-here]").hidden && document.querySelector("[data-context-separator=generate-here]").hidden'), 'Layer-row menus omit the canvas-only generation action');
    await evaluate('document.getElementById("main-canvas").focus()');
    await host('document.body.dataset.agentAvailability="offline";qaBridge.broadcastAppContext("layout")');
    await pause(60);
    await evaluate('document.getElementById("close-layers").click();document.getElementById("zoom-fit").click()');
    await click(await point(), 'right');
    check(await evaluate('!document.querySelector("[data-context-action=generate-here]").hidden && document.querySelector("[data-context-action=generate-here]").disabled'), 'The new action is disabled when Codex is unavailable');
    await host('document.body.dataset.agentAvailability="connected";qaBridge.broadcastAppContext("layout")');
    await fs.writeFile(path.join(temp, 'generate-here-requests.json'), JSON.stringify(await host('qaRequests.map(request=>({message:request.message,illustrationId:request.agent.pluginCanvasIllustrationId}))'), null, 2));
  } finally { win.webContents.debugger.detach(); }
}

module.exports = { verifyGenerateHere };
