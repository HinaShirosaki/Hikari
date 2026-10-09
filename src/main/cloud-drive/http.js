'use strict';

function createCloudHttp({ getToken, refreshToken, fetchImpl = globalThis.fetch }) {
  return async function request(url, options = {}, retried = false) {
    const token = await getToken();
    const response = await fetchImpl(url, {
      ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60000), redirect: 'error'
    });
    if (response.status === 401 && !retried) {
      await refreshToken();
      return request(url, options, true);
    }
    if (!response.ok) {
      const error = new Error(response.status === 401
        ? 'Cloud session expired. Please disconnect and sign in again.'
        : `Cloud request failed (HTTP ${response.status}). Your local files are saved; try syncing again.`);
      error.status = response.status;
      throw error;
    }
    return response;
  };
}

async function readCloudBytes(response, limit = 256 * 1024 * 1024) {
  const length = Number(response.headers.get('content-length'));
  if (length > limit) throw new Error('Cloud file exceeds the workspace size limit.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new Error('Cloud file exceeds the workspace size limit.');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally { await reader.cancel().catch(() => {}); }
}

module.exports = { createCloudHttp, readCloudBytes };
