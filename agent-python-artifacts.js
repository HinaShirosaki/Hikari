'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  asArray,
  cleanText,
  normalizeRelativePath
} = require('./agent-python-common');

function sanitizeFileName(value, fallback = 'artifact.txt') {
  const text = cleanText(value, 180)
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return text || fallback;
}

function ensurePathInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget === resolvedRoot) {
    return resolvedTarget;
  }
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : `${resolvedRoot}${path.sep}`;
  if (!resolvedTarget.startsWith(rootWithSep)) {
    throw new Error('Artifact target must be inside storage root.');
  }
  return resolvedTarget;
}

function mapContentType(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'text/csv';
  }
  if (lower.endsWith('.tsv')) {
    return 'text/tab-separated-values';
  }
  if (lower.endsWith('.json')) {
    return 'application/json';
  }
  if (lower.endsWith('.txt')) {
    return 'text/plain';
  }
  if (lower.endsWith('.png')) {
    return 'image/png';
  }
  if (lower.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}

async function persistPythonArtifacts({ sandboxItem, storagePath, projectName = '' }) {
  const normalizedStoragePath = cleanText(storagePath, 1200);
  if (!normalizedStoragePath) {
    return {
      applied: false,
      artifact_count: 0,
      result_files: [],
      result_file_records: [],
      citations: [],
      summary: 'Python artifact persistence skipped: storage path was not configured.'
    };
  }

  const source = sandboxItem && typeof sandboxItem === 'object' ? sandboxItem : {};
  const runId = sanitizeFileName(cleanText(source.run_id, 120), 'python_run');
  const readbackFiles = asArray(source.readback_files).map((entry) => ({
    relative_path: normalizeRelativePath(entry?.path),
    content: cleanText(entry?.content, 20000),
    truncated: entry?.truncated === true
  })).filter((entry) => entry.relative_path);

  if (!readbackFiles.length) {
    return {
      applied: false,
      artifact_count: 0,
      result_files: [],
      result_file_records: [],
      citations: [],
      summary: 'Python artifact persistence skipped: no readback files were produced.'
    };
  }

  const projectFolder = sanitizeFileName(projectName, 'unscoped_project');
  const artifactFolder = ensurePathInsideRoot(
    normalizedStoragePath,
    path.join(normalizedStoragePath, 'Agent', 'Python', projectFolder)
  );
  await fs.mkdir(artifactFolder, { recursive: true });

  const resultFiles = [];
  const resultFileRecords = [];
  const citations = [];

  for (let index = 0; index < readbackFiles.length; index += 1) {
    const file = readbackFiles[index];
    const baseName = sanitizeFileName(path.basename(file.relative_path), `artifact_${index + 1}.txt`);
    const uniqueName = sanitizeFileName(`${runId}_${index + 1}_${baseName}`, `artifact_${index + 1}.txt`);
    const absolutePath = ensurePathInsideRoot(artifactFolder, path.join(artifactFolder, uniqueName));
    await fs.writeFile(absolutePath, file.content, 'utf8');

    const relativePath = path.relative(normalizedStoragePath, absolutePath).split(path.sep).join('/');
    const sizeBytes = Buffer.byteLength(file.content, 'utf8');
    const contentType = mapContentType(uniqueName);
    resultFiles.push(uniqueName);
    resultFileRecords.push({
      kind: 'python_artifact',
      name: uniqueName,
      relativePath,
      filePath: absolutePath,
      sizeBytes,
      contentType,
      sourcePath: file.relative_path,
      truncated: file.truncated
    });
    citations.push({
      source: 'python_artifact',
      pointer: relativePath,
      reason: 'Persisted deterministic Python sandbox readback artifact.'
    });
  }

  return {
    applied: true,
    artifact_count: resultFileRecords.length,
    result_files: resultFiles,
    result_file_records: resultFileRecords,
    citations,
    summary: `Persisted ${resultFileRecords.length} Python artifact file(s).`
  };
}

module.exports = {
  persistPythonArtifacts
};
