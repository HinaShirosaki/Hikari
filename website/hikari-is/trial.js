(function () {
  'use strict';
  const M = window.HikariTrialModel, $ = id => document.getElementById(id);
  // AI workspaces are retained only for generating showcase screenshots.
  const FEATURES = M.PUBLIC_FEATURES;
  const mobileTrial = matchMedia('(max-width: 760px), (hover: none) and (pointer: coarse)');
  // Keep the screen's width as the desktop canvas throughout the page visit.
  const viewportWidth = Math.round(window.screen.width || 1280);
  const FEATURE_COPY = {
    cloning: ['Design your cloning plan.', 'Insert, replace, or delete DNA. Compare cloning routes, inspect primer properties, and copy or export an order list.'],
    'protein-builder': ['Build a protein. Prepare the sequence.', 'Arrange proteins, tags, linkers, and cleavage sites. Build coding DNA with your chosen codon usage, then copy either sequence for gene synthesis.'],
    calculations: ['Bench calculations, on paper.', 'Two known values reveal formulas; a third calculates the fourth. Choose units and save the worksheet.'],
    protocols: ['Reuse a method. Record the run.', 'Start from a saved protocol. Keep each run’s values, sample links, and observations together, even after you edit the reusable method.'],
    workflows: ['Repeat the process. Trace the run.', 'Reuse a workflow template. Track each run’s steps and branches, record values and results, and keep its notebook pages linked.'],
    samples: ['Find every sample.', 'Locate samples by container and well. Edit their details, import or export CSV, and see the experiments linked to them.']
  };
  // Small inline icons follow Hikari's existing outline icon style.
  const FEATURE_ICONS = {
    cloning: '<path d="M6 3c0 9 12 9 12 18M18 3c0 9-12 9-12 18M6.5 5h11M8.5 9h7M8.5 15h7M6.5 19h11"/>',
    'protein-builder': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><path d="M6.5 10v4m11-4v4M6.5 12h11"/>',
    calculations: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 11h1m6 0h1M8 15h1m6 0h1M8 19h1m6 0h1"/>',
    protocols: '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4M2 6h4M2 10h4M2 14h4M2 18h4M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    workflows: '<rect width="8" height="8" x="3" y="3" rx="2"/><path d="M7 11v4a2 2 0 0 0 2 2h4"/><rect width="8" height="8" x="13" y="13" rx="2"/>',
    samples: '<rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v13h14V7M10 11h4"/>'
  };
  const escape = value => String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let selected = M.DEFAULT_FEATURE, expandedFeature = null, storyScroll = {product: 0, agent: 0}, lastHash = null;
  $('trial-feature-list').innerHTML=FEATURES.map(f=>{
    const [lead,copy]=FEATURE_COPY[f.id];
    return `<li class="trial-feature-item"><a class="trial-feature-link" data-trial-feature="${f.id}" href="#trial/${f.id}" aria-expanded="false" aria-controls="trial-feature-copy-${f.id}"><svg class="trial-feature-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${FEATURE_ICONS[f.id]}</svg><span class="trial-feature-name">${escape(f.name)}</span></a><div id="trial-feature-copy-${f.id}" class="trial-feature-reveal" aria-hidden="true" inert><div class="trial-feature-reveal-inner"><p class="trial-feature-copy"><strong>${escape(lead)}</strong> ${escape(copy)}</p></div></div></li>`;
  }).join('');
  function setStatus(message) { $('demo-status').textContent=message; $('demo-status').hidden=!message; }
  function setLayoutProperty(element, name, value) {
    if(element.style.getPropertyValue(name)!==value)element.style.setProperty(name,value);
  }
  // Render at the computer's logical screen width, then fit the window into the
  // page. Its height follows the free space, between 6:5 and 16:9 proportions.
  // Mobile visitors receive a desktop-only message; no app frame is loaded.
  function fitAppWindow() {
    const page=$('trial-panel'), stage=$('trial-stage'), workbench=$('trial-workbench'), pool=$('trial-frame-pool');
    if(page.hidden || mobileTrial.matches || !page.clientWidth || !page.clientHeight) return;
    const controls=workbench.querySelector('.trial-controls');
    const gap=parseFloat(getComputedStyle(workbench).rowGap) || 8;
    const footerHeight=controls.offsetHeight+gap;
    setLayoutProperty(page,'--trial-footer-height',`${footerHeight}px`);
    const availableWidth=stage.clientWidth;
    const availableHeight=Math.max(1,stage.clientHeight-footerHeight);
    const width=Math.min(availableWidth,availableHeight*16/9), height=Math.min(availableHeight,width*5/6);
    const scale=width/viewportWidth, viewportHeight=height/scale;
    setLayoutProperty(workbench,'--trial-window-width',`${width}px`);
    setLayoutProperty(workbench,'--trial-window-height',`${height}px`);
    setLayoutProperty(pool,'--trial-viewport-width',`${viewportWidth}px`);
    setLayoutProperty(pool,'--trial-viewport-height',`${viewportHeight}px`);
    setLayoutProperty(pool,'--trial-scale',String(scale));
    const fontSize=String(M.appFontSize(viewportWidth,viewportHeight,scale));
    page.dataset.appFontSize=fontSize;
    for(const frame of pool.querySelectorAll('iframe')) {
      if(frame.dataset.layoutFont===fontSize)continue;
      frame.contentWindow.postMessage({type:'hikari-trial:layout',fontSize:Number(fontSize)},M.messageTargetOrigin(location));
      frame.dataset.layoutFont=fontSize;
    }
    window.HikariTrialGuide.refresh();
  }
  function refreshFeatureList() {
    for(const link of $('trial-feature-list').querySelectorAll('[data-trial-feature]')) {
      const expanded=link.dataset.trialFeature===selected && expandedFeature===selected;
      if(link.dataset.trialFeature===selected)link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
      link.setAttribute('aria-expanded',String(expanded));
      link.closest('.trial-feature-item').classList.toggle('is-expanded',expanded);
      const description=$(link.getAttribute('aria-controls'));
      description.setAttribute('aria-hidden',String(!expanded));
      description.inert=!expanded;
    }
  }
  function renderTrial() {
    window.HikariTrialGuide.hide();
    $('trial-desktop-message').hidden = !mobileTrial.matches;
    $('trial-layout').hidden = mobileTrial.matches;
    $('trial-workbench').hidden = mobileTrial.matches;
    if (mobileTrial.matches) return;
    const feature = FEATURES.find(f => f.id === selected);
    expandedFeature=selected;
    // Keep opened workspaces mounted, as the desktop app does. Switching tabs
    // must not discard drafts.
    $('trial-title').textContent=feature.title;
    const pool=$('trial-frame-pool');
    pool.querySelectorAll('iframe').forEach(frame=>{
      const inactive=frame.dataset.feature!==selected;
      if(frame.hidden!==inactive)frame.hidden=inactive;
      frame.inert=inactive;
      frame.setAttribute('aria-hidden',String(inactive));
      frame.id=inactive?'trial-app-'+frame.dataset.feature:'trial-app';
    });
    let frame=pool.querySelector(`iframe[data-feature="${selected}"]`);
    if(!frame){
      // Build the first table at its fitted text size, avoiding an immediate
      // second layout when the newly loaded frame announces that it is ready.
      fitAppWindow();
      frame=document.createElement('iframe');frame.className='trial-app';frame.dataset.feature=selected;
      frame.setAttribute('aria-label',`Hikari: ${feature.name} demo`);
      const query=`?feature=${selected}&fontSize=${$('trial-panel').dataset.appFontSize || M.APP_FONT_SIZE}`;
      if(location.protocol==='file:') {
        // A file iframe is a separate opaque origin in Safari. srcdoc inherits
        // this page's origin, keeping guide targets and their geometry readable.
        // A classic script supplies the built HTML without a blocked file fetch.
        const loader=new URL('trial-file-frame.js'+query,location.href);
        frame.srcdoc=`<!doctype html><script src="${escape(loader.href)}"></script>`;
      } else frame.src='trial-app.html'+query;
      frame.setAttribute('allow','clipboard-write');frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads allow-modals allow-forms');
      frame.addEventListener('load',()=>{
        delete frame.dataset.layoutFont; fitAppWindow();
      });
      pool.append(frame);
    }
    frame.hidden=false;frame.inert=false;frame.removeAttribute('aria-hidden');frame.id='trial-app';
    $('trial-guide-start').disabled=frame.dataset.ready!=='true';
    setStatus(frame.dataset.error || '');
    $('trial-retry').hidden = !frame.dataset.error;
    refreshFeatureList();
    fitAppWindow();
    window.HikariTrialGuide.show(selected,frame);
  }
  window.addEventListener('message',event=>{
    const frame=document.querySelector(`#trial-frame-pool iframe[data-feature="${FEATURES.find(f=>f.id===event.data?.feature)?.id}"]`);
    if(!frame || !M.isTrialMessage(event,frame.contentWindow,location)) return;
    if(event.data.type==='hikari-trial:action-complete')window.HikariTrialGuide.complete(event.data.feature);
    if(event.data.type==='hikari-trial:ready'){frame.dataset.ready='true';delete frame.dataset.error;delete frame.dataset.layoutFont;fitAppWindow();if(event.data.feature===selected){setStatus('');$('trial-retry').hidden=true;$('trial-guide-start').disabled=false;window.HikariTrialGuide.show(selected,frame);}}
    if(event.data.type==='hikari-trial:cloning-state'){frame.dataset.sequenceEdited=String(event.data.edited===true);if(event.data.feature===selected)window.HikariTrialGuide.refresh();}
    if(event.data.type==='hikari-trial:error'){frame.dataset.error=String(event.data.message || 'This demo could not start.');if(event.data.feature===selected){setStatus(frame.dataset.error);$('trial-retry').hidden=false;}}
    if(event.data.type==='hikari-trial:status' && event.data.feature===selected)setStatus(String(event.data.message || ''));
  });
  function route(force = false, focusFeature = false) {
    if (location.hash === '#trial/plugins') history.replaceState(null, '', '#plugins');
    if (location.hash === '#trial/experiments' || location.hash.startsWith('#trial/agent-')) history.replaceState(null, '', '#agent');
    if (!force && lastHash === location.hash) return;
    lastHash = location.hash;
    const hash = location.hash.slice(1), trial = hash === 'trial' || hash.startsWith('trial/');
    const target = hash ? document.getElementById(hash) : null;
    const page = trial ? 'trial' : hash === 'plugins' ? 'plugins' : hash === 'agent' || target?.closest('#agent-panel') ? 'agent' : 'product';
    document.querySelector('.site-header .cta').href = page === 'agent' ? '#agent-end' : '#install';
    if (!trial) window.HikariTrialGuide.hide();
    // Product and Agent each reopen where the reader left them.
    for (const id of ['product', 'agent']) if (page !== id && !$(id + '-panel').hidden) storyScroll[id] = scrollY;
    document.body.classList.toggle('is-trial',trial);
    for (const id of ['product', 'agent', 'trial', 'plugins']) {
      const active = page === id;
      $(id + '-panel').hidden = !active;
      $(id + '-tab').setAttribute('aria-selected', String(active));
      $(id + '-tab').tabIndex = active ? 0 : -1;
    }
    if (trial) {
      selected = M.resolveFeature(hash.split('/')[1]);
      renderTrial(); window.scrollTo(0, 0);
    } else if (page === 'plugins') {
      window.scrollTo(0, 0);
    } else {
      requestAnimationFrame(() => {
        if (hash === page) window.scrollTo(0, storyScroll[page]);
        else if (target) target.scrollIntoView();
        else if (!hash) window.scrollTo(0, 0);
        window.dispatchEvent(new Event('resize'));
        if (focusFeature && target?.classList.contains('feature-anchor')) {
          $(page + '-panel').querySelector('.feature-copy:not([hidden]) > h2').focus({preventScroll: true});
        }
      });
    }
    if (typeof window.render === 'function') window.render();
  }
  function navigate(hash, focusFeature = false) {
    if (location.hash !== hash) history.pushState(null, '', hash);
    route(focusFeature, focusFeature);
  }
  $('trial-guide-start').addEventListener('click',()=>{
    const frame=$('trial-app');
    if(!frame || frame.dataset.ready!=='true')return;
    try { M.resetFeature(localStorage,selected); }
    catch { setStatus('This demo could not reset. Check browser storage and try again.'); return; }
    // Discard the renderer too: undo history, dialogs, selections, and unsaved
    // edits belong to its document and must not survive a fresh walkthrough.
    window.HikariTrialGuide.reset(selected,frame);
    frame.remove();
    renderTrial();
  });
  $('trial-retry').addEventListener('click',()=>{
    const frame=$('trial-app');
    delete frame.dataset.error; delete frame.dataset.ready;
    $('trial-guide-start').disabled=true;
    $('trial-retry').hidden=true; setStatus('');
    window.HikariTrialGuide.hide();
    if(frame.hasAttribute('srcdoc'))frame.srcdoc=frame.srcdoc;
    else frame.src=frame.src;
  });
  $('trial-feature-list').addEventListener('click',event=>{
    const link=event.target.closest('[data-trial-feature]');
    if(!link || link.dataset.trialFeature!==selected || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
    event.preventDefault();event.stopPropagation();
    expandedFeature=expandedFeature===selected ? null : selected;
    refreshFeatureList();window.HikariTrialGuide.refresh();
  });
  $('trial-feature-list').addEventListener('transitionend',event=>{
    if(event.propertyName==='grid-template-rows' && !$('trial-panel').hidden)window.HikariTrialGuide.refresh();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(link.getAttribute('href'), !!link.closest('.feature-dots'));
  });
  document.querySelector('.header-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target.closest('[role="tab"]'));
    if (index < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    navigate(tab.getAttribute('href')); tab.focus();
  });
  window.addEventListener('hashchange', () => route());
  window.addEventListener('popstate', () => route());
  let layoutFrame=null;
  function queueFitAppWindow() {
    if(layoutFrame!==null)return;
    layoutFrame=requestAnimationFrame(()=>{layoutFrame=null;fitAppWindow();});
  }
  const windowSizeObserver=new ResizeObserver(queueFitAppWindow);
  windowSizeObserver.observe($('trial-panel'));
  windowSizeObserver.observe($('trial-stage'));
  windowSizeObserver.observe(document.querySelector('.trial-controls'));
  window.addEventListener('resize',queueFitAppWindow);
  document.fonts.ready.then(queueFitAppWindow);
  mobileTrial.addEventListener('change',()=>{if(!$('trial-panel').hidden)renderTrial();});
  route(true);
})();
