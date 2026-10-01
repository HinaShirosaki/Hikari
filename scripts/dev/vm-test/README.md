# App-only update check in a fresh VM

`app-only-update-e2e.mjs` packages this checkout labelled `0.0.0-e2e`, starts
it, updates it the way Settings > Updates does and checks that it restarts into
the latest npm release from `<userData>/app-code`. With `--compare-full` it also
times the full rebuild (`npx @hinashirosaki/hikari@<latest>`). It prints and
saves `hikari-e2e-result.json` (OS temp folder) with seconds per step. It has to
run in the desktop session, since Hikari opens a window.

## macOS with tart

On an Apple Silicon Mac with tart installed:

```sh
tart list                                        # the names of old VMs
scripts/dev/vm-test/tart-macos.sh <old VM name>  # deletes it, clones a fresh one, runs the check
```

It always deletes its own `hikari-e2e-macos` first and again at the end
(`KEEP_VM=1` keeps it). `IMAGE` picks another Cirrus Labs base image.

## Windows with UTM

utmctl can clone, start and delete VMs but not create one, and its `exec` runs
outside the desktop session, so this part is by hand:

1. Delete the old VM: in UTM, or `utmctl list` then `utmctl delete "<name>"`
   (no confirmation).
2. Make a fresh Windows 11 VM with UTM's new-VM wizard and sign in. If you
   keep a clean template instead: `utmctl clone "<template>" --name hikari-e2e-windows`
   and `utmctl start hikari-e2e-windows`.
3. In the VM, open PowerShell and run:

   ```powershell
   iwr -useb https://raw.githubusercontent.com/HinaShirosaki/Hikari/feat/app-only-updates/scripts/dev/vm-test/windows-guest.ps1 | iex
   ```

   It downloads Node.js and the branch to `%LOCALAPPDATA%\HikariE2E` and runs
   the check with `--compare-full`.
