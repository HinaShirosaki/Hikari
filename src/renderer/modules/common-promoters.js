export const COMMON_PROMOTER_LIBRARY_METADATA = Object.freeze({
  featureType: 'promoter',
  description: 'Editable library of common promoter sequences.'
});

export const COMMON_PROMOTERS = Object.freeze([
  Object.freeze({
    id: 't7',
    label: 'T7 promoter',
    type: 'promoter',
    note: 'promoter for bacteriophage T7 RNA polymerase',
    sequence: 'TAATACGACTCACTATAGG'
  })
]);
