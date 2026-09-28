// The four lane corners, how they are named to the user, which corner of the
// neighbouring lane each is glued to, and how near a click counts as grabbing a
// ladder band.
export const LADDER_BAND_GRAB_PX = 6;
export const LANE_VERTEX_KEYS = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
export const LANE_VERTEX_LABELS = Object.freeze({
  topLeft: 'top-left',
  topRight: 'top-right',
  bottomRight: 'bottom-right',
  bottomLeft: 'bottom-left'
});
export const GLUED_LANE_VERTEX = Object.freeze({
  topLeft: { laneOffset: -1, vertexKey: 'topRight' },
  bottomLeft: { laneOffset: -1, vertexKey: 'bottomRight' },
  topRight: { laneOffset: 1, vertexKey: 'topLeft' },
  bottomRight: { laneOffset: 1, vertexKey: 'bottomLeft' }
});
