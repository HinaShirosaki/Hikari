'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { extractPageRange } = require('./agent-paper-wiki-chunker.js');

// In-memory windows preserve the entire source, including oversized sections.
// Overlap keeps query phrases crossing a window boundary discoverable.
const WINDOW = 12000;
const OVERLAP = 400;

async function readSearchSections(storagePath, paper) {
  if (!paper.wiki_path) return { ok: false, error: 'missing_wiki_path' };
  let markdown;
  try {
    markdown = await fs.readFile(path.resolve(storagePath, paper.wiki_path), 'utf8');
  } catch (error) {
    return { ok: false, error: error.code || 'read_failed' };
  }
  if (!markdown.trim()) return { ok: false, error: 'empty_markdown' };
  const sections = [];
  let section = { heading: 'Preamble', lines: [] };
  for (const line of markdown.split(/\r?\n/)) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) {
      sections.push(section);
      section = { heading: match[1], lines: [] };
    } else {
      section.lines.push(line);
    }
  }
  sections.push(section);
  const rows = [];
  for (const [index, item] of sections.entries()) {
    const text = item.lines.join('\n').trim();
    // Heading-only sections remain searchable.
    for (let offset = 0; offset === 0 || offset < text.length; offset += WINDOW - OVERLAP) {
      const body = text.slice(offset, offset + WINDOW);
      const range = extractPageRange(`${item.heading}\n${body}`);
      rows.push({
        ...paper,
        chunk_id: `markdown:${paper.paper_id}:${index}:${offset}`,
        section_heading: item.heading,
        body,
        body_lower: body.toLowerCase(),
        char_length: body.length,
        page_start: range.pageStart,
        page_end: range.pageEnd
      });
      if (offset + WINDOW >= text.length) break;
    }
  }
  return { ok: true, rows };
}

module.exports = { readSearchSections };
