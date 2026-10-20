import { FIGURE_FONT_SIZE, FIGURE_MARGIN, LABEL_WIDTH } from './model.js';

export async function createBlotFigurePowerPoint({ plan, blotCanvases, title }) {
  const PptxGenJS = globalThis.PptxGenJS;
  if (typeof PptxGenJS !== 'function') throw new Error('The PowerPoint exporter is unavailable. Reload Gel and try again.');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Hikari Gel'; pptx.title = title || 'Blot figure';
  pptx.subject = 'Aligned blots with editable antibody labels';
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  const scale = Math.min(12.3 / plan.width, 6.5 / plan.height);
  const left = (13.333333 - plan.width * scale) / 2;
  const top = (7.5 - plan.height * scale) / 2;
  if (plan.table) {
    // Each lane is a native single-column table. Independent placement keeps
    // its center exactly over a lane even with uneven widths or tilted lanes.
    plan.table.columns.forEach((column, index) => {
      slide.addTable(plan.table.rows.map(row => [{ text: row.values[index].join('\n') }]), {
        x: left + (plan.imageLeft + column.x) * scale, y: top + plan.table.y * scale,
        w: column.width * scale, h: plan.table.height * scale,
        colW: [column.width * scale], rowH: plan.table.rows.map(row => row.height * scale),
        fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72,
        align: 'center', valign: 'mid', margin: 0, color: '000000',
        border: { type: 'none' }, fill: { color: 'FFFFFF', transparency: 100 },
        autoPage: false, objectName: `Lane ${column.laneIndex} table`
      });
    });
    plan.table.rows.forEach((row, index) => slide.addText(row.labelLines.join('\n'), {
      x: left + FIGURE_MARGIN * scale, y: top + row.y * scale,
      w: (LABEL_WIDTH - 20) * scale, h: row.height * scale,
      fontFace: 'Arial', fontSize: FIGURE_FONT_SIZE * scale * 72,
      align: 'right', valign: 'middle', margin: 0, color: '000000', objectName: `Lane table label ${index + 1}`
    }));
  }
  plan.rows.forEach((row, index) => {
    slide.addImage({ data: blotCanvases[index].toDataURL('image/png'),
      x: left + plan.imageLeft * scale, y: top + row.imageY * scale,
      w: plan.imageWidth * scale, h: row.imageHeight * scale,
      objectName: `Blot ${index + 1}`, altText: row.labelLines.join(' ') });
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
