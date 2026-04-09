function normalizeSource(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function sanitizeUrl(url) {
  const value = String(url || '').trim();
  if (!/^(https?:|mailto:)/i.test(value)) {
    return '';
  }
  return value;
}

function createInlineRenderer(safeText) {
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

    let escaped = source.replace(/`([^`\n]+)`/g, (_match, code) => (
      pushToken(`<code>${safeText(code)}</code>`)
    ));

    escaped = escaped.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
      const safeUrl = sanitizeUrl(href);
      if (!safeUrl) {
        return pushToken(safeText(label));
      }
      return pushToken(
        `<a href="${safeText(safeUrl)}" target="_blank" rel="noreferrer noopener">${safeText(label)}</a>`
      );
    });

    escaped = safeText(escaped)
      .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[\s([{-])\*([^*\n]+)\*(?=$|[\s).,;:!?}\]-])/g, '$1<em>$2</em>')
      .replace(/(^|[\s([{-])_([^_\n]+)_(?=$|[\s).,;:!?}\]-])/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return escaped.replace(/@@MDTOKEN_(\d+)@@/g, (_match, index) => tokens[Number(index)] || '');
  };
}

function splitTableRow(line) {
  const normalized = String(line || '').trim().replace(/^\||\|$/g, '');
  return normalized.split('|').map((cell) => cell.trim());
}

function isTableDivider(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableStart(lines, index) {
  const header = String(lines[index] || '').trim();
  const divider = String(lines[index + 1] || '').trim();
  if (!header || !divider || !header.includes('|')) {
    return false;
  }
  return isTableDivider(divider);
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
  return /^\s*([-+*]|\d+\.)\s+/.test(String(line || ''));
}

export function renderMarkdown(text, safeText) {
  const renderInline = createInlineRenderer(safeText);
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
    return /^\s*```/.test(line)
      || /^\s{0,3}#{1,6}\s+/.test(line)
      || /^\s*> ?/.test(line)
      || isListItem(line)
      || isTableStart(lines, cursor)
      || /^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line);
  }

  while (index < lines.length) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const fenceMatch = trimmed.match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      const language = String(fenceMatch[1] || '').trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !String(lines[index] || '').trim().match(/^```/)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageAttr = language ? ` data-language="${safeText(language)}"` : '';
      blocks.push(
        `<pre class="agent-chat-code-block"${languageAttr}><code>${safeText(codeLines.join('\n'))}</code></pre>`
      );
      continue;
    }

    if (isTableStart(lines, index)) {
      const headers = splitTableRow(lines[index]);
      const alignments = splitTableRow(lines[index + 1]).map(tableAlignment);
      const bodyRows = [];
      index += 2;
      while (index < lines.length) {
        const rowLine = String(lines[index] || '');
        if (!rowLine.trim() || !rowLine.includes('|')) {
          break;
        }
        bodyRows.push(splitTableRow(rowLine));
        index += 1;
      }
      const renderCell = (cell, cellIndex, tag = 'td') => {
        const alignment = alignments[cellIndex] || 'left';
        return `<${tag} data-align="${safeText(alignment)}">${renderInline(cell || '')}</${tag}>`;
      };
      blocks.push(`
        <div class="agent-chat-table-wrap">
          <table class="agent-chat-table">
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

    const headingMatch = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
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
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join('\n'), safeText)}</blockquote>`);
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
          if (isListItem(continuationLine) || isTableStart(lines, index) || /^\s{0,3}#{1,6}\s+/.test(continuationLine)) {
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
