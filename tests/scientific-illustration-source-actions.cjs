const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function verifySourceActions({ tool, evaluate, check, win, pause, temp, runtime }) {
  const host = code => win.webContents.executeJavaScript(code);
  const url = relative => pathToFileURL(path.join(runtime, relative)).href;
  const waitFor = async (test, label) => {
    for (let n = 0; n < 100; n++) { if (await test()) return; await pause(50); }
    throw new Error(label);
  };
  await waitFor(() => host('qaBridge.contextActions.list("protocol").length===1'), 'Plugin action did not register');
  check(await host('qaBridge.contextActions.list("protocol")[0].label==="Generate illustration" && qaBridge.contextActions.list("paper-selection").length===1'), 'Plugin registers both host entry points through the public context-action API');
  let existing = await tool({ action: 'read' });
  existing = await tool({ action: 'apply', illustration_id: existing.illustration_id, expected_revision: existing.revision, request_id: crypto.randomUUID(), operations: [
    { op: 'upsert', object: { id: 'keep', name: 'Existing user label', type: 'text', text: 'Preserve this figure' } }
  ] });
  const saved = JSON.stringify(existing.objects);
  await host(`(async () => {
    qaState.protocols=[{id:'protocol-wash',name:'Cell wash',purpose:'Prepare cells',materials:['PBS'],steps:['Wash at 4 °C','Incubate for [duration]']}];
    qaState.papers=[{id:'paper-uptake',title:'Receptor uptake',knowledgeMarkdownRelativePath:'KnowledgeBase/papers.md/source-fixture/Receptor uptake.md'}];
    const {createProtocolListController}=await import(${JSON.stringify(url('src/renderer/modules/protocol/list.js'))});
    const {installPdfViewerSelectionMenuController}=await import(${JSON.stringify(url('src/renderer/modules/papers/pdf-viewer/pdf-viewer-selection-menu-controller.js'))});
    const list=document.createElement('div');list.id='source-protocol-list';document.body.append(list);
    qaProtocolLocal={activeProtocolId:'protocol-wash',activeMenuProtocolId:'protocol-wash',protocolSortField:'name',protocolSortOrder:'asc'};
    qaProtocolList=createProtocolListController({state:qaState,persist:()=>{},ui:{protocolList:list},localState:qaProtocolLocal,safeText:String,normalizeIsoTimestamp:(v,f)=>v||f,parseTimestamp:v=>Date.parse(v)||0,contextActions:qaBridge.contextActions,onViewProtocol:()=>{}});
    qaProtocolList.renderList();
    const menu=document.createElement('div');menu.id='source-paper-menu';menu.className='papers-selection-menu';menu.hidden=true;document.body.append(menu);
    const text=document.createElement('div');text.id='source-paper-text';text.textContent='The occupied receptor enters a vesicle.';document.body.append(text);
    qaPaperContext={elements:{selectionMenu:menu},state:{paperId:'paper-uptake',getContextActions:()=>qaBridge.contextActions.list('paper-selection'),onContextAction:(key,selection)=>qaBridge.contextActions.invoke(key,{kind:'paper-selection',...selection})},positionFloatingElement:()=>{},refreshToolbar:()=>{},getSelectionRef:()=>window.getSelection(),hideSelectionSearchPopover:()=>{},setStatus:text=>window.qaSourceStatus=text};
    installPdfViewerSelectionMenuController(qaPaperContext);
  })()`);
  check(await host('document.querySelector("[data-context-action]").textContent==="Generate illustration"'), 'Saved Protocol … menu displays the plugin-provided action');
  await host('document.querySelector("[data-context-action]").click()');
  await waitFor(() => host('qaRequests.length===1 && document.getElementById("agent-rail-status").textContent==="Complete."'), 'Protocol action did not submit to the scoped chat');
  let protocol = await tool({ action: 'read' });
  check(protocol.illustration_id !== existing.illustration_id && protocol.source.id === 'protocol-wash', 'Protocol action creates a new illustration, preserving the prior figure');
  check(protocol.source.content.includes('Wash at 4 °C') && protocol.source.content.includes('[duration]'), 'Protocol source preserves steps, conditions and placeholders on MCP read');
  check(await host(`qaRequests[0].agent.pluginCanvasIllustrationId===${JSON.stringify(protocol.illustration_id)} && qaRequests[0].message.includes('workflow in') && !qaRequests[0].message.includes('plugin_canvas')`), 'Plugin owns the natural brief and pins its new illustration chat');
  const paperTitle = 'Receptor uptake';
  await host(`
    const node=document.getElementById('source-paper-text');const range=document.createRange();range.selectNodeContents(node);window.getSelection().removeAllRanges();window.getSelection().addRange(range);
    qaPaperContext.state.pendingSelection={text:window.getSelection().toString(),pageNumber:2,clientRect:range.getBoundingClientRect()};
    qaPaperContext.showSelectionMenu();
  `);
  check(await host('!document.getElementById("source-paper-menu").hidden && document.querySelector("[data-plugin-context-action]").dataset.hoverCaption==="Generate illustration"'), 'Paper text selection displays a compact icon with the Generate illustration hover caption');
  await host('document.querySelector("[data-plugin-context-action]").click()');
  await waitFor(() => host('qaRequests.length===2 && document.getElementById("agent-rail-status").textContent==="Complete."'), 'Paper selection did not submit to its new chat');
  const paper = await tool({ action: 'read' });
  check(paper.illustration_id !== protocol.illustration_id && paper.source.id === 'paper-uptake', 'Paper action creates a separate illustration');
  check(paper.source.selectedText === 'The occupied receptor enters a vesicle.' && paper.source.pageNumber === 2, 'Paper source pins the exact selected passage and page');
  check(paper.source.markdownStatus === 'ready' && paper.source.content.includes('no kinase cascade'), 'Context API reads the title-named Markdown file from disk for additional paper context');
  check(await host('qaRequests[0].chatSessionId!==qaRequests[1].chatSessionId && qaRequests[1].conversation.filter(item=>item.role==="user").length===1'), 'Protocol and paper illustration chats remain independent');
  await evaluate('location.reload()'); await pause(350);
  const restored = await tool({ action: 'read' });
  check(JSON.stringify(restored.source) === JSON.stringify(paper.source), 'Paper context persists through an installed-plugin reload');
  const listing = await tool({ action: 'list' });
  await tool({ action: 'open', illustration_id: existing.illustration_id, expected_library_revision: listing.library_revision, request_id: crypto.randomUUID() });
  check(JSON.stringify((await tool({ action: 'read' })).objects) === saved, 'Generating from both sources leaves existing user artwork intact');
  await fs.writeFile(path.join(temp, 'source-actions-result.json'), JSON.stringify({ protocol, paper, paperTitle }, null, 2));
  await fs.writeFile(path.join(temp, 'source-actions.png'), (await win.webContents.capturePage()).toPNG());
}
module.exports = { verifySourceActions };
