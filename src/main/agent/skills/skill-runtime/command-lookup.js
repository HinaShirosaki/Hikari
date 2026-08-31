'use strict';

const fs = require('node:fs');
const path = require('node:path');

function looksLikePath(value = '') {
  const text = String(value || '');
  return Boolean(text) && (
    text.includes('/')
    || text.includes('\\')
    || text.startsWith('.')
    || path.isAbsolute(text)
  );
}

function splitPathEntries(pathValue = '') {
  return String(pathValue || '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildPathCommandCandidates(commandName = '') {
  const command = String(commandName || '').trim();
  if (!command) {
    return [];
  }
  const extensions = process.platform === 'win32'
    ? ['', '.exe', '.cmd', '.bat', '.com']
    : [''];
  return splitPathEntries(process.env.PATH).flatMap((entry) => (
    extensions.map((extension) => path.join(entry, `${command}${extension}`))
  ));
}

function isRunnableFile(candidatePath = '') {
  const target = String(candidatePath || '').trim();
  if (!target) {
    return false;
  }
  try {
    const stat = fs.statSync(target);
    if (!stat.isFile()) {
      return false;
    }
    if (process.platform === 'win32') {
      return true;
    }
    return (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function commandExists(commandName = '') {
  const command = String(commandName || '').trim();
  if (!command) {
    return false;
  }
  if (looksLikePath(command)) {
    return isRunnableFile(command);
  }
  return buildPathCommandCandidates(command).some((candidate) => isRunnableFile(candidate));
}

function existingDirectory(candidatePath = '') {
  const value = String(candidatePath || '').trim();
  if (!value) {
    return '';
  }
  try {
    return fs.statSync(value).isDirectory() ? value : '';
  } catch {
    return '';
  }
}

function collectSkillDirectories(rootPath = '') {
  const root = existingDirectory(rootPath);
  if (!root) {
    return [];
  }

  if (isRunnableFile(path.join(root, 'SKILL.md')) || fs.existsSync(path.join(root, 'SKILL.md'))) {
    return [root];
  }

  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .filter((candidate) => fs.existsSync(path.join(candidate, 'SKILL.md')));
  } catch {
    return [];
  }
}

module.exports = {
  collectSkillDirectories,
  commandExists,
  existingDirectory
};
