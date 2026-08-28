import path from 'node:path';
import { defaultOutputPath } from './paths.mjs';

function parseArguments(argv) {
  let outputPath = defaultOutputPath;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') {
      printHelp();
      process.exit(0);
    }

    if (token === '--output' && argv[index + 1]) {
      outputPath = path.resolve(process.cwd(), argv[index + 1]);
      index += 1;
      continue;
    }

    if (token.startsWith('--output=')) {
      outputPath = path.resolve(process.cwd(), token.slice('--output='.length));
    }
  }

  return { outputPath };
}

function printHelp() {
  console.log('Usage: node scripts/report-module-relationships.mjs [--output <path>]');
  console.log('');
  console.log('Scans src/**/*.js for local import dependencies and direct imported API calls.');
  console.log('Also infers renderer service and registry-based communication from');
  console.log('src/renderer/core/module-runtime.js (init/registration root) and src/renderer/services/.');
}

export {
  parseArguments
};
