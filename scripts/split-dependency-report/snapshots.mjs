import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SNAPSHOT_FILE_PATTERN = /\.(?:c?js|mjs|json)$/;

function toPosix(value) {
  return String(value || '').split(path.sep).join('/');
}

function git(repoRoot, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    ...options
  });
}

function listWorkingTreeFiles(repoRoot, relativeRoot = 'src') {
  const absoluteRoot = path.join(repoRoot, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = toPosix(path.join(relativeRoot, entry.name));
    return entry.isDirectory()
      ? listWorkingTreeFiles(repoRoot, relativePath)
      : (entry.isFile() && SNAPSHOT_FILE_PATTERN.test(entry.name) ? [relativePath] : []);
  });
}

function readWorkingTreeSnapshot(repoRoot) {
  const filePaths = [
    ...listWorkingTreeFiles(repoRoot, 'src'),
    ...listWorkingTreeFiles(repoRoot, 'vendor'),
    'package.json'
  ].sort((left, right) => left.localeCompare(right));
  const files = new Map();
  filePaths.forEach((filePath) => {
    const absolutePath = path.join(repoRoot, filePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      files.set(filePath, fs.readFileSync(absolutePath, 'utf8'));
    }
  });
  return files;
}

function readGitSnapshot(repoRoot, ref) {
  const rawPaths = git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', ref, '--', 'src', 'vendor', 'package.json'], {
    encoding: 'buffer'
  });
  const filePaths = rawPaths
    .toString('utf8')
    .split('\0')
    .filter((filePath) => filePath === 'package.json' || SNAPSHOT_FILE_PATTERN.test(filePath))
    .sort((left, right) => left.localeCompare(right));
  const files = new Map();
  filePaths.forEach((filePath) => {
    files.set(filePath, git(repoRoot, ['show', `${ref}:${filePath}`]));
  });
  return files;
}

function compareFileSets(beforeFiles, afterFiles) {
  const allPaths = new Set([...beforeFiles.keys(), ...afterFiles.keys()]);
  const added = [];
  const modified = [];
  const deleted = [];
  const unchanged = [];
  [...allPaths].sort((left, right) => left.localeCompare(right)).forEach((filePath) => {
    const before = beforeFiles.get(filePath);
    const after = afterFiles.get(filePath);
    if (before === undefined) {
      added.push(filePath);
    } else if (after === undefined) {
      deleted.push(filePath);
    } else if (before !== after) {
      modified.push(filePath);
    } else {
      unchanged.push(filePath);
    }
  });
  return { added, modified, deleted, unchanged };
}

export {
  SNAPSHOT_FILE_PATTERN,
  compareFileSets,
  readGitSnapshot,
  readWorkingTreeSnapshot,
  toPosix
};
