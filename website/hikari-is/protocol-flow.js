// A small, editable illustration. The linked Trial opens the actual Hikari UI.
(function () {
  const $ = id => document.getElementById(id);
  const fields = ['protein','volume','time'].map(name=>$('pf-'+name));
  const runs = [
    {protein:'Variant A',volume:'200 µL',time:'15 min',observation:'Clear solution; no precipitate.'},
    {protein:'Variant B',volume:'100 µL',time:'10 min',observation:'Faint precipitate; repeat with a fresh aliquot.'}
  ];
  let run = 1, animationTimer;
  const title = () => { $('pf-run-title').textContent=(fields[0].value.trim() || 'Sample')+' comparison'; };
  fields[0].addEventListener('input',title);
  $('pf-next-run').addEventListener('click',()=>{
    run += 1;
    const example=runs[(run-1)%runs.length];
    fields.forEach((field,index)=>{field.value=example[['protein','volume','time'][index]];});
    title();
    $('pf-run-number').textContent='Run '+String(run).padStart(2,'0');
    $('pf-observation').textContent=example.observation;
    const card=document.querySelector('.pf-run');
    card.classList.remove('is-new-run');
    requestAnimationFrame(()=>card.classList.add('is-new-run'));
    clearTimeout(animationTimer);
    animationTimer=setTimeout(()=>card.classList.remove('is-new-run'),650);
    $('pf-status').textContent='New example notebook page: '+example.protein+', '+example.volume+', '+example.time+'. The saved protocol is unchanged.';
  });
})();
