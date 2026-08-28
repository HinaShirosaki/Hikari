'use strict';

const { DIFSECT, ENDOFCHAIN, FATSECT, FREESECT, OLE_SIGNATURE } = require('./constants.js');

function sectorOffset(sector, sectorSize) {
  return 512 + (sector * sectorSize);
}

function readSector(buffer, sector, sectorSize) {
  const offset = sectorOffset(sector, sectorSize);
  return buffer.subarray(offset, offset + sectorSize);
}

function readSectorChain(buffer, fat, startSector, sectorSize, maxBytes = Infinity) {
  const chunks = [];
  const seen = new Set();
  let sector = startSector;
  let remaining = maxBytes;
  while (
    sector !== ENDOFCHAIN
    && sector !== FREESECT
    && sector !== FATSECT
    && sector !== DIFSECT
    && Number.isInteger(sector)
    && sector >= 0
    && !seen.has(sector)
    && remaining > 0
  ) {
    seen.add(sector);
    const chunk = readSector(buffer, sector, sectorSize);
    chunks.push(remaining === Infinity ? chunk : chunk.subarray(0, remaining));
    remaining -= chunk.length;
    sector = fat[sector];
  }
  return Buffer.concat(chunks).subarray(0, maxBytes === Infinity ? undefined : maxBytes);
}

function parseDirectoryEntries(directoryStream) {
  const entries = [];
  for (let offset = 0; offset + 128 <= directoryStream.length; offset += 128) {
    const entry = directoryStream.subarray(offset, offset + 128);
    const nameLength = entry.readUInt16LE(64);
    const rawName = nameLength >= 2
      ? entry.subarray(0, nameLength - 2).toString('utf16le')
      : '';
    const type = entry[66];
    const startSector = entry.readUInt32LE(116);
    const sizeLow = entry.readUInt32LE(120);
    const sizeHigh = entry.readUInt32LE(124);
    const size = sizeHigh ? (sizeHigh * 0x100000000) + sizeLow : sizeLow;
    if (rawName) {
      entries.push({
        name: rawName,
        type,
        startSector,
        size
      });
    }
  }
  return entries;
}

function readOleCompoundFile(buffer) {
  if (buffer.length < 512 || !buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
    throw new Error('XLS file is not a valid OLE compound file.');
  }

  const sectorSize = 1 << buffer.readUInt16LE(30);
  const miniSectorSize = 1 << buffer.readUInt16LE(32);
  const fatSectorCount = buffer.readUInt32LE(44);
  const firstDirectorySector = buffer.readUInt32LE(48);
  const miniStreamCutoff = buffer.readUInt32LE(56);
  const firstMiniFatSector = buffer.readUInt32LE(60);
  const miniFatSectorCount = buffer.readUInt32LE(64);
  const firstDifatSector = buffer.readUInt32LE(68);
  const difatSectorCount = buffer.readUInt32LE(72);
  const difat = [];

  for (let index = 0; index < 109; index += 1) {
    const sector = buffer.readUInt32LE(76 + (index * 4));
    if (sector !== FREESECT) {
      difat.push(sector);
    }
  }

  let difatSector = firstDifatSector;
  for (let index = 0; index < difatSectorCount && difatSector !== ENDOFCHAIN; index += 1) {
    const sector = readSector(buffer, difatSector, sectorSize);
    const entriesPerSector = (sectorSize / 4) - 1;
    for (let entryIndex = 0; entryIndex < entriesPerSector; entryIndex += 1) {
      const value = sector.readUInt32LE(entryIndex * 4);
      if (value !== FREESECT) {
        difat.push(value);
      }
    }
    difatSector = sector.readUInt32LE(sectorSize - 4);
  }

  const fat = [];
  difat.slice(0, fatSectorCount || difat.length).forEach((sectorIndex) => {
    const sector = readSector(buffer, sectorIndex, sectorSize);
    for (let offset = 0; offset < sector.length; offset += 4) {
      fat.push(sector.readUInt32LE(offset));
    }
  });

  const directoryStream = readSectorChain(buffer, fat, firstDirectorySector, sectorSize);
  const entries = parseDirectoryEntries(directoryStream);
  const rootEntry = entries.find((entry) => entry.type === 5);
  const miniStream = rootEntry
    ? readSectorChain(buffer, fat, rootEntry.startSector, sectorSize, rootEntry.size)
    : Buffer.alloc(0);

  const miniFat = [];
  if (firstMiniFatSector !== ENDOFCHAIN && miniFatSectorCount > 0) {
    const miniFatStream = readSectorChain(buffer, fat, firstMiniFatSector, sectorSize, miniFatSectorCount * sectorSize);
    for (let offset = 0; offset + 4 <= miniFatStream.length; offset += 4) {
      miniFat.push(miniFatStream.readUInt32LE(offset));
    }
  }

  function readMiniStream(startSector, size) {
    const chunks = [];
    const seen = new Set();
    let sector = startSector;
    let remaining = size;
    while (
      sector !== ENDOFCHAIN
      && sector !== FREESECT
      && Number.isInteger(sector)
      && sector >= 0
      && !seen.has(sector)
      && remaining > 0
    ) {
      seen.add(sector);
      const offset = sector * miniSectorSize;
      const chunk = miniStream.subarray(offset, offset + Math.min(miniSectorSize, remaining));
      chunks.push(chunk);
      remaining -= chunk.length;
      sector = miniFat[sector];
    }
    return Buffer.concat(chunks).subarray(0, size);
  }

  function readStream(entry) {
    if (!entry || entry.type !== 2) {
      return Buffer.alloc(0);
    }
    if (entry.size < miniStreamCutoff && miniStream.length && miniFat.length) {
      return readMiniStream(entry.startSector, entry.size);
    }
    return readSectorChain(buffer, fat, entry.startSector, sectorSize, entry.size);
  }

  return {
    entries,
    readStream
  };
}

module.exports = {
  readOleCompoundFile
};
