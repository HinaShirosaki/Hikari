# Installation and releases

`install.sh` and `install.ps1` resolve npm's `latest` version, then try
`https://github.com/HinaShirosaki/Hikari/releases/download/v<version>/Hikari-<version>-<platform>-<arch>.zip`
and its `.sha256` sidecar. This works for prerelease tags too. A missing archive
falls back to a source build; an invalid checksum stops the install. Downloads
and extraction are staged before moving the completed app into `hikari-out/`.

`hikari.js` always builds from source. `source-build.js` copies published source
paths into a temporary workspace and runs `npm ci` followed by `npm run dist`.
The caller's absolute output path is preserved and the workspace is removed on
success or failure. It never installs build dependencies inside npm's npx cache.

`npm pack` and `npm publish` run `prepare-package.js` through `prepack`. It checks
the manifest against `package-lock.json` and ships that lock as
`bin/build-lock.json`, since npm excludes the conventional lock filename from
published packages. The generated copy is ignored by Git. Do not use
`npm pack --ignore-scripts` for a release. Update the normal lock whenever
changing dependencies or the release version.

After `npm run dist`, `npm run release:assets` creates the versioned ZIP and
SHA-256 sidecar under `out/release-assets/`. macOS archives preserve bundle
permissions, symlinks, and signatures using `ditto`. Windows archives contain
both `HikariSetup.exe` and the portable `Hikari/` folder. The publish workflow
builds macOS arm64/x64 and Windows x64 archives, attaches them to the exact
release tag, and only then publishes the npm package. It retains the direct
Windows installer download. macOS uses the existing signing configuration;
without a configured certificate the archives contain ad hoc signed apps.

For branch-only bootstrap smoke tests, `HIKARI_PACKAGE_SPEC=./hikari.tgz`
selects a locally packed tarball and `HIKARI_BUILD_FROM_SOURCE=1` skips prebuilt
downloads. The test driver supplies the branch's exact `HIKARI_VERSION`.
