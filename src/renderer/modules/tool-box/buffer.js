import { BUFFER_COMPOUNDS } from '../../lib/chemistry/buffer-compounds.js';

export function renderChemicalOptions() {
  const options = BUFFER_COMPOUNDS.map(
    (chemical) => {
      const formTag = chemical.form === 'liquid' ? '; liquid' : '; solid';
      return `<option value="${chemical.name}">${chemical.name} (${chemical.mw} g/mol; ${chemical.category}${formTag})</option>`;
    }
  ).join('');
  return `${options}<option value="__custom__">Other / custom chemical...</option>`;
}

export function makeBufferRow() {
  const wrapper = document.createElement('div');
  wrapper.className = 'buffer-row';
  wrapper.innerHTML = `
    <div class="buffer-row-main">
      <label class="buffer-chemical-field">
        Chemical
        <select class="buffer-chemical-select">
          ${renderChemicalOptions()}
        </select>
      </label>
      <label class="buffer-mw-field">
        MW (g/mol)
        <input class="buffer-mw" type="number" min="0" step="0.001" />
      </label>
      <label class="buffer-concentration-field">
        <span class="buffer-concentration-label">Concentration (mM)</span>
        <input class="buffer-concentration" type="number" min="0" step="0.001" placeholder="e.g. 150" />
      </label>
      <div class="buffer-output" aria-live="polite">
        <span class="buffer-weight">0 mg</span>
      </div>
      <button type="button" class="ghost-btn buffer-remove-btn">Remove</button>
    </div>
    <div class="buffer-custom-panel" hidden>
      <label>
        Custom Name
        <input class="buffer-custom-name" placeholder="Chemical name" disabled />
      </label>
      <label class="buffer-custom-form-wrap">
        Custom Type
        <select class="buffer-custom-form" disabled>
          <option value="solid" selected>Solid</option>
          <option value="liquid">Liquid</option>
        </select>
      </label>
    </div>
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
