// PDF text spans and Markdown wrap differently. Keep offsets while ignoring
// punctuation, whitespace, line-end hyphens and typographic ligatures.
export function citationTextIndex(value = '') {
  const text = String(value);
  let normalized = '';
  const offsets = [];
  let position = 0;
  for (const character of text) {
    const letters = character.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    normalized += letters;
    for (let index = 0; index < letters.length; index++) offsets.push({ start: position, end: position + character.length });
    position += character.length;
  }
  return { text: normalized, offsets };
}

export function citationNeedles(excerpt = '') {
  const plain = String(excerpt).replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  const full = citationTextIndex(plain).text;
  if (full.length < 24) return [];
  const words = plain.match(/[\p{L}\p{N}]+(?:[-\u00ad][\p{L}\p{N}]+)*/gu) || [];
  const needles = [full];
  // A long selected paragraph can cross columns or include a figure label.
  // Fall back to substantial consecutive phrases, never isolated keywords.
  for (let start = 0; start + 12 <= words.length; start += 6) {
    const phrase = citationTextIndex(words.slice(start, start + 12).join(' ')).text;
    if (phrase.length >= 48 && !needles.includes(phrase)) needles.push(phrase);
  }
  return needles;
}

export function findCitationText(text, needles) {
  const indexed = citationTextIndex(text);
  for (const needle of needles) {
    const index = indexed.text.indexOf(needle);
    if (index >= 0) return { needle, start: indexed.offsets[index].start,
      end: indexed.offsets[index + needle.length - 1].end };
  }
  return null;
}
