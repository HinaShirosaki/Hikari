'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createReleaseAssets({ root = path.join(__dirname, '..'), outputRoot = process.env.HIKARI_OUT_DIR || path.join(root, 'out'), platform = process.platform, arch = process.arch, run = execFileSync } = {}) {
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Release archives require macOS or Windows.');
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const output = path.resolve(outputRoot);
  const directory = `Hikari-${platform}-${arch}`;
  const source = path.join(output, directory);
  const required = platform === 'darwin'
    ? ['Hikari.app/Contents/Info.plist'] : ['HikariSetup.exe', 'Hikari/Hikari.exe'];
  for (const file of required) {
    if (!fs.statSync(path.join(source, file)).size) throw new Error(`Empty release file: ${file}`);
  }
  const destination = path.join(output, 'release-assets');
  fs.mkdirSync(destination, { recursive: true });
  const name = `Hikari-${version}-${platform}-${arch}.zip`;
  const archive = path.join(destination, name);
  fs.rmSync(archive, { force: true });
  if (platform === 'darwin') {
    // ditto preserves bundle permissions, symlinks, and code signatures.
    run('ditto', ['-c', '-k', '--keepParent', source, archive], { stdio: 'inherit' });
  } else {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Compress-Archive -LiteralPath $env:HIKARI_ARCHIVE_SOURCE -DestinationPath $env:HIKARI_ARCHIVE_DESTINATION -CompressionLevel Optimal'], {
      stdio: 'inherit',
      env: { ...process.env, HIKARI_ARCHIVE_SOURCE: source, HIKARI_ARCHIVE_DESTINATION: archive }
    });
  }
  const sha = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(`${archive}.sha256`, `${sha}  ${name}\n`);
  return archive;
}

if (require.main === module) console.log(createReleaseAssets());
module.exports = { createReleaseAssets };
