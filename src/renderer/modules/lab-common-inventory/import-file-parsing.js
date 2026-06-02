export function installImportFileParsing(ctx) {

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function readImportFileBase64(file) {
  const buffer = await file.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

function parseCsvRows(rawText) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  const text = String(rawText || '').replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (inQuotes && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const normalized = rows
    .map((item) => item.map((cellValue) => String(cellValue || '').trim()))
    .filter((item) => item.some((cellValue) => cellValue));
  return {
    headers: normalized[0] || [],
    rows: normalized.slice(1),
    rowCount: Math.max(0, normalized.length - 1),
    format: 'csv'
  };
}

async function parseChemicalImportFile(file) {
  if (window.enanaApi?.parseChemicalImportFile) {
    const dataBase64 = await readImportFileBase64(file);
    const parsed = await window.enanaApi.parseChemicalImportFile({
      fileName: file.name,
      dataBase64
    });
    if (!parsed?.ok) {
      throw new Error(parsed?.error || 'Could not parse chemical import file.');
    }
    return parsed;
  }

  if (!/\.csv$/i.test(file.name || '')) {
    throw new Error('This build can only import Excel files through the desktop parser.');
  }
  return parseCsvRows(await file.text());
}


  Object.assign(ctx, {
    arrayBufferToBase64,
    readImportFileBase64,
    parseCsvRows,
    parseChemicalImportFile
  });
}
