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

function numberPart(value) {
  return {
    value,
    text: formatNotebookTableNumber(value),
    precedence: value < 0 ? UNARY_PRECEDENCE : ATOM_PRECEDENCE
  };
}

function productText(factors) {
  if (factors.length === 1) {
    return factors[0];
  }
  return {
    text: factors.map((factor) => operandText(factor, OPERATOR_PRECEDENCE['*'])).join('*'),
    precedence: OPERATOR_PRECEDENCE['*']
  };
}

// Collect numeric factors across a product or quotient, even when an unknown splits
// them: 5000/(100*E1) becomes 50/E1. Only numbers are combined; cancelling an unknown
// would hide division by zero once that cell is filled in.
function simplifyProduct(left, right, operator, fallback) {
  const leftProduct = left.product || { numerator: [left], denominator: [] };
  // Keep a quotient used as a divisor intact: A/(B/C) must still be undefined at C=0.
  const rightProduct = right.product && (operator === '*' || !right.product.denominator.length)
    ? right.product
    : { numerator: [right], denominator: [] };
  const product = {
    numerator: [...leftProduct.numerator, ...(operator === '*' ? rightProduct.numerator : rightProduct.denominator)],
    denominator: [...leftProduct.denominator, ...(operator === '*' ? rightProduct.denominator : rightProduct.numerator)]
  };
  const unchanged = { ...fallback, product };
  const isNumeric = (factor) => typeof factor.value === 'number';
  const numbers = [...product.numerator, ...product.denominator].filter(isNumeric);
  if (!numbers.length || numbers.some((factor) => !Number.isFinite(factor.value))
    || product.denominator.some((factor) => isNumeric(factor) && factor.value === 0)) {
    return unchanged;
  }
  const multiplyNumbers = (factors) => factors.filter(isNumeric).reduce((value, factor) => value * factor.value, 1);
  const coefficient = multiplyNumbers(product.numerator) / multiplyNumbers(product.denominator);
  if (!Number.isFinite(coefficient) || (coefficient === 0 && numbers.every((factor) => factor.value !== 0))
    || (numbers.length === 1 && coefficient !== 1)) {
    return unchanged;
  }

  // Keep the symbolic factors in their original order and put the combined number
  // where the first numerator number was, so D3*0.18 remains familiar as values arrive.
  const numerator = [];
  let placedNumber = false;
  product.numerator.forEach((factor) => {
    if (!isNumeric(factor)) {
      numerator.push(factor);
    } else if (!placedNumber && coefficient !== 1) {
      numerator.push(numberPart(coefficient));
      placedNumber = true;
    }
  });
  if (!placedNumber && coefficient !== 1) {
    numerator.unshift(numberPart(coefficient));
  }
  if (!numerator.length) {
    numerator.push(numberPart(1));
  }
  const denominator = product.denominator.filter((factor) => !isNumeric(factor));
  const top = productText(numerator);
  if (!denominator.length) {
    return { ...top, known: false, product };
  }
  const precedence = OPERATOR_PRECEDENCE['/'];
  return {
    known: false,
    text: `${operandText(top, precedence)}/${operandText(productText(denominator), precedence, { rightSide: true, operator: '/' })}`,
    precedence,
    product
  };
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
      const leftPart = textPartOf(node.left, left, context);
      const rightPart = textPartOf(node.right, right, context);
      const leftText = operandText(leftPart, precedence, { operator: node.op });
      const rightText = operandText(
        rightPart,
        precedence,
        { rightSide: true, operator: node.op }
      );
      const result = { known: false, text: `${leftText}${node.op}${rightText}`, precedence };
      return node.op === '*' || node.op === '/'
        ? simplifyProduct(leftPart, rightPart, node.op, result)
        : result;
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
  // A folded negative has to survive sitting next to an operator: 2-(-3).
  return numberPart(value);
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
