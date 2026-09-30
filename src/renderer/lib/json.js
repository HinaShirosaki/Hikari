// Lenient JSON parse for model output: tries the raw text, then a ```json
// fence, then the outermost [...] and {...} spans. Returns {} if nothing parses.
export function parseJsonFromText(raw) {
  const clean = String(raw || '').trim();
  if (!clean) {
    return {};
  }
  try {
    return JSON.parse(clean);
  } catch {
    const candidates = [];
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    const arrayStart = clean.indexOf('[');
    const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      candidates.push(clean.slice(arrayStart, arrayEnd + 1));
    }

    const objectStart = clean.indexOf('{');
    const objectEnd = clean.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      candidates.push(clean.slice(objectStart, objectEnd + 1));
    }

    const seen = new Set();
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue;
      }
      seen.add(candidate);
      try {
        return JSON.parse(candidate);
      } catch {
        // Try the next extraction candidate.
      }
    }
    return {};
  }
}
