const assert = require('node:assert/strict');

module.exports = async function checkCellEditing({ js, settle, win }) {
  await js("document.getElementById('assay-workspace-view-data').click();document.getElementById('assay-data-tab-raw').click()");await settle();
  const original = await js('qa.state.assays[0].resultValues.A1');
  const point = await js(`(() => {
    const grid=Tabulator.findTable(document.querySelector('#assay-result-table .tabulator'))[0];
    const cell=grid.getRow(0).getCell('c1');
    const checks=window.qaCellEditingChecks={started:0,canceled:0,edited:0,grid,cell};
    checks.onStart=()=>checks.started++;
    checks.onCancel=()=>checks.canceled++;
    checks.onEdit=()=>checks.edited++;
    grid.on('cellEditing',checks.onStart);grid.on('cellEditCancelled',checks.onCancel);grid.on('cellEdited',checks.onEdit);
    const r=cell.getElement().getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })()`);
  const click = async () => {
    win.webContents.focus();
    win.webContents.sendInputEvent({type:'mouseMove',...point});
    win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});
    win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});
    await settle();
  };
  await click();
  assert.deepEqual(await js('({started:qaCellEditingChecks.started,canceled:qaCellEditingChecks.canceled,edited:qaCellEditingChecks.edited})'),
    {started:1,canceled:0,edited:0}, 'a single click starts one stable editor without the start/cancel flash');
  assert.equal(await js("document.activeElement === qaCellEditingChecks.cell.getElement().querySelector('input')"), true, 'the clicked cell keeps keyboard focus');
  await js("document.activeElement.select()");
  await win.webContents.insertText('123.5');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});await settle();
  assert.equal(await js('qa.state.assays[0].resultValues.A1'), '123.5', 'Enter saves the edited result');
  assert.equal(await js('qaCellEditingChecks.edited'), 1, 'the edit commits once');
  await js(`qaCellEditingChecks.cell.setValue(${JSON.stringify(original)})`);await settle();
  await click();
  assert.equal(await js('qaCellEditingChecks.canceled'), 0, 'reopening the cell still does not cancel its editor');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await settle();
  assert.equal(await js('qaCellEditingChecks.canceled'), 1, 'Escape deliberately cancels the editor');
  assert.equal(await js('qa.state.assays[0].resultValues.A1'), original, 'canceling keeps the saved value');
  await js(`(() => {
    const checks=qaCellEditingChecks;
    checks.grid.off('cellEditing',checks.onStart);checks.grid.off('cellEditCancelled',checks.onCancel);checks.grid.off('cellEdited',checks.onEdit);
    delete window.qaCellEditingChecks;
    document.getElementById('assay-workspace-view-chart').click();
  })()`);await settle();
};
