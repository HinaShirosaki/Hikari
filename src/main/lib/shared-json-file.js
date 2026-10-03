'use strict';

const { randomUUID } = require('node:crypto');

// chat_log/index.json is read-modify-written by two independent modules (the chat-log
// runtime and the transform monitor). Serialize those cycles per path and replace the
// file via rename so a concurrent writer can neither tear it nor clobber the other's update.
const locks = new Map();

function withFileLock(filePath, task) {
  const previous = locks.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  locks.set(filePath, current);
  return current.finally(() => {
    if (locks.get(filePath) === current) {
      locks.delete(filePath);
    }
  });
}

async function writeFileAtomic(runtimeFs, filePath, content) {
  // Independent saves can enter during the same millisecond. Each writer must
  // own its temporary file through rename and failure cleanup.
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await runtimeFs.writeFile(temporaryPath, content, 'utf8');
    await runtimeFs.rename(temporaryPath, filePath);
  } catch (error) {
    await runtimeFs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

// Files torn by the pre-lock race are a complete pretty-printed document followed by the
// tail of a longer one; the first line that is exactly `}` closes the valid document.
function parseJsonSalvagingTornTail(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const end = raw.indexOf('\n}');
    if (!(error instanceof SyntaxError) || end === -1) {
      throw error;
    }
    return JSON.parse(raw.slice(0, end + 2));
  }
}

module.exports = {
  withFileLock,
  writeFileAtomic,
  parseJsonSalvagingTornTail
};
