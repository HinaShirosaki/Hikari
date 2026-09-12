'use strict';

const { randomUUID } = require('node:crypto');

const jobs = new Map();
const RESEARCH_POLL_WAIT_MS = 45000;

function hasLiteratureResearchJob(id) {
  return typeof id === 'string' && jobs.has(id);
}

async function waitForLiteratureResearch(id, waitMs = RESEARCH_POLL_WAIT_MS) {
  const job = jobs.get(id);
  if (!job) return { ok: false, status: 'missing', error: 'Paper research job is no longer available. Do not start a replacement automatically.' };
  let timer;
  try {
    const result = await Promise.race([
      job.promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(null), waitMs); })
    ]);
    if (result) {
      jobs.delete(id);
      return result;
    }
    return {
      ok: true,
      status: 'running',
      delegated_research: true,
      research_id: id,
      query: job.query,
      summary: 'Paper research is still running. Call literature_search with this research_id to wait for the same researcher. Do not start another search or present this as a completed result.'
    };
  } finally {
    clearTimeout(timer);
  }
}

function startLiteratureResearchJob(query, run, waitMs = RESEARCH_POLL_WAIT_MS) {
  // Expire only abandoned completed results. Active research has no time limit.
  for (const [id, job] of jobs) {
    if (job.finishedAt && Date.now() - job.finishedAt > 3600000) jobs.delete(id);
  }
  const job = { id: randomUUID(), query, finishedAt: null };
  job.promise = Promise.resolve().then(run).catch((error) => ({
    ok: false, status: 'error', error: String(error?.message || error)
  })).then((result) => {
    job.finishedAt = Date.now();
    return result;
  });
  jobs.set(job.id, job);
  return waitForLiteratureResearch(job.id, waitMs);
}

module.exports = { hasLiteratureResearchJob, startLiteratureResearchJob, waitForLiteratureResearch };
