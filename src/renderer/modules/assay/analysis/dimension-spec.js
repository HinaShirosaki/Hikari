import {
  rowLabelToIndex,
  toRowLabel
} from '../plate-model.js';

export function normalizeDimensionMemberToken(token, dimension) {
  const value = String(token || '').trim().toUpperCase();
  if (!value) {
    return '';
  }
  if (dimension === 'row') {
    return /^[A-Z]+$/.test(value) ? value : '';
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return '';
  }
  return String(numeric);
}

export function expandDimensionMemberToken(token, dimension) {
  const value = String(token || '').trim().toUpperCase();
  if (!value) {
    return [];
  }

  if (dimension === 'row') {
    const rangeMatch = value.match(/^([A-Z]+)-([A-Z]+)$/);
    if (rangeMatch) {
      const start = rowLabelToIndex(rangeMatch[1]);
      const end = rowLabelToIndex(rangeMatch[2]);
      if (start < 0 || end < 0) {
        return [];
      }
      const step = start <= end ? 1 : -1;
      const labels = [];
      for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
        labels.push(toRowLabel(index));
      }
      return labels;
    }
    const normalized = normalizeDimensionMemberToken(value, dimension);
    return normalized ? [normalized] : [];
  }

  const rangeMatch = value.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      return [];
    }
    const step = start <= end ? 1 : -1;
    const labels = [];
    for (let index = start; step > 0 ? index <= end : index >= end; index += step) {
      labels.push(String(index));
    }
    return labels;
  }
  const normalized = normalizeDimensionMemberToken(value, dimension);
  return normalized ? [normalized] : [];
}

export function parseDimensionGroupSpec(rawSpec, dimension, maxMemberCount) {
  const warnings = [];
  const groups = [];
  const memberToGroup = new Map();
  const specText = String(rawSpec || '').trim();
  if (!specText) {
    return { groups, memberToGroup, warnings };
  }

  const entries = specText
    .split(/[\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const itemLabel = dimension === 'row' ? 'row' : 'column';

  entries.forEach((entry) => {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex <= 0 || separatorIndex >= entry.length - 1) {
      warnings.push(`Ignored "${entry}" (use "Group: members").`);
      return;
    }

    const groupLabel = entry.slice(0, separatorIndex).trim();
    if (!groupLabel) {
      warnings.push(`Ignored "${entry}" (missing group name before ":").`);
      return;
    }

    const rawMembers = entry.slice(separatorIndex + 1);
    const tokens = rawMembers.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
    if (!tokens.length) {
      warnings.push(`Ignored "${groupLabel}" (missing ${itemLabel} values).`);
      return;
    }

    const expandedMembers = [];
    tokens.forEach((token) => {
      const expanded = expandDimensionMemberToken(token, dimension);
      if (!expanded.length) {
        warnings.push(`Ignored token "${token}" in "${groupLabel}".`);
        return;
      }
      expandedMembers.push(...expanded);
    });

    if (!expandedMembers.length) {
      return;
    }

    const withinBounds = expandedMembers.filter((member) => {
      if (!Number.isInteger(maxMemberCount) || maxMemberCount <= 0) {
        return true;
      }
      const index = dimension === 'row' ? rowLabelToIndex(member) : Number(member) - 1;
      return index >= 0 && index < maxMemberCount;
    });
    // A one-member group is legitimate (a single control row/column), so only an
    // entirely empty group is rejected.
    const uniqueMembers = [...new Set(withinBounds)];
    if (!uniqueMembers.length) {
      warnings.push(`Group "${groupLabel}" has no valid ${itemLabel}s.`);
      return;
    }

    const acceptedMembers = [];
    uniqueMembers.forEach((member) => {
      if (memberToGroup.has(member)) {
        const existing = memberToGroup.get(member);
        warnings.push(`${itemLabel[0].toUpperCase() + itemLabel.slice(1)} ${member} is already in "${existing.label}".`);
        return;
      }
      acceptedMembers.push(member);
    });
    if (!acceptedMembers.length) {
      warnings.push(`Group "${groupLabel}" has no non-overlapping ${itemLabel}s.`);
      return;
    }

    const sortIndex = acceptedMembers.reduce((best, member) => {
      const index = dimension === 'row' ? rowLabelToIndex(member) : Number(member) - 1;
      return Math.min(best, index);
    }, Number.POSITIVE_INFINITY);
    const group = {
      label: groupLabel,
      members: acceptedMembers,
      sortIndex
    };

    groups.push(group);
    acceptedMembers.forEach((member) => {
      memberToGroup.set(member, group);
    });
  });

  return { groups, memberToGroup, warnings };
}
