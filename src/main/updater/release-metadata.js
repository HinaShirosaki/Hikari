'use strict';

const { normalizeVersion } = require('./version.js');

function normalizeHttpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function resolveNpmReleaseMetadata(metadata = {}) {
  const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata
    : {};
  const latestTag = normalizeVersion(source['dist-tags']?.latest);
  const taggedRelease = latestTag && source.versions && typeof source.versions === 'object'
    ? source.versions[latestTag]
    : null;
  const release = taggedRelease && typeof taggedRelease === 'object'
    ? taggedRelease
    : source;
  const version = normalizeVersion(release.version || latestTag || source.version);
  const packageName = String(release.name || source.name || '').trim();
  const releaseUrl = normalizeHttpsUrl(
    (packageName && `https://www.npmjs.com/package/${packageName}`)
      || release.homepage
      || source.homepage
      || release.dist?.tarball
      || source.dist?.tarball
  );
  const releaseNotes = String(
    release.hikariReleaseNotes
      || release.releaseNotes
      || source.hikariReleaseNotes
      || source.releaseNotes
      || ''
  ).trim();

  return {
    version,
    releaseUrl,
    releaseNotes
  };
}

module.exports = { normalizeHttpsUrl, resolveNpmReleaseMetadata };
