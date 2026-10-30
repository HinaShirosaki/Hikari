import { addLadderLabelsToSlide } from './ladder-labels.js';
import { CAPTION_ANGLE } from '../shared.js';

const EMU_PER_INCH = 914400;
const SLIDE_WIDTH_EMU = 12192000;
const SLIDE_HEIGHT_EMU = 6858000;
const SLIDE_MARGIN_EMU = Math.round(0.52 * EMU_PER_INCH);
const TABLE_ROW_HEIGHT_EMU = Math.round(0.58 * EMU_PER_INCH);
const TABLE_GEL_GAP_EMU = Math.round(0.18 * EMU_PER_INCH);
const MIN_LABEL_WIDTH_EMU = Math.round(1.3 * EMU_PER_INCH);
const MAX_LABEL_WIDTH_EMU = Math.round(2.2 * EMU_PER_INCH);
const TABLE_FONT_SIZE_POINTS = 22;
const FONT_EMU = TABLE_FONT_SIZE_POINTS * 12700;
const CAPTION_SIN = Math.sin(CAPTION_ANGLE * Math.PI / 180);
const CAPTION_COS = Math.cos(CAPTION_ANGLE * Math.PI / 180);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toInches(value) {
  return Number(value) / EMU_PER_INCH;
}

function resolvePowerPointLayout(plan) {
  const gelWidthPx = Math.max(1, Number(plan?.gelWidth) || 0);
  const gelHeightPx = Math.max(1, Number(plan?.sourceHeight) || 0);
  const annotation = plan.ladderLabels || { width: 0, height: gelHeightPx, imageTop: 0 };
  const rowCount = Math.max(0, plan?.rows?.length || 0);
  // Captions (a one-row table) are measured at the plan's font size; each
  // starts at its lane center and reaches up and right by reach[i].
  const captionWidths = plan.captions ? plan.captions.widths.map((width) => width / plan.fontSize * FONT_EMU) : null;
  const reach = (captionWidths || []).map((width) => (width * CAPTION_COS) + (FONT_EMU / 2 * CAPTION_SIN));
  let laneOffset = 0;
  const laneCenters = (plan.slices || []).map((slice) => {
    const center = (laneOffset + (slice.sourceWidth / 2)) / gelWidthPx;
    laneOffset += slice.sourceWidth;
    return center;
  });
  const tableHeight = captionWidths
    ? Math.max(TABLE_ROW_HEIGHT_EMU, Math.round((Math.max(...captionWidths) * CAPTION_SIN) + (FONT_EMU * CAPTION_COS) + (0.1 * EMU_PER_INCH)))
    : rowCount * TABLE_ROW_HEIGHT_EMU;
  // No table rows means no table and no label column: the slide is just the gel.
  const tableGelGap = rowCount ? TABLE_GEL_GAP_EMU : 0;
  const maxGelHeight = Math.max(
    EMU_PER_INCH,
    SLIDE_HEIGHT_EMU - (SLIDE_MARGIN_EMU * 2) - tableHeight - tableGelGap
  );
  const labelRatio = Math.max(0.08, Number(plan?.labelWidth) / Math.max(1, Number(plan?.canvasWidth)));
  const labelWidth = rowCount
    ? clamp(
      Math.round((SLIDE_WIDTH_EMU - (SLIDE_MARGIN_EMU * 2)) * labelRatio),
      MIN_LABEL_WIDTH_EMU,
      MAX_LABEL_WIDTH_EMU
    )
    : 0;
  const annotationRatio = annotation.width / gelWidthPx;
  const availableWidth = SLIDE_WIDTH_EMU - (SLIDE_MARGIN_EMU * 2) - labelWidth;
  // A caption ends at labelWidth + gelWidth * (annotationRatio + center) + reach.
  const maxGelWidth = Math.min(availableWidth / (1 + annotationRatio),
    ...reach.map((value, index) => (availableWidth - value) / (annotationRatio + laneCenters[index])));
  const gelWidth = Math.max(
    annotation.width ? 1 : EMU_PER_INCH,
    Math.min(maxGelWidth, Math.round(maxGelHeight * (gelWidthPx / annotation.height)))
  );
  const gelHeight = Math.max(1, Math.round(gelWidth * (gelHeightPx / gelWidthPx)));
  const annotationWidth = annotation.width / gelWidthPx * gelWidth;
  const annotationHeight = annotation.height / gelWidthPx * gelWidth;
  const tableWidth = labelWidth + annotationWidth + gelWidth;
  const groupWidth = Math.max(tableWidth,
    ...reach.map((value, index) => labelWidth + annotationWidth + (gelWidth * laneCenters[index]) + value));
  const groupLeft = Math.round((SLIDE_WIDTH_EMU - groupWidth) / 2);
  const groupHeight = tableHeight + tableGelGap + annotationHeight;
  const tableTop = Math.max(SLIDE_MARGIN_EMU, Math.round((SLIDE_HEIGHT_EMU - groupHeight) / 2));

  const columnWidths = [labelWidth];
  if (annotation.width) columnWidths.push(annotationWidth);
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
    annotationLeft: groupLeft + labelWidth,
    annotationTop: tableTop + tableHeight + tableGelGap,
    gelLeft: groupLeft + labelWidth + annotationWidth,
    gelTop: tableTop + tableHeight + tableGelGap + annotation.imageTop / gelWidthPx * gelWidth,
    gelWidth,
    gelHeight,
    columnWidths,
    captions: captionWidths && captionWidths.map((width, index) => ({
      x: groupLeft + labelWidth + annotationWidth + (gelWidth * laneCenters[index]),
      y: tableTop + tableHeight - Math.round(0.05 * EMU_PER_INCH) - (FONT_EMU / 2 * CAPTION_COS),
      width
    }))
  };
}

function toTableRows(plan) {
  return plan.rows.map((row) => [row.label, ...(plan.ladderLabels?.width ? [''] : []), ...row.values].map((value, index) => ({
    text: String(value ?? ''),
    options: {
      align: index ? 'center' : 'right',
      valign: 'mid',
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
  if (!plan?.slices?.length) {
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
  if (layout.captions) {
    // PowerPoint turns a text box about its center, so each box is placed for
    // its left edge, where the caption starts, to land on the lane center.
    const height = FONT_EMU * 1.4;
    const textOptions = { fontFace: 'Arial', fontSize: TABLE_FONT_SIZE_POINTS, color: '000000', valign: 'middle', margin: 0 };
    const [row] = plan.rows;
    if (row.label) {
      slide.addText(row.label, { ...textOptions, x: toInches(layout.tableLeft), y: toInches(layout.captions[0].y - (height / 2)),
        w: toInches(layout.columnWidths[0]), h: toInches(height), align: 'right', objectName: 'Lane caption label' });
    }
    layout.captions.forEach((caption, index) => {
      if (!row.values[index]) return;
      const width = caption.width + (FONT_EMU * 0.3);
      slide.addText(row.values[index], { ...textOptions,
        x: toInches(caption.x + (width / 2 * CAPTION_COS) - (width / 2)),
        y: toInches(caption.y - (width / 2 * CAPTION_SIN) - (height / 2)),
        w: toInches(width), h: toInches(height), rotate: 360 - CAPTION_ANGLE, align: 'left', wrap: false,
        objectName: `Lane ${plan.slices[index].laneIndex} caption` });
    });
  } else if (plan.rows?.length) {
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
      fontFace: 'Arial',
      fontSize: TABLE_FONT_SIZE_POINTS,
      align: 'center',
      valign: 'mid',
      margin: 0.05
    });
  }
  slide.addImage({
    data: gelImageDataUrl,
    x: toInches(layout.gelLeft),
    y: toInches(layout.gelTop),
    w: toInches(layout.gelWidth),
    h: toInches(layout.gelHeight),
    objectName: 'Cropped gel image',
    altText: 'Cropped gel lanes'
  });
  addLadderLabelsToSlide(slide, plan.ladderLabels, toInches(layout.annotationLeft),
    toInches(layout.annotationTop), toInches(layout.gelWidth) / plan.gelWidth);

  const generatedBuffer = await presentation.write({ outputType: 'arraybuffer', compression: true });
  const arrayBuffer = await normalizePowerPointXml(generatedBuffer, JSZip);
  return {
    bytes: arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer),
    layout
  };
}
