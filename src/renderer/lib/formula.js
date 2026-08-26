// A small spreadsheet-style formula language for plate transforms.
//
//   =(x - MEAN(H1:H12)) / MEAN(A1:A12) * 100
//
// `x` is the current well's value; bare names are plate references (a well, a row, or a
// custom group); `A1:H12` is a rectangular block. Parsed into an AST and walked --
// never eval()'d, and never handed a string it did not tokenise itself.
//
// Note `A-C` row ranges from the guided steps are NOT reference syntax here: inside a
// formula `-` is subtraction. Use `A1:C12`, or add the rows: MEAN(A) + MEAN(B).

export class FormulaError extends Error {
  constructor(message, position = null) {
    super(message);
    this.name = 'FormulaError';
    this.position = position;
  }
}

const WELL_PATTERN = /^[A-Za-z]+\d+$/;
const TABLE_PATTERN = /^Table\d+$/i;

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values) {
  // The sample SD of one value is undefined, not zero. Non-finite cells are filtered
  // out before we get here, so returning 0 would report "no variability" for a block
  // where every replicate but one happened to be blank.
  if (values.length < 2) {
    throw new FormulaError('SD() needs at least two numeric values.');
  }
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// Reduce a list of numbers to one. Arguments are flattened first, so
// MEAN(A1:A12, H1) is the mean of all thirteen wells.
const AGGREGATES = Object.freeze({
  MEAN: mean,
  AVERAGE: mean,
  AVG: mean,
  MEDIAN: median,
  MIN: (values) => Math.min(...values),
  MAX: (values) => Math.max(...values),
  SUM: (values) => values.reduce((sum, value) => sum + value, 0),
  COUNT: (values) => values.length,
  SD: sampleSd,
  STDEV: sampleSd
});

// name -> [minArgs, maxArgs, fn]
const SCALARS = Object.freeze({
  LOG10: [1, 1, (x) => (x > 0 ? Math.log10(x) : NaN)],
  LOG: [1, 2, (x, base) => {
    if (!(x > 0)) return NaN;
    if (base === undefined) return Math.log10(x);
    return base > 0 && base !== 1 ? Math.log(x) / Math.log(base) : NaN;
  }],
  LN: [1, 1, (x) => (x > 0 ? Math.log(x) : NaN)],
  EXP: [1, 1, (x) => Math.exp(x)],
  SQRT: [1, 1, (x) => (x >= 0 ? Math.sqrt(x) : NaN)],
  ABS: [1, 1, (x) => Math.abs(x)],
  POWER: [2, 2, (x, y) => x ** y],
  ROUND: [1, 2, (x, digits) => {
    const factor = 10 ** (Number.isFinite(digits) ? Math.trunc(digits) : 0);
    return Math.round(x * factor) / factor;
  }]
});

export const FORMULA_FUNCTIONS = Object.freeze({
  aggregates: Object.keys(AGGREGATES),
  scalars: Object.keys(SCALARS)
});

/* -------------------------------------------------------------- tokenizer */

// `offset` shifts reported positions back onto the string the user actually typed,
// which still has its leading whitespace and "=".
function tokenize(text, offset = 0) {
  const tokens = [];
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(text[index + 1] || ''))) {
      const match = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(text.slice(index));
      tokens.push({ type: 'number', value: Number(match[0]), position: index + offset });
      index += match[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(index));
      tokens.push({ type: 'name', value: match[0], position: index + offset });
      index += match[0].length;
      continue;
    }
    if ('+-*/^(),:'.includes(char)) {
      tokens.push({ type: char, position: index + offset });
      index += 1;
      continue;
    }
    throw new FormulaError(`Unexpected character "${char}".`, index + offset);
  }

  tokens.push({ type: 'end', position: text.length + offset });
  return tokens;
}

/* ----------------------------------------------------------------- parser */

// Names and arity are checked while parsing, so a typo is reported as you type rather
// than only once the formula is run against a plate.
function validateCall(node) {
  if (AGGREGATES[node.name]) {
    if (!node.args.length) {
      throw new FormulaError(`${node.name}() needs at least one value.`, node.position);
    }
    return;
  }
  const scalar = SCALARS[node.name];
  if (!scalar) {
    throw new FormulaError(`Unknown function "${node.rawName}".`, node.position);
  }
  const [min, max] = scalar;
  if (node.args.length < min || node.args.length > max) {
    const arity = min === max ? `${min}` : `${min}-${max}`;
    throw new FormulaError(
      `${node.name}() takes ${arity} argument(s), got ${node.args.length}.`,
      node.position
    );
  }
}

export function parseFormula(input) {
  const raw = String(input || '');
  const trimmedStart = raw.trimStart();
  const hasEquals = trimmedStart.startsWith('=');
  const offset = (raw.length - trimmedStart.length) + (hasEquals ? 1 : 0);
  const text = (hasEquals ? trimmedStart.slice(1) : trimmedStart).trimEnd();
  if (!text.trim()) {
    throw new FormulaError('Formula is empty.', 0);
  }
  const tokens = tokenize(text, offset);
  let cursor = 0;

  const peek = () => tokens[cursor];
  const next = () => tokens[cursor++];
  const expect = (type, what) => {
    if (peek().type !== type) {
      throw new FormulaError(`Expected ${what}.`, peek().position);
    }
    return next();
  };

  function parseExpression() {
    let left = parseTerm();
    while (peek().type === '+' || peek().type === '-') {
      const op = next().type;
      left = { kind: 'binary', op, left, right: parseTerm() };
    }
    return left;
  }

  function parseTerm() {
    let left = parsePower();
    while (peek().type === '*' || peek().type === '/') {
      const op = next().type;
      left = { kind: 'binary', op, left, right: parsePower() };
    }
    return left;
  }

  // ^ binds tighter than * / and is right-associative, as in Excel.
  function parsePower() {
    const base = parseUnary();
    if (peek().type === '^') {
      next();
      return { kind: 'binary', op: '^', left: base, right: parsePower() };
    }
    return base;
  }

  function parseUnary() {
    if (peek().type === '-' || peek().type === '+') {
      const op = next().type;
      return { kind: 'unary', op, arg: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const token = peek();

    if (token.type === 'number') {
      next();
      return { kind: 'number', value: token.value };
    }

    if (token.type === '(') {
      next();
      const inner = parseExpression();
      expect(')', 'a closing ")"');
      return inner;
    }

    if (token.type === 'name') {
      next();
      if (peek().type === '(') {
        next();
        const args = [];
        if (peek().type !== ')') {
          args.push(parseExpression());
          while (peek().type === ',') {
            next();
            args.push(parseExpression());
          }
        }
        expect(')', `a closing ")" for ${token.value}`);
        const call = {
          kind: 'call',
          name: token.value.toUpperCase(),
          rawName: token.value,
          args,
          position: token.position
        };
        validateCall(call);
        return call;
      }
      if (token.value.toLowerCase() === 'x') {
        return { kind: 'value', position: token.position };
      }
      // A table-qualified address keeps point-mode clicks unambiguous when two
      // spreadsheets are visible together. A qualified range is written as
      // Table1:A1:A8; the first colon selects the table and the second spans cells.
      if (TABLE_PATTERN.test(token.value) && peek().type === ':') {
        next();
        const from = expect('name', `a cell reference after ${token.value}:`);
        if (peek().type === ':') {
          next();
          const to = expect('name', 'a cell reference at the end of the range');
          return {
            kind: 'range',
            table: token.value,
            from: from.value,
            to: to.value,
            position: token.position
          };
        }
        return {
          kind: 'ref',
          table: token.value,
          name: from.value,
          position: token.position
        };
      }
      // A reference, optionally the start of an A1:H12 block.
      if (peek().type === ':') {
        next();
        const to = expect('name', 'a well reference after ":"');
        return { kind: 'range', from: token.value, to: to.value, position: token.position };
      }
      return { kind: 'ref', name: token.value, position: token.position };
    }

    throw new FormulaError('Expected a number, a reference, or a function.', token.position);
  }

  const ast = parseExpression();
  if (peek().type !== 'end') {
    throw new FormulaError('Unexpected trailing input.', peek().position);
  }
  return ast;
}

/* -------------------------------------------------------------- evaluator */

// resolveRef(node) must return an array of numbers for a `ref` or `range` node, or
// throw a FormulaError explaining why the reference is not usable.
function evaluateNode(node, context) {
  switch (node.kind) {
    case 'number':
      return [node.value];

    case 'value':
      if (!Number.isFinite(context.value)) {
        throw new FormulaError('"x" has no value in this well.', node.position);
      }
      return [context.value];

    case 'ref':
    case 'range':
      return context.resolveRef(node);

    case 'unary': {
      const arg = scalarOf(node.arg, context, 'a single value');
      return [node.op === '-' ? -arg : arg];
    }

    case 'binary': {
      const left = scalarOf(node.left, context, 'a single value');
      const right = scalarOf(node.right, context, 'a single value');
      if (node.op === '+') return [left + right];
      if (node.op === '-') return [left - right];
      if (node.op === '*') return [left * right];
      if (node.op === '^') return [left ** right];
      return [right === 0 ? NaN : left / right];
    }

    case 'call': {
      const aggregate = AGGREGATES[node.name];
      if (aggregate) {
        const values = node.args.flatMap((arg) => evaluateNode(arg, context));
        const usable = values.filter((value) => Number.isFinite(value));
        if (!usable.length) {
          throw new FormulaError(`${node.name}() has no numeric values to work with.`, node.position);
        }
        return [aggregate(usable)];
      }
      const scalar = SCALARS[node.name];
      if (scalar) {
        const [min, max, fn] = scalar;
        if (node.args.length < min || node.args.length > max) {
          const arity = min === max ? `${min}` : `${min}-${max}`;
          throw new FormulaError(`${node.name}() takes ${arity} argument(s), got ${node.args.length}.`, node.position);
        }
        return [fn(...node.args.map((arg) => scalarOf(arg, context, `an argument to ${node.name}()`)))];
      }
      throw new FormulaError(`Unknown function "${node.rawName}".`, node.position);
    }

    default:
      throw new FormulaError('Could not evaluate this formula.');
  }
}

function scalarOf(node, context, what) {
  const values = evaluateNode(node, context);
  if (values.length !== 1) {
    const prefix = node.table ? `${node.table}:` : '';
    const label = node.kind === 'range' ? `${prefix}${node.from}:${node.to}` : `${prefix}${node.name}`;
    throw new FormulaError(
      `"${label}" covers ${values.length} wells; wrap it in MEAN(), MAX(), MIN(), SUM() or MEDIAN() to use it as ${what}.`,
      node.position
    );
  }
  return values[0];
}

export function evaluateFormula(ast, context) {
  const values = evaluateNode(ast, context);
  if (values.length !== 1) {
    throw new FormulaError('The formula must produce a single value per well.');
  }
  return values[0];
}

// Parses once and hands back a reusable evaluator, so a 384-well plate parses the
// formula once rather than once per well.
export function compileFormula(input) {
  try {
    const ast = parseFormula(input);
    return {
      ast,
      error: null,
      evaluate: (context) => evaluateFormula(ast, context)
    };
  } catch (error) {
    return {
      ast: null,
      error: error instanceof FormulaError
        ? { message: error.message, position: error.position }
        : { message: String(error?.message || error), position: null },
      evaluate: null
    };
  }
}

export function isWellToken(name) {
  return WELL_PATTERN.test(String(name || ''));
}
