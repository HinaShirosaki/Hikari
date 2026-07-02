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
      unpackDir: '{src/main/helpers/agent,src/main/helpers/main,src/main/lib,src/main/papers,vendor/sqljs,vendor/onnxruntime,vendor/colony-counter,node_modules/@modelcontextprotocol/sdk,node_modules/zod,node_modules/ajv,node_modules/ajv-formats,node_modules/json-schema-typed,node_modules/zod-to-json-schema}'
    },
    prune: true,
    ignore: [
      // Build / package output
      /^\/out($|\/)/,
      /^\/output($|\/)/,
      /^\/dist($|\/)/,
      /^\/tmp($|\/)/,
      /\.asar$/,
      /\.zip$/,

      // Editor / assistant / OS noise
      /^\/\.vscode($|\/)/,
      /^\/\.claude($|\/)/,
      /^\/\.codex($|\/)/,
      /^\/\.npm-cache($|\/)/,
      /(^|\/)\.DS_Store$/,
      /(^|\/)~\$[^/]+$/,
      /\.map$/,

      // Repo-only development material
      /^\/tests($|\/)/,
      /^\/scripts($|\/)/,
      /^\/docs($|\/)/,
      /^\/reports($|\/)/,
      /^\/idea($|\/)/,
      /^\/skills($|\/)/,
      /^\/test\.js$/,
      /^\/agent-context-debug\.md$/,
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
      /^\/idea($|\/)/,

      // ML training workspace (runtime uses vendor/colony-counter instead)
      /^\/colony-counter($|\/)/,

      // Runtime / secret material that shouldn't ship
      /^\/data\/.*\.log$/,
      /^\/data\/Config\/codex-cli-home\/auth\.json$/,
      /^\/data\/Config\/codex-cli-home\/log($|\/)/,
      /^\/data\/Config\/codex-cli-home\/tmp($|\/)/,
      /^\/data\/[^/]+\.gb$/,
      /^\/data\/[^/]+\.gbk$/
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
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};
