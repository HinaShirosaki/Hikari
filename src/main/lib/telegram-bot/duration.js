'use strict';

// Duration parsing and timer-request extraction for the /timer command and
// natural-language "set timer ..." messages.

function parseDurationToMs(value) {
  const base = String(value || '').trim().toLowerCase();
  if (!base) {
    return 0;
  }

  const text = base.replace(/([a-z])(?=\d)/g, '$1 ');
  const unitRegex = /(\d+(?:\.\d+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  let totalMs = 0;
  let matched = false;
  let match;
  while ((match = unitRegex.exec(text))) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) {
      continue;
    }
    const unit = match[2];
    let unitMs = 0;
    if (/^d/.test(unit)) {
      unitMs = 24 * 60 * 60 * 1000;
    } else if (/^h/.test(unit)) {
      unitMs = 60 * 60 * 1000;
    } else if (/^m/.test(unit)) {
      unitMs = 60 * 1000;
    } else if (/^s/.test(unit)) {
      unitMs = 1000;
    }
    totalMs += amount * unitMs;
    matched = true;
  }

  if (matched) {
    return Math.round(totalMs);
  }

  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.round(Number(text) * 60 * 1000);
  }

  return 0;
}

function splitDurationAndLabel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return {
      durationText: '',
      label: '',
      durationMs: 0
    };
  }

  const tokens = text.split(/\s+/).filter(Boolean);
  let best = null;
  for (let i = 1; i <= tokens.length; i += 1) {
    const durationText = tokens.slice(0, i).join(' ');
    const durationMs = parseDurationToMs(durationText);
    if (!durationMs) {
      continue;
    }
    best = {
      durationText,
      label: tokens.slice(i).join(' ').trim(),
      durationMs
    };
  }

  if (best) {
    return best;
  }

  return {
    durationText: text,
    label: '',
    durationMs: parseDurationToMs(text)
  };
}

function parseTimerRequest(text) {
  const source = String(text || '').trim();
  if (!source) {
    return null;
  }

  const match = source.match(/^(?:set|start)?\s*timer\s+(.+)$/i);
  if (!match) {
    return null;
  }

  const parsed = splitDurationAndLabel(match[1]);
  return {
    duration: parsed.durationText,
    duration_ms: parsed.durationMs,
    label: parsed.label || 'Lab reminder'
  };
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const chunks = [];
  if (days) {
    chunks.push(`${days}d`);
  }
  if (hours) {
    chunks.push(`${hours}h`);
  }
  if (minutes) {
    chunks.push(`${minutes}m`);
  }
  if (!chunks.length || (!days && !hours && seconds)) {
    chunks.push(`${seconds}s`);
  }
  return chunks.join(' ');
}

module.exports = {
  parseDurationToMs,
  splitDurationAndLabel,
  parseTimerRequest,
  formatDuration
};
