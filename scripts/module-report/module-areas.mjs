import fs from 'node:fs';
import path from 'node:path';
import { toRepoRelativePath } from './source-scan.mjs';
import { rendererModulesRoot } from './paths.mjs';

function hasDirectory(directoryPath) {
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function getRendererModuleFamily(filePath) {
  const relativePath = path.relative(rendererModulesRoot, filePath);
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length > 1) {
    return parts[0];
  }

  const baseName = path.basename(relativePath, '.js');
  if (hasDirectory(path.join(rendererModulesRoot, baseName))) {
    return baseName;
  }

  const segments = baseName.split('-');
  for (let count = segments.length - 1; count >= 1; count -= 1) {
    const candidate = segments.slice(0, count).join('-');
    if (hasDirectory(path.join(rendererModulesRoot, candidate))) {
      return candidate;
    }
  }

  return baseName;
}

function describeSourceArea(filePath) {
  const relativePath = toRepoRelativePath(filePath);

  if (relativePath === 'src/renderer/renderer.js') {
    return {
      area: 'renderer-bootstrap',
      family: 'renderer'
    };
  }

  if (relativePath.startsWith('src/renderer/modules/')) {
    return {
      area: 'renderer-module',
      family: getRendererModuleFamily(filePath)
    };
  }

  if (relativePath.startsWith('src/renderer/services/')) {
    return {
      area: 'renderer-service',
      family: path.basename(relativePath, '.js')
    };
  }

  if (relativePath.startsWith('src/main/agent/')) {
    return {
      area: 'main-agent',
      family: 'agent'
    };
  }

  if (relativePath.startsWith('src/main/lib/')) {
    return {
      area: 'main-lib',
      family: 'lib'
    };
  }

  if (relativePath.startsWith('src/main/storage/')) {
    return {
      area: 'main-storage',
      family: 'storage'
    };
  }

  if (relativePath.startsWith('src/main/data/')) {
    return {
      area: 'main-data',
      family: 'data'
    };
  }

  if (relativePath.startsWith('src/main/')) {
    return {
      area: 'main',
      family: 'main'
    };
  }

  return {
    area: 'src',
    family: path.dirname(relativePath)
  };
}

function isTopLevelRendererModuleFile(filePath) {
  const relativePath = path.relative(rendererModulesRoot, filePath);
  return !relativePath.includes(path.sep);
}

export {
  describeSourceArea,
  isTopLevelRendererModuleFile
};
