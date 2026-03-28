const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;

const PAGE_MARGIN = 72;
const TITLE_FONT_SIZE = 20;
const HEADING_FONT_SIZE = 15;
const BODY_FONT_SIZE = 11;
const LINE_HEIGHT = 14;

const PLATE_DEFINITIONS = {
  '6': { rows: 2, columns: 3, label: '6 well' },
  '12': { rows: 3, columns: 4, label: '12 well' },
  '24': { rows: 4, columns: 6, label: '24 well' },
  '48': { rows: 6, columns: 8, label: '48 well' },
  '96': { rows: 8, columns: 12, label: '96 well' },
  '384': { rows: 16, columns: 24, label: '384 well' },
  '1536': { rows: 32, columns: 48, label: '1536 well' }
};

function getJsPdfCtor() {
  return window?.jspdf?.jsPDF || null;
}

function safeValue(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatTimestamp(value) {
  const parsed = Date.parse(String(value || '').trim());
  if (!Number.isFinite(parsed)) {
    return '-';
  }
  return new Date(parsed).toLocaleString();
}

function sanitizeFileName(value, fallback = 'export') {
  const cleaned = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function createContext({
  title,
  orientation = 'p',
  format = 'letter',
  margin = PAGE_MARGIN,
  serif = false,
  sectionDividers = false
}) {
  const JsPdf = getJsPdfCtor();
  if (!JsPdf) {
    window.alert('PDF generator is not loaded. Please restart the app and try again.');
    return null;
  }

  const doc = new JsPdf({
    orientation,
    unit: 'pt',
    format
  });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const maxWidth = pageWidth - (margin * 2);

  let y = margin;
  doc.setFont(serif ? 'times' : 'helvetica', 'bold');
  doc.setFontSize(TITLE_FONT_SIZE);
  y = writeWrappedLines(doc, String(title || 'Export'), margin, y, maxWidth, TITLE_FONT_SIZE + 8);
  y += 4;

  return {
    doc,
    pageWidth,
    pageHeight,
    maxWidth,
    margin,
    y,
    serif,
    sectionDividers,
    sectionCount: 0
  };
}

function ensureSpace(ctx, neededHeight) {
  if (ctx.y + neededHeight <= ctx.pageHeight - ctx.margin) {
    return;
  }
  ctx.doc.addPage();
  ctx.y = ctx.margin;
}

function writeWrappedLines(doc, text, x, y, maxWidth, lineHeight = LINE_HEIGHT) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  doc.text(lines, x, y);
  return y + (lines.length * lineHeight);
}

function writeHeading(ctx, heading) {
  if (ctx.sectionDividers && ctx.sectionCount > 0) {
    ensureSpace(ctx, 14);
    ctx.doc.setDrawColor(180, 180, 180);
    ctx.doc.setLineWidth(0.8);
    ctx.doc.line(ctx.margin, ctx.y + 2, ctx.pageWidth - ctx.margin, ctx.y + 2);
    ctx.y += 10;
  }
  ensureSpace(ctx, HEADING_FONT_SIZE + 12);
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'bold');
  ctx.doc.setFontSize(HEADING_FONT_SIZE);
  ctx.y = writeWrappedLines(ctx.doc, heading, ctx.margin, ctx.y, ctx.maxWidth, HEADING_FONT_SIZE + 8);
  ctx.y += 4;
  ctx.sectionCount += 1;
}

function writeParagraph(ctx, text) {
  ensureSpace(ctx, LINE_HEIGHT + 2);
  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(BODY_FONT_SIZE);
  ctx.y = writeWrappedLines(ctx.doc, text || '-', ctx.margin, ctx.y, ctx.maxWidth, LINE_HEIGHT);
  ctx.y += 4;
}

function writeKeyValue(ctx, key, value) {
  writeParagraph(ctx, `${key}: ${safeValue(value)}`);
}

function writeBulletLines(ctx, lines) {
  const values = Array.isArray(lines) ? lines : [];
  if (!values.length) {
    writeParagraph(ctx, '-');
    return;
  }
  values.forEach((line) => {
    writeParagraph(ctx, `- ${String(line || '').trim()}`);
  });
}

function finishAndSave(ctx, fileNameBase) {
  ctx.doc.save(`${sanitizeFileName(fileNameBase, 'export')}.pdf`);
}

function renderStepText(step, values = null) {
  const source = String(step?.text || '');
  const placeholders = Array.isArray(step?.placeholders) ? step.placeholders : [];
  const matches = [...source.matchAll(PLACEHOLDER_TOKEN_REGEX)];

  if (!matches.length) {
    if (!placeholders.length) {
      return source.trim();
    }
    const trailing = placeholders.map((placeholder) => {
      const key = `${step.id}:${placeholder.id}`;
      const rawValue = values ? String(values[key] || '').trim() : '';
      return rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    }).join(' ');
    return `${source} ${trailing}`.trim();
  }

  let cursor = 0;
  let text = '';
  matches.forEach((match) => {
    const startIndex = Number(match.index || 0);
    const placeholderId = String(match[1] || '');
    const placeholder = placeholders.find((item) => String(item?.id || '') === placeholderId);
    const key = `${step.id}:${placeholderId}`;
    const rawValue = values ? String(values[key] || '').trim() : '';
    text += source.slice(cursor, startIndex);
    text += rawValue || `[${String(placeholder?.name || 'value').trim()}]`;
    cursor = startIndex + match[0].length;
  });
  text += source.slice(cursor);
  return text.trim();
}

function toRowLabel(rowIndex) {
  let value = Number(rowIndex) + 1;
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function wellIdFor(rowIndex, columnIndex) {
  return `${toRowLabel(rowIndex)}${columnIndex + 1}`;
}

function sortWellLayout(layout) {
  return (Array.isArray(layout) ? layout : []).slice().sort((a, b) => {
    const aWell = String(a?.well || '');
    const bWell = String(b?.well || '');
    return aWell.localeCompare(bWell, undefined, { numeric: true });
  });
}

function resolveAssayDefinition(assay) {
  const rows = Number(assay?.plateRows);
  const columns = Number(assay?.plateColumns);
  if (Number.isFinite(rows) && Number.isFinite(columns) && rows > 0 && columns > 0) {
    return {
      rows,
      columns,
      label: String(assay?.plateLabel || `${rows * columns} well`)
    };
  }
  const fromType = PLATE_DEFINITIONS[String(assay?.plateType || '')] || PLATE_DEFINITIONS['96'];
  return { ...fromType };
}

function renderAssayPlot(ctx, assay, def) {
  const totalWells = def.rows * def.columns;
  const maxRows = totalWells > 384 ? Math.min(16, def.rows) : def.rows;
  const maxColumns = totalWells > 384 ? Math.min(24, def.columns) : def.columns;
  const rowHeaderWidth = 20;
  const colHeaderHeight = 16;
  const maxPlotWidth = ctx.maxWidth - rowHeaderWidth;
  const cellSize = Math.max(8, Math.floor(maxPlotWidth / maxColumns));
  const plotWidth = cellSize * maxColumns;
  const plotHeight = cellSize * maxRows;
  const neededHeight = plotHeight + colHeaderHeight + 24;
  const startX = ctx.margin + rowHeaderWidth;

  ensureSpace(ctx, neededHeight);
  const startY = ctx.y + colHeaderHeight;

  const map = {};
  (Array.isArray(assay?.wellLayout) ? assay.wellLayout : []).forEach((item) => {
    const well = String(item?.well || '').trim().toUpperCase();
    if (!well) {
      return;
    }
    map[well] = true;
  });

  ctx.doc.setFont(ctx.serif ? 'times' : 'helvetica', 'normal');
  ctx.doc.setFontSize(8);

  for (let col = 0; col < maxColumns; col += 1) {
    const label = String(col + 1);
    const x = startX + (col * cellSize) + (cellSize / 2);
    ctx.doc.text(label, x, ctx.y + 11, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    const rowLabel = toRowLabel(row);
    const y = startY + (row * cellSize) + (cellSize / 2) + 3;
    ctx.doc.text(rowLabel, ctx.margin + 10, y, { align: 'center' });
  }

  for (let row = 0; row < maxRows; row += 1) {
    for (let col = 0; col < maxColumns; col += 1) {
      const well = wellIdFor(row, col);
      const mapped = Boolean(map[well]);
      const x = startX + (col * cellSize);
      const y = startY + (row * cellSize);
      if (mapped) {
        ctx.doc.setFillColor(209, 227, 255);
      } else {
        ctx.doc.setFillColor(255, 255, 255);
      }
      ctx.doc.setDrawColor(170, 180, 190);
      ctx.doc.rect(x, y, cellSize, cellSize, 'FD');
    }
  }

  ctx.y = startY + plotHeight + 14;
  ctx.doc.setFontSize(9);
  writeParagraph(ctx, 'Legend: blue = mapped well, white = empty well');
}

export function exportProtocolPdf(protocol) {
  if (!protocol) {
    return false;
  }

  const title = `Protocol: ${safeValue(protocol.name, 'Untitled Protocol')}`;
  const ctx = createContext({
    title,
    orientation: 'p',
    format: 'letter',
    margin: 72,
    serif: true,
    sectionDividers: true
  });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Name', protocol.name);
  writeKeyValue(ctx, 'Created', formatTimestamp(protocol.createdAt));
  writeKeyValue(ctx, 'Updated', formatTimestamp(protocol.updatedAt));

  writeHeading(ctx, 'Purpose');
  writeParagraph(ctx, safeValue(protocol.purpose));

  writeHeading(ctx, 'Materials');
  writeBulletLines(ctx, Array.isArray(protocol.materials) ? protocol.materials : []);

  writeHeading(ctx, 'Steps');
  const steps = Array.isArray(protocol.steps) ? protocol.steps : [];
  if (!steps.length) {
    writeParagraph(ctx, '-');
  } else {
    steps.forEach((step, index) => {
      writeParagraph(ctx, `${index + 1}. ${renderStepText(step, null)}`);
    });
  }

  writeHeading(ctx, 'Troubleshooting');
  writeParagraph(ctx, safeValue(protocol.troubleshooting));

  finishAndSave(ctx, `protocol-${protocol.name || protocol.id || 'export'}`);
  return true;
}

export function exportNotebookEntryPdf({ entry, protocol }) {
  if (!entry) {
    return false;
  }

  const title = `Notebook: ${safeValue(entry.projectName)} / ${safeValue(entry.protocolName)}`;
  const ctx = createContext({
    title,
    orientation: 'p',
    format: 'letter',
    margin: 72,
    serif: true,
    sectionDividers: true
  });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Notebook Type', entry.notebookType === 'biology' ? 'Biology' : 'Synthesis');
  writeKeyValue(ctx, 'Project', entry.projectName);
  writeKeyValue(ctx, 'Protocol', entry.protocolName);
  writeKeyValue(ctx, 'Updated', formatTimestamp(entry.updatedAt));
  writeKeyValue(ctx, 'Storage Folder', entry.storageFolder);

  writeHeading(ctx, 'Protocol Steps (Filled)');
  const steps = Array.isArray(protocol?.steps) ? protocol.steps : [];
  if (!steps.length) {
    writeParagraph(ctx, 'No protocol steps available for this entry.');
  } else {
    steps.forEach((step, index) => {
      writeParagraph(ctx, `${index + 1}. ${renderStepText(step, entry.values || {})}`);
    });
  }

  writeHeading(ctx, 'Results');
  writeParagraph(ctx, safeValue(entry.result));
  writeKeyValue(ctx, 'Result Files', Array.isArray(entry.resultFiles) && entry.resultFiles.length ? entry.resultFiles.join(', ') : '-');

  finishAndSave(ctx, `notebook-${entry.projectName || 'project'}-${entry.protocolName || entry.id || 'entry'}`);
  return true;
}

export function exportAssayDefinitionPdf(assay) {
  if (!assay) {
    return false;
  }

  const def = resolveAssayDefinition(assay);
  const isLarge = def.columns > 12;
  const title = `Assay: ${safeValue(assay.name, assay.assayNumber || 'Unnamed')}`;
  const ctx = createContext({ title, orientation: isLarge ? 'l' : 'p' });
  if (!ctx) {
    return false;
  }

  writeHeading(ctx, 'Summary');
  writeKeyValue(ctx, 'Assay Number', assay.assayNumber || '-');
  writeKeyValue(ctx, 'Name', assay.name || '-');
  writeKeyValue(ctx, 'Project', assay.projectName || '-');
  writeKeyValue(ctx, 'Plate', `${safeValue(def.label)} (${def.rows} x ${def.columns})`);
  writeKeyValue(ctx, 'Sample Axis', assay.sampleAxis === 'column' ? 'Column' : 'Row');
  writeKeyValue(ctx, 'Concentration Axis', assay.concentrationAxis === 'column' ? 'Column' : 'Row');
  writeKeyValue(ctx, 'Notebook Page', assay.notebookEntryProtocolName || '-');
  writeKeyValue(ctx, 'Updated', formatTimestamp(assay.updatedAt));

  writeHeading(ctx, 'Well Definition Plot');
  renderAssayPlot(ctx, assay, def);

  writeHeading(ctx, 'Mapped Well Definitions');
  const mappedRows = sortWellLayout(assay.wellLayout);
  if (!mappedRows.length) {
    writeParagraph(ctx, 'No mapped well definitions.');
  } else {
    mappedRows.slice(0, 220).forEach((item) => {
      writeParagraph(
        ctx,
        `${safeValue(item.well)} | Sample: ${safeValue(item.sampleId)} | Concentration: ${safeValue(item.concentration)}`
      );
    });
    if (mappedRows.length > 220) {
      writeParagraph(ctx, `... ${mappedRows.length - 220} more mapped wells not shown in this section.`);
    }
  }

  finishAndSave(ctx, `assay-${assay.assayNumber || assay.id || assay.name || 'definition'}`);
  return true;
}
