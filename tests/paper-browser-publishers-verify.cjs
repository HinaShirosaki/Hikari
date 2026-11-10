'use strict';

// Run with Node (not Electron) after the opt-in live publisher smoke tests.
// Reads only downloaded PDFs and QA records; performs no network requests.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createPdfTextExtractionRuntime } = require('../src/main/papers/parse/agent-pdf-text-extraction.js');

const artifacts = path.resolve(__dirname, '../artifacts');
const output = path.join(artifacts, 'paper-browser-publishers-live');
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');

async function run() {
  const cases = new Map();
  const attempts = [];
  for (const dir of (await fs.readdir(artifacts)).filter((name) => /^paper-browser-publishers-live(?:-|$)/.test(name))) {
    let report;
    try { report = JSON.parse(await fs.readFile(path.join(artifacts, dir, 'results.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const item of report.cases) {
      const entry = { ...item, evidence_directory: dir };
      attempts.push(entry);
      const previous = cases.get(item.id);
      if (!previous || (item.result.ok && !previous.result.ok)
        || (Boolean(item.result.ok) === Boolean(previous.result.ok) && item.finished_at > previous.finished_at)) cases.set(item.id, entry);
    }
  }
  const extractor = createPdfTextExtractionRuntime();
  const verified = [];
  for (const item of cases.values()) {
    const result = { id: item.id, publisher: item.publisher, doi: item.doi, url: item.url,
      saved: item.result.ok, error: item.result.error, evidence_directory: item.evidence_directory };
    if (item.result.ok) {
      // One page preserves the printed DOI footer: reading multiple pages lets
      // normal running-footer cleanup remove repeated DOI lines.
      const parsed = await extractor.extractText({ file_path: item.result.file_path, max_pages: 1, include_sections: false });
      const compact = String(parsed.text || '').toLowerCase().replace(/[\s\u200b\u00ad]/g, '');
      const title = parsed.embedded_metadata?.title || '';
      const doiMatches = item.doi ? compact.includes(item.doi.toLowerCase()) : false;
      const titleMatches = normalize(title).includes(normalize(item.title).slice(0, 60));
      Object.assign(result, { file_path: item.result.file_path, actual_bytes: item.result.actual_bytes,
        parsed: parsed.ok, pages: parsed.page_count, pdf_title: title, doi_matches: doiMatches,
        title_matches: titleMatches, identity_verified: parsed.ok && (doiMatches || titleMatches) });
    } else {
      result.verification_page = item.snapshots.some((snapshot) => snapshot.challenge);
      result.last_title = item.snapshots.at(-1)?.title;
    }
    verified.push(result);
    console.log(`${item.id}: ${result.identity_verified ? 'verified PDF' : result.saved ? 'IDENTITY CHECK FAILED' : result.verification_page ? 'human verification required' : result.error}`);
  }
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ verified_at: new Date().toISOString(), cases: verified,
    attempts: attempts.map((item) => ({ id: item.id, started_at: item.started_at, ok: item.result.ok, evidence_directory: item.evidence_directory })) }, null, 2));
  if (verified.some((item) => item.saved && !item.identity_verified)) process.exitCode = 1;
  console.log(`${verified.filter(item => item.identity_verified).length}/${verified.length} unique article cases saved and verified.`);
}
run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
