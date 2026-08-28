import { buildAppRegistry } from './build-ui/app-registry.mjs';
import { buildCss, buildHtml } from './build-ui/html-css.mjs';
import { buildLlmProviderModules } from './build-ui/llm-catalog.mjs';
import { APP_REGISTRY_MODULE_OUTPUT, VIEWS_MODULE_OUTPUT } from './build-ui/paths.mjs';

async function main() {
  const llmProviderOutputs = await buildLlmProviderModules();
  const appRegistryOutputs = await buildAppRegistry();
  const htmlOutput = await buildHtml(appRegistryOutputs.views);
  const cssOutput = await buildCss(appRegistryOutputs.views);
  console.log(`Built ${[
    ...llmProviderOutputs,
    APP_REGISTRY_MODULE_OUTPUT,
    VIEWS_MODULE_OUTPUT,
    htmlOutput,
    cssOutput
  ].join(', ')}`);
}

main().catch((error) => {
  console.error('[build-ui] Failed:', error?.message || error);
  process.exit(1);
});
