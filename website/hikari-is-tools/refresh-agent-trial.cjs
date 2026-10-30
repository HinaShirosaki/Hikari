// Refresh the two Agent screenshot surfaces without replacing the public Trial.
const fs = require('node:fs');
const path = require('node:path');
const {SOURCE} = require('./trial-runtime.cjs');
const {optimizeTrial} = require('./optimize-trial.cjs');
const REPO = path.resolve(__dirname, '../..');
const FILES = [
  'src/renderer/modules/protocol/polish.js',
  'src/renderer/modules/assay/analysis-view/chart-surface.js',
  'ui/css/views/assay-view/results-and-analysis.css'
];
async function refreshAgentTrial() {
  for(const file of FILES) {
    if(!fs.existsSync(path.join(SOURCE,file)))throw new Error(`Missing frozen Agent source: ${file}`);
    fs.copyFileSync(path.join(REPO,file),path.join(SOURCE,file));
  }
  await optimizeTrial();
  console.log('Refreshed Protocol Polish and Agent chart surfaces from Hikari.');
}
if(require.main===module)refreshAgentTrial().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={refreshAgentTrial};
