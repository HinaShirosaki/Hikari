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
    asar: true,
    prune: true,
    ignore: [
      /^\/out($|\/)/,
      /^\/output($|\/)/,
      /^\/tmp($|\/)/,
      /^\/\.vscode($|\/)/,
      /^\/\.DS_Store$/,
      /^\/enana-data(?:\.ena)?\.json$/,
      /^\/\.npm-cache($|\/)/,
      /^\/\.claude($|\/)/,
      /^\/\.codex($|\/)/,
      /^\/Testdata($|\/)/,
      /^\/Exported Standard Features($|\/)/,
      /^\/tests($|\/)/,
      /^\/scripts($|\/)/,
      /^\/docs($|\/)/,
      /^\/reports($|\/)/,
      /^\/idea($|\/)/,
      /^\/skills($|\/)/,
      /^\/agent-context-debug\.md$/,
      /^\/test\.js$/,
      /^\/\.gitignore$/,
      /^\/\.npmignore$/,
      /^\/Readme\.md$/,
      /\.DS_Store$/,
      /\.map$/
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
