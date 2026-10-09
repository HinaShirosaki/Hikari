'use strict';

const path = require('node:path');
const { array, context, html, inline, label, object, properties, section, table, text } = require('./format');
const { resolveLocalPath } = require('./context');
const { block, derivedBlock, documentMarker, fieldsForRecord } = require('./document-fields');

const GENERATED_MARKER = '<!-- hikari-generated:record-markdown:v1 -->';

function link(label, target, image = false) {
  if (!target) return inline(label);
  const url = target.split('/').map(part => encodeURIComponent(part)).join('/');
  return `${image ? '!' : ''}[${inline(label)}](<${url}>)`;
}

function fileTarget(file, options) {
  const resolved = resolveLocalPath(file.relativePath || file.path || file.filePath, options.storageRoot);
  return resolved && !options.missingFiles?.has(resolved) ? path.relative(options.folderPath, resolved).split(path.sep).join('/') : '';
}

function files(records, names, options) {
  const seen = new Set();
  const lines = [];
  for (const rawRecord of array(records)) {
    const record = typeof rawRecord === 'string' ? { name: rawRecord } : object(rawRecord);
    const name = text(record.name || path.basename(record.relativePath || record.path || record.filePath || '') || 'Attached file');
    seen.add(name);
    const target = fileTarget(record, options) || options.embeddedImages?.get(record.dataUrl);
    const image = /^image\//i.test(record.mimeType || record.type || '') || /\.(?:png|jpe?g|gif|webp|svg|bmp|avif|tiff?|heic|heif)$/i.test(name);
    const metadata = [record.mimeType || record.type, record.size == null ? '' : `${record.size} bytes`, record.importedAt].filter(Boolean);
    lines.push(`- ${link(name, target)}${metadata.length ? ` — ${metadata.map(inline).join(' · ')}` : ''}${target ? '' : ' (saved file location unavailable)'}`);
    if (image && target) {
      options.usedImageTargets.add(target);
      lines.push('', link(name, target, true), '');
    }
  }
  for (const name of array(names)) {
    if (!seen.has(text(name))) lines.push(`- ${inline(name)} (saved file location unavailable)`);
  }
  return lines.join('\n');
}

function image(label, imagePath, dataUrl, options) {
  const target = options.embeddedImages?.get(dataUrl) || (imagePath && !options.missingFiles?.has(imagePath)
    ? path.relative(options.folderPath, imagePath).split(path.sep).join('/') : '');
  if (!target) return imagePath || dataUrl ? `${inline(label)} (saved image unavailable).\n\n` : '';
  options.usedImageTargets.add(target);
  return `${link(label, target, true)}\n\n`;
}

function steps(protocol, values = null) {
  const placeholderRows = [];
  const lines = array(protocol.steps).map((rawStep, index) => {
    const step = typeof rawStep === 'string' ? { text: rawStep } : object(rawStep);
    const placeholders = array(step.placeholders);
    let source = text(step.text || step.instruction || step.action);
    const tokens = new Set();
    const hasTokens = /\{\{ph:[^}]+\}\}/.test(source);
    source = source.replace(/\{\{ph:([^}]+)\}\}/g, (_match, id) => {
      tokens.add(id);
      const placeholder = placeholders.find(item => text(item.id) === id);
      return values && values[id] != null && text(values[id]).trim() ? text(values[id]) : `[${placeholder?.name || id}]`;
    });
    if (!hasTokens) {
      let placeholderIndex = 0;
      source = source.replace(/\[([^\[\]]+)\]/g, match => {
        const placeholder = placeholders[placeholderIndex++];
        if (!placeholder) return match;
        const id = text(placeholder.id);
        tokens.add(id);
        return values && values[id] != null && text(values[id]).trim() ? text(values[id]) : `[${placeholder.name || id}]`;
      });
    }
    for (const placeholder of placeholders) {
      const id = text(placeholder.id);
      const value = values?.[id];
      placeholderRows.push(values ? [index + 1, placeholder.name, value == null ? '' : value] : [index + 1, placeholder.name]);
      if (!tokens.has(id)) source += ` ${value != null && text(value).trim() ? text(value) : `[${placeholder.name || id}]`}`;
    }
    return `${index + 1}. ${html(source).replace(/\r?\n/g, '\n   ')}`;
  });
  return section('Steps', lines.join('\n\n'))
    + section('Parameters', placeholderRows.length ? table(values ? ['Step', 'Parameter', 'Saved value'] : ['Step', 'Parameter'], placeholderRows) : '');
}

function protocolBody(protocol, values) {
  return section('Purpose', html(protocol.purpose || protocol.description))
    + section('Materials', Array.isArray(protocol.materials) ? protocol.materials.map(item => `- ${inline(item)}`).join('\n') : html(protocol.materials))
    + steps(protocol, values)
    + section('Troubleshooting', html(protocol.troubleshooting));
}

// Keep scientific details readable without exposing storage paths, image
// encodings or duplicate artifact records as metadata in the document.
function readableDetails(value) {
  if (Array.isArray(value)) return value.map(readableDetails);
  if (!value || typeof value !== 'object') return /^(?:hikari-image-unavailable:)?data:image\//i.test(text(value)) ? '' : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) =>
    !/^(?:id|storageFolder|storageDocumentFile|markdownRevision|artifactDefinition|artifactAnalysis)$/.test(key)
    && !/(?:Id|Ids|Path|RelativePath|DataUrl)$/.test(key))
    .map(([key, item]) => [key, readableDetails(item)]));
}

function additionalDetails(record, handledKeys, level = 3) {
  const extra = Object.fromEntries(Object.entries(object(record)).filter(([key]) => !handledKeys.includes(key)));
  return section('Additional details', context(readableDetails(extra), Math.min(level + 1, 6)), level);
}

function resultTables(entry) {
  const tables = array(entry.resultTables).length ? entry.resultTables : [entry.resultTable].filter(Boolean);
  return tables.map((resultTable, index) => {
    const columns = array(resultTable.columns);
    const rows = array(resultTable.rows).map(row => columns.map(column => row[column.field]));
    return section(resultTable.name || resultTable.title || `Table ${index + 1}`, table(columns.map(column => column.title || column.field), rows), 3)
      + (resultTable.solve ? 'Hikari solves the empty cells using this table’s saved calculation rules.\n\n' : '');
  }).join('');
}

function calculations(entry) {
  return array(entry.toolCalculations).map(calculation => {
    const savedTable = object(calculation.table);
    const headers = array(savedTable.headers);
    let body = properties({ status: calculation.status, createdAt: calculation.createdAt });
    body += `\n\n${[calculation.result || calculation.resultText, calculation.formula || calculation.formulaText, calculation.summary || calculation.summaryText].filter(Boolean).map(html).join('\n\n')}`;
    body += '\n\n' + section('Inputs', context(calculation.inputs, 5), 4);
    body += section(savedTable.caption || 'Saved calculation table', table(headers, [
      ...array(savedTable.metaRows), ...array(savedTable.rows), ...array(savedTable.footerRows)
    ]), 4);
    return section(calculation.title || 'Bench calculation', body.trim(), 3);
  }).join('');
}

function linkedRecordHeader(title, metadata) {
  return `### ${inline(title)}\n\n${properties(metadata)}\n\n`;
}

function assayBody(assay, options) {
  const layout = array(assay.wellLayout);
  const results = object(assay.resultValues);
  const byWell = new Map(layout.map(well => [text(well.well), well]));
  const wells = [...new Set([...byWell.keys(), ...Object.keys(results)])];
  const rows = wells.map(well => {
    const item = byWell.get(well) || {};
    return [well, item.sampleId, item.concentration, results[well]];
  });
  const analysis = object(assay.latestAnalysis);
  return linkedRecordHeader(assay.name || assay.id || 'Assay', {
    assayNumber: assay.assayNumber, plate: assay.plateLabel || assay.plateType,
    project: assay.projectName, updatedAt: assay.updatedAt, sampleAxis: assay.sampleAxis,
    concentrationAxis: assay.concentrationAxis, concentrationUnit: assay.concentrationUnit
  })
    + section('Plate layout and measurements', table(['Well', 'Sample', `Concentration${assay.concentrationUnit ? ` (${assay.concentrationUnit})` : ''}`, 'Measured value'], rows), 4)
    + section('Serial dilution', Object.entries(object(assay.serialDilutionSummary || assay.serialDilution)).map(([key, value]) => section(label(key), context(value, 6), 5)).join(''), 4)
    + section('Analysis', context(readableDetails(analysis), 5), 4)
    + image(`${assay.name || 'Assay'} analysis plot`, resolveLocalPath(analysis.chartRelativePath || analysis.chartPath, options.storageRoot), analysis.chartDataUrl, options)
    + section('Assay files', files([
      ...array(assay.resultAttachments),
      ...[['definitionJson', 'Plate setup'], ['analysisResult', 'Analysis results']]
        .filter(([key]) => assay[`${key}RelativePath`] || assay[`${key}Path`])
        .map(([key, name]) => ({ name, path: assay[`${key}Path`], relativePath: assay[`${key}RelativePath`] }))
    ], [], options), 4)
    + additionalDetails(assay, ['name', 'assayNumber', 'plateLabel', 'plateType', 'projectName', 'updatedAt',
      'sampleAxis', 'concentrationAxis', 'concentrationUnit', 'wellLayout', 'resultValues', 'latestAnalysis',
      'serialDilution', 'serialDilutionSummary', 'resultAttachments'], 4);
}

function gelBody(gel, options) {
  return linkedRecordHeader(gel.name || gel.id || 'Gel', { analysisType: gel.analysisType, imageName: gel.imageName, updatedAt: gel.updatedAt })
    + image(`${gel.name || 'Gel'} preview`, gel.previewImagePath || gel.sourceImagePath, gel.previewImageDataUrl || gel.sourceImageDataUrl, options)
    + section('Parameters', context(gel.parameters, 5), 4)
    + section('Gel analysis', Object.entries(object(gel.report)).map(([key, value]) => section(label(key), context(readableDetails(value), 6), 5)).join(''), 4)
    + section('Gel files', files([
      ...[['originalImage', 'Original image'], ['sourceImage', 'Source image'], ['previewImage', 'Annotated image'], ['analysisResult', 'Analysis results']]
        .filter(([key]) => gel[`${key}Path`]).map(([key, name]) => ({ name, path: gel[`${key}Path`] }))
    ], [], options), 4)
    + additionalDetails(gel, ['name', 'analysisType', 'imageName', 'updatedAt', 'parameters', 'report'], 4);
}

function header(title, metadata) {
  return `${GENERATED_MARKER}\n\n# ${inline(title)}\n\n${properties(metadata)}\n\n`;
}

function renderProtocol(payload, options) {
  const protocol = object(payload.protocol);
  const metadata = {
    project: protocol.projectName, category: protocol.category,
    createdAt: protocol.createdAt, updatedAt: protocol.updatedAt
  };
  const extra = section('Files and images', files(protocol.resultFileRecords || protocol.fileRecords || protocol.attachments || protocol.files, protocol.resultFiles, options))
    + additionalDetails(protocol, ['name', 'title', 'projectName', 'category', 'createdAt', 'updatedAt',
      'purpose', 'description', 'materials', 'steps', 'troubleshooting', 'resultFileRecords', 'fileRecords',
      'attachments', 'files', 'resultFiles'], 2);
  if (!options.canonical) return header(protocol.name || protocol.title || 'Protocol', metadata) + protocolBody(protocol) + extra;
  const fields = fieldsForRecord(protocol, 'protocol');
  const parameters = array(protocol.steps).flatMap((step, index) => array(step?.placeholders).map(item => [index + 1, item.name]));
  return `${GENERATED_MARKER}\n${documentMarker('protocol')}\n\n` + block('field', 'name', fields.name)
    + derivedBlock('metadata', properties(metadata))
    + Object.entries(fields).filter(([key]) => key !== 'name').map(([key, body]) => block('field', key, body)).join('')
    + derivedBlock('context', section('Parameters', parameters.length ? table(['Step', 'Parameter'], parameters) : '') + extra);
}

function renderNotebook(payload, linked, options) {
  const entry = object(payload.notebookEntry);
  const tables = resultTables(entry);
  const placeholderIds = new Set(array(linked.protocol.steps).flatMap(step => array(step?.placeholders).map(placeholder => text(placeholder.id))));
  const otherValues = Object.fromEntries(Object.entries(object(entry.values)).filter(([key]) => !placeholderIds.has(key)));
  const before = header(entry.experimentName || entry.protocolName || 'Notebook page', {
    project: entry.projectName, notebookType: entry.notebookType,
    state: entry.notebookState, executedAt: entry.executedAt, createdAt: entry.createdAt,
    updatedAt: entry.updatedAt, protocol: entry.protocolName
  })
    + section('Protocol used', inline(linked.protocol.name || entry.protocolName))
    + protocolBody(linked.protocol, object(entry.values))
    + section('Other recorded values', context(otherValues));
  const after = section('Result tables', tables ? 'Cells below preserve the saved values and formulas.\n\n' + tables : '')
    + section('Bench calculations', calculations(entry))
    + section('Samples', linked.samples.map(({ link: sampleLink, sample }) => context(readableDetails(sampleLink)) + (sample ? `\n\n${context(readableDetails(sample))}` : '')).join('\n\n'))
    + section('Files and images', files(entry.resultFileRecords, entry.resultFiles, options))
    + section('Linked assays', linked.assays.map(assay => assayBody(assay, options)).join(''))
    + section('Linked gels', linked.gels.map(gel => gelBody(gel, options)).join(''))
    + section('Workflow', context(readableDetails(entry.workflowContext)))
    + section('Unavailable context', linked.warnings.map(warning => `- ${inline(warning)}`).join('\n'))
    + additionalDetails(entry, ['experimentName', 'protocolName', 'projectName', 'notebookType', 'notebookState',
      'executedAt', 'createdAt', 'updatedAt', 'protocolSnapshot', 'values', 'result', 'resultTable', 'resultTables',
      'toolCalculations', 'sampleLinks', 'resultFileRecords', 'resultFiles', 'workflowContext', 'agentDraftStatus', 'agentDraftMeta'], 2);
  if (!options.canonical) return before + section('Notes and results', html(entry.result)) + after;
  // The notes field is appended after the images, so a page ends with its notes.
  return `${GENERATED_MARKER}\n${documentMarker('notebook')}\n\n`
    + derivedBlock('metadata', before.slice(GENERATED_MARKER.length).trimStart())
    + derivedBlock('context', after);
}

module.exports = { GENERATED_MARKER, renderNotebook, renderProtocol };
