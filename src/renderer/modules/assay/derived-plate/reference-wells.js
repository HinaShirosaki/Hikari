import { isValidWellForDefinition, parseWellId, rowLabelToIndex, toRowLabel, wellIdFor } from '../plate-model.js';
import { cleanReference } from './transform-spec.js';

function wellsForRow(rowLabel, def) {
  const rowIndex = rowLabelToIndex(rowLabel);
  if (rowIndex < 0 || rowIndex >= def.rows) {
    return [];
  }
  return Array.from({ length: def.columns }, (_, column) => wellIdFor(rowIndex, column));
}

function wellsForColumn(columnNumber, def) {
  const columnIndex = Number(columnNumber) - 1;
  if (!Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= def.columns) {
    return [];
  }
  return Array.from({ length: def.rows }, (_, row) => wellIdFor(row, columnIndex));
}

function groupWells(token, def, groupSpecs) {
  const lowered = token.toLowerCase();
  const rowGroup = groupSpecs.row.groups.find((group) => group.label.toLowerCase() === lowered);
  if (rowGroup) {
    return rowGroup.members.flatMap((member) => wellsForRow(member, def));
  }
  const columnGroup = groupSpecs.column.groups.find((group) => group.label.toLowerCase() === lowered);
  if (columnGroup) {
    return columnGroup.members.flatMap((member) => wellsForColumn(member, def));
  }
  return [];
}

// A reference is a comma/space separated list of wells (A1), whole rows (A, A-C),
// whole columns (3, 3-5), or the name of a custom group. Plate coordinates are
// matched first, so a group named "A" does not shadow row A.
function resolveReferenceWells(reference, def, groupSpecs) {
  const text = cleanReference(reference);
  if (!text) {
    return { wells: [], unresolved: [] };
  }
  const wells = new Set();
  const unresolved = [];

  text.split(/[,;]+/).map((part) => part.trim()).filter(Boolean).forEach((token) => {
    const upper = token.toUpperCase();

    if (/^[A-Z]+\d+$/.test(upper)) {
      if (parseWellId(upper) && isValidWellForDefinition(upper, def)) {
        wells.add(upper);
        return;
      }
      // Not a well on this plate, so fall through to the group table: a group named
      // "Ctrl1" is well-shaped but is still a legitimate reference.
      const viaGroup = groupWells(token, def, groupSpecs);
      if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    const rowRange = upper.match(/^([A-Z]+)-([A-Z]+)$/);
    if (rowRange) {
      const start = rowLabelToIndex(rowRange[1]);
      const end = rowLabelToIndex(rowRange[2]);
      const found = [];
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
        found.push(...wellsForRow(toRowLabel(index), def));
      }
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    if (/^[A-Z]+$/.test(upper)) {
      const found = wellsForRow(upper, def);
      if (found.length) found.forEach((well) => wells.add(well));
      else {
        const viaGroup = groupWells(token, def, groupSpecs);
        if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
        else unresolved.push(token);
      }
      return;
    }

    const columnRange = upper.match(/^(\d+)-(\d+)$/);
    if (columnRange) {
      const start = Number(columnRange[1]);
      const end = Number(columnRange[2]);
      const found = [];
      for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
        found.push(...wellsForColumn(index, def));
      }
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    if (/^\d+$/.test(upper)) {
      const found = wellsForColumn(upper, def);
      if (found.length) found.forEach((well) => wells.add(well));
      else unresolved.push(token);
      return;
    }

    const viaGroup = groupWells(token, def, groupSpecs);
    if (viaGroup.length) viaGroup.forEach((well) => wells.add(well));
    else unresolved.push(token);
  });

  return { wells: Array.from(wells), unresolved };
}

export {
  resolveReferenceWells
};
