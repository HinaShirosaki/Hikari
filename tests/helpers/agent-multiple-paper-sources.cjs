'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Real PDFs and physical Markdown lines; no writes to the saved library.
module.exports = async function verifyMultiplePaperSources({ root, out, run, win, url }) {
  const storage = path.join(root, 'TestData3');
  const specs = [
    { id: '10.1038_nature13579', lines: [34, 42], anchors: [
      'The deoxyribose-phosphate backbone of the non-target DNA strand',
      'Previous biochemical studies indicated that PAM recognition is concomitant'] },
    { id: '10.1126_science.1225829', lines: [27, 57], anchors: [
      'Cas9 is a DNA endonuclease guided by two RNAs',
      'When we used a different crRNA-target DNA pair'] },
    { id: '10.1016_j.molcel.2020.06.014', lines: [54, 56], anchors: [
      'FACT Depletion Increases dCas9 Residence Times in Human Cells',
      'Three-dimensional FRAP imaging at the arrays revealed'] }
  ];
  const files = {};
  const records = [];
  const blocks = [];
  for (const [index, spec] of specs.entries()) {
    const metaPath = path.join(storage, 'KnowledgeBase/papers.md', spec.id, 'meta.json');
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const markdown = fs.readFileSync(path.join(storage, metadata.markdown_path), 'utf8').split('\n');
    const pdfPath = path.join(storage, metadata.source_pdf_path);
    files[metaPath] = fs.readFileSync(metaPath).toString('base64');
    files[pdfPath] = fs.readFileSync(pdfPath).toString('base64');
    records.push({ id: `library-${index}`, title: metadata.title, fileName: path.basename(pdfPath),
      storedRelativePath: metadata.source_pdf_path, ingestionStatus: 'ready', comments: [], highlights: [] });
    for (const [passageIndex, line] of spec.lines.entries()) {
      assert.ok(markdown[line - 1]?.includes(spec.anchors[passageIndex]), `${spec.id}:${line} matches physical Markdown`);
      blocks.push({ paper_id: metadata.paper_id, paper_title: metadata.title, section_label: 'Results',
        source_path: metadata.markdown_path, line_ranges: [{ start_line: line, end_line: line }],
        source_lines: [{ line_number: line, content: markdown[line - 1] }],
        relevance_reason: `Source-specific check ${index + 1}, passage ${passageIndex + 1}.` });
    }
  }
  await run(`(async () => {
    state.settings.storagePath=${JSON.stringify(storage)};
    window.multiRecords=${JSON.stringify(records)};window.multiBlocks=${JSON.stringify(blocks)};
    window.multiFiles=${JSON.stringify(files)};window.multiReads=[];window.multiDiscoveries=[];
    hikariApi.readFileBytes=async file=>{
      multiReads.push(file);const encoded=multiFiles[file];
      if(!encoded) return {ok:false};
      return {ok:true,bytes:Uint8Array.from(atob(encoded),char=>char.charCodeAt(0)).buffer};
    };
    hikariApi.discoverStoredPapers=async payload=>{
      multiDiscoveries.push(payload.metadataOnly===true);
      return {ok:true,papers:structuredClone(multiRecords),journalClubs:[]};
    };
    // Two indexed papers and one downloaded paper not yet in renderer state.
    state.papers=structuredClone(multiRecords.slice(0,2));
    state.agentChat.currentSessionId='multiple-paper-sources';
    state.agentChat.messages=[{id:'multi-user',role:'user',text:'Compare recognition, cutting, and release.'},
      {id:'multi-answer',role:'assistant',text:multiBlocks.filter((_,i)=>i%2===0).map(block=>
        'This study supports a distinct part of the mechanism. [Source](<'+block.source_path+'#L'+block.source_lines[0].line_number+'>)').join('\\n\\n'),
        meta:{paper_evidence:multiBlocks}}];
    window.multiPaper=id=>[...document.querySelectorAll('.agent-evidence-paper')].find(node=>node.dataset.evidenceKey===id);
    show('agent-view');shell.renderHistoryView();
    const pdfjs=await import(${JSON.stringify(url('vendor/pdfjs/build/pdf.mjs'))});
    pdfjs.GlobalWorkerOptions.workerSrc=${JSON.stringify(url('vendor/pdfjs/build/pdf.worker.mjs'))};
    const normalize=text=>text.toLowerCase().replace(/[^\\p{L}\\p{N}]/gu,'');
    window.expectedPages=[];
    for(const [index,record] of multiRecords.entries()){
      const encoded=multiFiles[state.settings.storagePath+'/'+record.storedRelativePath];
      const pdf=await pdfjs.getDocument({data:Uint8Array.from(atob(encoded),char=>char.charCodeAt(0))}).promise;
      const pages=[];
      for(let page=1;page<=pdf.numPages;page++){
        const content=await (await pdf.getPage(page)).getTextContent();
        pages.push(normalize(content.items.map(item=>item.str||'').join(' ')));
      }
      expectedPages.push(${JSON.stringify(specs.map(spec => spec.anchors))}[index].map(anchor=>
        pages.map((text,page)=>text.includes(normalize(anchor))?page+1:0).filter(Boolean)));
      await pdf.destroy();
    }
  })()`);
  const expectedPages = await run('expectedPages');
  expectedPages.flat().forEach(matches => assert.equal(matches.length, 1, 'Independent exact anchor identifies one PDF page'));
  assert.equal(await run('document.querySelectorAll(".agent-evidence-paper").length'), 3);
  assert.equal(await run('document.querySelector(".agent-evidence-total").textContent'), '3 papers · 6 passages');
  assert.equal(await run('document.querySelectorAll("[data-agent-paper-source]").length'), 3);
  const jumps = [];

  async function verifyJump(index, passageIndex, kind) {
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const actual = await run(`({paper:papers.getActivePaperId(),page:Number(document.getElementById('paper-viewer-page-input').value),
      located:navigationResult?.located,highlights:document.querySelectorAll('.papers-viewer-search-highlight').length})`);
    assert.equal(actual.paper, records[index].id, `${kind}: correct PDF identity`);
    assert.equal(actual.page, expectedPages[index][passageIndex][0], `${kind}: correct PDF page`);
    assert.equal(actual.located, true, `${kind}: exact passage located`);
    assert.ok(actual.highlights > 0, `${kind}: temporary passage highlight`);
    assert.equal(await run('state.papers.every(paper=>!paper.highlights?.length)'), true, 'No saved annotations or cross-paper annotation leaks');
    jumps.push({ paper: records[index].title, line: specs[index].lines[passageIndex], kind, ...actual });
  }

  // Alternate documents, then revisit all of them. Select passage 2 separately
  // in every paper, including the newly discovered download.
  for (const index of [0, 1, 2, 0, 2, 1]) {
    const id = blocks[index * 2].paper_id;
    await run(`show('agent-view');shell.renderHistoryView();
      document.querySelectorAll('.agent-evidence-paper').forEach(node=>node.open=node.dataset.evidenceKey===${JSON.stringify(id)});
      window.activeMulti=multiPaper(${JSON.stringify(id)});
      if(activeMulti.querySelector('.agent-evidence-position').textContent==='Passage 1 of 2')
        activeMulti.querySelector('.agent-evidence-page-button:not(.is-previous)').click();`);
    assert.equal(await run('activeMulti.querySelector(".agent-evidence-line-text").textContent'), blocks[index * 2 + 1].source_lines[0].content);
    assert.equal(await run('activeMulti.querySelector(".agent-evidence-comment").textContent'), blocks[index * 2 + 1].relevance_reason);
    await run('activeMulti.querySelector(".agent-evidence-open-paper").click();cardClicked');
    await verifyJump(index, 1, 'Evidence');
  }
  assert.equal(await run('multiDiscoveries.includes(true)'), true, 'Downloaded third paper discovered without full library loading');
  for (const [index, block] of blocks.filter((_, i) => i % 2 === 0).entries()) {
    await run(`show('agent-view');shell.renderHistoryView();
      document.querySelectorAll('[data-agent-paper-source]')[${index}].click();clicked`);
    await verifyJump(index, 0, 'Sentence citation');
    assert.ok((await run('multiReads')).includes(path.join(storage, block.source_path.replace(/[^/]+$/, 'meta.json'))));
  }
  // A saved follow-up cites earlier evidence without receiving it again.
  await run(`state.agentChat.messages=JSON.parse(JSON.stringify(state.agentChat.messages));
    state.agentChat.messages.push({id:'multi-followup',role:'assistant',text:state.agentChat.messages[1].text});
    show('agent-view');shell.renderHistoryView();`);
  assert.equal(await run('document.querySelectorAll("[data-agent-source-message=multi-followup]").length'), 3);
  for (const index of [2, 0, 1]) {
    await run(`show('agent-view');document.querySelectorAll('[data-agent-source-message=multi-followup]')[${index}].click();clicked`);
    await verifyJump(index, 0, 'Saved follow-up');
  }
  await run(`show('agent-view');shell.renderHistoryView();
    document.querySelectorAll('.agent-evidence-paper').forEach(node=>node.open=true);`);
  for (const index of [0, 1, 2]) {
    assert.equal(await run(`multiPaper(${JSON.stringify(blocks[index * 2].paper_id)}).querySelector('.agent-evidence-position').textContent`),
      'Passage 2 of 2', 'Each paper independently retains its active passage');
  }
  fs.writeFileSync(path.join(out, 'three-paper-evidence.png'), (await win.webContents.capturePage()).toPNG());
  const result = { realPapers: 3, physicalPassages: 6, independentExpectedPages: expectedPages,
    jumps, retainedPerPaperSelection: true, downloadedPaperDiscovery: true, savedFollowup: true };
  console.log('Multiple paper sources passed: 3 real PDFs, 6 physical passages, 12 source jumps, independent reader state, download discovery and saved follow-up citations.');
  return result;
};
