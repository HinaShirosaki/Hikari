// Classic deferred script also supports Safari previews opened directly via file://.
(() => {
// Static captures of the real app; switching never opens a research workspace.
const figure = document.querySelector('.hero-product');
const image = figure?.querySelector('img');
const title = figure?.querySelector('.hero-window-bar span');
const scenes = {
  home: ['Home', 'home-hero.png?v=wide-rail-7', 'Hikari Home dashboard with a running timer, cell passage reminders, papers, and notebook notes. Fictional lab data.'],
  notebook: ['Notebook', 'hero-notebook.png?v=wide-rail-7', 'Hikari Notebook: a fictional enzyme heat-challenge record with linked sample PROT-017 and a table of activity results.'],
  samples: ['Samples', 'hero-samples.png?v=wide-rail-7', 'Hikari Samples: a populated freezer box of fictional enzyme variants and the selected A17 protein sample.'],
  plate: ['Plate', 'hero-plate.png?v=wide-rail-7', 'Hikari Plate: fictional retained enzyme activity measurements for A17, B08, and wild type in a 96-well assay.'],
  protocols: ['Protocols', 'hero-protocols.png?v=wide-rail-7', 'Hikari Protocols: a fictional thermal challenge method with reusable sample, temperature, and duration fields.'],
  workflows: ['Workflows', 'hero-workflows.png?v=wide-rail-7', 'Hikari Workflows: fictional enzyme screening runs with progress and linked notebook records.'],
  dna: ['DNA', 'hero-dna.png?v=plasmid-9', 'Hikari DNA: the circular plasmid map preview of a fictional 6,120 bp A17 expression vector, with annotated promoter, enzyme, GFP reporter, origin, and resistance gene.'],
  papers: ['Papers', 'hero-papers.png?v=wide-rail-7', 'Hikari Papers: the AlphaFold paper by Jumper and colleagues, with the copper-free click chemistry paper by Baskin and colleagues in the library.']
};
// Featured modules follow APP_DOCK_ORDER from left to right.
const order = ['home', 'protocols', 'notebook', 'papers', 'samples', 'workflows', 'dna', 'plate'];
const frame = figure?.querySelector('.hero-product-frame');
const progress = document.querySelector('.hero-progress');
const transitionDuration = 1100;
const transitionEasing = 'cubic-bezier(.45, 0, .25, 1)';
progress?.style.setProperty('--hero-transition-duration', `${transitionDuration}ms`);
progress?.style.setProperty('--hero-transition-easing', transitionEasing);
let progressAnimation = null, pendingIndex = null;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let activeImage = image;
let spareImage = null;
let preparedIndex = -1, prepared = null;
let current = 0, timer = null, visible = false, changing = false;
const painted = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

function loadScene(index) {
  if (preparedIndex !== index) {
    preparedIndex = index;
    // Decode the actual hidden layer, rather than a detached clone.
    const filename = scenes[order[index]][1].split('?')[0].replace('.png', '');
    spareImage.sizes = image.sizes;
    spareImage.srcset = [1280, 2560, 3840].map(width => `shots/${filename}-${width}.webp ${width}w`).join(', ') + `, shots/${scenes[order[index]][1]} 6400w`;
    spareImage.src = new URL(`shots/${scenes[order[index]][1]}`, document.baseURI).href;
    prepared = spareImage.decode().then(() => spareImage).catch(() => {
      preparedIndex = -1;
      return null;
    });
  }
  return prepared;
}
function canPlay() {
  return visible && !document.hidden && !figure.closest('[hidden]');
}
function updateProgressVisibility() {
  if (!progress) return;
  const track = document.getElementById('track');
  const heading = document.getElementById('head');
  if (!track || !heading || figure.closest('[hidden]')) { progress.hidden = true; return; }
  const bounds = heading.getBoundingClientRect();
  const headerBottom = document.querySelector('.site-header')?.getBoundingClientRect().bottom || 0;
  const sectionTitleVisible = bounds.top < innerHeight && bounds.bottom > headerBottom;
  progress.hidden = track.getBoundingClientRect().top <= 0 || sectionTitleVisible;
}
function syncProgress(selected = current) {
  progress?.querySelectorAll('button').forEach((button, index) => {
    button.setAttribute('aria-pressed', String(index === selected));
  });
}
function stopPlayback() {
  clearTimeout(timer);
  progressAnimation?.cancel();
  progressAnimation = null;
}
function schedule(delay = 3000) {
  stopPlayback();
  if (canPlay() && !changing) {
    void loadScene((current + 1) % order.length);
    const fill = progress?.querySelector('button[aria-pressed="true"] .hero-progress-fill');
    if (fill) {
      if (reducedMotion.matches) fill.style.transform = 'scaleX(1)';
      else progressAnimation = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: delay, easing: 'linear', fill: 'forwards' });
    }
    timer = setTimeout(advance, delay);
  }
}
async function advance(index = (current + 1) % order.length, manual = false) {
  if ((!canPlay() && !manual) || !order[index]) return;
  if (changing) {
    if (manual) pendingIndex = index;
    return;
  }
  if (index === current) { schedule(); return; }
  clearTimeout(timer);
  progressAnimation?.finish();
  changing = true;
  const next = await loadScene(index);
  if (next && (canPlay() || manual)) {
    const scene = scenes[order[index]];
    const outgoing = activeImage;
    next.style.zIndex = '2';
    next.style.opacity = '0';
    // Give the decoded pixels time to reach the compositor before fading in.
    await painted();
    // Morph the indicator alongside the image, using the same duration and easing.
    syncProgress(index);
    if (!reducedMotion.matches) {
      const fade = next.animate([{ opacity: 0 }, { opacity: 1 }], { duration: transitionDuration, easing: transitionEasing, fill: 'both' });
      await fade.finished;
      next.style.opacity = '1';
      fade.cancel();
    } else {
      next.style.opacity = '1';
    }
    next.alt = scene[2];
    next.removeAttribute('aria-hidden');
    outgoing.setAttribute('aria-hidden', 'true');
    outgoing.style.opacity = '0';
    outgoing.style.zIndex = '0';
    next.style.zIndex = '1';
    activeImage = next;
    spareImage = outgoing;
    preparedIndex = -1;
    prepared = null;
    title.textContent = `Hikari · ${scene[0]}`;
    figure.setAttribute('aria-label', `Hikari ${scene[0]} preview`);
    const credit = document.querySelector('.hero-papers-credit');
    if (credit) credit.hidden = order[index] !== 'papers';
    current = index;
  }
  changing = false;
  if (pendingIndex !== null) {
    const requested = pendingIndex;
    pendingIndex = null;
    if (requested !== current) { void advance(requested, true); return; }
  }
  schedule();
}
if (frame && image && title) {
  // Keep both layers mounted. Never replace the source of the visible image.
  spareImage = image.cloneNode();
  spareImage.removeAttribute('src');
  spareImage.removeAttribute('srcset');
  spareImage.fetchPriority = 'low';
  spareImage.alt = '';
  spareImage.setAttribute('aria-hidden', 'true');
  spareImage.style.opacity = '0';
  spareImage.style.zIndex = '0';
  image.style.zIndex = '1';
  frame.append(spareImage);
  if (progress) {
    order.forEach((key, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.heroIndex = String(index);
      button.setAttribute('aria-label', `Show ${scenes[key][0]} screenshot`);
      button.title = scenes[key][0];
      button.innerHTML = '<span class="hero-progress-track" aria-hidden="true"><span class="hero-progress-fill"></span></span>';
      button.addEventListener('click', () => { void advance(index, true); });
      progress.append(button);
    });
    syncProgress();
    updateProgressVisibility();
    progress.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...progress.querySelectorAll('button')];
      const focused = buttons.indexOf(document.activeElement);
      if (focused < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (focused + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
      buttons[next].click();
    });
  }
  // Keep Home visible through the headline's entrance before beginning playback.
  const firstAdvanceAt = performance.now() + 5500;
  const resume = () => schedule(Math.max(3000, firstAdvanceAt - performance.now()));
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible) resume(); else stopPlayback();
  }, { threshold: 0.15 }).observe(figure);
  document.addEventListener('visibilitychange', resume);
  const refresh = () => { updateProgressVisibility(); resume(); };
  let visibilityFrame = null;
  const queueVisibility = () => {
    if (visibilityFrame !== null) return;
    visibilityFrame = requestAnimationFrame(() => { visibilityFrame = null; updateProgressVisibility(); });
  };
  addEventListener('scroll', queueVisibility, { passive: true });
  addEventListener('resize', queueVisibility);
  new ResizeObserver(queueVisibility).observe(document.getElementById('opening'));
  new MutationObserver(refresh).observe(document.getElementById('product-panel'), { attributes: true, attributeFilter: ['hidden'] });
  queueVisibility();
}

})();
