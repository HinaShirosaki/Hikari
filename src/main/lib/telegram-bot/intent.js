'use strict';

// Natural-language intent classification: maps a free-text message to an
// intent/subintent (lookup, protocol execution, draft creation, reminders,
// chat) and bridges event types to intent subintents.

const { parseLinkedRecords } = require('./text-utils.js');
const { parseTimerRequest } = require('./duration.js');
const {
  parseProjectFromText,
  parseProtocolFromText,
  detectLabEventType
} = require('./event-parsers.js');

function eventTypeToIntentSubintent(eventType) {
  switch (eventType) {
    case 'protein_expression':
      return 'protein_expression';
    case 'transformation':
      return 'transformation';
    case 'transfection':
      return 'transfection';
    case 'cell_culture':
      return 'cell_seeding';
    case 'purification':
      return 'purification';
    case 'assay':
      return 'assay_run';
    case 'gel':
      return 'gel_run';
    case 'inventory_usage':
      return 'reagent_prep';
    case 'decision':
      return 'decision_record';
    default:
      return 'observation';
  }
}

function parseLookupSubintent(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) {
    return '';
  }
  if (/\bexpir|expiry|expire\b/.test(lower)) {
    return 'expiry';
  }
  if (/\blot\b/.test(lower)) {
    return 'lot';
  }
  if (/\bconstruct\b/.test(lower)) {
    return 'construct';
  }
  if (/\bsample\b|\bsmp-/.test(lower)) {
    return 'sample';
  }
  if (/\bprotocol\b/.test(lower)) {
    return 'protocol';
  }
  if (/\bproject\b/.test(lower)) {
    return 'project';
  }
  if (/\bpaper\b|\blibrary\b|\bjournal\b/.test(lower)) {
    return 'paper';
  }
  if (/\bwhere\s+is\b|\blocation\b/.test(lower)) {
    return 'location';
  }
  if (/\bdo\s+we\s+have\b|\bavailable\b|\binventory\b|\blow\s+stock\b/.test(lower)) {
    return 'inventory';
  }
  return '';
}

function extractLookupQuery(text, subintent = '') {
  let query = String(text || '').trim();
  query = query
    .replace(/^(do\s+we\s+have|where\s+is|find|show|lookup|look\s+up|what(?:'s|\s+is)\s+booked\s+(?:on|for)|any)\s+/i, '')
    .replace(/^(inventory|sample|samples|construct|constructs|protocol|project|paper|papers|lots?|expiry|expiring)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (!query && subintent === 'expiry') {
    return 'expiring';
  }
  if (!query && subintent === 'inventory') {
    return '';
  }
  return query;
}

function parseNaturalLanguageIntent(text, context = {}) {
  const source = String(text || '').trim();
  const lower = source.toLowerCase();

  const result = {
    intent: '',
    subintent: '',
    entities: {},
    time_context: {},
    linked_records: parseLinkedRecords(source),
    confidence: 0.2,
    requires_confirmation: false,
    draft_action: null
  };

  if (!source) {
    return result;
  }

  const timerIntent = parseTimerRequest(source);
  if (timerIntent) {
    result.intent = 'reminder';
    result.subintent = 'timer';
    result.entities = {
      duration: timerIntent.duration,
      label: timerIntent.label
    };
    result.time_context = {
      duration_ms: timerIntent.duration_ms
    };
    result.confidence = timerIntent.duration_ms ? 0.96 : 0.8;
    result.requires_confirmation = !timerIntent.duration_ms;
    return result;
  }

  const executionMap = [
    ['start', /^(?:start|begin)\s+.+(?:protocol|workflow)/i],
    ['next', /^(?:next)\b/i],
    ['done', /^(?:done|complete(?:d)?)\b/i],
    ['repeat', /^(?:repeat|again)\b/i],
    ['pause', /^(?:pause|hold)\b/i],
    ['resume', /^(?:resume|continue)\b/i],
    ['add_note', /^(?:note|log note)\b/i],
    ['add_deviation', /\bdeviation\b/i]
  ];

  for (const [subintent, pattern] of executionMap) {
    if (pattern.test(source)) {
      result.intent = 'protocol_execution';
      result.subintent = subintent;
      result.entities = {
        protocol_name: parseProtocolFromText(source, context.active_protocol)
      };
      result.confidence = 0.92;
      result.requires_confirmation = false;
      return result;
    }
  }

  const lookupSubintent = parseLookupSubintent(source);
  if (lookupSubintent && (/\?|\bdo\s+we\s+have\b|\bwhere\s+is\b|\bshow\b|\bfind\b|\bexpir|\blow\s+stock\b/.test(lower) || ['protocol', 'project', 'paper'].includes(lookupSubintent))) {
    result.intent = 'lookup';
    result.subintent = lookupSubintent;
    result.entities = {
      query: extractLookupQuery(source, lookupSubintent)
    };
    result.confidence = 0.88;
    return result;
  }

  if (/\bdraft\b|\bsummarize\b|\bsummary\b|\bchecklist\b|\bassay\s+plan\b|\breservation\b/.test(lower)) {
    result.intent = 'draft_record';
    if (/\bdecision\b/.test(lower)) {
      result.subintent = 'decision_record';
    } else if (/\bchecklist\b/.test(lower)) {
      result.subintent = 'reagent_checklist';
    } else if (/\bassay\s+plan\b|\bdraft\s+assay\b/.test(lower)) {
      result.subintent = 'assay_plan';
    } else if (/\breservation\b/.test(lower)) {
      result.subintent = 'reservation_request';
    } else if (/\bsummarize\b|\bsummary\b/.test(lower)) {
      result.subintent = 'daily_summary';
    } else {
      result.subintent = 'notebook_entry';
    }
    result.entities = {
      message_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.84;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/\b(decide|decided|decision|drop\s+construct|scale[- ]?up|repeat\s+purification)\b/.test(lower)) {
    result.intent = 'draft_record';
    result.subintent = 'decision_record';
    result.entities = {
      decision_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.9;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/\btask\b|\btodo\b|\bto do\b/.test(lower)) {
    result.intent = 'draft_record';
    result.subintent = 'task_list';
    result.entities = {
      task_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.85;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  const eventType = detectLabEventType(source);
  if (eventType !== 'observation') {
    result.intent = 'log_experiment';
    result.subintent = eventTypeToIntentSubintent(eventType);
    result.entities = {
      project: parseProjectFromText(source, context.active_project || context.default_project),
      protocol: parseProtocolFromText(source, context.active_protocol)
    };
    result.confidence = 0.82;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  if (/^log\s+this\s*:/i.test(source) || /^note\s*:/i.test(source)) {
    result.intent = 'draft_record';
    result.subintent = 'notebook_entry';
    result.entities = {
      message_text: source.replace(/^\s*(log\s+this\s*:|note\s*:)/i, '').trim(),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    };
    result.confidence = 0.79;
    result.requires_confirmation = true;
    result.draft_action = 'create';
    return result;
  }

  result.intent = 'chat';
  result.subintent = 'general';
  result.entities = {
    message_text: source
  };
  result.confidence = 0.35;
  return result;
}

function mapIntentToEventType(intent) {
  const fallback = detectLabEventType(intent?.entities?.message_text || '');
  if (!intent) {
    return fallback;
  }
  if (intent.intent === 'log_experiment') {
    const subintent = String(intent.subintent || '').toLowerCase();
    if (subintent === 'protein_expression') {
      return 'protein_expression';
    }
    if (subintent === 'transformation') {
      return 'transformation';
    }
    if (subintent === 'transfection') {
      return 'transfection';
    }
    if (subintent === 'cell_seeding' || subintent === 'passage') {
      return 'cell_culture';
    }
    if (subintent === 'purification') {
      return 'purification';
    }
    if (subintent === 'assay_run') {
      return 'assay';
    }
    if (subintent === 'gel_run') {
      return 'gel';
    }
    if (subintent === 'reagent_prep') {
      return 'inventory_usage';
    }
    return fallback;
  }
  if (intent.intent === 'draft_record') {
    const subintent = String(intent.subintent || '').toLowerCase();
    if (subintent === 'decision_record') {
      return 'decision';
    }
    if (subintent === 'task_list') {
      return 'task';
    }
    if (subintent === 'assay_plan') {
      return 'assay';
    }
    if (subintent === 'reagent_checklist') {
      return 'checklist';
    }
    if (subintent === 'daily_summary') {
      return 'daily_summary';
    }
    if (subintent === 'reservation_request') {
      return 'reservation_request';
    }
    return fallback;
  }
  return fallback;
}

module.exports = {
  eventTypeToIntentSubintent,
  parseLookupSubintent,
  extractLookupQuery,
  parseNaturalLanguageIntent,
  mapIntentToEventType
};
