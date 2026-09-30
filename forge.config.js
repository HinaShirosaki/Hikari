const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const fs = require('node:fs/promises');
const path = require('node:path');

const makers = [];

if (process.platform === 'darwin') {
  makers.push({
    name: '@electron-forge/maker-zip',
    platforms: ['darwin']
  });
}

if (process.platform === 'win32') {
  makers.push({
    name: '@electron-forge/maker-squirrel',
    config: { name: 'hikari', setupExe: 'HikariSetup.exe', setupIcon: './assets/icon.ico' } // nupkg id; the scoped npm name has a '/'
  });
}

module.exports = {
  hooks: {
    async packageAfterExtract(_config, buildPath, _electronVersion, platform) {
      if (platform !== 'darwin') return;
      // Keep Electron's notices in the bundle, before packaging/signing it.
      const resources = path.join(buildPath, 'Electron.app', 'Contents', 'Resources');
      for (const name of ['LICENSE', 'LICENSES.chromium.html', 'version']) {
        await fs.rename(path.join(buildPath, name), path.join(resources, name));
      }
    }
  },
  // Set by bin/hikari.js so `npx @hinashirosaki/hikari` writes next to the caller, not into the npx cache.
  outDir: process.env.HIKARI_OUT_DIR,
  packagerConfig: {
    // Built from assets/icon.svg by scripts/build-icons.cjs; Packager selects .icns or .ico.
    icon: './assets/icon',
    // Shipped outside app.asar so Settings can open it with the system viewer.
    extraResource: ['./THIRD-PARTY-NOTICES.md'],
    asar: {
      // node_modules is unpacked whole: the MCP stdio server runs under an external
      // Node that cannot read app.asar, and a hand-picked package list kept missing
      // transitive SDK deps (fast-uri, pkce-challenge, @hono/node-server, ...).
      unpackDir: '{src/main/agent,src/main/storage,src/main/data,src/main/lib,src/main/papers,src/renderer/lib,src/renderer/modules/sequence-viewer,vendor/pdfjs,vendor/sqljs,vendor/onnxruntime,vendor/colony-counter,node_modules}'
    },
    prune: true,
    ignore: [
      // Build / package output
      /^\/out($|\/)/,
      /^\/output($|\/)/,
      /^\/dist($|\/)/,
      /^\/tmp($|\/)/,
      /\.asar$/,
      /\.tgz$/,
      /\.zip$/,

      // Editor / assistant / OS noise
      /^\/\.vscode($|\/)/,
      /^\/\.claude($|\/)/,
      /^\/\.codex($|\/)/,
      /^\/\.npm-cache($|\/)/,
      /(^|\/)\.DS_Store$/,
      /(^|\/)~\$[^/]+$/,
      /\.sqlite-(?:shm|wal)$/,
      /\.map$/,

      // Repo-only development material
      /^\/\.github($|\/)/,
      /^\/tests($|\/)/,
      /^\/scripts($|\/)/,
      /^\/docs($|\/)/,
      /^\/artifacts($|\/)/,
      /^\/examples($|\/)/,
      /^\/reports($|\/)/,
      /^\/idea($|\/)/,
      /^\/skills($|\/)/,
      /^\/config($|\/)/,
      /^\/ui\/(?:config|html)($|\/)/,
      /^\/test\.js$/,
      /^\/(?:eslint|forge)\.config\.(?:js|mjs)$/,
      /^\/[^/]*_debug_[^/]*\.json$/,
      /^\/\.gitignore$/,
      /^\/\.npmignore$/,
      /^\/Readme\.md$/,

      // Local scratch / personal / test material
      /^\/Book3\.xlsx$/,
      /^\/hikari-data\.json$/,
      /^\/enana-data(?:\.ena)?\.json$/,
      /^\/Testdata($|\/)/,
      /^\/TestData2($|\/)/,
      /^\/TestData3($|\/)/,
      /^\/TestData5($|\/)/,
      /^\/TestData6($|\/)/,
      /^\/TestData7($|\/)/,

      // ML training workspace (runtime uses vendor/colony-counter instead)
      /^\/colony-counter($|\/)/,

      // Runtime / secret material that shouldn't ship
      /^\/data($|\/)/
    ]
  },
  rebuildConfig: {},
  makers,
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {}
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Off: the streaming validator aborts the main process on a partial read
      // of a packed asar file (string_view::substr out-of-range -> LOG(FATAL)).
      // The app is ad-hoc signed, so anyone who can rewrite app.asar can rewrite
      // Info.plist's hash too — this bought no tamper protection, only crashes.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};
