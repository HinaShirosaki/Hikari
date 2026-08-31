import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const srcRoot = path.join(repoRoot, 'src');
const rendererRoot = path.join(repoRoot, 'src', 'renderer');
const rendererModulesRoot = path.join(rendererRoot, 'modules');
const rendererManifestsRoot = path.join(rendererRoot, 'module-manifests');
const rendererServicesRoot = path.join(rendererRoot, 'services');
const moduleRuntimeFile = path.join(rendererRoot, 'core', 'module-runtime.js');
const defaultOutputPath = path.join(repoRoot, 'reports', 'renderer-module-relationships.md');

export {
  repoRoot,
  srcRoot,
  rendererRoot,
  rendererModulesRoot,
  rendererManifestsRoot,
  rendererServicesRoot,
  moduleRuntimeFile,
  defaultOutputPath
};
