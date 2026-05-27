import { getWellName, isMultiWellContainer } from '../personal-inventory/constants.js';
import { escapeHtml, setMultiSelectValues } from './sample-utils.js';

export function buildInventoryContainerOptions(ctx) {
  const options = ['<option value="">Not linked</option>'];
  Object.entries(ctx.state.inventory || {}).forEach(([section, containers]) => {
    (containers || []).forEach((container) => {
      const value = `${section}::${container.id}`;
      const label = `${section} / ${container.name}`;
      options.push(`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`);
    });
  });
  return options.join('');
}

export function findLinkedContainer(ctx, linkedContainerValue) {
  const raw = String(linkedContainerValue || '');
  if (!raw.includes('::')) {
    return null;
  }
  const [section, containerId] = raw.split('::');
  if (!section || !containerId) {
    return null;
  }
  const container = (ctx.state.inventory?.[section] || []).find((item) => item.id === containerId);
  if (!container) {
    return null;
  }
  return { section, containerId, container };
}

export function getContainerWellName(container, index) {
  const rawWell = container?.wells?.[index];
  if (rawWell && typeof rawWell === 'object') {
    const explicitName = String(rawWell.name || '').trim();
    if (explicitName) {
      return explicitName;
    }
  }
  return getWellName(container, index);
}

export function renderLinkedPositionOptions(ctx) {
  const { sampleLinkContainerInput, sampleLinkPositionInput } = ctx.dom;
  if (!sampleLinkPositionInput) {
    return;
  }
  const selected = sampleLinkPositionInput.value;
  const linked = findLinkedContainer(ctx, sampleLinkContainerInput?.value);
  const options = ['<option value="">Auto / none</option>'];
  if (linked) {
    if (isMultiWellContainer(linked.container)) {
      (linked.container.wells || []).forEach((rawWell, index) => {
        const wellName = rawWell && typeof rawWell === 'object'
          ? String(rawWell.name || getContainerWellName(linked.container, index))
          : getContainerWellName(linked.container, index);
        options.push(`<option value="${index}">${escapeHtml(`${index + 1} - ${wellName}`)}</option>`);
      });
    } else {
      options.push('<option value="single">Single slot</option>');
    }
  }
  sampleLinkPositionInput.innerHTML = options.join('');
  if (selected && Array.from(sampleLinkPositionInput.options).some((option) => option.value === selected)) {
    sampleLinkPositionInput.value = selected;
  }
}

export function renderLinkedContainerOptions(ctx) {
  const { sampleLinkContainerInput } = ctx.dom;
  if (!sampleLinkContainerInput) {
    return;
  }
  const selectedContainer = sampleLinkContainerInput.value;
  sampleLinkContainerInput.innerHTML = buildInventoryContainerOptions(ctx);
  if (selectedContainer && Array.from(sampleLinkContainerInput.options).some((option) => option.value === selectedContainer)) {
    sampleLinkContainerInput.value = selectedContainer;
  }
  renderLinkedPositionOptions(ctx);
}

export function renderChemicalLinkOptions(ctx) {
  const { sampleLinkChemicalsInput } = ctx.dom;
  if (!sampleLinkChemicalsInput) {
    return;
  }
  const selected = Array.from(sampleLinkChemicalsInput.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
  sampleLinkChemicalsInput.innerHTML = (ctx.state.labInventory?.chemicals || []).map((chemical) => {
    const label = `${chemical.name} (${chemical.casNumber})`;
    return `<option value="${escapeHtml(chemical.id)}">${escapeHtml(label)}</option>`;
  }).join('');
  setMultiSelectValues(sampleLinkChemicalsInput, selected);
}

export function buildLocationFromInventoryLink(linkedContainer, linkedPosition) {
  if (!linkedContainer) {
    return null;
  }
  const section = linkedContainer.section;
  const container = linkedContainer.container;
  if (section === '4 Degree') {
    return {
      storageType: 'fridge',
      fridge: '4 Degree',
      shelf: container.name || ''
    };
  }
  if (section === 'Room Temp') {
    return {
      storageType: 'rt_cabinet',
      cabinet: 'Room Temp',
      slot: container.name || ''
    };
  }
  return {
    storageType: 'freezer',
    freezer: section,
    rack: '',
    box: container.name || '',
    position: linkedPosition === '' || linkedPosition === 'single'
      ? ''
      : getContainerWellName(container, Number(linkedPosition))
  };
}

export function formatInventoryLink(ctx, link) {
  if (!link) {
    return '-';
  }
  const container = (ctx.state.inventory?.[link.section] || []).find((item) => item.id === link.containerId);
  if (!container) {
    return `${link.section || '-'} / missing container`;
  }
  if (link.wellIndex === null || link.wellIndex === undefined) {
    return `${link.section} / ${container.name}`;
  }
  const rawWell = container.wells?.[link.wellIndex];
  const wellName = rawWell && typeof rawWell === 'object'
    ? (rawWell.name || getContainerWellName(container, Number(link.wellIndex)))
    : getContainerWellName(container, Number(link.wellIndex));
  return `${link.section} / ${container.name} / ${wellName}`;
}

export function formatChemicalLinks(ctx, chemicalLinks) {
  const links = Array.isArray(chemicalLinks) ? chemicalLinks : [];
  if (!links.length) {
    return '-';
  }
  return links.map((id) => {
    const item = (ctx.state.labInventory?.chemicals || []).find((chemical) => chemical.id === id);
    return item ? item.name : `${id} (missing)`;
  }).join(', ');
}
