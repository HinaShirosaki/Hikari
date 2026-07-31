'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { CODEX_TMP_DIR_NAME } = require('./constants');
const { resolveWorkingDirectory } = require('./paths');
const { cleanText } = require('./utils');

function sanitizeFileName(fileName, fallback = 'paper.pdf') {
  const raw = String(fileName || '').trim().replace(/[/\\]+/g, '_');
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  const normalized = safe || fallback;
  if (/\.pdf$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}.pdf`;
}

function sanitizeAttachmentFileName(fileName, fallback = 'attachment.bin') {
  const raw = String(fileName || '').trim().replace(/[/\\]+/g, '_');
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || fallback;
}

function parseBase64DataUrl(dataUrl = '') {
  const match = String(dataUrl || '').trim().match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[2]) {
    return null;
  }
  return {
    mimeType: cleanText(match[1], 120),
    buffer: Buffer.from(match[2], 'base64')
  };
}

async function createCodexOutputFilePath(cwd = '') {
  const safeCwd = resolveWorkingDirectory(cwd);
  const outputDir = path.join(safeCwd, 'Tmp', CODEX_TMP_DIR_NAME);
  await fs.mkdir(outputDir, { recursive: true });
  return path.join(outputDir, `last-message-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`);
}

async function stageCodexOutputSchema(cwd = '', outputSchema = null) {
  if (!outputSchema || typeof outputSchema !== 'object' || Array.isArray(outputSchema)) {
    return '';
  }
  const safeCwd = resolveWorkingDirectory(cwd);
  const outputDir = path.join(safeCwd, 'Tmp', CODEX_TMP_DIR_NAME);
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(
    outputDir,
    `output-schema-${Date.now()}-${Math.random().toString(16).slice(2)}.json`
  );
  await fs.writeFile(filePath, `${JSON.stringify(outputSchema, null, 2)}\n`, 'utf8');
  return filePath;
}

async function stageCodexPromptAttachments({
  cwd = '',
  fileName = '',
  pdfDataUrl = '',
  imageDataUrl = '',
  imageUrl = '',
  attachments = []
} = {}) {
  const safeCwd = resolveWorkingDirectory(cwd);
  const rawAttachments = Array.isArray(attachments) && attachments.length
    ? normalizeExplicitAttachments(attachments)
    : normalizeLegacyAttachments({ fileName, pdfDataUrl, imageDataUrl, imageUrl });
  const normalized = rawAttachments.filter((attachment) => attachment.dataUrl);
  if (!normalized.length) {
    return [];
  }
  const attachmentDir = path.join(safeCwd, 'CodexAttachments');
  await fs.mkdir(attachmentDir, { recursive: true });
  const staged = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const stagedAttachment = await stageCodexAttachment(attachmentDir, safeCwd, normalized[index], index);
    if (stagedAttachment) {
      staged.push(stagedAttachment);
    }
  }
  return staged;
}

function normalizeExplicitAttachments(attachments = []) {
  return attachments.map((attachment) => {
    const source = attachment && typeof attachment === 'object' ? attachment : {};
    return {
      kind: cleanText(source.kind, 40),
      name: sanitizeAttachmentFileName(source.name || 'attachment.bin'),
      dataUrl: cleanText(source.dataUrl || source.data_url, 400000)
    };
  });
}

function normalizeLegacyAttachments({ fileName = '', pdfDataUrl = '', imageDataUrl = '', imageUrl = '' } = {}) {
  return [
    ...(pdfDataUrl ? [{
      kind: 'file',
      name: sanitizeFileName(fileName || 'paper.pdf'),
      dataUrl: String(pdfDataUrl)
    }] : []),
    ...(cleanText(imageDataUrl || imageUrl, 400000) ? [{
      kind: 'image',
      name: 'image.png',
      dataUrl: cleanText(imageDataUrl || imageUrl, 400000)
    }] : [])
  ];
}

async function stageCodexAttachment(attachmentDir, safeCwd, attachment, index) {
  const parsed = parseBase64DataUrl(attachment.dataUrl);
  if (!parsed?.buffer?.length) {
    return null;
  }
  const fallback = attachment.kind === 'image' ? `image-${index + 1}.png` : `attachment-${index + 1}.bin`;
  const filePath = path.join(attachmentDir, sanitizeAttachmentFileName(attachment.name, fallback));
  await fs.writeFile(filePath, parsed.buffer);
  return {
    kind: attachment.kind || (parsed.mimeType.startsWith('image/') ? 'image' : 'file'),
    name: path.basename(filePath),
    mimeType: parsed.mimeType,
    path: filePath,
    relativePath: path.relative(safeCwd, filePath)
  };
}

function buildCodexPromptWithStagedAttachments(prompt = '', stagedAttachments = []) {
  const cleanPrompt = String(prompt || '').trim();
  if (!stagedAttachments.length) {
    return cleanPrompt;
  }
  const attachmentRows = stagedAttachments.map((attachment) => (
    `- ${attachment.name} (${attachment.mimeType || attachment.kind || 'file'}): ${attachment.relativePath}`
  ));
  return [
    cleanPrompt,
    'Hikari staged the following input files in this Codex workspace. Read them from disk if they are relevant:',
    attachmentRows.join('\n')
  ].join('\n\n');
}

module.exports = {
  buildCodexPromptWithStagedAttachments,
  createCodexOutputFilePath,
  parseBase64DataUrl,
  sanitizeAttachmentFileName,
  sanitizeFileName,
  stageCodexOutputSchema,
  stageCodexPromptAttachments
};
