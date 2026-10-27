import { writeBulletLines, writeMinorHeading, writeParagraph } from './text-blocks.js';
import { writeSimpleTable } from './tables.js';

const heading = /^\s*#{1,6}\s+(.+)$/;
const bullet = /^\s*[-*+]\s+(.+)$/;
const tableRule = /^\s*\|?\s*:?-{3,}:?\s*\|/;
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

// Appended notebook text often includes Markdown sections and simple tables.
// Preserve explicit line breaks in plain notes and give those sections the
// same typography and pagination as native notebook results.
export function writeNotebookNote(ctx, value) {
  const lines = String(value || '-').split(/\r?\n/);
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      ctx.y += 4;
      index++;
    } else if (heading.test(line)) {
      writeMinorHeading(ctx, line.match(heading)[1]);
      index++;
    } else if (line.includes('|') && tableRule.test(lines[index + 1] || '')) {
      const headers = cells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) rows.push(cells(lines[index++]));
      writeSimpleTable(ctx, headers, rows);
    } else if (bullet.test(line)) {
      const items = [];
      while (index < lines.length && bullet.test(lines[index])) items.push(lines[index++].match(bullet)[1]);
      writeBulletLines(ctx, items);
    } else {
      const paragraph = [line];
      index++;
      while (index < lines.length && lines[index].trim() && !heading.test(lines[index]) && !bullet.test(lines[index])
        && !(lines[index].includes('|') && tableRule.test(lines[index + 1] || ''))) paragraph.push(lines[index++]);
      writeParagraph(ctx, paragraph.join('\n'));
    }
  }
}
