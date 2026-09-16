// A compact, hand-curated set of broadly used promoters for backbone recognition.
// Keep this list limited to common promoter sequences rather than importing a
// third-party feature-library export.

export const COMMON_PROMOTERS = Object.freeze([
  Object.freeze({
    label: 'Amp promoter',
    sequence: 'TATGTATCCGCTCATGAGACAATAACCCTGATAAATGCTTCAATAATATTGAAAAAGGAAGAGT'
  }),
  Object.freeze({
    label: 'CMV promoter',
    sequence: 'GTGATGCGGTTTTGGCAGTACATCAATGGGCGTGGATAGCGGTTTGACTCACGGGGATTTCCAAGTCTCCACCCCATTGACGTCAATGGGAGTTTGTTTTGGCACCAAAATCAACGGGACTTTCCAAAATGTCGTAACAACTCCGCCCCATTGACGCAAATGGGCGGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCT'
  }),
  Object.freeze({
    label: 'EF1alpha promoter',
    sequence: 'GGGCAGAGCGCACATCGCCCACAGTCCCCGAGAAGTTGGGGGGAGGGGTCGGCAATTGAACGGGTGCCTAGAGAAGGTGGCGCGGGGTAAACTGGGAAAGTGATGTCGTGTACTGGCTCCGCCTTTTTCCCGAGGGTGGGGGAGAACCGTATATAAGTGCAGTAGTCGCCGTGAACGTTCTTTTTCGCAACGGGTTTGCCGCCAGAACACAG'
  }),
  Object.freeze({
    label: 'Lac promoter',
    sequence: 'TTTACACTTTATGCTTCCGGCTCGTATGTTG'
  }),
  Object.freeze({
    label: 'T7 promoter',
    sequence: 'TAATACGACTCACTATAGG'
  }),
  Object.freeze({
    label: 'tac promoter',
    sequence: 'TTGACAATTAATCATCGGCTCGTATAATG'
  })
]);

export default COMMON_PROMOTERS;
