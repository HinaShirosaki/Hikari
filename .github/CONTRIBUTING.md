# Contributing to Hikari

Thanks for your interest. Hikari is maintained by one person, so small, focused changes are the easiest to review.

## Before you start

- **Bugs:** open an issue with steps to reproduce, your OS (macOS or Windows), and the Hikari version.
- **Features or larger changes:** open an issue first so we can agree on the approach before you write code.
- **Security problems:** do not open a public issue — see [SECURITY.md](SECURITY.md).

## Development

Requires Node.js 24.

```bash
npm ci
npm start
```

Read [docs/README.md](../docs/README.md) for the architecture, and [docs/module-development/](../docs/module-development/README.md) if you are adding a feature module.

### macOS package signing

`npm run make` signs the completed bundle with an available Developer ID Application
certificate, or an Apple Development certificate for local builds. Keeping the
same signing identity lets Keychain recognize rebuilt versions of Hikari. You can
pin a certificate by its full name or SHA-1 hash:

```bash
HIKARI_MAC_SIGN_IDENTITY='Developer ID Application: Your Name (TEAMID)' npm run make
```

Use `security find-identity -v -p codesigning` to list certificates. A certificate
that was explicitly requested must be available; packaging fails otherwise.
Machines without a certificate use ad hoc signing and may ask for Keychain access
after every rebuild. `HIKARI_MAC_SIGN_IDENTITY=-` explicitly selects that mode.
Apple Development signing is for local verification; public macOS distribution
requires Developer ID signing and notarization.

## Pull requests

1. Branch from `main` (`feat/…`, `fix/…`, `chore/…`).
2. Keep the change scoped to one thing, and match the style of the surrounding code.
3. Run the full gate — it is what CI runs:
   ```bash
   npm test
   ```
4. Update the relevant docs under `docs/` when behavior changes.
5. Describe what changed and why, and how you tested it (include a screenshot for UI changes).

Do not commit generated files, user data, or test fixtures containing third-party copyrighted data.

## License

Hikari is licensed under [Apache-2.0](../LICENSE). By submitting a contribution you agree it is licensed under the same terms (Apache-2.0, section 5).
