import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const palette = read('ui/css/base/palette.css');
const coreCss = read('ui/css/base/core.css');
const buttonIcon = read('assets/icons/hikari-button.svg');
const sourceMarkup = [
  read('ui/html/views/agent-view.html'),
  read('ui/html/shell/end.html'),
  read('ui/html/views/home-view.html'),
  read('ui/html/views/protocol-management-view.html'),
  read('ui/html/views/biology-notebook-view.html')
].join('\n');
const generatedActions = [
  read('src/renderer/modules/biology-notebook/project/project-dashboard-renderer.js'),
  read('src/renderer/modules/selection-insights/controller-ui.js'),
  read('src/renderer/modules/agent-chat/rendering-question-card.js')
].join('\n');

for (const color of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'violet']) {
  assert.match(palette, new RegExp(`--theme-hikari-rainbow-${color}:`));
  assert.match(coreCss, new RegExp(`var\\(--theme-hikari-rainbow-${color}\\)`));
}

assert.match(coreCss, /\.hikari-agent-action::before\s*\{/);
assert.match(coreCss, /linear-gradient\(/);
assert.match(coreCss, /assets\/icons\/hikari-button\.svg/);
assert.match(buttonIcon, /viewBox="390 185 475 865"/);
assert.match(buttonIcon, /stroke-width="30"/, 'the button-specific Hikari mark should remain optically thick at small sizes');
assert.doesNotMatch(buttonIcon, /<(?:image|script|foreignObject)\b/i);

for (const id of [
  'dashboard-quick-log-agent-btn',
  'dashboard-notebook-note-clarify-btn',
  'protocol-generate-btn',
  'protocol-polish-btn',
  'protocol-generate-send-btn',
  'clarify-save-biology-notebook-btn'
]) {
  assert.match(
    sourceMarkup,
    new RegExp(`<button[^>]*id="${id}"[^>]*class="[^"]*hikari-agent-action`),
    `${id} should display the Hikari model-action mark`
  );
}

assert.match(generatedActions, /class="ghost-btn hikari-agent-action" data-suggest-experiment/);
assert.match(generatedActions, /class="selection-insight-menu-item hikari-agent-action" data-selection-insight-action/);
assert.match(generatedActions, /class="primary-btn agent-send-icon-btn"[\s\S]*?<svg class="agent-send-icon"/);
assert.doesNotMatch(generatedActions, /agent-send-icon-btn hikari-agent-action/);

// Local-only and review/apply actions must not imply that clicking them starts a model call.
for (const id of [
  'dashboard-quick-log-save-btn',
  'agent-send-btn',
  'agent-rail-send-btn',
  'protocol-generate-apply-btn',
  'protocol-polish-apply-btn'
]) {
  assert.doesNotMatch(
    sourceMarkup,
    new RegExp(`<button[^>]*id="${id}"[^>]*class="[^"]*hikari-agent-action`),
    `${id} should not display the model-action mark`
  );
}

assert.match(sourceMarkup, /id="agent-send-btn"[\s\S]*?<svg class="agent-send-icon"/);
assert.match(sourceMarkup, /id="agent-rail-send-btn"[\s\S]*?<svg class="agent-send-icon"/);

console.log('Hikari agent action icon self-check passed.');
