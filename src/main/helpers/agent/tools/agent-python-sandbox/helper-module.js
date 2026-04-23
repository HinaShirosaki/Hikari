'use strict';

const fs = require('fs/promises');
const { ensureObject } = require('./utils.js');
const { normalizePythonSandboxRenderOutputs } = require('./normalize.js');

function buildPythonSandboxHelperModule() {
  return [
    'import atexit',
    'import base64',
    'import json',
    'import os',
    '',
    '_ROOT = os.path.abspath(os.environ.get("ENANA_SANDBOX_ROOT") or os.getcwd())',
    '_OUTPUT_PATH = os.path.abspath(os.environ.get("ENANA_SANDBOX_OUTPUT_PATH") or os.path.join(_ROOT, ".enana_sandbox_render_outputs.json"))',
    '_RENDER_OUTPUTS = []',
    '',
    'def _resolve_path(relative_path):',
    '    text = str(relative_path or "").replace("\\\\", "/").strip()',
    '    if not text:',
    '        raise ValueError("Path is required.")',
    '    target = os.path.abspath(os.path.join(_ROOT, text))',
    '    root_prefix = _ROOT if _ROOT.endswith(os.sep) else _ROOT + os.sep',
    '    if target != _ROOT and not target.startswith(root_prefix):',
    '        raise ValueError("Path must stay inside sandbox root.")',
    '    return target',
    '',
    'def read_text(relative_path, encoding="utf-8"):',
    '    with open(_resolve_path(relative_path), "r", encoding=encoding) as handle:',
    '        return handle.read()',
    '',
    'def read_bytes(relative_path):',
    '    with open(_resolve_path(relative_path), "rb") as handle:',
    '        return handle.read()',
    '',
    'def read_json(relative_path, encoding="utf-8"):',
    '    return json.loads(read_text(relative_path, encoding=encoding))',
    '',
    'def emit_text(content, title=None, format="text/plain"):',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "text",',
    '        "title": str(title or ""),',
    '        "format": str(format or "text/plain"),',
    '        "content": str(content or "")',
    '    })',
    '',
    'def emit_markdown(content, title=None):',
    '    emit_text(content, title=title, format="text/markdown")',
    '',
    'def emit_json(value, title=None):',
    '    emit_text(json.dumps(value, indent=2, ensure_ascii=False), title=title, format="application/json")',
    '',
    'def emit_image(relative_path, title=None, mime_type=None, alt=None):',
    '    image_path = _resolve_path(relative_path)',
    '    with open(image_path, "rb") as handle:',
    '        encoded = base64.b64encode(handle.read()).decode("ascii")',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "image",',
    '        "title": str(title or ""),',
    '        "mime_type": str(mime_type or ""),',
    '        "alt": str(alt or title or ""),',
    '        "path": str(relative_path or ""),',
    '        "data_base64": encoded',
    '    })',
    '',
    'def emit_image_bytes(data, mime_type="image/png", title=None, alt=None):',
    '    encoded = base64.b64encode(bytes(data or b"")).decode("ascii")',
    '    _RENDER_OUTPUTS.append({',
    '        "type": "image",',
    '        "title": str(title or ""),',
    '        "mime_type": str(mime_type or "image/png"),',
    '        "alt": str(alt or title or ""),',
    '        "data_base64": encoded',
    '    })',
    '',
    'def list_outputs():',
    '    return list(_RENDER_OUTPUTS)',
    '',
    'def clear_outputs():',
    '    _RENDER_OUTPUTS.clear()',
    '',
    'def _persist_outputs():',
    '    payload = {',
    '        "version": 1,',
    '        "outputs": _RENDER_OUTPUTS',
    '    }',
    '    parent = os.path.dirname(_OUTPUT_PATH)',
    '    if parent:',
    '        os.makedirs(parent, exist_ok=True)',
    '    temp_path = _OUTPUT_PATH + ".tmp"',
    '    with open(temp_path, "w", encoding="utf-8") as handle:',
    '        json.dump(payload, handle)',
    '    os.replace(temp_path, _OUTPUT_PATH)',
    '',
    'atexit.register(_persist_outputs)'
  ].join('\n');
}

async function readPythonSandboxRenderOutputs(renderOutputPath, warnings = []) {
  try {
    const raw = await fs.readFile(renderOutputPath, 'utf8');
    const payload = JSON.parse(raw);
    const source = ensureObject(payload);
    return normalizePythonSandboxRenderOutputs(source.outputs, warnings);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    warnings.push(`Failed to load sandbox render outputs: ${String(error?.message || error)}.`);
    return [];
  }
}

module.exports = {
  buildPythonSandboxHelperModule,
  readPythonSandboxRenderOutputs
};
