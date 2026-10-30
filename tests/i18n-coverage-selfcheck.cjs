const { execFileSync } = require('node:child_process');
const path = require('node:path');
process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, '../scripts/i18n/check-coverage.cjs')], { encoding: 'utf8' }));
