# Google Drive and Dropbox

Hikari can connect its **whole local workspace folder** to a Hikari workspace in Google Drive or Dropbox. In **Settings → Cloud drives**, sign in, then create a cloud workspace or select one created on another device. Hikari creates the cloud folder for you. Each local workspace has its own connections. Both providers can be connected at the same time.

Local storage remains authoritative for editing and is available offline. After a successful local save, Hikari uploads changes after a five-second quiet period. If another device has published a version, background upload stops and reports that cloud updates are available. **Sync now** saves current records, compares local and cloud versions, downloads changes, and reloads the workspace. Open editors and plugins must be saved first. Hikari pauses renderer persistence while this operation runs and checks for intervening edits before publishing or installing changes. Cloud failures do not change whether the local save succeeded.

When the same file has changed differently on two devices, Hikari lists the conflicting paths before changing them. **Keep local changes** or **Use cloud changes** resolves those conflicts; other files are merged normally. If either side changed since the conflict was shown, Hikari requires review again. When cloud history has multiple concurrent tips, it uses their common ancestor rather than allowing one device to silently revert another's independent changes. Choosing cloud changes for a conflict uses the last cloud tip in version order.

For Hikari's recognized JSON record wrappers, comparison ignores only the top-level `updated_at` save clock. It verifies this content identity against the stored bytes before trusting a cloud manifest. Record timestamps and every scientific field are still compared, and the original bytes are retained. Ordinary files and attachments use byte identity. Routine saves of unchanged records therefore do not generate conflicts or extra cloud versions merely because their wrapper timestamps changed.

Cloud storage uses Hikari-managed `objects/` and `versions/` folders, rather than a live mirror intended for editing in the provider's website. Objects are addressed by SHA-256. A small immutable version record is published only after every object is uploaded. This preserves old cloud versions and makes interrupted uploads retryable. Version and object folders must not be edited or deleted manually. Replaced/deleted local files are retained in `.hikari-cloud-recovery/<transaction>/`; `journal.json` maps each numbered `.before` file to its original relative path. Signing out or disconnecting a workspace leaves local files and cloud versions in place. Version history and recovery copies currently have no automatic retention limit.

The current limits are 20,000 files per workspace and 256 MiB per file. Symlinks, nonportable/colliding paths, and nonempty SQLite WAL/journal files stop sync. `.git`, `node_modules`, `.codex`, `.aws`, `.env*`, `Logs`, `Tmp`, transaction/temp files, and cloud recovery copies are excluded. Scientific Markdown, hidden record metadata, attachments, plugin files, and Hikari database files otherwise travel together. Connecting a repository syncs its workspace content; Git history is excluded.

## OAuth application setup

OAuth applications must be registered before distributing an enabled build. The checked-in `src/main/cloud-drive/client-config.json` contains empty client IDs; builds without configured IDs show unavailable sign-in controls. User accounts and tokens are never bundled.

For Google Drive:

1. Enable the Google Drive API in the Hikari Google Cloud project and configure the OAuth consent screen.
2. Create a **Desktop app** OAuth client. Use its client ID and, when provided, the downloaded desktop client secret. Desktop clients support a dynamic loopback port; no web server is needed.
3. Set `HIKARI_GOOGLE_DRIVE_CLIENT_ID` and `HIKARI_GOOGLE_DRIVE_CLIENT_SECRET`, or put the public desktop client configuration into `client-config.json` for distribution.
4. The integration requests only `https://www.googleapis.com/auth/drive.file`. It lists and opens Hikari-created cloud workspaces rather than requesting access to all Drive files.

For Dropbox:

1. Register a scoped **App folder** application in the Dropbox App Console.
2. Enable `account_info.read`, `files.metadata.read`, `files.content.read`, and `files.content.write`.
3. Register the exact redirect URI `http://127.0.0.1:53682/oauth/callback`.
4. Set `HIKARI_DROPBOX_APP_KEY`, or the `dropbox.clientId` in `client-config.json`. No Dropbox app secret is used. If changing the callback port with `HIKARI_DROPBOX_REDIRECT_PORT` or `redirectPort`, register the matching URI.

Both sign-in flows use the system browser, authorization code + PKCE (S256), a random state value, offline refresh tokens, a loopback-only callback listener, cancellation, and a three-minute timeout. The main process encrypts tokens with Electron `safeStorage` in its private profile `Config/cloud-drive/cloud-credentials.json`. Credentials never enter the renderer or the workspace. Sign-in refuses unavailable encryption and Linux's `basic_text` backend. Account identity changes detach previous workspace links. Every cloud IPC operation is restricted to the main Hikari window and derives local paths from the configured storage root.

Provider references: [Google desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Drive file scope](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Dropbox OAuth](https://docs.dropboxapi.com/dropbox-api/docs/oauth).

## Validation

`node tests/cloud-drive-selfcheck.js` checks sync behavior, two-device divergence, binary round trips, offline failures, deletion/conflict safeguards, path confinement, credential encryption, refresh handling, provider HTTP contracts, IPC access, and a real temporary OAuth callback listener. It uses fake cloud accounts and isolated local files.

After `npm run build:ui`, `node node_modules/electron/cli.js tests/cloud-drive-electron.cjs` exercises the rendered app with real preload/storage/cloud IPC and fake providers, including sign-in cancellation, both providers, download/reload, conflict controls, offline retry, disconnect, and narrow layout. Actual provider consent, refresh, quota, and account behavior still require testing with registered OAuth clients; these fixtures do not constitute live Google Drive or Dropbox verification.
