'use strict';

const { experimentDatabasePath } = require('../store/experiment-database.js');
const { runExperimentSql } = require('../store/experiment-query.js');
const { readOnlyAnnotations } = require('./projections.js');

const TOOL_NAME = 'paper_experiments_sql';
const QUERY_EXPERIMENTS_DEFINITION = Object.freeze({
  name: TOOL_NAME,
  description: [
    'Run one read-only SQLite SELECT (WITH supported) against KnowledgeBase/experiments.sqlite in the current workspace.',
    'Use for exact filters, joins, counts, grouping, or inspection of extracted paper experiments.',
    'Tables: experiments(paper_id, ordinal, id, title, technique, variables, figure_ref, outcome, evidence);',
    'papers(paper_id, title, doi, doc_type, one_sentence_summary, project_ids_json, intake_path, paper_md, figures_dir, pdf_path, created_at, updated_at).',
    'Join on paper_id, which is the intake folder ID. Discover columns with SELECT * FROM pragma_table_info(\'experiments\').',
    'Queries cover the whole workspace library; there is no automatic active-project filter.',
    'Use project-summary search for current project membership; project_ids_json reflects only the saved intake.',
    'Results contain columns and row-value arrays in that order, with truncation reported. Use ORDER BY and LIMIT/OFFSET for paging.',
    'Integers outside the JavaScript safe range are decimal strings; blobs are base64 objects.',
    'Default 50 rows, maximum 200 rows, 48 KB result budget, 3-second deadline. No file paths, writes, PRAGMA statements, or multiple statements.',
    'If the database is missing, use existing intake search tools; it is created on intake save or by the rebuild command.'
  ].join(' '),
  annotations: readOnlyAnnotations('Paper experiments SQL'),
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['sql'],
    properties: {
      sql: { type: 'string', minLength: 1, maxLength: 12000, description: 'A single SELECT query. Use ? placeholders with parameters for values.' },
      parameters: { type: 'array', maxItems: 100, items: { anyOf: [
        { type: 'string', maxLength: 4000 }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }
      ] } },
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
    }
  }
});

async function callQueryExperiments(input = {}, _context = {}, deps = {}) {
  const base = { mcp_tool: TOOL_NAME, app_tool: TOOL_NAME, database: 'KnowledgeBase/experiments.sqlite', search_scope: 'library' };
  const invalid = (error) => ({ ...base, ok: false, status: 'invalid_arguments', error });
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['sql', 'parameters', 'limit'].includes(key))) return invalid('Expected sql, optional parameters, and optional limit.');
  if (typeof input.sql !== 'string' || !input.sql.trim() || input.sql.length > 12000 || input.sql.includes('\0')) return invalid('sql must contain 1–12000 characters without NUL bytes.');
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return invalid('limit must be an integer from 1 to 200.');
  const parameters = input.parameters ?? [];
  if (!Array.isArray(parameters) || parameters.length > 100 || parameters.some((value) => !(
    value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && value.length <= 4000)
  ))) return invalid('parameters must contain at most 100 strings, finite numbers, booleans, or nulls.');
  if (!deps.workspacePath || typeof deps.fs?.readFile !== 'function') {
    return { ...base, ok: false, status: 'executor_unavailable', error: 'The experiment database is not connected to a workspace.' };
  }
  try {
    const bytes = new Uint8Array(await deps.fs.readFile(experimentDatabasePath(deps.workspacePath)));
    if (!bytes.length) return { ...base, ok: false, status: 'query_failed', error: 'The experiment database is empty; rebuild it from saved intake records.' };
    return { ...base, limit, ...await runExperimentSql({ bytes, sql: input.sql, parameters, limit }) };
  } catch (error) {
    return { ...base, ok: false, status: error.code === 'ENOENT' ? 'not_found' : 'query_failed',
      error: error.code === 'ENOENT'
        ? 'No experiment database exists yet. Use intake search, save paper intake, or rebuild experiments.sqlite from saved intake records.'
        : String(error?.message || error).slice(0, 1000) };
  }
}

module.exports = { QUERY_EXPERIMENTS_DEFINITION, callQueryExperiments };
