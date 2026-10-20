import { selectionBounds } from './grouping.mjs';

// A complete group is one layout item; individually selected members stay
// independent. Measure editing bounds, but translate the authored geometry.
export function selectionLayoutUnits(state, ids, getBounds = object => object) {
  const selected = new Set(ids), objects = (state?.objects || []).filter(object => selected.has(object.id));
  const groups = (state?.groups || []).filter(group => group.ids.every(id => selected.has(id)));
  const used = new Set(), units = [];
  for (const object of objects) {
    if (used.has(object.id)) continue;
    const group = groups.find(group => group.ids.includes(object.id));
    const members = group ? objects.filter(member => group.ids.includes(member.id)) : [object];
    members.forEach(member => used.add(member.id));
    units.push({ objects: members, bounds: selectionBounds(members.map(getBounds)) });
  }
  return units;
}

export function alignmentOperations(state, ids, action, getBounds = object => object) {
  const actions = ['left', 'right', 'top', 'bottom', 'horizontal-center', 'vertical-center',
    'distribute-horizontal', 'distribute-vertical'];
  if (!actions.includes(action)) throw new Error('Unknown alignment action.');
  const units = selectionLayoutUnits(state, ids, getBounds), distribute = action.startsWith('distribute-');
  if (units.length < (distribute ? 3 : 2)) return [];
  const horizontal = ['left', 'right', 'horizontal-center', 'distribute-horizontal'].includes(action);
  const axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height';
  const start = Math.min(...units.map(unit => unit.bounds[axis]));
  const end = Math.max(...units.map(unit => unit.bounds[axis] + unit.bounds[size]));
  const operations = [];
  function translate(unit, target) {
    const delta = target - unit.bounds[axis];
    if (Math.abs(delta) < 1e-9) return;
    for (const object of unit.objects) operations.push({ op: 'update', id: object.id, patch: { [axis]: object[axis] + delta } });
  }
  if (distribute) {
    const ordered = [...units].sort((a, b) => a.bounds[axis] - b.bounds[axis]);
    const first = ordered[0].bounds, last = ordered.at(-1).bounds;
    const gap = (last[axis] + last[size] - first[axis] - ordered.reduce((sum, unit) => sum + unit.bounds[size], 0)) / (ordered.length - 1);
    let target = first[axis];
    ordered.forEach((unit, index) => {
      // Keep both outer items exactly fixed, including floating-point geometry.
      if (index && index < ordered.length - 1) translate(unit, target);
      target += unit.bounds[size] + gap;
    });
  } else {
    for (const unit of units) {
      const target = ['left', 'top'].includes(action) ? start
        : ['right', 'bottom'].includes(action) ? end - unit.bounds[size]
          : (start + end - unit.bounds[size]) / 2;
      translate(unit, target);
    }
  }
  return operations;
}
