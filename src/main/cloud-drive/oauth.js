'use strict';

const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

async function requestToken(config, fields, fetchImpl = globalThis.fetch) {
  const body = new URLSearchParams({ client_id: config.clientId, ...fields });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  const response = await fetchImpl(config.tokenUrl, {
    method: 'POST', body, signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    // Provider responses can contain credentials. Only expose the error code.
    throw new Error(`Cloud sign-in failed (${String(result.error || response.status).replace(/[^\w-]/g, '').slice(0, 80)}). Please sign in again.`);
  }
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token || fields.refresh_token || '',
    expiresAt: Date.now() + (Number(result.expires_in) || 3600) * 1000,
    clientId: config.clientId
  };
}

async function authorize({ provider, config, openExternal, signal, fetchImpl = globalThis.fetch, timeoutMs = 180000 }) {
  if (!config.clientId) throw new Error(`${config.name} sign-in is not configured in this Hikari build.`);
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  let finish;
  const callback = new Promise((resolve, reject) => { finish = (error, code) => error ? reject(error) : resolve(code); });
  // The callback may fail while the browser is opening.
  callback.catch(() => {});
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const returnedState = Buffer.from(url.searchParams.get('state') || '');
    if (request.method !== 'GET' || url.pathname !== '/oauth/callback'
      || returnedState.length !== state.length || !timingSafeEqual(returnedState, Buffer.from(state))) {
      response.writeHead(400).end('Invalid sign-in callback.');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    const code = url.searchParams.get('code');
    response.end(code ? 'Signed in. You can return to Hikari.' : 'Sign-in canceled. You can return to Hikari.');
    finish(code ? null : new Error('Cloud sign-in canceled.'), code);
  });
  const cancel = () => finish(new Error('Cloud sign-in canceled.'));
  const timer = setTimeout(() => finish(new Error('Cloud sign-in timed out. Please try again.')), timeoutMs);
  timer.unref?.();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.redirectPort, '127.0.0.1', resolve);
    });
    server.on('error', error => finish(error));
    if (signal?.aborted) cancel();
    const redirectUri = `http://127.0.0.1:${server.address().port}/oauth/callback`;
    const url = new URL(config.authorizeUrl);
    const parameters = {
      client_id: config.clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: config.scope, state, code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url')
    };
    if (provider === 'dropbox') parameters.token_access_type = 'offline';
    else { parameters.access_type = 'offline'; parameters.prompt = 'consent'; }
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
    if (!signal?.aborted) await openExternal(url.href);
    const code = await callback;
    if (signal?.aborted) throw new Error('Cloud sign-in canceled.');
    return await requestToken(config, { code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }, fetchImpl);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    server.close();
    server.closeAllConnections();
  }
}

module.exports = { authorize, requestToken };
