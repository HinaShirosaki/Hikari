async function verifyLibraryNavigation({ tool, evaluate, check, win, pause, waitFor }) {
  const created = await evaluate(`(async () => {
    const results = [];
    for (let i = 1; i <= 26; i++) results.push(await illustrationWorkspace.manage('create', undefined, 'Navigation figure '+i));
    return results.every(result => result.ok);
  })()`);
  check(created, 'Create a scrollable library in temporary storage');
  win.setSize(1300, 650); await pause(80);
  const clickVisibleRow = async () => {
    const target = await evaluate(`(() => {
      const list=document.getElementById('illustrations');
      list.scrollTop=(list.scrollHeight-list.clientHeight)*0.65;
      const bounds=list.getBoundingClientRect();
      const button=[...list.children].find(row=>{
        const rect=row.getBoundingClientRect();
        return row.getAttribute('aria-pressed')!=='true' && rect.top>=bounds.top && rect.bottom<=bounds.bottom;
      });
      if(!button) throw new Error('No visible illustration to select');
      button.focus({preventScroll:true});
      const before=list.scrollTop,id=button.dataset.illustrationId;
      button.click();return {before,id};
    })()`);
    check(target.before > 100, 'Select a figure after scrolling beyond the first rows');
    await waitFor(async () => (await tool({ action: 'list' })).active_illustration_id === target.id, 'The clicked illustration did not open');
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    return target;
  };
  const selected = await clickVisibleRow();
  const position = await evaluate('document.getElementById("illustrations").scrollTop');
  check(Math.abs(position - selected.before) < 1, `Opening a scrolled illustration preserves navigation position (${selected.before} → ${position})`);
  check(await evaluate(`document.activeElement?.dataset.illustrationId===${JSON.stringify(selected.id)} && document.activeElement.getAttribute('aria-pressed')==='true'`), 'Selection retains keyboard focus on the active illustration');
  const current = await tool({ action: 'read' });
  const edited = await tool({ action: 'apply', illustration_id: current.illustration_id, expected_revision: current.revision,
    request_id: require('node:crypto').randomUUID(), operations: [{ op: 'title', title: 'Renamed navigation figure' }] });
  check(edited.ok, edited.error || 'Rename the selected illustration');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  check(Math.abs(await evaluate('document.getElementById("illustrations").scrollTop') - selected.before) < 1, 'Saving the selected figure also preserves navigation position');
  await evaluate('document.getElementById("illustration-search").value="navigation figure";document.getElementById("illustration-search").dispatchEvent(new Event("input"))');
  check(await evaluate('document.getElementById("illustrations").scrollTop===0'), 'Changing the search starts at the first matching illustration');
  const filtered = await clickVisibleRow();
  check(await evaluate('document.getElementById("illustration-search").value==="navigation figure"'), 'Opening a filtered illustration preserves the search');
  check(Math.abs(await evaluate('document.getElementById("illustrations").scrollTop') - filtered.before) < 1, 'Selection preserves scroll within filtered results');
}

module.exports = { verifyLibraryNavigation };
