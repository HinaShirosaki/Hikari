const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

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
    config: {}
  });
}

if (process.platform === 'linux') {
  makers.push(
    {
      name: '@electron-forge/maker-deb',
      config: {}
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {}
    }
  );
}

module.exports = {
  packagerConfig: {
    asar: {
      unpackDir: '{src/main/agent,src/main/storage,src/main/data,src/main/lib,src/main/papers,vendor/pdfjs,vendor/sqljs,vendor/onnxruntime,vendor/colony-counter,node_modules/@modelcontextprotocol/sdk,node_modules/zod,node_modules/ajv,node_modules/ajv-formats,node_modules/json-schema-typed,node_modules/zod-to-json-schema}'
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
      /^\/hikari-data(?:\.ena)?\.json$/,
      /^\/enana-data(?:\.ena)?\.json$/,
      /^\/Exported Standard Features($|\/)/,
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
