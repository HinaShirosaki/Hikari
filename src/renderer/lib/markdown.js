function normalizeSource(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

// Model output is untrusted: links may only be http(s) or mailto, so a
// javascript: or file: href renders as plain text.
function sanitizeUrl(url) {
  const value = String(url || '').trim();
  if (!/^(https?:|mailto:)/i.test(value)) {
    return '';
  }
  return value;
}

// Safety rule for the inline pass: code spans, images and links are rendered and
// escaped first, then swapped out for @@MDTOKEN_n@@ markers; the rest of the
// text is HTML-escaped as a whole before emphasis tags are added, and the
// markers are swapped back last. No raw model text reaches the output unescaped.
function formatEmphasis(text) {
  return text
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s([{-])\*([^*\n]+)\*(?=$|[\s).,;:!?}\]-])/g, '$1<em>$2</em>')
    .replace(/(^|[\s([{-])_([^_\n]+)_(?=$|[\s).,;:!?}\]-])/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}

function createInlineRenderer(safeText, { renderLocalLink, renderImage } = {}) {
  return function renderInline(text) {
    const source = String(text || '');
    if (!source) {
      return '';
    }

    const tokens = [];
    const pushToken = (html) => {
      const marker = `@@MDTOKEN_${tokens.length}@@`;
      tokens.push(String(html || ''));
      return marker;
    };
    const restoreTokens = (value) => value.replace(/@@MDTOKEN_(\d+)@@/g, (_match, index) => tokens[Number(index)] || '');

    let escaped = source.replace(/`([^`\n]+)`/g, (_match, code) => (
      pushToken(`<code>${safeText(code)}</code>`)
    ));

    escaped = escaped.replace(/!\[([^\]\n]*)\]\(\s*(<[^<>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"\n]*")?\s*\)/g, (_match, alt, src) => {
      return pushToken(renderImage?.(alt, src, safeText) ?? safeText(alt));
    });

    escaped = escaped.replace(/\[([^\]\n]+)\]\(\s*(<[^<>\n]+>|(?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"\n]*")?\s*\)/g, (_match, label, href) => {
      const target = href.replace(/^<|>$/g, '');
      const renderedLabel = restoreTokens(formatEmphasis(safeText(label)));
      const localLink = renderLocalLink?.(target, renderedLabel);
      if (localLink) return pushToken(localLink);
      const safeUrl = sanitizeUrl(target);
      if (!safeUrl) {
        return pushToken(renderedLabel);
      }
      return pushToken(
        `<a href="${safeText(safeUrl)}" target="_blank" rel="noreferrer noopener">${renderedLabel}</a>`
      );
    });

    escaped = formatEmphasis(safeText(escaped));

    return restoreTokens(escaped);
  };
}

function splitTableRow(line, requirePipe = true) {
  const source = String(line || '').trim();
  if (requirePipe && !source.includes('|')) return null;
  const cells = [''];
  for (const [token] of source.matchAll(/\\[\\|]|\||[^\\|]+|\\/g)) {
    if (token === '|') cells.push('');
    else cells[cells.length - 1] += token === '\\|' || token === '\\\\' ? token[1] : token;
  }
  if (requirePipe && cells.length === 1) return null;
  if (source.startsWith('|')) cells.shift();
  if (cells.length > 1 && cells.at(-1) === '') cells.pop();
  return cells.map(cell => cell.trim());
}

function readTableHeader(lines, index) {
  const headers = splitTableRow(lines[index]);
  if (!headers) return null;
  const divider = splitTableRow(lines[index + 1], false);
  if (headers.length !== divider.length || !divider.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
  return { headers, alignments: divider.map(tableAlignment) };
}

function tableAlignment(cell) {
  const value = String(cell || '').trim();
  if (value.startsWith(':') && value.endsWith(':')) {
    return 'center';
  }
  if (value.endsWith(':')) {
    return 'right';
  }
  return 'left';
}

function isListItem(line) {
  return /^\s*([-+*]|\d+\.)\s+.+$/.test(String(line || ''));
}

const headingPattern = /^\s{0,3}(#{1,6})\s+(.+)$/;
const fencePattern = /^(`{3,}|~{3,})\s*([A-Za-z0-9_-]+)?\s*$/;

// Shared Markdown subset: fenced code, pipe tables, headings,
// rules, blockquotes (recursive), flat lists and paragraphs. Callers may provide an image renderer.
// Nested lists and raw HTML are not supported (HTML is shown escaped).
export function renderMarkdown(text, safeText, options = {}) {
  const { classPrefix = 'markdown', onTable, quoteDepth = 0 } = options;
  const renderInline = createInlineRenderer(safeText, options);
  const source = normalizeSource(text).trim();
  if (!source) {
    return '';
  }

  const lines = source.split('\n');
  const blocks = [];
  let index = 0;

  function isParagraphBoundary(cursor) {
    const line = String(lines[cursor] || '');
    if (!line.trim()) {
      return true;
    }
    return fencePattern.test(line.trim())
      || headingPattern.test(line)
      || /^\s*> ?/.test(line)
      || isListItem(line)
      || readTableHeader(lines, cursor)
      || /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
  }

  while (index < lines.length) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(fencePattern);
    if (fenceMatch) {
      const [, opening, language] = fenceMatch;
      const codeLines = [];
      index += 1;
      while (index < lines.length) {
        const closing = lines[index].trim().match(fencePattern);
        if (closing && !closing[2] && closing[1][0] === opening[0] && closing[1].length >= opening.length) break;
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageAttr = language ? ` data-language="${safeText(language)}"` : '';
      blocks.push(
        `<pre class="${classPrefix}-code-block"${languageAttr}><code>${safeText(codeLines.join('\n'))}</code></pre>`
      );
      continue;
    }

    const table = readTableHeader(lines, index);
    if (table) {
      onTable?.();
      const { headers, alignments } = table;
      const bodyRows = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = String(lines[index] || '');
        if (headingPattern.test(rowLine) || fencePattern.test(rowLine.trim()) || isListItem(rowLine)) break;
        const cells = splitTableRow(rowLine);
        if (!cells) break;
        bodyRows.push(cells);
        index += 1;
      }
      const renderCell = (cell, cellIndex, tag = 'td') => {
        const alignment = alignments[cellIndex] || 'left';
        return `<${tag}${tag === 'th' ? ' scope="col"' : ''} data-align="${safeText(alignment)}">${renderInline(cell || '')}</${tag}>`;
      };
      blocks.push(`
        <div class="${classPrefix}-table-wrap">
          <table class="${classPrefix}-table">
            <thead>
              <tr>${headers.map((cell, cellIndex) => renderCell(cell, cellIndex, 'th')).join('')}</tr>
            </thead>
            <tbody>
              ${bodyRows.map((row) => (
                `<tr>${headers.map((_cell, cellIndex) => renderCell(row[cellIndex] || '', cellIndex)).join('')}</tr>`
              )).join('')}
            </tbody>
          </table>
        </div>
      `);
      continue;
    }

    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      const level = Math.max(1, Math.min(6, headingMatch[1].length));
      blocks.push(`<h${level}>${renderInline(headingMatch[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(trimmed)) {
      blocks.push('<hr />');
      index += 1;
      continue;
    }

    if (/^\s*> ?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length) {
        const quoteLine = String(lines[index] || '');
        if (!quoteLine.trim()) {
          quoteLines.push('');
          index += 1;
          continue;
        }
        if (!/^\s*> ?/.test(quoteLine)) {
          break;
        }
        quoteLines.push(quoteLine.replace(/^\s*> ?/, ''));
        index += 1;
      }
      const quote = quoteLines.join('\n');
      const body = quoteDepth < 20
        ? renderMarkdown(quote, safeText, { ...options, quoteDepth: quoteDepth + 1 })
        : renderInline(quote).replace(/\n/g, '<br />');
      blocks.push(`<blockquote>${body}</blockquote>`);
      continue;
    }

    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];
      while (index < lines.length) {
        const currentLine = String(lines[index] || '');
        const match = ordered
          ? currentLine.match(/^\s*\d+\.\s+(.+)$/)
          : currentLine.match(/^\s*[-+*]\s+(.+)$/);
        if (!match) {
          break;
        }
        const itemLines = [match[1]];
        index += 1;
        while (index < lines.length) {
          const continuationLine = String(lines[index] || '');
          if (!continuationLine.trim()) {
            break;
          }
          if (isListItem(continuationLine) || readTableHeader(lines, index) || headingPattern.test(continuationLine)) {
            break;
          }
          itemLines.push(continuationLine.trim());
          index += 1;
        }
        items.push(`<li>${renderInline(itemLines.join('\n')).replace(/\n/g, '<br />')}</li>`);
        if (!String(lines[index] || '').trim()) {
          index += 1;
          break;
        }
      }
      blocks.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && !isParagraphBoundary(index)) {
      paragraphLines.push(String(lines[index] || '').trimEnd());
      index += 1;
    }
    blocks.push(`<p>${renderInline(paragraphLines.join('\n')).replace(/\n/g, '<br />')}</p>`);
  }

  return blocks.join('');
}
