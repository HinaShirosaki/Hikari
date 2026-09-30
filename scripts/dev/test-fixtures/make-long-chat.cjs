#!/usr/bin/env node
// Seeds one long Agent Chat session that cycles through every visualization the
// chat renderer supports, for long-history performance testing.
// Usage: node scripts/dev/test-fixtures/make-long-chat.cjs [storagePath] [cycles=12]
// storagePath defaults to the live root in Hikari/Config/last-storage-root.json.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createAgentChatLogRuntime } = require('../../../src/main/agent/context/agent-chat-log.js');
const { callHtmlOutput } = require('../../../src/main/agent/mcp-contract/direct-tools/html-output.js');

const storagePath = process.argv[2] || JSON.parse(fs.readFileSync(
  path.join(os.homedir(), 'Library/Application Support/Hikari/Config/last-storage-root.json'), 'utf8')).storagePath;
const cycles = Math.max(1, Number(process.argv[3]) || 12);

// --- procedural PNGs (no deps) ---
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = pixel(x, y);
    raw.set([r, g, b].map(v => Math.max(0, Math.min(255, v | 0))), y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]).toString('base64')}`;
}
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const ladder = [0.08, 0.14, 0.22, 0.31, 0.42, 0.55, 0.7, 0.86];
const lanes = Array.from({ length: 10 }, (_, i) => i === 0 ? ladder : ladder.filter(() => rand() > 0.55).concat(rand()));
const noise = Array.from({ length: 4096 }, rand);
const gelPng = png(720, 360, (x, y) => {
  const lane = Math.floor(x / 72), lx = x % 72;
  let v = 18 + noise[(x * 31 + y * 17) % 4096] * 14;
  if (lx > 10 && lx < 62) for (const pos of lanes[lane]) v += 230 * Math.exp(-(((y / 360) - pos) ** 2) / 0.00006);
  return [v, v, v];
});
const viridis = t => [68 + t * 185, 1 + t * 230, 84 + Math.sin(t * Math.PI) * 120];
const heatmapPng = png(600, 400, (x, y) => {
  const c = Math.floor(x / 50), r = Math.floor(y / 50);
  if (x % 50 < 2 || y % 50 < 2) return [255, 255, 255];
  return viridis((Math.sin(c / 2) + Math.cos(r / 1.5) + 2) / 4);
});
const cells = Array.from({ length: 70 }, () => [rand() * 640, rand() * 480, 6 + rand() * 12]);
const microscopyPng = png(640, 480, (x, y) => {
  let g = 6;
  for (const [cx, cy, s] of cells) {
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (d < 900) g += 220 * Math.exp(-d / (2 * s * s));
  }
  return [g * 0.2, g, g * 0.35];
});
const svgThumb = (hue, label) => `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" rx="16" fill="hsl(${hue},55%,88%)"/><text x="80" y="92" font-family="sans-serif" font-size="22" text-anchor="middle" fill="hsl(${hue},45%,30%)">${label}</text></svg>`
).toString('base64')}`;

// --- interactive HTML artifacts ---
const doseResponseHtml = n => `<!doctype html><meta charset="utf-8"><style>
body{font:13px system-ui;margin:12px;color:#223}label{display:block;margin:6px 0}svg{width:100%;height:260px}
</style><h3>Dose response #${n}</h3><label>Hill slope <input id="h" type="range" min="0.3" max="4" step="0.1" value="1.2"> <span id="hv"></span></label>
<label>IC50 (µM) <input id="c" type="range" min="-2" max="2" step="0.05" value="0"> <span id="cv"></span></label>
<svg viewBox="0 0 400 220"><g id="g"></g><path id="p" fill="none" stroke="#4169d8" stroke-width="2.5"/></svg>
<script>const pts=[...Array(10)].map((_,i)=>[i,100/(1+Math.pow(10,(i/2-2.5)*1.3))+(Math.sin(i*${n})*6)]);
function draw(){const h=+document.getElementById('h').value, c=Math.pow(10,+document.getElementById('c').value);
document.getElementById('hv').textContent=h;document.getElementById('cv').textContent=c.toFixed(2);
let d='';for(let x=0;x<=400;x+=4){const dose=Math.pow(10,x/80-2.5);const y=100/(1+Math.pow(dose/c,h));d+=(x?'L':'M')+x+','+(210-y*2)}
document.getElementById('p').setAttribute('d',d);
document.getElementById('g').innerHTML=pts.map(([i,y])=>'<circle cx="'+(i*40+20)+'" cy="'+(210-y*2)+'" r="4" fill="#d9573b"/>').join('')}
document.querySelectorAll('input').forEach(i=>i.oninput=draw);draw();</script>`;
const plateHtml = n => `<!doctype html><meta charset="utf-8"><style>
body{font:12px system-ui;margin:12px}.g{display:grid;grid-template-columns:repeat(12,1fr);gap:3px}
.w{aspect-ratio:1;border-radius:50%;display:grid;place-items:center;color:#fff;font-size:9px;cursor:default}
#t{margin-top:8px;min-height:1.4em}</style><h3>Plate readout #${n}</h3><div class="g" id="g"></div><div id="t">Hover a well</div>
<script>const rows='ABCDEFGH';let h='';for(let r=0;r<8;r++)for(let c=0;c<12;c++){const v=Math.abs(Math.sin((r+1)*(c+1)*${n}))*2.4;
h+='<div class="w" data-k="'+rows[r]+(c+1)+'" data-v="'+v.toFixed(3)+'" style="background:hsl('+(220-v*80)+',65%,'+(35+v*10)+'%)">'+v.toFixed(1)+'</div>'}
const g=document.getElementById('g');g.innerHTML=h;g.onmouseover=e=>{const d=e.target.dataset;if(d.k)document.getElementById('t').textContent=d.k+' · OD600 '+d.v};</script>`;
// Async: the turn loop awaits these before persisting.
const html = (title, source, caption, height) => callHtmlOutput({ title, html: source, caption, height }).then(r => r.html_artifact);

// --- turn builders: each returns [userText, assistantText, meta] ---
const codexRows = lines => lines.map(([kind, text]) => ({ stage: 'codex_cli_display', routing_intent: 'codex_agent', kind, stream: '', text }));
const codex = (answer, rows, extra = {}) => ({
  parser: { primary_intent: 'codex_agent' },
  codex_agent: { status: 'completed', answer, follow_up_questions: [], user_question: null, citations: [] },
  codex_cli_display_rows: codexRows(rows), ...extra
});
const bigTable = n => ['| Well | Sample | Ct (GAPDH) | Ct (IL6) | ΔCt | Fold change |', '|---|---|---:|---:|---:|---:|',
  ...Array.from({ length: 40 }, (_, i) => {
    const g = 17 + ((i * 7 + n) % 13) / 10, t = 24 + ((i * 11 + n) % 37) / 10;
    return `| ${'ABCDEFGH'[i % 8]}${Math.floor(i / 8) + 1} | S${i + 1} | ${g.toFixed(2)} | ${t.toFixed(2)} | ${(t - g).toFixed(2)} | ${(2 ** (7 - (t - g))).toFixed(3)} |`;
  })].join('\n');

const turns = [
  n => [`Summarize the plan for the IL-6 knockdown experiment (round ${n}).`, [
    `## IL-6 knockdown plan — round ${n}`, '', 'The goal is to confirm **siRNA-mediated IL-6 knockdown** in *HEK293T* before scaling up.', '',
    '### Steps', '1. Seed cells at `2e5` per well in a 12-well plate', '2. Transfect with 20 nM siRNA using RNAiMAX', '   - scrambled control', '   - two independent IL-6 siRNAs',
    '3. Harvest at 48 h for qPCR', '', '> Keep passage number under 20 — later passages showed ~30% lower transfection efficiency.', '', '---', '',
    '| Condition | siRNA | Replicates |', '|---|---|:---:|', '| Mock | — | 3 |', '| Scrambled | NC-1 | 3 |', '| KD-A | IL6-s7310 | 3 |', '| KD-B | IL6-s7311 | 3 |', '',
    '```python', 'import numpy as np', 'fold = 2 ** -(ct_target - ct_ref - baseline)', 'print(fold.round(3))', '```', '',
    'See the [RNAiMAX protocol](https://www.thermofisher.com) for volumes. ~~Use 50 nM~~ 20 nM is enough.'
  ].join('\n'), { thinking_trace: { intent_parse_question: 'Plan summary for an existing project.', criteria_generate: 'Steps, conditions, and caveats.', final_synthesize: 'Structured markdown answer.' } }],
  n => ['Search the literature for EGFR inhibitor resistance mechanisms and give me the top hits.', `Found 4 relevant papers (run ${n}). The dominant mechanisms are **T790M gatekeeper mutation**, **MET amplification**, and **histologic transformation to SCLC**.`,
    codex('Found 4 papers.', [['assistant', 'I will search the literature library for EGFR resistance.'], ['tool', 'Running tool...'], ['command', `mcp__hikari__literature_search {"query":"EGFR inhibitor resistance ${n}","limit":4}`],
      ['tool', 'literature_search completed · 4 papers'], ['assistant', 'Reading abstracts to rank mechanisms by frequency.'], ['tool', 'paper_read × 4 completed']])],
  n => ['Show me the gel image from yesterday\'s colony PCR.', `Here is the colony PCR gel (lanes 2–10, ladder in lane 1). Lanes 3, 6 and 9 show the expected ~1.2 kb insert band.`,
    codex('Gel image attached.', [['tool', 'image_output completed']], { image_artifacts: [{ type: 'image', id: `gel-${n}`, mime_type: 'image/png', title: 'Colony PCR — 1% agarose', alt: 'Agarose gel with ten lanes; ladder in lane 1', caption: 'Exposure 0.4 s, SYBR Safe.', data_url: gelPng }] })],
  n => ['Compare the viability heatmap with the microscopy field for plate 3.', 'Both views agree: the upper-left quadrant has the highest signal, and the microscopy field shows confluent GFP+ cells there.',
    codex('Two images attached.', [['tool', 'image_output completed'], ['tool', 'image_output completed']], { image_artifacts: [
      { type: 'image', id: `heat-${n}`, mime_type: 'image/png', title: 'Viability heatmap', alt: '12 by 8 viability heatmap', data_url: heatmapPng },
      { type: 'image', id: `micro-${n}`, mime_type: 'image/png', title: 'GFP field 4×', alt: 'Fluorescence micrograph of GFP positive cells', caption: 'Scale bar omitted.', data_url: microscopyPng }] })],
  n => ['Make an interactive dose-response curve I can play with.', 'Drag the sliders to see how the Hill slope and IC50 reshape the fit against the measured points.',
    codex('HTML artifact rendered.', [['tool', 'html_output completed']], { html_artifacts: [html(`Dose response explorer ${n}`, doseResponseHtml(n), 'Synthetic points; curve is a 4PL model.', 20)] })],
  n => ['Render the 96-well OD600 readout as a plate map.', 'Hover any well for its OD600 value. Row H is consistently low — likely an edge-evaporation effect.',
    codex('HTML artifact rendered.', [['tool', 'html_output completed']], { html_artifacts: [html(`Plate map ${n}`, plateHtml(n), '', 24)] })],
  n => ['Run a quick analysis on the qPCR Cts and plot the fold changes.', 'Analysis done in the Python sandbox. KD-A reaches ~80% knockdown; KD-B ~65%.', {
    result_analysis: { tool_trace: [{ tool_name: 'python-sandbox', round: 1, status: 'completed', run_id: `py-${n}`, stdout: 'mean ΔΔCt: KD-A 2.31, KD-B 1.52\n', render_outputs: [
      { type: 'text', title: 'Summary', format: 'text/markdown', content: '| Condition | ΔΔCt | Knockdown |\n|---|---:|---:|\n| KD-A | 2.31 | 79.8% |\n| KD-B | 1.52 | 65.1% |' },
      { type: 'text', title: 'Stats', format: 'application/json', content: JSON.stringify({ ttest: { t: 6.21, p: 0.0034 }, n: 3, run: n }) },
      { type: 'image', title: 'Fold change heatmap', mime_type: 'image/png', data_base64: heatmapPng.split(',')[1], path: `outputs/fold-${n}.png` }] }] }
  }],
  n => ['Where can I buy more RNAiMAX and Opti-MEM?', 'Three options with current list prices:', { purchase_recommendation: { items: [
    { title: 'Lipofectamine RNAiMAX 1.5 mL', vendor: 'Thermo Fisher', price_text: '$642.00', image_url: svgThumb(210, 'RNAiMAX'), product_url: 'https://www.thermofisher.com/order/catalog/product/13778150' },
    { title: 'Opti-MEM I Reduced Serum 500 mL', vendor: 'Thermo Fisher', price_text: '$48.50', image_url: svgThumb(20, 'Opti-MEM'), product_url: 'https://www.thermofisher.com/order/catalog/product/31985070' },
    { title: 'siRNA Transfection Starter Kit', vendor: 'Sigma-Aldrich', price_text: `$${310 + n}.00`, image_url: svgThumb(130, 'Kit'), product_url: 'https://www.sigmaaldrich.com' }] } }],
  n => ['Draft a notebook page for the next transfection.', 'I drafted a planned page. Review it before it is created.', { notebookDrafts: [{
    notebook_type: 'biology', project: { id: 'p-perf', name: 'Perf fixture' }, protocol: { id: 'proto-transfect', name: 'siRNA transfection' },
    proposal: { proposal_id: `perf-draft-${n}`, title: `Transfection round ${n + 1}`, purpose: 'Repeat KD-A with a 10 nM titration.', rationale: 'KD-A worked at 20 nM; test whether 10 nM suffices.',
      planned_materials: ['HEK293T p14', 'RNAiMAX', 'IL6-s7310'], checkpoints: ['Confluence 70% at transfection', 'qPCR at 48 h'] },
    rendered_steps: ['Seed 2e5 cells/well', 'Transfect 10 nM and 20 nM', 'Harvest at 48 h'], save: { mode: 'confirm_before_save' },
    entry_template: { experimentName: `Transfection round ${n + 1}`, notebookState: 'planned', result: '' } }] }],
  n => ['Add today\'s qPCR interpretation to the notebook page.', 'Here is a suggested section to append:', { notebook_append: {
    proposal: { proposal_id: `perf-append-${n}`, section_title: `qPCR interpretation ${n}`, content_markdown: '### qPCR\n- KD-A: **79.8%** knockdown\n- KD-B: 65.1%\n\nGAPDH Cts stable (±0.2).' },
    save: { mode: 'confirm_before_append' } } }],
  n => ['Write a reusable protocol for RNA extraction with TRIzol.', 'Drafted a protocol — add it to your library if it looks right.', { protocol_generation: { protocol: {
    name: `TRIzol RNA extraction v${n}`, purpose: 'Total RNA from adherent cells.', materials: ['TRIzol', 'Chloroform', 'Isopropanol', '75% ethanol'],
    steps: ['Lyse cells in 1 mL TRIzol per 10 cm²', { text: 'Add {{chloroform}} and shake 15 s', placeholders: [{ name: 'chloroform' }] }, 'Centrifuge 12,000 g, 15 min, 4 °C', 'Precipitate aqueous phase with isopropanol', 'Wash pellet with 75% ethanol and resuspend in RNase-free water'] } } }],
  n => ['Design primers for the IL6 insert in pUC19-IL6.', 'Primer pair designed. Open the plasmid or primer design view to inspect.',
    codex('Primers designed.', [['tool', 'sequence_primer_design completed']], { sequence_actions: [
      { action: 'open_plasmid', entry_id: `perf-seq-${n}`, label: 'Open pUC19-IL6', name: 'pUC19-IL6' },
      { action: 'open_primer_design', entry_id: `perf-seq-${n}`, construct_id: `c-${n}`, label: 'Open primer design', name: 'IL6 primers' }] })],
  n => ['Export the whole qPCR table with fold changes.', `Full table (run ${n}):\n\n${bigTable(n)}\n\nFold change uses 2^-(ΔCt − 7).`, { thinking_trace: { intent_parse_question: 'Table export.', final_synthesize: 'Markdown table.' } }],
  () => ['Upload the plate to the shared drive.', 'Agent failed: The shared drive connector is not configured.', { parser: { primary_intent: 'unclear', needs_clarification: true, clarification_reason: 'agent_error', reasoning_summary: 'Connector missing.' } }]
];

(async () => {
  const runtime = createAgentChatLogRuntime();
  const start = Date.now() - cycles * turns.length * 2 * 60_000;
  let t = 0;
  const at = () => new Date(start + (t++) * 60_000).toISOString();
  const { session } = await runtime.createSession({ storagePath, title: `Visualization perf fixture (${cycles * turns.length} turns)`, created_at: at() });
  const rows = [];
  let id = 0;
  const push = (role, text, meta) => rows.push({ type: `${role}-message`, session_id: session.id, message_id: `perf-${id++}`, timestamp: at(), text, meta });
  for (let c = 0; c < cycles; c++) for (const turn of turns) {
    const [user, answer, meta] = turn(c + 1);
    if (meta.html_artifacts) meta.html_artifacts = await Promise.all(meta.html_artifacts);
    push('user', user);
    push('assistant', answer, meta);
  }
  push('user', 'Set up the next titration experiment.');
  push('assistant', 'Before I draft it, one question:', codex('', [['assistant', 'Need the titration range.']], {
    codex_agent: { status: 'needs_user_answer', user_question: { question: 'Which siRNA concentrations should the titration cover?', context: 'KD-A worked at 20 nM.',
      options: [{ label: '5 / 10 / 20 nM', description: 'Three-point titration' }, { label: '1 / 5 / 10 / 20 / 40 nM', description: 'Five-point, more reagent' }], placeholder: 'e.g. 2.5–20 nM' } }
  }));
  await runtime.appendRows(storagePath, session.id, rows);
  const size = fs.statSync(path.join(storagePath, 'chat_log', session.log_file)).size;
  console.log(`${session.id}: ${rows.length} messages, ${(size / 1e6).toFixed(1)} MB → ${storagePath}/chat_log/${session.log_file}`);
})().catch(error => { console.error(error); process.exit(1); });
