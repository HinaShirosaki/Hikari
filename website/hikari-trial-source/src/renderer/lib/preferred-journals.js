export function normalizePreferredJournalList(value, maxItems = 12) {
  const limit = Math.max(1, Number(maxItems) || 12);
  const candidates = [];

  function pushCandidate(candidate) {
    if (Array.isArray(candidate)) {
      candidate.forEach(pushCandidate);
      return;
    }
    if (candidate && typeof candidate === 'object') {
      pushCandidate(candidate.name || candidate.url || candidate.href || '');
      return;
    }
    String(candidate || '')
      .split(/[;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => candidates.push(item));
  }

  pushCandidate(value);

  const seen = new Set();
  const journals = [];
  candidates.forEach((journal) => {
    const key = journal.toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    journals.push(journal);
  });
  return journals.slice(0, limit);
}
