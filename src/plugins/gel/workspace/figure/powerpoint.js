import { FIGURE_FONT_SIZE, FIGURE_MARGIN, LABEL_WIDTH } from './model.js';
import { CAPTION_ANGLE } from '../shared.js';
import { addLadderLabelsToSlide } from '../rendering/ladder-labels.js';

export async function createBlotFigurePowerPoint({ plan, blotCanvases, title }) {
  const PptxGenJS = globalThis.PptxGenJS;
  if (typeof PptxGenJS !== 'function') throw new Error('The PowerPoint exporter is unavailable. Reload Gel and try again.');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Hikari Gel'; pptx.title = title || "Blot figure";
  pptx.subject = 'Aligned blots with editable antibody labels';
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const scale = Math.min(12.3 / plan.width, 6.5 / plan.height);
  const left = (13.333333 - plan.width * scale) / 2;
  const top = (7.5 - plan.height * scale) / 2;
  const angle = CAPTION_ANGLE * Math.PI / 180;
  for (const table of plan.tables) {
    // PowerPoint turns a text box about its center, so the box is placed for
    // its left edge, where the caption starts, to land on the lane center.
    if (table.rotated) table.columns.forEach((column, index) => {
      const [row] = table.rows, text = row.values[index][0];
      if (!text) return;
      const w = row.widths[index] + 8, h = FIGURE_FONT_SIZE * 1.4;
      const x = plan.imageLeft + column.center + w / 2 * Math.cos(angle) - w / 2, y = row.captionY - w / 2 * Math.sin(angle) - h / 2;
      slide.addText(text, {
        x: left + x * scale, y: top + y * scale, w: w * scale, h: h * scale, rotate: 360 - CAPTION_ANGLE,
        fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72, align: 'left', valign: 'middle', margin: 0,
        wrap: false, color: '000000', objectName: `${table.label} lane ${column.laneIndex} caption`
      });
    });
    // A table is one native table: the row labels, then one column per lane.
    // Lane columns meet midway between lane centers, so each keeps its own
    // width over its lane; the label column runs up to the first lane, its
    // text ending where the PNG draws it.
    else {
      const centers = table.columns.map(column => column.center), last = centers.length - 1;
      const edges = [
        last ? centers[0] - (centers[1] - centers[0]) / 2 : table.columns[0].x,
        ...centers.slice(1).map((center, index) => (centers[index] + center) / 2),
        last ? centers[last] + (centers[last] - centers[last - 1]) / 2 : table.columns[0].x + table.columns[0].width
      ];
      const labelRight = plan.imageLeft + edges[0];
      const labelGap = Math.max(0, labelRight - (FIGURE_MARGIN + LABEL_WIDTH - 20));
      const colW = [labelRight - FIGURE_MARGIN, ...centers.map((_, index) => edges[index + 1] - edges[index])].map(width => width * scale);
      slide.addTable(table.rows.map(row => [
        { text: row.labelLines.join('\n'), options: { align: 'right', margin: [0, labelGap * scale, 0, 0] } },
        ...row.values.map(lines => ({ text: lines.join('\n') }))
      ]), {
        x: left + FIGURE_MARGIN * scale, y: top + table.y * scale,
        w: colW.reduce((sum, width) => sum + width, 0), h: table.height * scale,
        colW, rowH: table.rows.map(row => row.height * scale),
        fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72,
        align: 'center', valign: 'mid', margin: 0, color: '000000',
        border: { type: 'none' }, fill: { color: 'FFFFFF', transparency: 100 },
        autoPage: false, objectName: `${table.label} lane table`
      });
    }
    if (table.rotated) table.rows.forEach((row, index) => slide.addText(row.labelLines.join('\n'), {
      x: left + FIGURE_MARGIN * scale, y: top + row.labelY * scale,
      w: (LABEL_WIDTH - 20) * scale, h: row.labelHeight * scale,
      fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72,
      align: 'right', valign: 'middle', margin: 0, color: '000000', objectName: `${table.label} lane table label ${index + 1}`
    }));
  }
  plan.rows.forEach((row, index) => {
    slide.addImage({ data: blotCanvases[index].toDataURL('image/png'),
      x: left + plan.imageLeft * scale, y: top + row.imageY * scale,
      w: plan.imageWidth * scale, h: row.imageHeight * scale,
      objectName: `Blot ${index + 1}`, altText: row.labelLines.join(' ') });
    addLadderLabelsToSlide(slide, row.ladderLabels,
      left + (plan.imageLeft - row.ladderLabels.width) * scale,
      top + (row.imageY - row.ladderLabels.imageTop) * scale, scale);
    slide.addText(row.labelLines.join('\n'), {
      x: left + FIGURE_MARGIN * scale, y: top + (row.y + row.rowHeight / 2 - row.labelLines.length * 14) * scale,
      w: (LABEL_WIDTH - 20) * scale, h: row.labelLines.length * 28 * scale,
      fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72,
      color: '000000', align: 'right', valign: 'middle', margin: 0,
      breakLine: false, objectName: `Antibody ${index + 1}`
    });
  });
  // Match the existing Gel exporter's compatibility normalization.
  const zip = await globalThis.JSZip.loadAsync(await pptx.write({ outputType: 'arraybuffer', compression: true }));
  const file = zip.file('ppt/slides/slide1.xml');
  zip.file('ppt/slides/slide1.xml', (await file.async('string')).replaceAll('anchor="mid"', 'anchor="ctr"'));
  return new Uint8Array(await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' }));
}
