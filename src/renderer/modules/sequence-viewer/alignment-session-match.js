import { alignSequenceToReference } from './alignment.js';
import { buildReferenceRecordKey } from './alignment-input.js';

function buildReferenceSignature(record) {
  if (!record?.sequence?.length) {
    return '';
  }
  return [
    buildReferenceRecordKey(record),
    String(record?.name || '').trim(),
    String(record?.topology || 'linear').trim(),
    String(record?.sourceFormat || 'external').trim()
  ].join('|');
}

function resolveStoredAlignmentForReference(session, referenceRecord) {
  const safeSession = session && typeof session === 'object' ? session : null;
  const safeReference = referenceRecord && typeof referenceRecord === 'object' ? referenceRecord : null;
  const queryRecord = safeSession?.queryRecord && typeof safeSession.queryRecord === 'object'
    ? safeSession.queryRecord
    : null;
  const storedResult = safeSession?.result && typeof safeSession.result === 'object'
    ? safeSession.result
    : null;
  const referenceRecordKey = buildReferenceRecordKey(safeReference);
  const storedReferenceRecordKey = String(safeSession?.referenceRecordKey || '').trim();

  if (!safeSession || !safeReference?.sequence?.length || !queryRecord?.sequence?.length) {
    return {
      session: safeSession,
      result: storedResult,
      wasRealigned: false
    };
  }

  if (storedResult && storedReferenceRecordKey && storedReferenceRecordKey === referenceRecordKey) {
    return {
      session: safeSession,
      result: storedResult,
      wasRealigned: false
    };
  }

  const result = alignSequenceToReference(safeReference, queryRecord);
  return {
    session: {
      ...safeSession,
      referenceRecordKey,
      referenceRecordName: String(safeReference.name || '').trim() || 'reference',
      result
    },
    result,
    wasRealigned: true
  };
}

export { buildReferenceSignature, resolveStoredAlignmentForReference };
