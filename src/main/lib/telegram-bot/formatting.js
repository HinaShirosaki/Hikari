'use strict';

// Reply/draft presentation helpers plus chat-context defaults and summaries.
// These turn structured drafts, protocol runs, and session context into the
// plain-text replies the bot sends back to Telegram.

const { DRAFT_TYPE_LABELS, FIELD_LABEL_MAP } = require('./config.js');

function formatFieldLabel(key) {
  if (FIELD_LABEL_MAP.has(key)) {
    return FIELD_LABEL_MAP.get(key);
  }
  return String(key || '').replace(/_/g, ' ');
}

function formatFieldValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    if (!value.length) {
      return '';
    }
    if (value.every((item) => typeof item === 'string')) {
      return value.join(', ');
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildDraftTitle(draft) {
  const fields = draft?.content?.fields || {};
  switch (draft?.content?.event_type) {
    case 'protein_expression': {
      const target = fields.target_protein || fields.construct || 'target';
      return `Protein expression of ${target}`;
    }
    case 'transformation':
      return `Transformation of ${fields.construct || 'construct'}`;
    case 'transfection':
      return `Transfection in ${fields.cell_line || 'cells'}`;
    case 'cell_culture':
      return `Cell culture update (${fields.action || 'culture'})`;
    case 'purification':
      return `Purification of ${fields.target || 'target'}`;
    case 'assay':
      return `Assay draft (${fields.assay_type || 'assay'})`;
    case 'gel':
      return `Gel run draft (${fields.gel_type || 'gel'})`;
    case 'inventory_usage':
      return 'Reagent usage draft';
    case 'decision':
      return 'Decision draft';
    case 'task':
      return 'Task draft';
    case 'sample_registration':
      return `Sample registration (${fields.sample_id || 'draft'})`;
    case 'reagent_registration':
      return 'Reagent registration draft';
    case 'checklist':
      return `Checklist draft (${fields.title || 'task'})`;
    case 'reservation_request':
      return 'Reservation request draft';
    case 'daily_summary':
      return 'Daily summary draft';
    default:
      return 'Lab draft record';
  }
}

function formatDetectedFields(fields) {
  const lines = [];
  Object.entries(fields || {}).forEach(([key, value]) => {
    const display = formatFieldValue(value);
    if (!display) {
      return;
    }
    lines.push(`- ${formatFieldLabel(key)}: ${display}`);
  });
  return lines;
}

function formatDraftReply(draft, options = {}) {
  const updated = Boolean(options.updated);
  const missing = Array.isArray(draft?.content?.missing_fields) ? draft.content.missing_fields : [];
  const fields = draft?.content?.fields || {};

  const lines = [];
  if (updated) {
    lines.push('Updated draft.');
  } else {
    lines.push(`I created a draft ${DRAFT_TYPE_LABELS.get(draft.draft_type) || 'record'}.`);
  }
  lines.push(`Draft ID: ${draft.draft_id}`);
  lines.push(`Title: ${buildDraftTitle(draft)}`);

  const detected = formatDetectedFields(fields);
  if (detected.length) {
    lines.push('Detected:');
    lines.push(...detected);
  }

  if (missing.length) {
    lines.push('Missing:');
    missing.forEach((field) => {
      lines.push(`- ${formatFieldLabel(field)}`);
    });
  }

  lines.push('Reply with:');
  lines.push('- "add ..." to refine this draft');
  lines.push('- "save draft"');
  lines.push('- "discard"');
  lines.push('- "open in Hikari"');

  return lines.join('\n');
}

function formatProtocolStepReply(run, extra = '') {
  const index = Number(run.current_step_index || 0);
  const total = Array.isArray(run.steps) ? run.steps.length : 0;
  const stepText = run.steps[index] || 'No step text available.';
  const lines = [
    `Protocol: ${run.protocol_name}`,
    `Step ${index + 1} of ${total}`,
    stepText,
    '',
    'Reply:',
    '- "done"',
    '- "repeat"',
    '- "note ..."',
    '- "set timer 10 min"',
    '- "pause"'
  ];
  if (extra) {
    lines.unshift(extra);
  }
  return lines.join('\n');
}

function createDefaultChatContext() {
  return {
    active_project: '',
    default_project: '',
    active_protocol: '',
    active_run_id: '',
    active_draft_id: '',
    last_entities: {},
    notifications_enabled: true
  };
}

function buildTodaySummaryFromHistory(events) {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const filtered = (events || []).filter((entry) => {
    const t = new Date(entry.timestamp || 0);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });

  if (!filtered.length) {
    return 'No logged events for today yet.';
  }

  const lines = [`I found ${filtered.length} logged events today:`];
  filtered.slice(-10).forEach((entry) => {
    lines.push(`- ${entry.label || entry.type || 'event'}`);
  });
  return lines.join('\n');
}

function formatSessionContextMessage(context, activeDraft, activeRun) {
  const lines = [
    'Current Telegram context:',
    `- active project: ${context.active_project || '(none)'}`,
    `- default project: ${context.default_project || '(none)'}`,
    `- active protocol: ${context.active_protocol || '(none)'}`,
    `- active run: ${activeRun ? activeRun.run_id : '(none)'}`,
    `- active draft: ${activeDraft ? activeDraft.draft_id : '(none)'}`,
    `- notifications: ${context.notifications_enabled ? 'on' : 'off'}`
  ];
  return lines.join('\n');
}

module.exports = {
  formatFieldLabel,
  formatFieldValue,
  buildDraftTitle,
  formatDetectedFields,
  formatDraftReply,
  formatProtocolStepReply,
  createDefaultChatContext,
  buildTodaySummaryFromHistory,
  formatSessionContextMessage
};
