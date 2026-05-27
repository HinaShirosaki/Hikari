'use strict';

const fs = require('fs/promises');
const path = require('path');
const {
  ALIGNMENTS_DIR_NAME,
  ALIGNMENTS_MANIFEST_FILE_NAME
} = require('./constants');
const { clearDirectoryContents, ensurePathWithinRoot, toPosixRelative } = require('./paths');
const {
  cleanText,
  normalizeName,
  sanitizeFileName
} = require('./utils');
const {
  normalizeAlignmentQueryRecord,
  normalizeAlignmentResultPayload,
  normalizeAlignmentSessionPayload,
  normalizeAlignmentSourceKind,
  normalizeAlignmentTimestamp
} = require('./alignment-normalize');

function resolveAlignmentStoragePaths(entryDir) {
  const alignmentsDir = path.join(entryDir, ALIGNMENTS_DIR_NAME);
  return {
    alignmentsDir,
    manifestPath: path.join(alignmentsDir, ALIGNMENTS_MANIFEST_FILE_NAME)
  };
}

function normalizeStoredAlignmentSession(session) {
  const safeSession = session && typeof session === 'object' ? session : null;
  if (!safeSession?.id || !safeSession?.queryRecord) {
    return null;
  }

  return {
    id: cleanText(safeSession.id, 200),
    name: normalizeName(safeSession.name || safeSession.queryRecord?.name || 'alignment', 'alignment'),
    referenceRecordKey: cleanText(safeSession.referenceRecordKey || safeSession.referenceKey, 200),
    referenceRecordName: normalizeName(safeSession.referenceRecordName || 'reference', 'reference'),
    sourceKind: normalizeAlignmentSourceKind(safeSession.sourceKind),
    sourceFormat: cleanText(safeSession.sourceFormat || safeSession.queryRecord?.sourceFormat, 80).toLowerCase() || 'raw',
    originalFileName: cleanText(safeSession.originalFileName, 240),
    storedSourceRelPath: cleanText(safeSession.storedSourceRelPath, 1200),
    queryRecord: normalizeAlignmentQueryRecord(safeSession.queryRecord),
    result: normalizeAlignmentResultPayload(safeSession.result),
    createdAt: normalizeAlignmentTimestamp(safeSession.createdAt),
    updatedAt: normalizeAlignmentTimestamp(safeSession.updatedAt)
  };
}

async function readAlignmentManifest(entryDir) {
  const paths = resolveAlignmentStoragePaths(entryDir);
  try {
    const raw = await fs.readFile(paths.manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    const sessions = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    return sessions.map((session) => normalizeStoredAlignmentSession(session)).filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

async function writeAlignmentManifest(entryDir, inputSessions = [], libraryRoot) {
  const paths = resolveAlignmentStoragePaths(entryDir);
  const existingSessions = await readAlignmentManifest(entryDir);
  const existingById = new Map(existingSessions.map((session) => [session.id, session]));
  const nextSessions = [];

  if (!Array.isArray(inputSessions) || !inputSessions.length) {
    await fs.rm(paths.alignmentsDir, { recursive: true, force: true });
    return [];
  }

  await fs.mkdir(paths.alignmentsDir, { recursive: true });
  for (let index = 0; index < inputSessions.length; index += 1) {
    const nextSession = await writeSingleAlignmentSession({
      index,
      inputSession: inputSessions[index],
      existingById,
      paths,
      libraryRoot
    });
    if (nextSession) {
      nextSessions.push(nextSession);
    }
  }

  await pruneRemovedAlignmentDirs(paths.alignmentsDir, nextSessions);
  await fs.writeFile(paths.manifestPath, JSON.stringify({ sessions: nextSessions }, null, 2), 'utf8');
  return nextSessions;
}

async function writeSingleAlignmentSession({ index, inputSession, existingById, paths, libraryRoot }) {
  const existingSession = existingById.get(cleanText(inputSession?.id, 200)) || null;
  const normalized = normalizeAlignmentSessionPayload(inputSession, index, existingSession);
  if (!normalized) {
    return null;
  }

  const sessionDirName = sanitizeFileName(normalized.id, `alignment_${index + 1}`);
  const sessionDir = path.join(paths.alignmentsDir, sessionDirName);
  await fs.mkdir(sessionDir, { recursive: true });

  let storedSourceRelPath = normalized.storedSourceRelPath;
  if (normalized._sourceText || normalized._sourceBytes) {
    await clearDirectoryContents(sessionDir);
    const sourceFileName = `${normalized._sourceBaseName}${normalized._sourceExtension}`;
    const sourceAbsPath = path.join(sessionDir, sourceFileName);
    if (normalized._sourceBytes) {
      await fs.writeFile(sourceAbsPath, normalized._sourceBytes);
    } else {
      await fs.writeFile(sourceAbsPath, normalized._sourceText, 'utf8');
    }
    storedSourceRelPath = toPosixRelative(libraryRoot, sourceAbsPath);
  }

  return {
    id: normalized.id,
    name: normalized.name,
    referenceRecordKey: normalized.referenceRecordKey,
    referenceRecordName: normalized.referenceRecordName,
    sourceKind: normalized.sourceKind,
    sourceFormat: normalized.sourceFormat,
    originalFileName: normalized.originalFileName,
    storedSourceRelPath,
    queryRecord: normalized.queryRecord,
    result: normalized.result,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt
  };
}

async function pruneRemovedAlignmentDirs(alignmentsDir, nextSessions) {
  const keepSessionDirs = new Set(nextSessions.map((session) => sanitizeFileName(session.id, session.id)));
  try {
    const entries = await fs.readdir(alignmentsDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() && !keepSessionDirs.has(entry.name)) {
        await fs.rm(path.join(alignmentsDir, entry.name), { recursive: true, force: true });
      }
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

function attachAlignmentSourcePaths(sessions, libraryRoot) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => {
      const safeSession = normalizeStoredAlignmentSession(session);
      if (!safeSession) {
        return null;
      }
      const storedSourcePath = safeSession.storedSourceRelPath
        ? ensurePathWithinRoot(libraryRoot, safeSession.storedSourceRelPath)
        : '';
      return { ...safeSession, storedSourcePath };
    })
    .filter(Boolean);
}

module.exports = {
  attachAlignmentSourcePaths,
  readAlignmentManifest,
  writeAlignmentManifest
};
