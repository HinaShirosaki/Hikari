'use strict';

const bundled = require('./client-config.json');

const PROVIDERS = Object.freeze({
  'google-drive': {
    name: 'Google Drive',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/drive.file'
  },
  dropbox: {
    name: 'Dropbox',
    authorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    tokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    scope: 'account_info.read files.metadata.read files.content.read files.content.write'
  }
});

function getClientConfig(provider, env = process.env) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unsupported cloud drive.');
  const defaults = bundled[provider];
  const google = provider === 'google-drive';
  const redirectPort = google ? 0 : Number(env.HIKARI_DROPBOX_REDIRECT_PORT || defaults.redirectPort);
  if (!Number.isInteger(redirectPort) || redirectPort < 0 || redirectPort > 65535 || (!google && !redirectPort)) {
    throw new Error('Invalid Dropbox OAuth redirect port.');
  }
  return {
    ...PROVIDERS[provider],
    clientId: String((google ? env.HIKARI_GOOGLE_DRIVE_CLIENT_ID : env.HIKARI_DROPBOX_APP_KEY) || defaults.clientId).trim(),
    clientSecret: google ? String(env.HIKARI_GOOGLE_DRIVE_CLIENT_SECRET || defaults.clientSecret || '').trim() : '',
    redirectPort
  };
}

module.exports = { PROVIDERS, getClientConfig };
