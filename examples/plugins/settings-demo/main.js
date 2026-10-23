/* global HikariPlugin */
const { hikari } = HikariPlugin;
const output = document.getElementById('values');
const button = document.getElementById('toggle-format');
const status = document.getElementById('status');
let preferences;
function applyPreferences(values) {
  preferences = values;
  output.textContent = JSON.stringify(values, null, 2);
  button.disabled = false;
}
function applyAppearance(appearance) {
  document.documentElement.style.colorScheme = appearance.mode === 'night' ? 'dark' : 'light';
}
hikari.on('settings.changed', ({ values }) => applyPreferences(values));
hikari.on('app.context', ({ appearance }) => applyAppearance(appearance));
Promise.all([hikari.call('settings.get'), hikari.call('app.info')]).then(([result, info]) => {
  applyPreferences(result.values);
  applyAppearance(info.appearance);
}).catch(error => { status.textContent = error.message; });
button.addEventListener('click', async () => {
  try {
    const { values } = await hikari.call('settings.set', {
      values: { defaultFormat: preferences.defaultFormat === 'svg' ? 'png' : 'svg' }
    });
    applyPreferences(values);
    status.textContent = 'Export format saved.';
  } catch (error) { status.textContent = error.message; }
});
