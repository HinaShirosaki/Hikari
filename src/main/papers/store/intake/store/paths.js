'use strict';

const path = require('node:path');
const { ensureObject } = require('../../../../lib/normalize.js');
const { buildKnowledgeMarkdownFileName } = require('../../paper-knowledge-paths.js');
const { INTAKE_FILE_NAME, PAPERS_ROOT_REL, cleanText } = require('./record-normalizing.js');

function intakeRelativePath(paperId = '') {
  const id = cleanText(paperId, 200);
  if (!id) {
    return '';
  }
  return path.posix.join(PAPERS_ROOT_REL, id, INTAKE_FILE_NAME);
}

function defaultSourcePaths(paperId = '', options = {}) {
  const id = cleanText(paperId, 200);
  if (!id) {
    return { paper_md: '', figures_dir: '', pdf_path: '' };
  }
  const source = typeof options === 'string' ? { paper_md: options } : ensureObject(options);
  const dir = path.posix.join(PAPERS_ROOT_REL, id);
  const explicitPaperMd = cleanText(source.paper_md || source.paperMd, 400);
  const markdownFileName = explicitPaperMd
    ? ''
    : buildKnowledgeMarkdownFileName({ title: cleanText(source.title, 400) });
  return {
    paper_md: explicitPaperMd || path.posix.join(dir, markdownFileName),
    figures_dir: path.posix.join(dir, 'figures'),
    pdf_path: ''
  };
}

module.exports = {
  defaultSourcePaths,
  intakeRelativePath
};
