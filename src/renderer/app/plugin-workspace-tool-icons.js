// Keep advertised icon capabilities and toolbar validation on the same list.
export const workspaceToolIconPaths = {
  pointer: ['M5 3v17l5-5 4 7 3-2-4-7h7Z'],
  lasso: ['M7 18c-4-2-5-5-3-9S13 3 18 6s4 9-1 12-10 3-10 0 4-3 5-1-1 5-4 5'],
  plus: ['M12 5v14M5 12h14'],
  undo: ['M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12'],
  redo: ['m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12'],
  group: ['M3 3h18v18H3zM7 7h6v6H7zM11 11h6v6h-6z'],
  ungroup: ['M3 7V3h4M17 3h4v4M21 17v4h-4M7 21H3v-4M7 7h6v6H7zM11 11h6v6h-6z'],
  layers: ['m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5'],
  assets: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  scratch: ['M3 4h18v16H3zM15 4v16M3 14h12'],
  minus: ['M5 12h14'],
  crop: ['M6 3v15h15M3 6h15v15'],
  fit: ['M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6']
};
export const workspaceToolIcons = Object.freeze(Object.keys(workspaceToolIconPaths));
