export function createProtocolDraftImportHelpers({
  createId,
  normalizeImportedProtocolStepEntries,
  normalizeMaterials,
  normalizeTroubleshooting
}) {
  function sanitizeIncomingProtocol(rawProtocol) {
      if (!rawProtocol || typeof rawProtocol !== 'object') {
        return null;
      }
  
      const name = String(rawProtocol.name || rawProtocol.title || '').trim();
      if (!name) {
        return null;
      }
  
      const nowIso = new Date().toISOString();
      const parsedCreatedAt = Date.parse(String(rawProtocol.createdAt || '').trim());
      const createdAt = Number.isFinite(parsedCreatedAt) ? new Date(parsedCreatedAt).toISOString() : nowIso;
      const parsedUpdatedAt = Date.parse(String(rawProtocol.updatedAt || '').trim());
      const updatedAt = Number.isFinite(parsedUpdatedAt) ? new Date(parsedUpdatedAt).toISOString() : createdAt;
  
      return {
        id: String(rawProtocol.id || createId()),
        name,
        createdAt,
        updatedAt,
        purpose: String(rawProtocol.purpose || '').trim(),
        materials: normalizeMaterials(rawProtocol.materials),
        steps: normalizeImportedProtocolStepEntries(rawProtocol.steps || rawProtocol.procedure),
        troubleshooting: normalizeTroubleshooting(rawProtocol.troubleshooting)
      };
    }
  
    function sanitizeIncomingProtocols(rawProtocols) {
      if (Array.isArray(rawProtocols)) {
        return rawProtocols.map((item) => sanitizeIncomingProtocol(item)).filter(Boolean);
      }
      const single = sanitizeIncomingProtocol(rawProtocols);
      return single ? [single] : [];
    }
  
    function parseLooseJsonObjectOrArray(rawInput) {
      const text = String(rawInput || '').trim();
      if (!text) {
        return null;
      }
  
      const candidates = [text];
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenceMatch?.[1]) {
        candidates.push(String(fenceMatch[1]).trim());
      }
  
      const firstBrace = text.indexOf('{');
      const lastBrace = text.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        candidates.push(text.slice(firstBrace, lastBrace + 1));
      }
  
      const firstBracket = text.indexOf('[');
      const lastBracket = text.lastIndexOf(']');
      if (firstBracket >= 0 && lastBracket > firstBracket) {
        candidates.push(text.slice(firstBracket, lastBracket + 1));
      }
  
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(candidate);
          if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
            return parsed;
          }
        } catch {
          // Try the next candidate.
        }
      }
      return null;
    }
  
    function parseProtocolsFromJson(rawInput) {
      const parsed = parseLooseJsonObjectOrArray(rawInput);
      if (!parsed) {
        return [];
      }
  
      if (Array.isArray(parsed)) {
        return sanitizeIncomingProtocols(parsed);
      }
      if (Array.isArray(parsed.protocols)) {
        return sanitizeIncomingProtocols(parsed.protocols);
      }
      if (parsed.protocol && typeof parsed.protocol === 'object') {
        return sanitizeIncomingProtocols(parsed.protocol);
      }
      return sanitizeIncomingProtocols(parsed);
    }

  return {
    parseLooseJsonObjectOrArray,
    parseProtocolsFromJson,
    sanitizeIncomingProtocol,
    sanitizeIncomingProtocols
  };
}
