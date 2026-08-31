const EMU_PER_INCH = 914400;
const SLIDE_WIDTH_EMU = 12192000;
const SLIDE_HEIGHT_EMU = 6858000;
const SLIDE_MARGIN_EMU = Math.round(0.52 * EMU_PER_INCH);
const TABLE_ROW_HEIGHT_EMU = Math.round(0.58 * EMU_PER_INCH);
const TABLE_GEL_GAP_EMU = Math.round(0.18 * EMU_PER_INCH);
const MIN_LABEL_WIDTH_EMU = Math.round(1.3 * EMU_PER_INCH);
const MAX_LABEL_WIDTH_EMU = Math.round(2.2 * EMU_PER_INCH);
const TABLE_FONT_SIZE_POINTS = 22;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInches(value) {
  return Number(value) / EMU_PER_INCH;
}

function resolvePowerPointLayout(plan) {
  const gelWidthPx = Math.max(1, Number(plan?.gelWidth) || 0);
  const gelHeightPx = Math.max(1, Number(plan?.sourceHeight) || 0);
  const rowCount = Math.max(1, plan?.rows?.length || 0);
  const tableHeight = rowCount * TABLE_ROW_HEIGHT_EMU;
  const maxGelHeight = Math.max(
    EMU_PER_INCH,
    SLIDE_HEIGHT_EMU - (SLIDE_MARGIN_EMU * 2) - tableHeight - TABLE_GEL_GAP_EMU
  );
  const labelRatio = Math.max(0.08, Number(plan?.labelWidth) / Math.max(1, Number(plan?.canvasWidth)));
  const labelWidth = clamp(
    Math.round((SLIDE_WIDTH_EMU - (SLIDE_MARGIN_EMU * 2)) * labelRatio),
    MIN_LABEL_WIDTH_EMU,
    MAX_LABEL_WIDTH_EMU
  );
  const maxGelWidth = SLIDE_WIDTH_EMU - (SLIDE_MARGIN_EMU * 2) - labelWidth;
  const gelWidth = Math.max(
    EMU_PER_INCH,
    Math.min(maxGelWidth, Math.round(maxGelHeight * (gelWidthPx / gelHeightPx)))
  );
  const gelHeight = Math.max(1, Math.round(gelWidth * (gelHeightPx / gelWidthPx)));
  const tableWidth = labelWidth + gelWidth;
  const groupLeft = Math.round((SLIDE_WIDTH_EMU - tableWidth) / 2);
  const groupHeight = tableHeight + TABLE_GEL_GAP_EMU + gelHeight;
  const tableTop = Math.max(SLIDE_MARGIN_EMU, Math.round((SLIDE_HEIGHT_EMU - groupHeight) / 2));

  const columnWidths = [labelWidth];
  let assignedGelWidth = 0;
  (plan.slices || []).forEach((slice, index, all) => {
    const width = index === all.length - 1
      ? gelWidth - assignedGelWidth
      : Math.max(1, Math.round(gelWidth * (slice.sourceWidth / gelWidthPx)));
    columnWidths.push(width);
    assignedGelWidth += width;
  });

  return {
    slideWidth: SLIDE_WIDTH_EMU,
    slideHeight: SLIDE_HEIGHT_EMU,
    tableLeft: groupLeft,
    tableTop,
    tableWidth,
    tableHeight,
    tableRowHeight: TABLE_ROW_HEIGHT_EMU,
    gelLeft: groupLeft + labelWidth,
    gelTop: tableTop + tableHeight + TABLE_GEL_GAP_EMU,
    gelWidth,
    gelHeight,
    columnWidths
  };
}

function toTableRows(plan) {
  return plan.rows.map((row) => [row.label, ...row.values].map((value) => ({
    text: String(value ?? ''),
    options: {
      align: 'center',
      valign: 'mid',
      bold: true,
      color: '000000',
      fill: { color: 'FFFFFF', transparency: 100 },
      border: { type: 'none' },
      margin: 0.05
    }
  })));
}

function resolvePptxGenJs(override) {
  const constructor = override || globalThis?.PptxGenJS;
  if (typeof constructor !== 'function') {
    throw new Error('The PowerPoint exporter did not finish loading. Reload Gel and try again.');
  }
  return constructor;
}

function resolveJsZip(override) {
  const constructor = override || globalThis?.JSZip;
  if (typeof constructor?.loadAsync !== 'function') {
    throw new Error('The PowerPoint packager did not finish loading. Reload Gel and try again.');
  }
  return constructor;
}

async function normalizePowerPointXml(arrayBuffer, JSZip) {
  const archive = await JSZip.loadAsync(arrayBuffer);
  const slidePaths = Object.keys(archive.files).filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry));
  await Promise.all(slidePaths.map(async (slidePath) => {
    const slideXml = await archive.file(slidePath).async('string');
    archive.file(slidePath, slideXml.replaceAll('anchor="mid"', 'anchor="ctr"'));
  }));
  return archive.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

export async function createGelPowerPoint({
  plan,
  gelImageDataUrl,
  title = 'Gel figure',
  pptxgenConstructor = null,
  zipConstructor = null
} = {}) {
  if (!plan?.rows?.length || !plan?.slices?.length) {
    throw new Error('PowerPoint export needs a completed Gel figure plan.');
  }
  if (!String(gelImageDataUrl || '').startsWith('data:image/png;base64,')) {
    throw new Error('PowerPoint export needs a PNG gel image.');
  }

  const PptxGenJS = resolvePptxGenJs(pptxgenConstructor);
  const JSZip = resolveJsZip(zipConstructor);
  const layout = resolvePowerPointLayout(plan);
  const presentation = new PptxGenJS();
  presentation.layout = 'LAYOUT_WIDE';
  presentation.author = 'Hikari Gel';
  presentation.company = 'Hikari';
  presentation.subject = 'Editable gel figure';
  presentation.title = String(title || 'Gel figure');
  presentation.lang = 'en-US';
  presentation.theme = {
    headFontFace: 'Arial',
    bodyFontFace: 'Arial',
    lang: 'en-US'
  };

  const slide = presentation.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addTable(toTableRows(plan), {
    x: toInches(layout.tableLeft),
    y: toInches(layout.tableTop),
    w: toInches(layout.tableWidth),
    h: toInches(layout.tableHeight),
    colW: layout.columnWidths.map(toInches),
    rowH: Array.from({ length: plan.rows.length }, () => toInches(layout.tableRowHeight)),
    objectName: 'Editable lane table',
    autoPage: false,
    border: { type: 'none' },
    fill: { color: 'FFFFFF', transparency: 100 },
    color: '000000',
    bold: true,
    fontFace: 'Arial',
    fontSize: TABLE_FONT_SIZE_POINTS,
    align: 'center',
    valign: 'mid',
    margin: 0.05
  });
  slide.addImage({
    data: gelImageDataUrl,
    x: toInches(layout.gelLeft),
    y: toInches(layout.gelTop),
    w: toInches(layout.gelWidth),
    h: toInches(layout.gelHeight),
    objectName: 'Cropped gel image',
    altText: 'Cropped gel lanes'
  });

  const generatedBuffer = await presentation.write({ outputType: 'arraybuffer', compression: true });
  const arrayBuffer = await normalizePowerPointXml(generatedBuffer, JSZip);
  return {
    bytes: arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer),
    layout
  };
}
