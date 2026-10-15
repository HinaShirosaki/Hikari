const REGION_TYPES = new Set([
  'Domain', 'Region', 'Repeat', 'Motif', 'Coiled coil', 'Compositional bias',
  'Chain', 'Peptide', 'Signal', 'Propeptide', 'Transit peptide',
  'Topological domain', 'Transmembrane', 'Intramembrane'
]);

function exactPosition(position) {
  const value = Number(position?.value);
  const modifier = String(position?.modifier || '').toUpperCase();
  return Number.isInteger(value) && value > 0 && (!modifier || modifier === 'EXACT') ? value : null;
}

export function getUniProtRegions(entry) {
  const length = String(entry?.sequence?.value || '').length;
  return (Array.isArray(entry?.features) ? entry.features : [])
    .filter((feature) => REGION_TYPES.has(feature.type))
    .map((feature) => {
      const start = exactPosition(feature.start);
      const end = exactPosition(feature.end);
      return {
        type: feature.type,
        description: String(feature.description || ''),
        start,
        end,
        selectable: start !== null && end !== null && end >= start && end <= length
      };
    });
}

export function selectUniProtSequence(entry, rawStart, rawEnd, region = null) {
  const protein = String(entry?.sequence?.value || '');
  const start = Number(rawStart);
  const end = Number(rawEnd);
  if (!protein) return { sequence: '', error: 'Select a UniProt protein first.' };
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > protein.length) {
    return { sequence: '', error: `Enter a residue range from 1 to ${protein.length}, with start ≤ end.` };
  }
  const sequence = protein.slice(start - 1, end);
  const unsupported = [...new Set([...sequence].filter((residue) => !'ACDEFGHIKLMNPQRSTVWY'.includes(residue)))];
  if (unsupported.length) {
    return { sequence, error: `This selection contains unsupported residues: ${unsupported.join(', ')}. Choose a range containing the 20 standard amino acids.` };
  }
  const annotation = region?.selectable && region.start === start && region.end === end ? region : null;
  const name = entry.geneNames?.[0] || entry.proteinName || entry.accession;
  const fullLength = start === 1 && end === protein.length;
  const label = annotation
    ? `${name} · ${annotation.description || annotation.type}`
    : `${name}${fullLength ? '' : ` · ${start}–${end}`}`;
  const note = `UniProt ${entry.accession} · residues ${start}–${end}${annotation ? ` · ${annotation.description || annotation.type}` : ''}.`;
  return {
    sequence,
    error: '',
    label,
    note,
    uniprot: {
      accession: entry.accession,
      entryId: entry.entryId,
      proteinName: entry.proteinName,
      organism: entry.organism?.scientificName || '',
      start,
      end,
      featureType: annotation?.type || '',
      featureDescription: annotation?.description || ''
    }
  };
}
