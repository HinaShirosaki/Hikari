// Pure request/response helpers for the headless .dna conversion service.
// Loaded as a classic script because service plugins run in an opaque-origin
// iframe. The actual .dna parser and GenBank writer are Biopython; JavaScript
// only transports bytes through Hikari's sandboxed Python API.

'use strict';

(function installDnaBiopython(root) {
  const PYTHON_CODE = [
    'import base64',
    'import json',
    'import pathlib',
    'import re',
    '',
    'try:',
    '    from Bio import SeqIO',
    'except ImportError as exc:',
    '    raise RuntimeError("Biopython is required. Install it in Hikari python with: python3 -m pip install biopython") from exc',
    '',
    'request = json.loads(pathlib.Path("request.json").read_text(encoding="utf-8"))',
    'encoded = pathlib.Path("input.dna.b64").read_text(encoding="ascii").strip()',
    'try:',
    '    raw = base64.b64decode(encoded, validate=True)',
    'except Exception as exc:',
    '    raise RuntimeError("The .dna input bytes were not valid base64.") from exc',
    'if not raw:',
    '    raise RuntimeError("The .dna file is empty.")',
    'pathlib.Path("input.dna").write_bytes(raw)',
    '',
    'try:',
    '    record = SeqIO.read("input.dna", "snapgene")',
    'except Exception as exc:',
    '    raise RuntimeError(f"Biopython could not parse the .dna file: {exc}") from exc',
    '',
    'filename = pathlib.Path(str(request.get("filename") or "sequence.dna")).name',
    'stem = pathlib.Path(filename).stem',
    'safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem).strip("_.-") or "sequence"',
    'locus_name = safe_name[:16]',
    'record.id = locus_name',
    'record.name = locus_name',
    'if not record.description or record.description == "<unknown description>":',
    '    record.description = f"Converted from {filename} by the Hikari Biopython service"',
    'record.annotations.setdefault("molecule_type", "DNA")',
    '',
    'written = SeqIO.write(record, "output.gbk", "genbank")',
    'if written != 1:',
    '    raise RuntimeError("Biopython did not produce exactly one GenBank record.")',
    'print(json.dumps({',
    '    "name": locus_name,',
    '    "sequence_length": len(record.seq),',
    '    "topology": record.annotations.get("topology", "linear")',
    '}))'
  ].join('\n');

  const MAX_BASE64_INPUT_CHARS = 3950000;

  function normalizeBytes(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (Array.isArray(value)) {
      return new Uint8Array(value);
    }
    throw new Error('The conversion request did not contain .dna file bytes.');
  }

  function bytesToBase64(value) {
    const bytes = normalizeBytes(value);
    if (typeof btoa === 'function') {
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 0x8000));
      }
      return btoa(binary);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(bytes).toString('base64');
    }
    throw new Error('This runtime cannot encode the .dna bytes for Python.');
  }

  function buildPythonRunParams(bytes, options) {
    const filename = String((options && options.filename) || 'sequence.dna');
    const encoded = bytesToBase64(bytes);
    if (encoded.length > MAX_BASE64_INPUT_CHARS) {
      throw new Error('This .dna file is too large for the Hikari Python service.');
    }
    return {
      code: PYTHON_CODE,
      files: [
        { path: 'input.dna.b64', content: encoded },
        { path: 'request.json', content: JSON.stringify({ filename: filename }) }
      ],
      readbackPaths: ['output.gbk'],
      timeoutMs: 12000
    };
  }

  function extractGenBankResult(result) {
    if (!result || result.ok !== true) {
      const detail = result
        ? [result.error, result.stderr]
          .map(function (value) { return String(value || '').trim(); })
          .filter(Boolean)
          .join('\n') || String(result.status || 'The Python conversion failed.')
        : 'The Python conversion failed.';
      throw new Error(detail);
    }
    const output = (Array.isArray(result.files) ? result.files : [])
      .find(function (file) { return file && file.path === 'output.gbk'; });
    if (!output) {
      throw new Error('Biopython completed without returning output.gbk.');
    }
    if (output.truncated) {
      throw new Error('The converted GenBank file exceeded the Python API readback limit.');
    }
    const text = String(output.content || '');
    if (!/^LOCUS\s/m.test(text) || !/^ORIGIN\s*$/m.test(text) || !/^\/\/\s*$/m.test(text)) {
      throw new Error('Biopython returned an invalid GenBank record.');
    }
    return text;
  }

  async function convertWithPython(hikari, bytes, options) {
    if (!hikari || typeof hikari.call !== 'function') {
      throw new Error('The Hikari Python API is unavailable.');
    }
    const result = await hikari.call('python.run', buildPythonRunParams(bytes, options));
    return extractGenBankResult(result);
  }

  const api = Object.freeze({
    PYTHON_CODE,
    bytesToBase64,
    buildPythonRunParams,
    extractGenBankResult,
    convertWithPython
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DnaBiopython = api;
  }
}(typeof window !== 'undefined' ? window : null));
