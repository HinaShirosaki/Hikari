import { getSampleInventoryLocationDisplay } from '../../lib/inventory-settings.js';
import {
  createDefaultWells,
  getContainerLayout,
  getContainerTypeLabel,
  getWellName,
  isSupportedContainerType,
  isMultiWellContainer,
  normalizeCustomGridDimensions
} from '../../lib/inventory-containers.js';

export {
  createDefaultWells,
  getContainerLayout,
  getContainerTypeLabel,
  getWellName,
  isSupportedContainerType,
  isMultiWellContainer,
  normalizeCustomGridDimensions
};

export const SAMPLE_TYPE_COLORS = {
  plasmid: '#2f6fec',
  cell_line: '#e8871a',
  strain: '#159a8a',
  antibody: '#d75062',
  protein: '#3b9d3a',
  chemical: '#0f8a9d',
  primer: '#be9a1a',
  other: '#718096'
};

export function getSectionDisplay(section) {
  return getSampleInventoryLocationDisplay(section);
}
