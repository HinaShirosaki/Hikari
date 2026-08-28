'use strict';

const { buildParsedTable, decodeXmlEntities } = require('./table-text.js');
const { parseXmlAttributes } = require('./xlsx.js');

function parseHtmlTableRows(tableHtml) {
  const rows = [];
  (tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).forEach((rowHtml) => {
    const row = [];
    rowHtml.replace(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi, (_match, cellHtml) => {
      row.push(decodeXmlEntities(cellHtml.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim());
      return '';
    });
    rows.push(row);
  });
  return rows;
}

function maybeParseHtmlTables(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!/^<(!doctype\s+html|html|table)\b/i.test(text)) {
    return [];
  }
  const tableMatches = text.match(/<table\b[\s\S]*?<\/table>/gi) || [text];
  return tableMatches.map((table, index) => buildParsedTable(parseHtmlTableRows(table), {
    format: 'html-xls',
    sheetName: `Table ${index + 1}`
  }));
}

function maybeParseHtmlTable(buffer) {
  return maybeParseHtmlTables(buffer)[0] || null;
}

function parseSpreadsheetMlRows(source) {
  const rows = [];
  (source.match(/<Row\b[\s\S]*?<\/Row>/gi) || []).forEach((rowXml) => {
    const row = [];
    let currentIndex = 0;
    rowXml.replace(/<Cell\b([^>]*)>([\s\S]*?)<\/Cell>/gi, (_match, attrText, cellXml) => {
      const attrs = parseXmlAttributes(attrText);
      const explicitIndex = Number(attrs['ss:Index'] || attrs.Index || 0);
      if (Number.isFinite(explicitIndex) && explicitIndex > 0) {
        currentIndex = explicitIndex - 1;
      }
      const valueMatch = cellXml.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
      row[currentIndex] = valueMatch ? decodeXmlEntities(valueMatch[1]).trim() : '';
      currentIndex += 1;
      return '';
    });
    rows.push(row);
  });
  return rows;
}

function maybeParseSpreadsheetMlTables(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
  if (!/^<\?xml/i.test(text) || !/<Workbook\b/i.test(text)) {
    return [];
  }
  const worksheetMatches = text.match(/<Worksheet\b[\s\S]*?<\/Worksheet>/gi) || [];
  if (!worksheetMatches.length) {
    return [buildParsedTable(parseSpreadsheetMlRows(text), {
      format: 'xml-xls',
      sheetName: 'Sheet 1'
    })];
  }
  return worksheetMatches.map((worksheetXml, index) => {
    const attrs = parseXmlAttributes(worksheetXml.match(/<Worksheet\b([^>]*)>/i)?.[1] || '');
    return buildParsedTable(parseSpreadsheetMlRows(worksheetXml), {
      format: 'xml-xls',
      sheetName: attrs['ss:Name'] || attrs.Name || `Sheet ${index + 1}`
    });
  });
}

function maybeParseSpreadsheetMl(buffer) {
  return maybeParseSpreadsheetMlTables(buffer)[0] || null;
}

module.exports = {
  maybeParseHtmlTable,
  maybeParseHtmlTables,
  maybeParseSpreadsheetMl,
  maybeParseSpreadsheetMlTables
};
