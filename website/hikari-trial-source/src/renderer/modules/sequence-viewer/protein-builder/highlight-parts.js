// Display-only mapping: edited residues inherit the nearest original block.
// Keep assembly parts and physical-template provenance unchanged.
export function mapProteinHighlightParts(sequence, parts = []) {
  const source = parts.map((part) => part.sequence || '').join('');
  if (!parts.length || !source.length) return [];
  const owners = parts.flatMap((part, index) => Array(String(part.sequence || '').length).fill(index));
  const targetOwners = [];
  let prefix = 0;
  while (prefix < source.length && prefix < sequence.length && source[prefix] === sequence[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < source.length - prefix && suffix < sequence.length - prefix
    && source[source.length - 1 - suffix] === sequence[sequence.length - 1 - suffix]) suffix += 1;
  for (let i = 0; i < prefix; i += 1) targetOwners.push(owners[i]);
  const before = source.slice(prefix, source.length - suffix);
  const after = sequence.slice(prefix, sequence.length - suffix);
  const nearby = (index) => owners[Math.max(0, Math.min(owners.length - 1, index))];
  if (before.length === after.length) {
    for (let i = 0; i < after.length; i += 1) targetOwners.push(nearby(prefix + i));
  } else if ((before.length + 1) * (after.length + 1) <= 1000000) {
    const width = after.length + 1;
    const costs = new Uint32Array((before.length + 1) * width);
    for (let i = 0; i <= before.length; i += 1) costs[i * width] = i;
    for (let j = 0; j <= after.length; j += 1) costs[j] = j;
    for (let i = 1; i <= before.length; i += 1) {
      for (let j = 1; j <= after.length; j += 1) {
        costs[i * width + j] = Math.min(
          costs[(i - 1) * width + j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1),
          costs[(i - 1) * width + j] + 1, costs[i * width + j - 1] + 1
        );
      }
    }
    const middle = [];
    let i = before.length;
    let j = after.length;
    while (i || j) {
      const value = costs[i * width + j];
      if (i && j && value === costs[(i - 1) * width + j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1)) {
        middle.push(nearby(prefix + i - 1)); i -= 1; j -= 1;
      } else if (j && value === costs[i * width + j - 1] + 1) {
        middle.push(nearby(prefix + Math.max(0, i - 1))); j -= 1;
      } else {
        i -= 1;
      }
    }
    middle.reverse().forEach((owner) => targetOwners.push(owner));
  } else {
    // Bound work for large replacements; retain both unchanged flanks and use
    // an explicit edited region where block attribution cannot be recovered.
    for (let i = 0; i < after.length; i += 1) targetOwners.push(-1);
  }
  for (let i = source.length - suffix; i < source.length; i += 1) targetOwners.push(owners[i]);
  const result = [];
  targetOwners.forEach((owner, index) => {
    if (!result.length || result[result.length - 1].owner !== owner) {
      result.push({ ...(parts[owner] || { type: 'custom', label: 'Edited sequence' }), owner, sequence: '' });
    }
    result[result.length - 1].sequence += sequence[index];
  });
  return result;
}
