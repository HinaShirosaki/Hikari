import path from 'node:path';

const ROOT_DIR = process.cwd();
const HTML_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'html-order.json');
const CSS_CONFIG_PATH = path.join(ROOT_DIR, 'ui', 'config', 'css-order.json');
const APP_REGISTRY_PATH = path.join(ROOT_DIR, 'ui', 'config', 'app-registry.json');
const APP_REGISTRY_MODULE_OUTPUT = 'src/renderer/modules/app-registry.generated.js';
const VIEWS_MODULE_OUTPUT = 'src/renderer/modules/views.js';
const MAIN_LLM_PROVIDER_MODULE_OUTPUT = 'src/main/generated/codex-model-catalog.generated.js';
const RENDERER_LLM_PROVIDER_MODULE_OUTPUT = 'src/renderer/modules/codex-model-catalog.generated.js';

export {
  ROOT_DIR,
  HTML_CONFIG_PATH,
  CSS_CONFIG_PATH,
  APP_REGISTRY_PATH,
  APP_REGISTRY_MODULE_OUTPUT,
  VIEWS_MODULE_OUTPUT,
  MAIN_LLM_PROVIDER_MODULE_OUTPUT,
  RENDERER_LLM_PROVIDER_MODULE_OUTPUT
};
