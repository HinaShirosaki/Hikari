'use strict';

function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v(?=\d)/i, '');
}

function parseSemver(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
  );
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function comparePrerelease(left = [], right = []) {
  if (!left.length && !right.length) {
    return 0;
  }
  if (!left.length) {
    return 1;
  }
  if (!right.length) {
    return -1;
  }
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }
    if (leftValue === rightValue) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftValue);
    const rightNumeric = /^\d+$/.test(rightValue);
    if (leftNumeric && rightNumeric) {
      return Number(leftValue) > Number(rightValue) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    return null;
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] > right[key] ? 1 : -1;
    }
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

// Enough of npm's range syntax for package.json's electron entry: ^x.y.z, ~x.y.z,
// >=x.y.z or an exact version. Anything else counts as not satisfied, which
// makes the updater rebuild the whole app.
function satisfiesRange(version, range) {
  const match = String(range || '').trim().match(/^(\^|~|>=|=)?\s*(\S+)$/);
  const current = parseSemver(version);
  const floor = match && parseSemver(match[2]);
  if (!current || !floor || compareSemver(version, match[2]) < 0) {
    return false;
  }
  switch (match[1] || '=') {
    case '>=': return true;
    case '=': return compareSemver(version, match[2]) === 0;
    case '~': return current.major === floor.major && current.minor === floor.minor;
    default: return floor.major > 0
      ? current.major === floor.major
      : current.major === 0 && current.minor === floor.minor;
  }
}

module.exports = { compareSemver, normalizeVersion, parseSemver, satisfiesRange };
