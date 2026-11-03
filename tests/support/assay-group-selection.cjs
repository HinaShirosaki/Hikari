const assert = require('node:assert/strict');

module.exports = async function checkGroupSelection({ js, settle, shot, win }) {
  const valuesBefore = await js('JSON.stringify(qa.state.assays[0].resultValues)');
  await js("document.getElementById('assay-workspace-view-data').click();document.getElementById('assay-data-tab-raw').click()");await settle();
  const tableTop = await js("document.getElementById('assay-result-table').getBoundingClientRect().top");
  await js("document.getElementById('assay-analysis-toggle-btn').click();document.getElementById('assay-workspace-view-chart').click();document.getElementById('assay-analysis-add-row-group-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-workspace-chart').hidden"), true, 'arming grouping opens Data view');
  assert.equal(await js("document.getElementById('assay-data-tab-raw').getAttribute('aria-selected')"), 'true');
  assert.equal(await js("document.getElementById('assay-analysis-row-groups').value"), '', 'arming does not create a group from an old selection');
  assert.equal(await js("document.getElementById('assay-analysis-add-row-group-btn').getAttribute('aria-pressed')"), 'true');
  assert.match(await js("document.getElementById('assay-group-selection-hint-text').textContent"), /Drag across plate rows/);
  assert.equal(await js("document.getElementById('assay-result-table').getBoundingClientRect().top"), tableTop, 'the floating hint does not move the plate table');
  assert.equal(await js("getComputedStyle(document.querySelector('#assay-result-table .tabulator-cell')).cursor"), 'crosshair');
  await shot('19-group-rows-mode');

  const point = (row, field) => js(`(() => {
    const grid=Tabulator.findTable(document.querySelector('#assay-result-table .tabulator'))[0];
    const element=${row === null ? `grid.getColumn('${field}').getElement()` : `grid.getRow(${row}).getCell('${field}').getElement()`};
    const r=element.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })()`);
  async function drag(from, to) {
    win.webContents.focus();
    win.webContents.sendInputEvent({type:'mouseMove',...from});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...from});
    for (let step=1;step<=5;step++) {
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*step/5),y:Math.round(from.y+(to.y-from.y)*step/5),modifiers:['leftButtonDown']});
      await new Promise(resolve=>setTimeout(resolve,15));
    }
    assert.equal(await js("document.querySelectorAll('#assay-result-table .tabulator-cell input').length"), 0, 'dragging a group does not edit cells');
    const range = await js("Tabulator.findTable(document.querySelector('#assay-result-table .tabulator'))[0].getRanges().map(range=>({columns:range.getColumns().map(column=>column.getField()),rows:range.getRows().map(row=>row.getData().rowLabel)}))");
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...to});
    await settle();
    return range;
  }
  await drag(await point(0,'c1'), await point(1,'c2'));
  assert.equal(await js("document.getElementById('assay-analysis-row-groups').value"), 'Row Group 1: A,B', 'releasing the drag creates the selected row group');
  assert.equal(await js("document.getElementById('assay-group-selection-hint').hidden"), true);
  assert.equal(await js("document.getElementById('assay-analysis-add-row-group-btn').getAttribute('aria-pressed')"), 'false');
  assert.ok(await js("document.querySelectorAll('#assay-result-table .assay-analysis-row-group-cell').length") > 0, 'the completed group is highlighted');

  await js("document.getElementById('assay-analysis-add-column-group-btn').click()");await settle();
  assert.match(await js("document.getElementById('assay-group-selection-hint-text').textContent"), /Drag across plate columns/);
  const columns = await drag(await point(null,'c3'), await point(null,'c1'));
  assert.equal(await js("document.getElementById('assay-analysis-column-groups').value"), 'Column Group 1: 1,2,3', 'reverse header dragging groups columns in plate order: '+JSON.stringify(columns));
  await shot('20-dragged-groups');

  await js("document.getElementById('assay-analysis-add-row-group-btn').click()");await settle();
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle();
  assert.equal(await js("document.getElementById('assay-group-selection-hint').hidden"), true, 'Escape cancels grouping');
  assert.equal(await js("document.getElementById('assay-analysis-row-groups').value"), 'Row Group 1: A,B', 'canceling does not append a group');
  await js("document.getElementById('assay-analysis-add-row-group-btn').click();document.getElementById('assay-group-selection-cancel-btn').click()");await settle();
  assert.equal(await js("document.getElementById('assay-group-selection-hint').hidden"), true, 'Cancel exits grouping');
  await js("document.getElementById('assay-analysis-add-column-group-btn').click();document.getElementById('assay-workspace-view-chart').click()");await settle();
  assert.equal(await js("document.getElementById('assay-analysis-add-column-group-btn').getAttribute('aria-pressed')"), 'false', 'returning to Chart cancels grouping');
  assert.equal(await js('JSON.stringify(qa.state.assays[0].resultValues)'), valuesBefore, 'group gestures preserve the plate values');
  await js("document.getElementById('assay-analysis-clear-groups-btn').click()");await settle();
};
