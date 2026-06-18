'use strict';

// Heuristic parsers that turn free-text lab messages into structured event
// records (protein expression, transformation, gels, assays, inventory, etc.)
// and detect which event type a message describes.

const {
  firstRegexValue,
  uniqueValues,
  parseLinkedRecords,
  parseNumericValue
} = require('./text-utils.js');

function parseProjectFromText(text, fallback = '') {
  const explicit = firstRegexValue(text, [
    /\bproject\s*[:\-]?\s*([A-Za-z0-9._-]{2,})\b/i,
    /\bfor\s+project\s+([A-Za-z0-9._-]{2,})\b/i
  ]);
  if (explicit) {
    return explicit;
  }
  const shorthand = firstRegexValue(text, [
    /\b(PD\d{1,4}[A-Za-z0-9-]*)\b/
  ]);
  if (shorthand) {
    return shorthand;
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText || null;
}

function parseProtocolFromText(text, fallback = '') {
  const protocol = firstRegexValue(text, [
    /\bprotocol\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i,
    /\bstart\s+([A-Za-z0-9 _./-]{2,80})\s+protocol\b/i
  ]).replace(/[.?!]+$/, '').trim();
  if (protocol) {
    return protocol;
  }
  const fallbackText = String(fallback || '').trim();
  return fallbackText || null;
}

function parseTemperatureC(text) {
  return parseNumericValue(text, [
    /\b(?:at|temp(?:erature)?\s*)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:°?\s*c)\b/i,
    /\b([0-9]+(?:\.[0-9]+)?)\s*(?:°?\s*c)\b/i
  ]);
}

function parseReagentAmountItems(text) {
  const source = String(text || '');
  const items = [];
  const quantitative = /(\d+(?:\.\d+)?)\s*(uL|ul|µL|mL|L|g|mg|ug|µg|kg|box(?:es)?|bottle(?:s)?|vial(?:s)?|tube(?:s)?|tips?)\s+([A-Za-z0-9][A-Za-z0-9\s._/-]{0,50}?)(?=\s+(?:and|for|with|into|to)\b|$)/gi;
  let match;
  while ((match = quantitative.exec(source))) {
    items.push({
      name: String(match[3] || '').trim(),
      amount: String(match[1] || '').trim(),
      unit: String(match[2] || '').trim()
    });
  }

  if (!items.length) {
    const simple = source.match(/\b(?:used|finished|consumed)\s+(one|two|three|\d+(?:\.\d+)?)\s+(box|bottle|vial|tube)\s+of\s+([A-Za-z0-9][A-Za-z0-9\s._/-]+)/i);
    if (simple) {
      items.push({
        name: String(simple[3] || '').trim(),
        amount: String(simple[1] || '').trim(),
        unit: String(simple[2] || '').trim()
      });
    }
  }

  return items;
}

function parseProteinExpressionEvent(text, context = {}) {
  const source = String(text || '');
  const targetProtein = firstRegexValue(source, [
    /\bexpress(?:ed|ing)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\bexpression\s+of\s+([A-Za-z0-9._/-]+)\b/i,
    /\binduced\s+([A-Za-z0-9._/-]+)\s+culture\b/i
  ]);
  const construct = firstRegexValue(source, [
    /\bconstruct\s+([A-Za-z0-9._/-]+)\b/i,
    /\bplasmid\s+([A-Za-z0-9._/-]+)\b/i
  ]);
  const hostStrain = firstRegexValue(source, [
    /\b(?:in|into)\s+([A-Za-z0-9()_-]+)\b/i,
    /\bhost\s*[:\-]?\s*([A-Za-z0-9()_-]+)\b/i,
    /\b(BL21(?:\(DE3\))?|DH5alpha|Top10|Rosetta)\b/i
  ]);
  const cultureId = firstRegexValue(source, [
    /\bculture\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i,
    /\bbatch\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i
  ]);
  const inductionOd = parseNumericValue(source, [
    /\bOD(?:600)?\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?)\b/i
  ]);
  const inducerConcentration = firstRegexValue(source, [
    /\bIPTG\s*[:=]?\s*([0-9]+(?:\.[0-9]+)?\s*(?:mM|uM|µM))\b/i,
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:mM|uM|µM))\s*IPTG\b/i
  ]) || null;
  const temperatureC = parseTemperatureC(source);
  const harvestTime = firstRegexValue(source, [
    /\bharvest\s*(?:at|on)?\s*([A-Za-z0-9: -]{2,40})\b/i
  ]) || null;

  const fields = {
    target_protein: targetProtein || null,
    construct: construct || null,
    host_strain: hostStrain || null,
    culture_id: cultureId || null,
    induction_od600: inductionOd,
    inducer: 'IPTG',
    inducer_concentration: inducerConcentration,
    temperature_c: temperatureC,
    start_time: null,
    harvest_time: harvestTime,
    project: parseProjectFromText(source, context.active_project || context.default_project),
    protocol: parseProtocolFromText(source, context.active_protocol)
  };

  const missingFields = [];
  if (fields.induction_od600 === null) {
    missingFields.push('induction_od600');
  }
  if (!fields.inducer_concentration) {
    missingFields.push('inducer_concentration');
  }
  if (fields.temperature_c === null) {
    missingFields.push('temperature_c');
  }

  return {
    event_type: 'protein_expression',
    fields,
    missing_fields: missingFields
  };
}

function parseTransformationEvent(text, context = {}) {
  const source = String(text || '');
  const construct = firstRegexValue(source, [
    /\btransform(?:ed|ation)?\s+([A-Za-z0-9._/-]+)\s+(?:into|in)\b/i,
    /\btransform(?:ed|ation)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\bplasmid\s+([A-Za-z0-9._/-]+)\b/i
  ]);
  const hostStrain = firstRegexValue(source, [
    /\binto\s+([A-Za-z0-9()_-]+)\b/i,
    /\bhost\s*[:\-]?\s*([A-Za-z0-9()_-]+)\b/i
  ]);
  const method = firstRegexValue(source, [
    /\b(heat[-\s]?shock|electroporation|chemical transformation)\b/i
  ]) || null;
  const selectionMarker = firstRegexValue(source, [
    /\b(kanamycin|ampicillin|chloramphenicol|zeocin|hygromycin)\b/i
  ]) || null;
  const plateType = firstRegexValue(source, [
    /\b(LB agar|SOC|agar plate|selective plate|plate)\b/i
  ]) || null;

  return {
    event_type: 'transformation',
    fields: {
      construct: construct || null,
      host_strain: hostStrain || null,
      method,
      selection_marker: selectionMarker,
      plate_type: plateType,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseTransfectionEvent(text, context = {}) {
  const source = String(text || '');
  const cellLine = firstRegexValue(source, [
    /\btransfect(?:ed|ion)?\s+([A-Za-z0-9._/-]+)\b/i,
    /\b(HEK293T|HEK293F|CHO(?:-K1)?|A549|HepG2)\b/i
  ]);
  const construct = firstRegexValue(source, [
    /\bwith\s+([A-Za-z0-9._/-]+)\s+(?:plasmid|construct)?\b/i,
    /\bfor\s+([A-Za-z0-9._/-]+)\s+construct\b/i
  ]);
  const transfectionReagent = firstRegexValue(source, [
    /\b(PEI|Lipofectamine\s*\d*|Fugene|jetPRIME)\b/i
  ]) || null;
  const plateFormat = firstRegexValue(source, [
    /\b(\d+\s*-?\s*well)\b/i
  ]) || null;
  const dnaAmount = firstRegexValue(source, [
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:ng|ug|µg|mg))\b/i
  ]) || null;
  const ratio = firstRegexValue(source, [
    /\bratio\s*[:=]?\s*([0-9:.]+)\b/i
  ]) || null;
  const cultureScale = firstRegexValue(source, [
    /\b([0-9]+(?:\.[0-9]+)?\s*(?:mL|L))\b/i
  ]) || null;

  return {
    event_type: 'transfection',
    fields: {
      cell_line: cellLine || null,
      construct: construct || null,
      transfection_reagent: transfectionReagent,
      plate_format: plateFormat,
      dna_amount: dnaAmount,
      ratio,
      culture_scale: cultureScale,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseCellCultureEvent(text, context = {}) {
  const source = String(text || '');
  let action = 'culture';
  if (/\bseed(?:ed|ing)?\b/i.test(source)) {
    action = 'seed';
  } else if (/\bpassag(?:e|ed|ing)\b/i.test(source)) {
    action = 'passage';
  } else if (/\bmedia\s+change|changed\s+media\b/i.test(source)) {
    action = 'media_change';
  }

  const cellLine = firstRegexValue(source, [
    /\b(?:seed(?:ed|ing)?|passag(?:e|ed|ing)?|transfect(?:ed|ion)?)\s+([A-Za-z0-9._/-]+)\b/i,
    /\b(HEK293T|HEK293F|CHO(?:-K1)?|A549|HepG2)\b/i
  ]);

  return {
    event_type: 'cell_culture',
    fields: {
      action,
      cell_line: cellLine || null,
      split_ratio: firstRegexValue(source, [/\b(\d+\s*:\s*\d+)\b/i]) || null,
      confluency: parseNumericValue(source, [/\b([0-9]{1,3})\s*%\s*conflu(?:ent|ency)?\b/i]),
      vessel: firstRegexValue(source, [/\b(T\d+|flask|dish|plate|well|bioreactor)\b/i]) || null,
      media: firstRegexValue(source, [/\b(DMEM|RPMI|FBS[^,.;]*|LB|media[^,.;]*)\b/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function detectPurificationMethod(text) {
  const source = String(text || '');
  if (/\bni[-\s]?nta\b/i.test(source)) {
    return 'Ni-NTA';
  }
  if (/\bsec\b|size\s+exclusion/i.test(source)) {
    return 'SEC';
  }
  if (/\biex\b|ion\s+exchange/i.test(source)) {
    return 'IEX';
  }
  if (/\baffinity/i.test(source)) {
    return 'Affinity';
  }
  return null;
}

function parsePurificationEvent(text, context = {}) {
  const source = String(text || '');

  return {
    event_type: 'purification',
    fields: {
      target: firstRegexValue(source, [
        /\bpurif(?:y|ied|ication)\s+([A-Za-z0-9._/-]+)\b/i,
        /\bfor\s+([A-Za-z0-9._/-]+)\s+protein\b/i
      ]) || null,
      sample_input: firstRegexValue(source, [
        /\bsample\s+([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      purification_method: detectPurificationMethod(source),
      start_time: null,
      fractions: firstRegexValue(source, [
        /\bfractions?\s+([0-9]+\s*(?:to|-|-)\s*[0-9]+|[0-9]+)\b/i
      ]) || null,
      buffers: uniqueValues((source.match(/\b(?:binding|wash|elution|lysis)\s+buffer\b/gi) || []).map((item) => item.toLowerCase())),
      linked_gel: firstRegexValue(source, [
        /\b(GEL-[A-Za-z0-9-]+)\b/i,
        /\bgel\s+([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseAssayEvent(text, context = {}) {
  const source = String(text || '');
  let assayType = firstRegexValue(source, [
    /\b(ELISA|BLI|SPR|qPCR|flow cytometry|western blot|cell viability)\b/i
  ]);
  if (!assayType) {
    assayType = /\bassay\b/i.test(source) ? 'Assay' : null;
  }

  const controls = [];
  const controlMatch = source.match(/\bcontrols?\s*[:\-]?\s*([^.;\n]+)/i);
  if (controlMatch) {
    controlMatch[1]
      .split(/[,/]| and /i)
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((item) => controls.push(item));
  }

  return {
    event_type: 'assay',
    fields: {
      assay_type: assayType,
      assay_id: firstRegexValue(source, [/\b(ASY-[A-Za-z0-9-]+)\b/i]) || null,
      sample_set: firstRegexValue(source, [
        /\bon\s+([A-Za-z0-9 _./-]{2,80})$/i,
        /\bfor\s+([A-Za-z0-9 _./-]{2,80})$/i
      ]) || null,
      readout: firstRegexValue(source, [
        /\b(OD\d+|fluorescence|luminescence|absorbance|Ct)\b/i
      ]) || null,
      controls: uniqueValues(controls),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseGelEvent(text, context = {}) {
  const source = String(text || '');
  let gelType = null;
  if (/\bsds[-\s]?page\b/i.test(source)) {
    gelType = 'SDS-PAGE';
  } else if (/\bwestern\b/i.test(source)) {
    gelType = 'western';
  } else if (/\bagarose\b/i.test(source)) {
    gelType = 'agarose';
  }

  return {
    event_type: 'gel',
    fields: {
      gel_type: gelType,
      sample_set: firstRegexValue(source, [
        /\bfor\s+([A-Za-z0-9 _./-]{2,80})\b/i
      ]) || null,
      ladder: firstRegexValue(source, [
        /\bladder\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i
      ]) || null,
      expected_band_kda: parseNumericValue(source, [
        /\b([0-9]+(?:\.[0-9]+)?)\s*kda\b/i
      ]),
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseReagentUseEvent(text, context = {}) {
  const source = String(text || '');
  const items = parseReagentAmountItems(source);

  return {
    event_type: 'inventory_usage',
    fields: {
      items,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_run: firstRegexValue(source, [/\b(RUN-[A-Za-z0-9-]+)\b/i]) || context.active_run_id || null
    }
  };
}

function parseDecisionEvent(text, context = {}) {
  const source = String(text || '');

  return {
    event_type: 'decision',
    fields: {
      decision_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      reason: firstRegexValue(source, [/\bdue\s+to\s+(.+)$/i]) || null,
      evidence_refs: parseLinkedRecords(source)
    }
  };
}

function parseTaskEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'task',
    fields: {
      task_text: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_records: parseLinkedRecords(source)
    }
  };
}

function parseSampleRegistrationEvent(text, context = {}) {
  const source = String(text || '');
  const sampleId = firstRegexValue(source, [/\b([A-Z]{2,5}-\d{2,})\b/]);
  const location = firstRegexValue(source, [/\b(?:at|in|location\s*[:\-]?)\s+([A-Za-z0-9 _./-]{2,80})$/i]);

  return {
    event_type: 'sample_registration',
    fields: {
      sample_id: sampleId || null,
      sample_name: firstRegexValue(source, [/\bname\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || null,
      sample_type: firstRegexValue(source, [/\b(?:type|kind)\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || null,
      location: location || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseReagentRegistrationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'reagent_registration',
    fields: {
      reagent_name: firstRegexValue(source, [/\bname\s*[:\-]?\s*([A-Za-z0-9 _./-]{2,80})/i]) || source,
      lot_number: firstRegexValue(source, [/\blot\s*[:\-]?\s*([A-Za-z0-9._/-]+)\b/i]) || null,
      amount: firstRegexValue(source, [/\b(\d+(?:\.\d+)?)\b/]) || null,
      unit: firstRegexValue(source, [/\b(?:\d+(?:\.\d+)?)\s*(uL|ul|µL|mL|L|g|mg|ug|µg|kg|bottle|vial|box)\b/i]) || null,
      location: firstRegexValue(source, [/\b(?:at|in|location\s*[:\-]?)\s+([A-Za-z0-9 _./-]{2,80})$/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseChecklistEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'checklist',
    fields: {
      title: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      protocol: parseProtocolFromText(source, context.active_protocol)
    }
  };
}

function parseReservationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'reservation_request',
    fields: {
      title: source,
      instrument: firstRegexValue(source, [/\bfor\s+([A-Za-z0-9 _./-]{2,80})\b/i]) || null,
      start_time: firstRegexValue(source, [/\b(?:at|on)\s+([A-Za-z0-9: -]{2,80})\b/i]) || null,
      project: parseProjectFromText(source, context.active_project || context.default_project)
    }
  };
}

function parseObservationEvent(text, context = {}) {
  const source = String(text || '');
  return {
    event_type: 'observation',
    fields: {
      observation: source,
      project: parseProjectFromText(source, context.active_project || context.default_project),
      linked_records: parseLinkedRecords(source)
    }
  };
}

function detectLabEventType(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower) {
    return 'observation';
  }
  if (/\btransfect/.test(lower)) {
    return 'transfection';
  }
  if (/\btransform|heat[- ]?shock|electroporat/.test(lower)) {
    return 'transformation';
  }
  if (/\bexpress|induc(ed|tion)?\b/.test(lower)) {
    return 'protein_expression';
  }
  if (/\bpurif|ni[- ]?nta|sec\b|fractions?\b/.test(lower)) {
    return 'purification';
  }
  if (/\belisa|assay|bli\b|spr\b|qpcr\b/.test(lower)) {
    return 'assay';
  }
  if (/\bsds[- ]?page|gel|western|agarose/.test(lower)) {
    return 'gel';
  }
  if (/\bpassag|seed(ed|ing)?|media\s+change|confluen/.test(lower)) {
    return 'cell_culture';
  }
  if (/\bused\b|finished\b|consum(ed|e)\b|tips\b/.test(lower)) {
    return 'inventory_usage';
  }
  if (/\bdecid(ed|e)\b|repeat\b|drop\b|scale[- ]?up\b/.test(lower)) {
    return 'decision';
  }
  if (/\btask\b|todo\b|to do\b/.test(lower)) {
    return 'task';
  }
  return 'observation';
}

function parseLabEventByType(eventType, text, context = {}) {
  switch (eventType) {
    case 'protein_expression':
      return parseProteinExpressionEvent(text, context);
    case 'transformation':
      return parseTransformationEvent(text, context);
    case 'transfection':
      return parseTransfectionEvent(text, context);
    case 'cell_culture':
      return parseCellCultureEvent(text, context);
    case 'purification':
      return parsePurificationEvent(text, context);
    case 'assay':
      return parseAssayEvent(text, context);
    case 'gel':
      return parseGelEvent(text, context);
    case 'inventory_usage':
      return parseReagentUseEvent(text, context);
    case 'decision':
      return parseDecisionEvent(text, context);
    case 'task':
      return parseTaskEvent(text, context);
    case 'sample_registration':
      return parseSampleRegistrationEvent(text, context);
    case 'reagent_registration':
      return parseReagentRegistrationEvent(text, context);
    case 'checklist':
      return parseChecklistEvent(text, context);
    case 'reservation_request':
      return parseReservationEvent(text, context);
    case 'daily_summary':
      return {
        event_type: 'daily_summary',
        fields: {
          summary: String(text || '').trim(),
          project: parseProjectFromText(text, context.active_project || context.default_project)
        },
        missing_fields: []
      };
    default:
      return parseObservationEvent(text, context);
  }
}

function parseLabEvent(text, eventTypeHint = '', context = {}) {
  const eventType = eventTypeHint || detectLabEventType(text);
  return parseLabEventByType(eventType, text, context);
}

module.exports = {
  parseProjectFromText,
  parseProtocolFromText,
  parseTemperatureC,
  parseReagentAmountItems,
  parseProteinExpressionEvent,
  parseTransformationEvent,
  parseTransfectionEvent,
  parseCellCultureEvent,
  detectPurificationMethod,
  parsePurificationEvent,
  parseAssayEvent,
  parseGelEvent,
  parseReagentUseEvent,
  parseDecisionEvent,
  parseTaskEvent,
  parseSampleRegistrationEvent,
  parseReagentRegistrationEvent,
  parseChecklistEvent,
  parseReservationEvent,
  parseObservationEvent,
  detectLabEventType,
  parseLabEventByType,
  parseLabEvent
};
