'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const { createBioinformaticsService } = require(path.join(
  projectRoot,
  'src/main/bioinformatics'
));
const { registerBioinformaticsIpc } = require(path.join(
  projectRoot,
  'src/main/ipc/register-bioinformatics-ipc.js'
));
const { createBioinformaticsApi } = require(path.join(
  projectRoot,
  'src/main/preload/api/bioinformatics-api.js'
));
const { BIOINFORMATICS } = require(path.join(projectRoot, 'src/shared/ipc/channels.js'));

function response(body, options = {}) {
  const headers = Object.fromEntries(
    Object.entries(options.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return {
    ok: options.ok !== false,
    status: options.status || 200,
    headers: { get: (name) => headers[String(name || '').toLowerCase()] || null },
    text: async () => typeof body === 'string' ? body : JSON.stringify(body)
  };
}

async function main() {

// NCBI submission is form-encoded, includes contact metadata, respects the RID
// poll window, and returns JSON2_S results as parsed data.
{
  let clock = 1000;
  const requests = [];
  const replies = [
    response('QBlastInfoBegin\nRID = RID12345\nRTOE = 25\nQBlastInfoEnd'),
    response('QBlastInfoBegin\nStatus=READY\nThereAreHits=yes\nQBlastInfoEnd'),
    response({ BlastOutput2: [{ report: { program: 'blastp' } }] }, {
      headers: { 'content-type': 'application/json' }
    })
  ];
  const service = createBioinformaticsService({
    fetch: async (url, options) => {
      requests.push({ url, options });
      return replies.shift();
    },
    now: () => clock,
    requestSpacingMs: 0,
    ridPollIntervalMs: 60_000
  });

  const job = await service.submitBlast({
    query: '>query\nMKWVTFISLL',
    program: 'blastp',
    database: 'swissprot',
    email: 'scientist@example.org',
    expect: 0.001,
    hitlistSize: 12,
    shortQueryAdjust: true
  });
  assert.equal(job.rid, 'RID12345');
  assert.equal(job.estimatedSeconds, 25);
  assert.equal(job.earliestPollAt, 61_000);
  assert.equal(requests[0].options.method, 'POST');
  const submitted = new URLSearchParams(requests[0].options.body);
  assert.equal(submitted.get('PROGRAM'), 'blastp');
  assert.equal(submitted.get('DATABASE'), 'swissprot');
  assert.equal(submitted.get('QUERY'), '>query\nMKWVTFISLL');
  assert.equal(submitted.get('EMAIL'), 'scientist@example.org');
  assert.equal(submitted.get('TOOL'), 'Hikari');
  assert.equal(submitted.get('HITLIST_SIZE'), '12');
  assert.equal(submitted.get('SHORT_QUERY_ADJUST'), 'true');

  clock = 2000;
  const cached = await service.getBlastStatus({ rid: job.rid });
  assert.equal(cached.state, 'waiting');
  assert.equal(cached.cached, true);
  assert.equal(cached.retryAfterMs, 59_000);
  assert.equal(requests.length, 1, 'an early poll must not contact NCBI');

  clock = job.earliestPollAt;
  const ready = await service.getBlastStatus({ rid: job.rid });
  assert.equal(ready.state, 'ready');
  assert.equal(ready.hasHits, true);
  assert.match(requests[1].url, /FORMAT_OBJECT=SearchInfo/);

  const result = await service.getBlastResults({ rid: job.rid, format: 'json' });
  assert.equal(result.format, 'json');
  assert.equal(result.contentType, 'application/json');
  assert.equal(result.data.BlastOutput2[0].report.program, 'blastp');
  assert.match(requests[2].url, /FORMAT_TYPE=JSON2_S/);
  service.stop();
}

// Asking for results before a remote RID is ready establishes the same
// one-minute no-poll window as the explicit status operation.
{
  let clock = 0;
  let requests = 0;
  const service = createBioinformaticsService({
    fetch: async () => {
      requests += 1;
      return response('QBlastInfoBegin\nStatus=WAITING\nQBlastInfoEnd');
    },
    now: () => clock,
    requestSpacingMs: 0,
    ridPollIntervalMs: 1000
  });
  await assert.rejects(
    () => service.getBlastResults({ rid: 'RIDWAIT1' }),
    (error) => error.code === 'BLAST_NOT_READY' && error.retryAfterMs === 1000
  );
  clock = 1;
  await assert.rejects(
    () => service.getBlastResults({ rid: 'RIDWAIT1' }),
    (error) => error.code === 'BLAST_NOT_READY' && error.retryAfterMs === 999
  );
  assert.equal(requests, 1, 'a repeated early results request must not contact NCBI');
  service.stop();
}

// Separate BLAST contacts are serialized with NCBI's minimum spacing.
{
  let clock = 0;
  const waits = [];
  let requestCount = 0;
  const service = createBioinformaticsService({
    fetch: async () => {
      requestCount += 1;
      return response(`RID = RID0000${requestCount}\nRTOE = 1`);
    },
    now: () => clock,
    delay: async (duration) => {
      waits.push(duration);
      clock += duration;
    },
    requestSpacingMs: 10_000,
    defaultNcbiEmail: 'configured@example.org'
  });
  await service.submitBlast({ query: 'ACTG', program: 'blastn' });
  await service.submitBlast({ query: 'TGCA', program: 'blastn' });
  assert.deepEqual(waits, [10_000]);
  service.stop();
}

// UniProt search preserves native records, adds stable summaries, and exposes
// pagination without handing an arbitrary next URL to the renderer.
{
  const requests = [];
  const protein = {
    primaryAccession: 'Q99999',
    uniProtkbId: 'TEST_HUMAN',
    entryType: 'UniProtKB reviewed (Swiss-Prot)',
    proteinDescription: { recommendedName: { fullName: { value: 'Test receptor' } } },
    genes: [{ geneName: { value: 'TST1' } }],
    organism: { scientificName: 'Homo sapiens', commonName: 'Human', taxonId: 9606 },
    sequence: { value: 'MPEPTIDE', length: 8, molWeight: 900, crc64: 'ABC123' },
    comments: [
      { commentType: 'FUNCTION', texts: [{ value: 'Binds a test ligand.' }] },
      {
        commentType: 'SUBCELLULAR LOCATION',
        subcellularLocations: [{ location: { value: 'Cell membrane' } }]
      }
    ],
    features: [{
      type: 'Domain',
      description: 'Test domain',
      location: { start: { value: 2 }, end: { value: 7 } }
    }],
    uniProtKBCrossReferences: [{ database: 'PDB', id: '1ABC', properties: [] }]
  };
  const service = createBioinformaticsService({
    fetch: async (url) => {
      requests.push(url);
      if (url.includes('/search?')) {
        return response({ results: [protein] }, {
          headers: {
            'x-total-results': '42',
            link: '<https://rest.uniprot.org/uniprotkb/search?format=json&query=test&cursor=NEXT123>; rel="next"'
          }
        });
      }
      return response(protein);
    }
  });

  const search = await service.searchUniProt({ query: 'gene:TST1 AND organism_id:9606', size: 10 });
  assert.equal(search.total, 42);
  assert.equal(search.nextCursor, 'NEXT123');
  assert.equal(search.records[0].primaryAccession, 'Q99999');
  assert.equal(search.items[0].proteinName, 'Test receptor');
  assert.deepEqual(search.items[0].geneNames, ['TST1']);
  assert.deepEqual(search.items[0].functions, ['Binds a test ligand.']);
  assert.equal(search.items[0].subcellularLocations[0].location, 'Cell membrane');
  assert.equal(search.items[0].features[0].start.value, 2);
  assert.equal(search.items[0].crossReferences[0].database, 'PDB');
  assert.equal(new URL(requests[0]).searchParams.get('query'), 'gene:TST1 AND organism_id:9606');

  const entry = await service.getUniProtEntry('q99999');
  assert.equal(entry.entry.accession, 'Q99999');
  assert.equal(entry.record.sequence.value, 'MPEPTIDE');
  assert.match(requests[1], /\/uniprotkb\/Q99999\?format=json$/);
  service.stop();
}

// Validation happens before the network, and remote rate-limit metadata is retained.
{
  let requests = 0;
  const service = createBioinformaticsService({
    fetch: async () => {
      requests += 1;
      return response('slow down', {
        ok: false,
        status: 429,
        headers: { 'retry-after': '2' }
      });
    }
  });
  await assert.rejects(
    () => service.submitBlast({ query: 'ACTG', email: 'invalid' }),
    (error) => error.code === 'BLAST_EMAIL_REQUIRED'
  );
  await assert.rejects(
    () => service.searchUniProt({ query: '' }),
    (error) => error.code === 'INVALID_UNIPROT_QUERY'
  );
  assert.equal(requests, 0);
  await assert.rejects(
    () => service.searchUniProt({ query: 'insulin' }),
    (error) => error.code === 'REMOTE_HTTP_ERROR'
      && error.status === 429
      && error.retryAfterMs === 2000
  );
  service.stop();
}

// The IPC adapter returns stable success/failure envelopes, and preload exposes
// only the five fixed-endpoint operations.
{
  const handlers = new Map();
  registerBioinformaticsIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    bioinformaticsService: {
      submitBlast: async (payload) => ({ rid: payload.query }),
      getBlastStatus: async () => {
        const error = new Error('wait');
        error.code = 'BLAST_NOT_READY';
        error.retryAfterMs = 5000;
        throw error;
      },
      getBlastResults: async () => ({}),
      searchUniProt: async () => ({ items: [] }),
      getUniProtEntry: async () => ({ entry: {} })
    }
  });
  assert.equal(handlers.size, 5);
  const submitted = await handlers.get(BIOINFORMATICS.BLAST_SUBMIT)({}, { query: 'ACTG' });
  assert.deepEqual(submitted, { ok: true, job: { rid: 'ACTG' } });
  const waiting = await handlers.get(BIOINFORMATICS.BLAST_STATUS)({}, { rid: 'RID1' });
  assert.equal(waiting.ok, false);
  assert.equal(waiting.code, 'BLAST_NOT_READY');
  assert.equal(waiting.retry_after_ms, 5000);
  assert.equal(Object.hasOwn(waiting, 'status'), false);

  const invokes = [];
  const api = createBioinformaticsApi({
    invoke: (channel, payload) => {
      invokes.push({ channel, payload });
      return Promise.resolve({ ok: true });
    }
  });
  await api.submitBlast({ query: 'ACTG' });
  await api.getBlastStatus('RID1');
  await api.getBlastResults({ rid: 'RID1', format: 'xml' });
  await api.searchUniProt({ query: 'insulin' });
  await api.getUniProtEntry('P01308');
  assert.deepEqual(invokes.map((item) => item.channel), Object.values(BIOINFORMATICS));
  assert.deepEqual(invokes[1].payload, { rid: 'RID1' });
  assert.deepEqual(invokes[4].payload, { accession: 'P01308' });
}

  console.log('bioinformatics-service-selfcheck passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
