// A tool plugin: Hikari shows this page as a panel in Tools. It looks up a
// buffer's pKa through chemicals.list (inventory chemicals plus Hikari's
// reference compounds) and gives the base:acid ratio for a target pH.
const { hikari } = window.HikariPlugin;
const compoundInput = document.getElementById('compound');
const phInput = document.getElementById('ph');
const result = document.getElementById('result');
let compounds = [];

function applyAppearance({ appearance }) {
  document.documentElement.style.colorScheme = appearance?.mode === 'night' ? 'dark' : 'light';
}

function render() {
  const name = compoundInput.value.trim().toLowerCase();
  const compound = compounds.find((item) => item.name.toLowerCase() === name);
  const pH = Number(phInput.value);
  if (!compound || phInput.value === '' || !Number.isFinite(pH)) {
    result.textContent = name && !compound ? 'Pick a compound from the list.' : '';
    return;
  }
  // Henderson-Hasselbalch: pH = pKa + log10([base] / [acid]).
  const ratio = 10 ** (pH - compound.pKa);
  const basePercent = (100 * ratio) / (1 + ratio);
  result.textContent = `pKa ${compound.pKa}: base : acid = ${ratio.toFixed(2)} : 1 (${basePercent.toFixed(1)}% base form).`;
}

hikari.on('app.context', applyAppearance);
hikari.call('app.info').then(applyAppearance).catch(() => {});
hikari.call('chemicals.list')
  .then((list) => {
    compounds = list.filter((item) => item.pKa);
    document.getElementById('compounds').replaceChildren(...compounds.map((item) => new Option(item.name)));
    compoundInput.disabled = false;
    compoundInput.placeholder = 'e.g. HEPES';
  })
  .catch((error) => {
    compoundInput.placeholder = 'Unavailable';
    result.textContent = error.message;
  });
compoundInput.addEventListener('input', render);
phInput.addEventListener('input', render);
