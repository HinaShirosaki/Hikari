import { PARTITION_REGIONS } from './analysis.mjs';
import { channelLabel, gateColor, gatePercentage } from './plot.mjs';

const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat();

export function groupName(group) {
  return group.regionName ? `${group.gate.name} · ${group.regionName}` : group.gate.name;
}

export function groupReference(view) {
  return view.gate ? { gateId: view.gate.id, region: view.region } : null;
}

export function createGateLibrary({
  analyze, button, select, getActiveSample, currentView, getSample, listSamples,
  drawGates, showGateErrors, gateMessage, cancelDrawing, updateViewHeading, refreshView, onGateChange
}) {
  let nextGateId = 0;
  const pendingMoves = new WeakMap();
  const dialog = $('gate-dialog');
  const nameInput = $('gate-dialog-name');
  let managed = null;

  function manageGate(sample, gate) {
    cancelDrawing();
    managed = { sample, gate };
    nameInput.value = gate.name;
    $('gate-dialog-channels').textContent = [gate.x, gate.y]
      .map(axis => channelLabel(sample.channels[axis.channel], sample.scope.aliases)).join(' × ');
    const scope = $('gate-dialog-scope');
    scope.textContent = sample.folder ? `This gate is shared across ${sample.folder.name}.`
      : gate.groups.length > 1 ? 'These settings apply to all regions of this gate.' : '';
    scope.hidden = !scope.textContent;
    $('remove-gate').disabled = pendingMoves.has(sample.scope);
    dialog.showModal();
    nameInput.select();
  }

  $('cancel-gate-settings').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (!dialog.open) managed = null;
  });
  $('gate-dialog-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!managed) return;
    const { sample, gate } = managed;
    dialog.close();
    renameGate(sample, gate.definition, nameInput.value);
  });
  $('show-gate').addEventListener('click', () => {
    if (!managed) return;
    const { sample, gate } = managed;
    dialog.close();
    select(sample.id, gate.view.gate ? gate.view : null, gate);
  });
  $('remove-gate').addEventListener('click', () => {
    if (!managed || pendingMoves.has(managed.sample.scope)) return;
    const { sample, gate } = managed;
    dialog.close();
    deleteGate(sample, gate);
  });

  function updateGroupRow(group) {
    const name = groupName(group);
    group.label.textContent = name;
    group.open.title = name;
    group.open.setAttribute('aria-label', 'View ' + name);
    group.manage.setAttribute('aria-label', 'Manage gate for ' + name);
    group.meta.textContent = group.count === null
      ? 'Counting…'
      : `${integer.format(group.count)} events · ${gatePercentage(group.count, group.gate.parentCount)} of parent`;
    group.open.disabled = group.count === null || group.gate.moving;
    group.manage.disabled = group.open.disabled;
  }

  function addGroupRow(sample, parent, gate, region, regionName) {
    const row = document.createElement('li');
    const axes = {
      x: { channel: gate.x.channel, scale: gate.x.scale, auto: true },
      y: { channel: gate.y.channel, scale: gate.y.scale, auto: true }
    };
    const group = { gate, region, regionName, count: null, axes, gates: [], selectedGate: null, rendered: null, row };
    const open = button('', () => select(sample.id, group), { className: 'group-select' });
    open.setAttribute('aria-current', 'false');
    const manage = button('', () => manageGate(sample, gate), { icon: 'more', className: 'gate-manage icon-button' });
    manage.setAttribute('aria-haspopup', 'dialog');
    manage.title = 'Gate settings';
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--gate-color', gateColor(gate.id));
    const text = document.createElement('span');
    text.className = 'file-text';
    const label = document.createElement('span');
    label.className = 'file-name';
    const meta = document.createElement('span');
    meta.className = 'file-meta';
    meta.id = `group-stats-${sample.id}-${gate.id}-${region}`;
    open.setAttribute('aria-describedby', meta.id);
    text.append(label, meta);
    open.append(swatch, text);
    const groupList = document.createElement('ul');
    groupList.className = 'group-list';
    const groupRow = document.createElement('div');
    groupRow.className = 'group-row';
    groupRow.append(open, manage);
    row.append(groupRow, groupList);
    Object.assign(group, { open, manage, label, meta, groupList });
    updateGroupRow(group);
    parent.groupList.append(row);
    return group;
  }

  function scopeSamples(scope) {
    return [...listSamples()].filter(sample => sample.scope === scope);
  }

  function nextGateNumber(scope) {
    return ++scope.nextGate;
  }

  function renameGate(sample, definition, name) {
    definition.name = name.trim() || `Gate ${definition.number}`;
    for (const member of scopeSamples(sample.scope)) {
      const gate = member.gatesById.get(definition.id);
      for (const group of gate?.groups ?? []) updateGroupRow(group);
    }
    if (getActiveSample()?.scope === sample.scope) {
      updateViewHeading();
      drawGates(currentView());
      showGateErrors();
    }
    onGateChange(descendantGateIds(sample.scope, definition));
  }

  function removeGateInstance(sample, gate) {
    sample.gatesById.delete(gate.id);
    const { view } = gate;
    view.gates = view.gates.filter(item => item !== gate);
    if (view.selectedGate === gate.id) view.selectedGate = null;
    for (const group of gate.groups) group.row.remove();
  }

  function descendantGateIds(scope, definition) {
    const ids = new Set([definition.id]);
    for (const candidate of scope.definitions) {
      if (ids.has(candidate.parent?.gateId)) ids.add(candidate.id);
    }
    return ids;
  }

  function deleteGate(sample, gate) {
    const scope = sample.scope;
    if (pendingMoves.has(scope)) return;
    const ids = descendantGateIds(scope, gate.definition);
    const activeSample = getActiveSample();
    const view = currentView();
    let fallback = view;
    while (fallback?.gate && ids.has(fallback.gate.id)) fallback = fallback.gate.view;
    scope.definitions = scope.definitions.filter(candidate => !ids.has(candidate.id));
    for (const member of scopeSamples(scope)) {
      for (const id of ids) {
        const gate = member.gatesById.get(id);
        if (gate) removeGateInstance(member, gate);
        member.gateErrors.delete(id);
      }
      void analyze('remove-gates', member.id, { gateIds: [...ids] }).catch(() => {});
    }
    if (activeSample?.scope === scope) {
      if (fallback !== view) select(activeSample.id, fallback.gate ? fallback : null);
      else {
        drawGates(view);
        showGateErrors();
      }
    }
    if (fallback === view) onGateChange(ids);
    (activeSample?.scope === scope && fallback !== view ? fallback : gate.view).open.focus();
  }

  function gateAxis(sample, axis) {
    const name = axis.measurement.name.toUpperCase();
    const matches = sample.channels.flatMap((channel, index) => channel.name.toUpperCase() === name ? [index] : []);
    const exact = matches.filter(index => sample.channels[index].label === axis.measurement.label);
    if (exact.length === 1) return { ...axis.axis, channel: exact[0] };
    if (matches.length === 1) {
      const label = sample.channels[matches[0]].label;
      if (!label || !axis.measurement.label) return { ...axis.axis, channel: matches[0] };
    }
    throw new Error(`No matching channel for ${channelLabel(axis.measurement)} in this file. Gate not applied.`);
  }

  function saveGate(sample, view, shape) {
    const { x, y } = view.rendered;
    const number = nextGateNumber(sample.scope);
    const id = ++nextGateId;
    const describeAxis = axis => ({ axis: { ...axis, auto: false }, measurement: sample.channels[axis.channel] });
    const definition = {
      id, number, shape, name: `Gate ${number}`, parent: groupReference(view), sourceId: sample.id,
      x: describeAxis(x), y: describeAxis(y)
    };
    sample.scope.definitions.push(definition);
    for (const member of scopeSamples(sample.scope)) void applyGate(member, definition, member === sample);
  }

  function updateGateCounts(gate, counts) {
    gate.counts = counts;
    gate.parentCount = gate.view.count;
    for (const [index, group] of gate.groups.entries()) {
      group.count = counts[index];
      updateGroupRow(group);
    }
  }

  async function updateGate(sample, gate, shape) {
    if (!gate.counts || gate.moving) return;
    const { scope } = sample;
    if (pendingMoves.has(scope)) {
      gateMessage('Wait for the current gate edit to finish, then try again.');
      return;
    }
    const definition = gate.definition;
    const affected = descendantGateIds(scope, definition);
    const members = scopeSamples(scope).flatMap(member => {
      const gates = scope.definitions.filter(item => affected.has(item.id))
        .map(item => member.gatesById.get(item.id)).filter(Boolean);
      return gates.length ? [{ member, gates }] : [];
    });
    // Wait for initial counts before editing a tree that is still being created.
    if (members.some(({ gates }) => gates.some(item => !item.counts || item.moving))) {
      gateMessage('Wait for the gate counts to finish, then try again.');
      return;
    }
    for (const { gates } of members) {
      for (const item of gates) {
        item.moving = true;
        for (const group of item.groups) updateGroupRow(group);
      }
    }
    const view = currentView();
    view.selectedGate = gate.id;
    let committed = false;
    try {
      const updates = members.map(({ member, gates }) => ({
        id: member.id,
        gates: gates.map(item => ({
          group: item.definition.parent,
          gate: {
            ...(item.id === gate.id ? shape : item.definition.shape),
            id: item.id, x: item.x, y: item.y
          }
        }))
      }));
      gateMessage(`Updating ${gate.name}…`);
      const result = analyze('move-gate', sample.id, { updates });
      pendingMoves.set(scope, result);
      const results = await result;
      definition.shape = shape;
      for (const [index, { gates }] of members.entries()) {
        for (const [gateIndex, item] of gates.entries()) {
          if (item.id === gate.id) Object.assign(item, shape);
          updateGateCounts(item, results[index][gateIndex]);
        }
      }
      committed = true;
    } catch (error) {
      gateMessage(`Could not update ${gate.name}. ${error.message}`);
    } finally {
      pendingMoves.delete(scope);
      for (const { gates } of members) {
        for (const item of gates) {
          item.moving = false;
          for (const group of item.groups) updateGroupRow(group);
        }
      }
      const member = getActiveSample();
      const activeView = currentView();
      if (member?.scope === scope) {
        if (committed && affected.has(activeView.gate?.id)) refreshView(member, activeView);
        else {
          drawGates(activeView);
          if (committed) onGateChange(affected);
        }
      } else if (committed) {
        onGateChange(affected);
      }
      if (managed?.sample.scope === scope) $('remove-gate').disabled = false;
      if (committed && activeView === view) gateMessage(`Updated ${gate.name}.`);
    }
  }

  async function applyGate(sample, definition, selected = false) {
    const pending = pendingMoves.get(sample.scope);
    if (pending) await pending.catch(() => {});
    if (!getSample(sample.id) || !sample.scope.definitions.includes(definition)) return;
    const { id, parent, shape } = definition;
    const view = parent ? sample.gatesById.get(parent.gateId)?.groups[parent.region] : sample;
    if (!view || sample.gatesById.has(id)) return;
    let x, y;
    try {
      x = definition.sourceId === sample.id ? definition.x.axis : gateAxis(sample, definition.x);
      y = definition.sourceId === sample.id ? definition.y.axis : gateAxis(sample, definition.y);
    } catch (error) {
      sample.gateErrors.set(id, { definition, message: error.message });
      if (getActiveSample() === sample) showGateErrors();
      return;
    }
    const gate = {
      ...shape, id, definition, view, x, y, counts: null, parentCount: view.count,
      get name() { return definition.name; }
    };
    const regions = PARTITION_REGIONS[gate.kind] ?? [''];
    gate.groups = regions.map((name, region) => addGroupRow(sample, view, gate, region, name));
    sample.gatesById.set(id, gate);
    view.gates.push(gate);
    if (selected) view.selectedGate = id;
    if (currentView() === view) drawGates(view);
    try {
      const counts = await analyze('gate', sample.id, { gate: { ...shape, id, x, y }, group: parent });
      if (!getSample(sample.id) || !view.gates.includes(gate) || !gate.groups[0].row.isConnected) return;
      updateGateCounts(gate, counts);
      if (currentView() === view) {
        drawGates(view);
        if (selected && view.selectedGate === id) {
          if (sample.folder) gateMessage(`${gate.name} shared with ${sample.folder.name}.`);
          else gateMessage(counts.length > 1
            ? `${gate.name} added ${counts.length} groups to the file rail.`
            : `${gate.name} added to the file rail with ${integer.format(counts[0])} events.`);
        }
      }
    } catch (error) {
      if (!getSample(sample.id) || !view.gates.includes(gate) || !gate.groups[0].row.isConnected) return;
      const affectedIds = [...descendantGateIds(sample.scope, definition)];
      for (const id of affectedIds) {
        const instance = sample.gatesById.get(id);
        if (instance) removeGateInstance(sample, instance);
      }
      void analyze('remove-gates', sample.id, { gateIds: affectedIds }).catch(() => {});
      sample.gateErrors.set(id, { definition, message: error.message });
      if (getActiveSample() === sample) showGateErrors();
      if (currentView() === view) {
        drawGates(view);
        gateMessage(error.message);
      }
    }
  }

  function moveIntoFolder(sample, folder) {
    const incoming = sample.scope.definitions;
    const existing = [...folder.definitions];
    for (const definition of incoming) {
      if (folder.definitions.some(other => other.number === definition.number)) {
        const number = nextGateNumber(folder);
        if (definition.name === `Gate ${definition.number}`) definition.name = `Gate ${number}`;
        definition.number = number;
      }
      folder.nextGate = Math.max(folder.nextGate, definition.number);
      const gate = sample.gatesById.get(definition.id);
      for (const group of gate?.groups ?? []) updateGroupRow(group);
      folder.definitions.push(definition);
    }
    sample.scope = folder;
    for (const definition of existing) void applyGate(sample, definition);
    for (const other of listSamples()) {
      if (other !== sample && other.folder === folder) {
        for (const definition of incoming) void applyGate(other, definition);
      }
    }
    if (getActiveSample() === sample) {
      drawGates(currentView());
      showGateErrors();
    }
  }

  return {
    saveGate,
    updateGate,
    canMoveIntoFolder(sample, folder) {
      return !pendingMoves.has(sample.scope) && !pendingMoves.has(folder);
    },
    moveIntoFolder,
    applyExisting(sample) {
      for (const definition of sample.scope.definitions) void applyGate(sample, definition);
    }
  };
}
