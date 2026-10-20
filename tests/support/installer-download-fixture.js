// Network stand-in used only by installer-selfcheck.js. Both installers still
// execute their real checksum, extraction, runtime validation, and promotion.
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const fixture = JSON.parse(fs.readFileSync(process.env.HIKARI_TEST_FIXTURE, 'utf8'));
const outputIndex = args.indexOf('-o');
const url = outputIndex >= 0 ? args[outputIndex - 1] : args[0];
const destination = outputIndex >= 0 ? args[outputIndex + 1] : args[1];
fs.appendFileSync(fixture.requests, `${url}\n`);
let contents;
if (url.endsWith('/dist-tags')) contents = JSON.stringify({ latest: fixture.version });
else if (url.endsWith(`${fixture.asset}.sha256`) && fixture.prebuilt) contents = `${fixture.badChecksum ? '0'.repeat(64) : fixture.assetSha}  ${fixture.asset}\n`;
else if (url.endsWith(`/${fixture.asset}`) && fixture.prebuilt) contents = fs.readFileSync(fixture.assetFile);
else if (url.endsWith('/SHASUMS256.txt')) contents = `${fixture.badNodeChecksum ? '0'.repeat(64) : fixture.nodeSha}  ${fixture.nodeName}\n`;
else if (url.endsWith(`/${fixture.nodeName}`) && !fixture.interrupted) contents = fs.readFileSync(fixture.nodeFile);
else {
  fs.writeFileSync(destination, 'partial download');
  process.exit(44);
}
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.writeFileSync(destination, contents);
