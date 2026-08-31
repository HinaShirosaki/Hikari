# Gel Analysis

`index.js` composes the runtime and controllers.

- `analysis/`: pure image preprocessing, lane detection, calibration, and quantification
- `images/`: image decoding, enhancement, crop, and rotation controllers
- `manual/`: guided segmentation workflow and its toolbar UI
- `rendering/`: viewer/report rendering, lane table, and presentation labels
- root files: shared state helpers, constants, DOM collection, record storage, and export

Consumers of gel math should import `analysis/` or `public-api.js`, not the view controller.
