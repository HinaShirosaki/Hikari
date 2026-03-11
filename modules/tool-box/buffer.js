import { BUFFER_COMPOUNDS } from '../buffer-compounds.js';

export function renderChemicalOptions() {
  const options = BUFFER_COMPOUNDS.map(
    (chemical) => {
      const formTag = chemical.form === 'liquid' ? '; liquid' : '; solid';
      return `<option value="${chemical.name}">${chemical.name} (${chemical.mw} g/mol; ${chemical.category}${formTag})</option>`;
    }
  ).join('');
  return `${options}<option value="__custom__">Custom</option>`;
}

export function makeBufferRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'buffer-row';
  wrapper.innerHTML = `
    <label>
      Chemical
      <select class="buffer-chemical-select">
        ${renderChemicalOptions()}
      </select>
    </label>
    <label>
      Custom Name
      <input class="buffer-custom-name" placeholder="Chemical name" disabled />
    </label>
    <label class="buffer-custom-form-wrap" hidden>
      Custom Type
      <select class="buffer-custom-form" disabled>
        <option value="solid" selected>Solid</option>
        <option value="liquid">Liquid</option>
      </select>
    </label>
    <label>
      MW (g/mol)
      <input class="buffer-mw" type="number" min="0" step="0.001" />
    </label>
    <label>
      <span class="buffer-concentration-label">Concentration (mM)</span>
      <input class="buffer-concentration" type="number" min="0" step="0.001" placeholder="e.g. 150" />
    </label>
    <div class="buffer-output">
      <span class="buffer-weight">0 mg</span>
    </div>
    <button type="button" class="ghost-btn buffer-remove-btn">Remove</button>
  `;

  const select = wrapper.querySelector('.buffer-chemical-select');
  const mwInput = wrapper.querySelector('.buffer-mw');
  const customNameInput = wrapper.querySelector('.buffer-custom-name');

  const first = BUFFER_COMPOUNDS[0];
  select.value = first.name;
  mwInput.value = first.mw;
  customNameInput.value = '';

  return wrapper;
}
