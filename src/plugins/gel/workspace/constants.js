export const MAX_IMAGE_DIMENSION = 1400;
export const DEFAULT_LADDER_STANDARDS = [250, 150, 100, 75, 50, 37, 25, 20, 15, 10];
export const LOCAL_UTIF_URL = './vendor/utif/UTIF.js';

export const DEFAULT_LADDER_PRESET_ID = 'biorad-precision-plus';

// Band sizes as published by the vendor (Bio-Rad, Thermo Fisher, NEB), verified
// against their product pages in August 2026. Protein bands are kDa, DNA bp,
// RNA nt. Bands stay in descending order — buildCalibration pairs the sorted
// ladder bands with these top-down, so a wrong order silently mis-sizes a gel.
export const LADDER_PRESETS = [
  {
    id: DEFAULT_LADDER_PRESET_ID,
    group: 'Protein (kDa)',
    label: 'Bio-Rad Precision Plus Protein (All Blue / Dual Color / Kaleidoscope / Unstained)',
    bands: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10]
  },
  {
    id: 'biorad-precision-plus-dual-xtra',
    group: 'Protein (kDa)',
    label: 'Bio-Rad Precision Plus Protein Dual Xtra',
    bands: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10, 5, 2]
  },
  {
    id: 'thermo-pageruler-prestained',
    group: 'Protein (kDa)',
    label: 'Thermo PageRuler Prestained (10-180 kDa, #26616)',
    bands: [180, 130, 100, 70, 55, 40, 35, 25, 15, 10]
  },
  {
    id: 'thermo-pageruler-plus-prestained',
    group: 'Protein (kDa)',
    label: 'Thermo PageRuler Plus Prestained (10-250 kDa, #26619)',
    bands: [250, 130, 100, 70, 55, 35, 25, 15, 10]
  },
  {
    id: 'thermo-pageruler-unstained',
    group: 'Protein (kDa)',
    label: 'Thermo PageRuler Unstained (10-200 kDa, #26614)',
    bands: [200, 150, 120, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10]
  },
  {
    id: 'thermo-spectra-broad-range',
    group: 'Protein (kDa)',
    label: 'Thermo Spectra Multicolor Broad Range (#26634)',
    bands: [260, 140, 100, 70, 50, 40, 35, 25, 15, 10]
  },
  {
    id: 'neb-color-prestained-broad',
    group: 'Protein (kDa)',
    label: 'NEB Color Prestained Broad Range (10-250 kDa, #P7719)',
    bands: [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 10]
  },
  {
    id: 'neb-blue-prestained-broad',
    group: 'Protein (kDa)',
    label: 'NEB Blue Prestained Broad Range (11-250 kDa, #P7718)',
    bands: [250, 180, 130, 95, 72, 55, 43, 34, 26, 17, 11]
  },
  {
    id: 'neb-unstained-broad',
    group: 'Protein (kDa)',
    label: 'NEB Unstained Broad Range (10-200 kDa, #P7717)',
    bands: [200, 150, 100, 85, 70, 60, 50, 40, 30, 25, 20, 15, 10]
  },
  {
    id: 'neb-1kb',
    group: 'DNA (bp)',
    label: 'NEB 1 kb DNA Ladder (#N3232)',
    bands: [10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 500]
  },
  {
    id: 'neb-1kb-plus',
    group: 'DNA (bp)',
    label: 'NEB 1 kb Plus DNA Ladder (#N3200 / #N0550)',
    bands: [
      10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1200, 1000,
      900, 800, 700, 600, 500, 400, 300, 200, 100
    ]
  },
  {
    // The 517/500 doublet co-migrates as one band, so it is listed once.
    id: 'neb-100bp',
    group: 'DNA (bp)',
    label: 'NEB 100 bp DNA Ladder (#N3231)',
    bands: [1517, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]
  },
  {
    id: 'neb-50bp',
    group: 'DNA (bp)',
    label: 'NEB 50 bp DNA Ladder (#N3236)',
    bands: [
      1350, 916, 766, 700, 650, 600, 550, 500, 450, 400,
      350, 300, 250, 200, 150, 100, 50
    ]
  },
  {
    id: 'neb-lambda-hindiii',
    group: 'DNA (bp)',
    label: 'NEB Lambda DNA-HindIII Digest (#N3012)',
    bands: [23130, 9416, 6557, 4361, 2322, 2027, 564, 125]
  },
  {
    id: 'thermo-generuler-1kb',
    group: 'DNA (bp)',
    label: 'Thermo GeneRuler 1 kb (#SM0311)',
    bands: [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250]
  },
  {
    id: 'thermo-generuler-1kb-plus',
    group: 'DNA (bp)',
    label: 'Thermo GeneRuler 1 kb Plus (#SM1331)',
    bands: [20000, 10000, 7000, 5000, 4000, 3000, 2000, 1500, 1000, 700, 500, 400, 300, 200, 75]
  },
  {
    id: 'thermo-generuler-100bp',
    group: 'DNA (bp)',
    label: 'Thermo GeneRuler 100 bp (#SM0241)',
    bands: [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]
  },
  {
    id: 'thermo-generuler-100bp-plus',
    group: 'DNA (bp)',
    label: 'Thermo GeneRuler 100 bp Plus (#SM0321)',
    bands: [3000, 2000, 1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]
  },
  {
    id: 'thermo-generuler-mix',
    group: 'DNA (bp)',
    label: 'Thermo GeneRuler DNA Ladder Mix (#SM0331)',
    bands: [
      10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1200,
      1000, 900, 800, 700, 600, 500, 400, 300, 200, 100
    ]
  },
  {
    id: 'neb-ssrna',
    group: 'RNA (nt)',
    label: 'NEB ssRNA Ladder (#N0362)',
    bands: [9000, 7000, 5000, 3000, 2000, 1000, 500]
  },
  {
    id: 'thermo-riboruler-high',
    group: 'RNA (nt)',
    label: 'Thermo RiboRuler High Range (#SM1821)',
    bands: [6000, 4000, 3000, 2000, 1500, 1000, 500, 200]
  },
  {
    id: 'thermo-riboruler-low',
    group: 'RNA (nt)',
    label: 'Thermo RiboRuler Low Range (#SM1831)',
    bands: [1000, 800, 600, 400, 300, 200, 100]
  }
];

export function getLadderPresetBands(presetId) {
  const preset = LADDER_PRESETS.find((item) => item.id === presetId);
  return (preset ? preset.bands : DEFAULT_LADDER_STANDARDS).slice();
}
