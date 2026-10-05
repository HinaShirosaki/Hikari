import { element } from './artwork.mjs';

const paths = {
  pointer: ['M5 3v17l5-5 4 7 3-2-4-7h7Z'],
  lasso: ['M7 18c-4-2-5-5-3-9S13 3 18 6s4 9-1 12-10 3-10 0 4-3 5-1-1 5-4 5'],
  assets: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  scratch: ['M3 4h18v16H3zM15 4v16M3 14h12'],
  fit: ['M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  rail: ['m14 6-6 6 6 6'],
  layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 12 9 5 9-5M3 16l9 5 9-5'],
  download: ['M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5'],
  undo: ['M9 5 4 10l5 5', 'M4 10h10a6 6 0 0 1 0 12'],
  redo: ['m15 5 5 5-5 5', 'M20 10H10a6 6 0 0 0 0 12'],
  group: ['M3 3h18v18H3z', 'M7 7h6v6H7zM11 11h6v6h-6z'],
  ungroup: ['M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4', 'M7 7h6v6H7zM11 11h6v6h-6z'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  down: ['m7 10 5 5 5-5'],
  close: ['m6 6 12 12M6 18 18 6'],
  copy: ['M8 8h12v12H8z', 'M16 8V4H4v12h4'],
  up: ['m7 13 5-5 5 5', 'M12 8v12M5 4h14'],
  lower: ['m7 11 5 5 5-5', 'M12 4v12M5 20h14'],
  trash: ['M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  hidden: ['m3 3 18 18M10.6 5.1 12 5c6 0 10 7 10 7a20 20 0 0 1-3.1 3.9M6.2 6.2A23 23 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.8-1.8'],
  alignLeft: ['M4 5h16M4 10h10M4 15h16M4 20h10'],
  alignCenter: ['M4 5h16M7 10h10M4 15h16M7 20h10'],
  alignRight: ['M4 5h16M10 10h10M4 15h16M10 20h10'],
  arrow: ['M12 19V5m-6 6 6-6 6 6'],
  image: ['M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5', 'M8 7h.01']
};
export function icon(name) {
  const svg = element('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'ui-icon' });
  for (const d of paths[name] || paths.image) svg.append(element('path', { d }));
  return svg;
}
export function mountIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach(node => node.prepend(icon(node.dataset.icon)));
}
