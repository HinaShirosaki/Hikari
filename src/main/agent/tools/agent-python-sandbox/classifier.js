'use strict';

const { cleanText } = require('./utils.js');

function classifyPythonSandboxFailure(result = {}) {
  const stderr = cleanText(result.stderr, 12000);
  const stdout = cleanText(result.stdout, 4000);
  const error = cleanText(result.error, 4000);
  const combined = `${stderr}\n${stdout}\n${error}`;

  const moduleMatch = combined.match(/ModuleNotFoundError:\s+No module named ['"]([^'"]+)['"]/i);
  if (moduleMatch?.[1]) {
    return {
      classification: 'missing_module',
      likely_cause: `The sandbox tried to import "${moduleMatch[1]}", which is not available in the current Python environment.`,
      suggested_fix: 'Use the standard library only, vendor the dependency into the sandbox files, or remove the import.'
    };
  }

  const fileMatch = combined.match(/FileNotFoundError:.*?['"]([^'"]+)['"]/i);
  if (fileMatch?.[1]) {
    return {
      classification: 'missing_file',
      likely_cause: `The code tried to open "${fileMatch[1]}", but that file was not present inside the sandbox.`,
      suggested_fix: 'Stage the file through `files`, write it before reading it, or correct the relative path.'
    };
  }

  if (/SyntaxError:/i.test(combined) || /IndentationError:/i.test(combined)) {
    return {
      classification: 'syntax_error',
      likely_cause: 'The Python source could not be parsed before execution.',
      suggested_fix: 'Check indentation, quotes, commas, and unmatched brackets in the generated code.'
    };
  }

  if (/NameError:/i.test(combined)) {
    return {
      classification: 'name_error',
      likely_cause: 'The code referenced a variable or function name that was never defined.',
      suggested_fix: 'Define the missing symbol before use or fix the variable name.'
    };
  }

  if (/TypeError:/i.test(combined)) {
    return {
      classification: 'type_error',
      likely_cause: 'An operation received a value of the wrong type.',
      suggested_fix: 'Inspect the traceback line and coerce or validate input values before that operation.'
    };
  }

  if (/ValueError:/i.test(combined)) {
    return {
      classification: 'value_error',
      likely_cause: 'The code received a value that was structurally valid but semantically unusable.',
      suggested_fix: 'Validate assumptions about parsed text, numeric conversions, or expected formats before processing.'
    };
  }

  if (/KeyError:/i.test(combined)) {
    return {
      classification: 'key_error',
      likely_cause: 'The code expected a dictionary key that was missing from the input data.',
      suggested_fix: 'Guard dictionary lookups with `.get(...)`, membership checks, or defaults.'
    };
  }

  if (/IndexError:/i.test(combined)) {
    return {
      classification: 'index_error',
      likely_cause: 'The code accessed a list or sequence position that does not exist.',
      suggested_fix: 'Check sequence lengths before indexing and handle empty-input cases.'
    };
  }

  if (result.timed_out === true) {
    return {
      classification: 'timed_out',
      likely_cause: 'The Python process exceeded the sandbox timeout before finishing.',
      suggested_fix: 'Reduce the workload, stream partial results, or request a larger timeout when appropriate.'
    };
  }

  return {
    classification: 'runtime_error',
    likely_cause: cleanText(stderr || error, 280) || 'The Python process exited with an error.',
    suggested_fix: 'Inspect the traceback, fix the failing line, and rerun with tighter input validation.'
  };
}

module.exports = {
  classifyPythonSandboxFailure
};
