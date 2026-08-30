import { evaluateFormula, parseFormula } from '../formula.js';
import { formatNotebookTableNumber } from './cell-address.js';

const OPERATOR_PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 };
const UNARY_PRECEDENCE = 4;
const ATOM_PRECEDENCE = 5;

// Parenthesise a part only where dropping them would change the arithmetic:
// (10+D3)*2 needs them, 10+18*D3 does not.
function operandText(part, parentPrecedence, { rightSide = false, operator = '' } = {}) {
  const tighter = part.precedence < parentPrecedence;
  const sameButOrderMatters = part.precedence === parentPrecedence
    && ((rightSide && (operator === '-' || operator === '/' || operator === '^'))
      || (!rightSide && operator === '^'));
  return tighter || sameButOrderMatters ? `(${part.text})` : part.text;
}

function simplifyNode(node, context) {
  const known = { known: true };

  switch (node.kind) {
    case 'number':
      return known;

    case 'value':
      // "x" means the current well on a plate; a table cell has no such value.
      return { known: false, text: 'x', precedence: ATOM_PRECEDENCE };

    case 'ref':
    case 'range': {
      const resolved = context.resolve(node);
      return resolved.known
        ? known
        : { known: false, text: resolved.text, precedence: ATOM_PRECEDENCE };
    }

    case 'unary': {
      const arg = simplifyNode(node.arg, context);
      if (arg.known) {
        return known;
      }
      return {
        known: false,
        text: `${node.op}${operandText(textPartOf(node.arg, arg, context), UNARY_PRECEDENCE)}`,
        precedence: UNARY_PRECEDENCE
      };
    }

    case 'binary': {
      const left = simplifyNode(node.left, context);
      const right = simplifyNode(node.right, context);
      if (left.known && right.known) {
        return known;
      }
      const precedence = OPERATOR_PRECEDENCE[node.op] || 1;
      const leftText = operandText(textPartOf(node.left, left, context), precedence, { operator: node.op });
      const rightText = operandText(
        textPartOf(node.right, right, context),
        precedence,
        { rightSide: true, operator: node.op }
      );
      return { known: false, text: `${leftText}${node.op}${rightText}`, precedence };
    }

    case 'call': {
      const args = node.args.map((arg) => simplifyNode(arg, context));
      if (args.every((arg) => arg.known)) {
        return known;
      }
      const argsText = node.args
        .map((arg, index) => textPartOf(arg, args[index], context).text)
        .join(', ');
      return { known: false, text: `${node.rawName}(${argsText})`, precedence: ATOM_PRECEDENCE };
    }

    default:
      return { known: false, text: '?', precedence: ATOM_PRECEDENCE };
  }
}

// What a sub-expression looks like once written out: a folded number for the parts
// that are known, the source text for the parts that are still waiting on a cell.
function textPartOf(node, part, context) {
  if (!part.known) {
    return part;
  }
  if (node.kind === 'range') {
    // A qualified range keeps its table, or the text would point at the local one.
    const prefix = node.table ? `${node.table}:` : '';
    return {
      text: `${prefix}${String(node.from).toUpperCase()}:${String(node.to).toUpperCase()}`,
      precedence: ATOM_PRECEDENCE
    };
  }
  const value = evaluateFormula(node, context.numeric);
  return {
    text: formatNotebookTableNumber(value),
    // A folded negative has to survive sitting next to an operator: 2-(-3).
    precedence: value < 0 ? UNARY_PRECEDENCE : ATOM_PRECEDENCE
  };
}

// `resolve(node)` reports whether a reference has a value yet: { known: true } or
// { known: false, text } naming the cell that is still empty. `numeric` is the
// evaluation context used to fold the parts that are known.
function simplifyFormula(text, { resolve, numeric }) {
  const ast = parseFormula(text);
  const context = { resolve, numeric };
  const result = simplifyNode(ast, context);
  return result.known ? null : result.text;
}

export {
  simplifyFormula
};
