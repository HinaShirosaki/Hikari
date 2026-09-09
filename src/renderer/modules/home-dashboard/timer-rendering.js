export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function endLabel(timer) {
  if (timer.isPaused) {
    return 'Paused';
  }
  return `Ends ${new Date(timer.endAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

export function renderActiveTimer(timer, index, safeText) {
  const label = `${timer.isPaused ? 'Resume' : 'Pause'} timer ${timer.name}`;
  return `
    <article class="home-timer-row${index === 0 ? ' is-featured' : ''}" data-dashboard-timer-index="${timer.sourceIndex}">
      <div class="home-timer-copy">
        <div class="home-timer-name">${safeText(timer.name)}</div>
        <span class="home-timer-state">${timer.isPaused ? 'Paused' : 'Running'}</span>
      </div>
      <span class="home-timer-count${timer.isWarn ? ' is-warn' : ''}">${formatCountdown(timer.remainingMs)}</span>
      <button type="button" class="home-timer-btn" data-dashboard-toggle-active-timer="${timer.sourceIndex}" aria-label="${safeText(label)}" title="${safeText(label)}">
        <svg viewBox="0 0 24 24" aria-hidden="true">${timer.isPaused
          ? '<path d="M8 5 19 12 8 19Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"></path>'
          : '<path d="M8 5v14M16 5v14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"></path>'}
        </svg>
      </button>
      <div class="home-timer-track" role="progressbar" aria-label="Elapsed time for ${safeText(timer.name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(timer.pct)}">
        <div class="home-timer-fill${timer.isWarn ? ' is-warn' : ''}" style="width: ${timer.pct.toFixed(1)}%"></div>
      </div>
      <div class="home-timer-meta"><span>${timer.durationMinutes} min total</span><span>${safeText(endLabel(timer))}</span></div>
    </article>`;
}

// Ticks update existing nodes so keyboard focus and pointer targets stay stable.
export function updateActiveTimer(row, timer) {
  const count = row.querySelector('.home-timer-count');
  count.textContent = formatCountdown(timer.remainingMs);
  count.classList.toggle('is-warn', timer.isWarn && !timer.isPaused);
  const fill = row.querySelector('.home-timer-fill');
  fill.style.width = `${timer.pct.toFixed(1)}%`;
  fill.classList.toggle('is-warn', timer.isWarn && !timer.isPaused);
  row.querySelector('.home-timer-track').setAttribute('aria-valuenow', String(Math.round(timer.pct)));
}

export function renderFinishedTimer(timer, safeText) {
  return `
    <article class="home-row home-timer-finished-row">
      <div class="home-row-copy"><div class="home-row-name">${safeText(timer.name)}</div><div class="home-row-meta">${timer.durationMinutes} min · Complete</div></div>
      <button type="button" class="home-row-action" data-dashboard-remove-active-timer="${timer.sourceIndex}" aria-label="Dismiss finished timer ${safeText(timer.name)}" title="Dismiss finished timer">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path></svg>
      </button>
    </article>`;
}
