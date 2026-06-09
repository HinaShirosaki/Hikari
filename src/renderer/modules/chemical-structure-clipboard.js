const STRUCTURE_FORMAT_PRIORITY = [
  'chemical/x-cdxml',
  'cdxml',
  'chemical/x-mdl-molfile',
  'molfile',
  'chemical/x-mdl-sdfile',
  'sdf',
  'chemical/x-cdx',
  'cdx',
  'inchi',
  'smiles',
  'text/plain',
  'text/html',
  'image/svg+xml',
  'image/png',
  'public.png',
  'image/jpeg',
  'image/jpg',
  'public.jpeg',
  'public.jpg',
  'public.tiff',
  'public.tif',
  'public.pdf',
  'image/native'
];

const SMILES_PATTERN = /^[A-Za-z0-9@+\-[\]()=#$\\/%.:*]+$/;

export function getChemicalStructureCandidatesFromClipboardData(clipboardData) {
  return extractChemicalStructureCandidates(collectClipboardDataTransferCandidates(clipboardData));
}

export function readChemicalStructureClipboard(options = {}) {
  return readChemicalStructureClipboardInternal(options);
}

export function readChemicalStructureCandidatesFromClipboard(options = {}) {
  return readChemicalStructureClipboard(options).then((result) => result.candidates);
}

async function readChemicalStructureClipboardInternal({
  clipboardData = null,
  hikariApi = globalThis.window?.hikariApi,
  navigatorRef = globalThis.navigator
} = {}) {
  const candidates = collectClipboardDataTransferCandidates(clipboardData);
  const apiClipboard = await readHikariClipboard(hikariApi);
  const browserCandidates = apiClipboard.candidates.length ? [] : await readBrowserClipboardCandidates(navigatorRef);
  const parsedCandidates = extractChemicalStructureCandidates(candidates.concat(apiClipboard.candidates, browserCandidates));
  return {
    candidates: parsedCandidates,
    formats: Array.from(new Set([
      ...collectClipboardFormats(clipboardData),
      ...apiClipboard.formats,
      ...browserCandidates.map((candidate) => candidate.format).filter(Boolean)
    ]))
  };
}

export function extractChemicalStructureCandidates(rawCandidates = []) {
  const parsed = [];
  const seen = new Set();
  sortRawCandidates(rawCandidates).forEach((candidate) => {
    const format = String(candidate?.format || '').trim();
    const imageDataUrl = normalizeImageDataUrl(candidate?.imageDataUrl || candidate?.source);
    if (imageDataUrl && isPotentialImageFormat(format)) {
      pushUniqueCandidate(parsed, seen, {
        source: imageDataUrl,
        sourceFormat: 'image',
        imageDataUrl,
        clipboardFormat: format
      });
    }

    const sourceText = String(candidate?.text || candidate?.source || '').trim();
    if (!sourceText) {
      return;
    }

    const directFormat = getDirectChemicalFormat(format);
    if (directFormat) {
      pushUniqueCandidate(parsed, seen, {
        source: sourceText,
        sourceFormat: directFormat,
        clipboardFormat: format
      });
    }

    extractChemicalStructureFromText(sourceText).forEach((item) => {
      pushUniqueCandidate(parsed, seen, {
        ...item,
        clipboardFormat: format
      });
    });
  });
  return parsed;
}

export function extractChemicalStructureFromText(value) {
  const text = normalizeClipboardText(value);
  if (!text) {
    return [];
  }

  const decoded = decodeBasicHtmlEntities(text);
  const candidates = [];
  const cdxml = extractCdxml(decoded) || extractCdxml(text);
  if (cdxml) {
    candidates.push({ source: cdxml, sourceFormat: 'cdxml' });
  }

  const molfile = extractMolfile(decoded) || extractMolfile(text);
  if (molfile) {
    candidates.push({ source: molfile, sourceFormat: 'molfile' });
  }

  const inchi = extractInchi(decoded);
  if (inchi) {
    candidates.push({ source: inchi, sourceFormat: 'inchi' });
  }

  const smiles = extractSmiles(decoded);
  if (smiles) {
    candidates.push({ source: smiles, sourceFormat: 'smiles' });
  }

  return candidates;
}

function collectClipboardDataTransferCandidates(clipboardData) {
  if (!clipboardData || typeof clipboardData.getData !== 'function') {
    return [];
  }

  const types = Array.from(clipboardData.types || []);
  const requestedTypes = types.concat(['chemical/x-cdxml', 'chemical/x-mdl-molfile', 'chemical/x-mdl-sdfile', 'text/plain', 'text/html', 'Text']);
  const candidates = [];
  const seen = new Set();
  requestedTypes.forEach((type) => {
    const format = String(type || '').trim();
    const key = format.toLowerCase();
    if (!format || seen.has(key)) {
      return;
    }
    seen.add(key);
    let text = '';
    try {
      text = clipboardData.getData(format);
    } catch {
      text = '';
    }
    if (text) {
      candidates.push({ format, text });
    }
  });
  return candidates;
}

function collectClipboardFormats(clipboardData) {
  return Array.from(clipboardData?.types || []).map((type) => String(type || '').trim()).filter(Boolean);
}

async function readHikariClipboard(hikariApi) {
  if (!hikariApi || typeof hikariApi.readChemicalClipboard !== 'function') {
    return { candidates: [], formats: [] };
  }
  try {
    const result = await hikariApi.readChemicalClipboard();
    return {
      candidates: Array.isArray(result?.candidates) ? result.candidates : [],
      formats: Array.isArray(result?.formats) ? result.formats.map((format) => String(format || '').trim()).filter(Boolean) : []
    };
  } catch {
    return { candidates: [], formats: [] };
  }
}

async function readBrowserClipboardCandidates(navigatorRef) {
  const clipboard = navigatorRef?.clipboard;
  if (!clipboard) {
    return [];
  }

  const candidates = [];
  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read();
      for (const item of items || []) {
        for (const type of item.types || []) {
          if (!isPotentialStructureFormat(type) && !String(type || '').startsWith('text/')) {
            continue;
          }
          try {
            const blob = await item.getType(type);
            if (blob && isPotentialImageFormat(type)) {
              candidates.push({ format: type, imageDataUrl: await blobToDataUrl(blob) });
            } else if (blob && typeof blob.text === 'function') {
              candidates.push({ format: type, text: await blob.text() });
            }
          } catch {
            // Continue to the next clipboard type.
          }
        }
      }
    } catch {
      // Fall through to readText.
    }
  }

  if (!candidates.length && typeof clipboard.readText === 'function') {
    try {
      const text = await clipboard.readText();
      if (text) {
        candidates.push({ format: 'text/plain', text });
      }
    } catch {
      // Clipboard permission may be unavailable outside Electron.
    }
  }
  return candidates;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Cannot convert clipboard image to a data URL.'));
    reader.readAsDataURL(blob);
  });
}

function sortRawCandidates(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .slice()
    .sort((a, b) => getFormatScore(a?.format) - getFormatScore(b?.format));
}

function getFormatScore(format) {
  const lower = String(format || '').toLowerCase();
  const index = STRUCTURE_FORMAT_PRIORITY.findIndex((item) => lower.includes(item));
  return index >= 0 ? index : STRUCTURE_FORMAT_PRIORITY.length;
}

function getDirectChemicalFormat(format) {
  const lower = String(format || '').toLowerCase();
  if (lower.includes('cdxml')) {
    return '';
  }
  if (
    lower.includes('chemical/x-cdx')
    || /\bcdx\b/.test(lower)
    || lower.includes('chemdraw')
    || lower.includes('cambridge')
    || lower.includes('perkinelmer')
    || lower.includes('revvity')
  ) {
    return 'cdx';
  }
  return '';
}

function isPotentialStructureFormat(format) {
  const lower = String(format || '').toLowerCase();
  return STRUCTURE_FORMAT_PRIORITY.some((item) => lower.includes(item))
    || lower.includes('chemical')
    || lower.includes('chemdraw')
    || lower.includes('cambridge')
    || lower.includes('perkinelmer')
    || lower.includes('revvity');
}

function isPotentialImageFormat(format) {
  const lower = String(format || '').toLowerCase();
  return lower.startsWith('image/')
    || lower.includes('image')
    || lower.includes('public.png')
    || lower.includes('public.jpeg')
    || lower.includes('public.jpg')
    || lower.includes('public.tiff')
    || lower.includes('public.tif')
    || lower.includes('public.pdf')
    || lower.includes('com.adobe.pdf')
    || lower.includes('enhanced metafile')
    || lower.includes('windows metafile');
}

function normalizeImageDataUrl(value) {
  const text = String(value || '').trim();
  if (!/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);/i.test(text)) {
    return '';
  }
  return text;
}

function normalizeClipboardText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function decodeBasicHtmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&amp;/gi, '&');
}

function extractCdxml(text) {
  const source = normalizeClipboardText(text);
  const lower = source.toLowerCase();
  const cdxmlStart = lower.indexOf('<cdxml');
  if (cdxmlStart < 0) {
    return '';
  }
  const xmlStart = lower.lastIndexOf('<?xml', cdxmlStart);
  const start = xmlStart >= 0 && cdxmlStart - xmlStart < 500 ? xmlStart : cdxmlStart;
  const closeStart = lower.lastIndexOf('</cdxml>');
  if (closeStart >= cdxmlStart) {
    const closeEnd = lower.indexOf('>', closeStart);
    return source.slice(start, closeEnd >= 0 ? closeEnd + 1 : source.length).trim();
  }
  return source.slice(start).trim();
}

function extractMolfile(text) {
  const source = normalizeClipboardText(text);
  if (!/(^|\n)M\s+END(\n|$)/.test(source) && !/\bV3000\b/.test(source)) {
    return '';
  }
  const lines = source.split('\n');
  const countsIndex = lines.findIndex((line) => /\bV(?:2000|3000)\b/.test(line));
  const v30Index = lines.findIndex((line) => /^M\s+V30\s+BEGIN\s+CTAB\b/i.test(line));
  const markerIndex = countsIndex >= 0 ? countsIndex : v30Index;
  if (markerIndex < 0) {
    return '';
  }
  const endIndex = lines.findIndex((line, index) => index >= markerIndex && /^M\s+END\s*$/i.test(line));
  if (endIndex < 0) {
    return '';
  }
  const sdfEndIndex = lines.findIndex((line, index) => index > endIndex && /^\$\$\$\$\s*$/.test(line));
  const startIndex = Math.max(0, markerIndex - 3);
  const lastIndex = sdfEndIndex >= 0 ? sdfEndIndex : endIndex;
  return lines.slice(startIndex, lastIndex + 1).join('\n').trim();
}

function extractInchi(text) {
  const match = normalizeClipboardText(text).match(/\bInChI=1S?\/[^\s<]+/i);
  return match ? match[0].trim() : '';
}

function extractSmiles(text) {
  const source = normalizeClipboardText(text);
  const labeled = source.match(/\b(?:canonical\s+)?SMILES\s*[:=\t, ]+\s*([A-Za-z0-9@+\-[\]()=#$\\/%.:*]+)\b/i);
  if (labeled && isLikelySmiles(labeled[1])) {
    return labeled[1].trim();
  }

  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && isLikelySmiles(lines[0])) {
    return lines[0];
  }
  return '';
}

function isLikelySmiles(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 5000 || /\s/.test(text) || /^(?:https?:|file:|data:)/i.test(text)) {
    return false;
  }
  if (!SMILES_PATTERN.test(text)) {
    return false;
  }
  return /(?:Cl|Br|Si|Se|Na|Li|Mg|Ca|C|N|O|S|P|F|I|B|c|n|o|s|p|\[[^\]]+\])/.test(text);
}

function pushUniqueCandidate(target, seen, candidate) {
  const source = String(candidate?.source || '').trim();
  if (!source) {
    return;
  }
  const key = `${candidate.sourceFormat || ''}::${source}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push({ ...candidate, source });
}
