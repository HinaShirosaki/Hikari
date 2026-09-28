import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const icons = read('src/renderer/modules/agent-chat/icons.js');
const composerCss = read('ui/css/views/agent-view/chat-refresh-and-composer.css');

for (const name of ['attach', 'chat', 'chevron-right', 'close', 'context', 'copy', 'draft', 'new-chat', 'rail-collapse', 'screenshot', 'send']) {
  assert.match(icons, new RegExp(`(?:['"]${name}['"]|\\b${name}\\b):`), `${name} should have one canonical Agent Chat icon definition`);
}
assert.match(icons, /export function renderAgentChatIcon/);
assert.match(icons, /export function hydrateAgentChatIcons/);
assert.match(composerCss, /\.agent-chat-icon\s*\{[\s\S]*?stroke-width: 1\.8/);

const staticMarkup = [
  'ui/html/views/agent-view.html',
  'ui/html/views/home-view.html',
  'ui/html/views/protocol-management-view.html',
  'ui/html/shell/end.html'
].map(read).join('\n');

for (const [id, icon] of [
  ['agent-attach-btn', 'attach'],
  ['agent-send-btn', 'send'],
  ['agent-rail-attach-btn', 'attach'],
  ['agent-rail-send-btn', 'send'],
  ['home-agent-attach-btn', 'attach'],
  ['home-agent-send-btn', 'send'],
  ['protocol-generate-attach-btn', 'attach']
]) {
  // Stop at the button's own </button>: a later element with the same icon
  // must not satisfy the match for this one.
  assert.match(staticMarkup, new RegExp(`id="${id}"(?:(?!</button>)[\\s\\S])*data-agent-chat-icon="${icon}"`));
}

const dynamicRenderers = [
  'src/renderer/modules/agent-chat/composer-attachments.js',
  'src/renderer/modules/agent-chat/index.js',
  'src/renderer/modules/agent-chat/rendering-question-card.js',
  'src/renderer/modules/agent-chat/rendering-drafts.js',
  'src/renderer/modules/agent-chat/rendering.js',
  'src/renderer/modules/agent-chat/session-manager.js',
  'src/renderer/app/navigation-shell.js'
].map(read).join('\n');

assert.doesNotMatch(dynamicRenderers, /<svg\b/, 'Agent Chat renderers should not carry their own SVG markup');
assert.match(dynamicRenderers, /renderAgentChatIcon\('send'/);
assert.match(dynamicRenderers, /renderAgentChatIcon\('close'/);
assert.match(dynamicRenderers, /renderAgentChatIcon\('copy'/);
assert.match(dynamicRenderers, /renderAgentChatIcon\('draft'/);
assert.match(dynamicRenderers, /renderAgentChatIcon\('chevron-right'/);
assert.match(dynamicRenderers, /renderAgentChatIcon\('new-chat'/);

console.log('Agent Chat icon system self-check passed.');
