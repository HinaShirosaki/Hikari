function escapeCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function codeList(values, empty = '—') {
  return values?.length ? values.map((value) => `\`${value}\``).join(', ') : empty;
}

function issueLines(issues) {
  if (!issues.length) return ['None.'];
  return issues.map((issue) => `- **${issue.type}** — ${issue.message}`);
}

function renderMarkdown(report) {
  const lines = [
    '# Before/After Split Import-Export Dependency Map',
    '',
    `- Baseline: \`${report.baselineRef}\``,
    '- After snapshot: current working tree',
    `- Generated: ${report.generatedAt}`,
    `- Package entrypoint: \`${report.packageEntrypoint.before || '(none)'}\` → \`${report.packageEntrypoint.after || '(none)'}\``,
    '',
    '## Verdict',
    ''
  ];
  const blocking = report.newImportIssues.length
    + report.lostExports.filter((entry) => entry.afterConsumers.length || entry.publicEntrypoint).length;
  if (blocking === 0) {
    lines.push('No newly unresolved local imports, missing named exports, or lost public exports were detected. Review the lower-confidence and orphan-module sections for possible semantic split mistakes.');
  } else {
    lines.push(`Detected **${blocking} blocking compatibility finding(s)**. Inspect the findings below before treating the split as complete.`);
  }
  lines.push(
    '',
    '## Summary',
    '',
    '| Metric | Before | After / delta |',
    '|---|---:|---:|',
    `| Parsed code files | ${report.summary.beforeCodeFiles} | ${report.summary.afterCodeFiles} |`,
    `| Added code files | — | ${report.summary.addedCodeFiles} |`,
    `| Modified code files | — | ${report.summary.modifiedCodeFiles} |`,
    `| Local import/export issues | ${report.summary.beforeImportIssues} | ${report.summary.afterImportIssues} (${report.summary.newImportIssues} new) |`,
    `| Exact-body function moves | — | ${report.summary.exactMovedFunctions} |`,
    `| Name-only function moves | — | ${report.summary.nameOnlyMovedFunctions} |`,
    `| Removed functions not found after | — | ${report.summary.missingFunctions} |`,
    `| Lost owner exports | — | ${report.summary.lostExports} |`,
    `| New modules with no static inbound edge | — | ${report.summary.orphanAddedModules} |`,
    `| Detected owner → extracted-module pairs | — | ${report.summary.splitPairs} |`,
    '',
    '## New import/export findings',
    '',
    ...issueLines(report.newImportIssues),
    '',
    '## Lost owner exports',
    ''
  );
  if (!report.lostExports.length) {
    lines.push('None. Every export exposed by a modified owner at the baseline remains available from that owner after the split.');
  } else {
    report.lostExports.forEach((entry) => {
      const classification = entry.afterConsumers.length || entry.publicEntrypoint
        ? '**compatibility risk**'
        : 'retired internal export; no after-split consumer';
      lines.push(`- \`${entry.filePath}\` no longer exports \`${entry.exportedName}\` — ${classification}. Before consumers: ${codeList(entry.beforeConsumers)}.`);
    });
  }

  lines.push('', '## Detected split map', '');
  if (!report.splitPairs.length) {
    lines.push('No exact owner-to-new-module function moves were detected.');
  } else {
    lines.push('| Before owner | After extracted module | Functions moved | Match |', '|---|---|---|---|');
    report.splitPairs.forEach((entry) => {
      lines.push(`| \`${escapeCell(entry.owner)}\` | \`${escapeCell(entry.destination)}\` | ${escapeCell(codeList(entry.functions))} | ${entry.confidence} |`);
    });
  }

  const nameOnlyMoves = report.movedFunctions.filter((entry) => entry.confidence === 'name-only');
  lines.push('', '## Moves requiring manual review', '');
  if (!nameOnlyMoves.length) {
    lines.push('None. All detected moves matched the function body, not only the function name.');
  } else {
    lines.push('| Before | Candidate after | Function | Public API preserved? |', '|---|---|---|---|');
    nameOnlyMoves.forEach((entry) => {
      lines.push(`| \`${entry.owner}:${entry.beforeLine}\` | \`${entry.destination}:${entry.afterLine}\` | \`${entry.name}\` | ${entry.apiPreserved ? 'yes' : 'no'} |`);
    });
  }

  lines.push('', '## Removed functions not located after the split', '');
  if (!report.missingFunctions.length) {
    lines.push('None.');
  } else {
    lines.push('| Before location | Function | Scope | Previously exported | Classification |', '|---|---|---|---|---|');
    report.missingFunctions.forEach((entry) => {
      lines.push(`| \`${entry.owner}:${entry.beforeLine}\` | \`${entry.name}\` | ${entry.scope ? `\`${entry.scope}\`` : 'top level'} | ${codeList(entry.publicNames)} | ${entry.classification} |`);
    });
  }

  lines.push('', '## Ambiguous function move candidates', '');
  if (!report.duplicateMovedBodies.length) {
    lines.push('None.');
  } else {
    lines.push('These are same-name or same-body callbacks with more than one reachable extracted destination; inspect the listed call sites rather than assuming a duplicate export.', '');
    report.duplicateMovedBodies.forEach((entry) => {
      lines.push(`- \`${entry.owner}:${entry.beforeLine}\` \`${entry.name}\` (${entry.confidence}): ${entry.locations.map((location) => `\`${location.filePath}:${location.line}\``).join(', ')}`);
    });
  }

  lines.push('', '## New modules with no static inbound import/re-export', '');
  if (!report.orphanAddedModules.length) {
    lines.push('None.');
  } else {
    lines.push('These may be runtime entrypoints or intentionally unused work in progress; verify each one.', '');
    lines.push('| Module | Exports | Named functions |', '|---|---|---|');
    report.orphanAddedModules.forEach((entry) => {
      lines.push(`| \`${entry.filePath}\` | ${escapeCell(codeList(entry.exports))} | ${escapeCell(codeList(entry.functions))} |`);
    });
  }

  lines.push('', '## Changed owner dependencies', '');
  if (!report.dependencyChanges.length) {
    lines.push('None.');
  } else {
    lines.push('| Owner | Added dependencies | Removed dependencies |', '|---|---|---|');
    report.dependencyChanges.forEach((entry) => {
      lines.push(`| \`${entry.filePath}\` | ${escapeCell(codeList(entry.added))} | ${escapeCell(codeList(entry.removed))} |`);
    });
  }

  lines.push('', '## After-split import/export inventory', '');
  report.splitInventory.forEach((entry) => {
    lines.push(
      `### ${entry.filePath}`,
      '',
      `- Change: ${entry.change}`,
      `- Exports: ${codeList(entry.exports)}`,
      `- Static inbound consumers: ${entry.inbound.length ? codeList(entry.inbound.map((edge) => edge.from)) : 'none'}`,
      '- Local dependencies:'
    );
    if (!entry.imports.length) {
      lines.push('  - none');
    } else {
      entry.imports.forEach((edge) => {
        const bindings = edge.bindings.length ? ` — ${codeList(edge.bindings)}` : '';
        lines.push(`  - \`${edge.target}\` (${edge.kind}, line ${edge.line})${bindings}`);
      });
    }
    lines.push('- Named functions:');
    if (!entry.functions.length) {
      lines.push('  - none');
    } else {
      entry.functions.forEach((fn) => {
        lines.push(`  - \`${fn.name}\` — line ${fn.line}${fn.scope ? `, inside \`${fn.scope}\`` : ''}`);
      });
    }
    lines.push('');
  });

  lines.push(
    '## Analyzer scope',
    '',
    '- Parses ESM imports, exports, named re-exports, `export *`, CommonJS `require`, and common `module.exports` forms.',
    '- Function moves are exact when normalized function bodies match; name-only matches are kept separate for manual review.',
    '- Dynamic computed imports, runtime plugin loading, and export mutation cannot always be proven statically.',
    '- The JSON companion contains the complete machine-readable findings; the DOT companion contains the split-file dependency graph.',
    ''
  );
  return lines.join('\n');
}

function renderDot(report) {
  const addedFiles = new Set(report.fileChanges.added);
  const changedOwners = new Set(report.dependencyChanges.map((entry) => entry.filePath));
  const lines = [
    'digraph split_dependencies {',
    '  rankdir=LR;',
    '  compound=true;',
    '  graph [fontname="Helvetica", fontsize=11];',
    '  node [shape=box, fontname="Helvetica", fontsize=8];',
    '  edge [color="#78909c", arrowsize=0.6];'
  ];

  const renderCluster = ({ prefix, label, edgeRecords, after = false }) => {
    const nodes = new Set();
    const edges = new Map();
    edgeRecords.forEach(({ from, to, bindings = [] }) => {
      if (!from || !to) return;
      nodes.add(from);
      nodes.add(to);
      const key = `${from}->${to}`;
      if (!edges.has(key)) edges.set(key, { from, to, bindings: new Set() });
      bindings.forEach((binding) => edges.get(key).bindings.add(binding));
    });
    lines.push(`  subgraph ${JSON.stringify(`cluster_${prefix}`)} {`, `    label=${JSON.stringify(label)};`);
    [...nodes].sort().forEach((filePath) => {
      const fill = after && addedFiles.has(filePath)
        ? '#e8f5e9'
        : (changedOwners.has(filePath) ? '#fff3e0' : '#f5f5f5');
      lines.push(`    ${JSON.stringify(`${prefix}:${filePath}`)} [label=${JSON.stringify(filePath)}, style=filled, fillcolor=${JSON.stringify(fill)}];`);
    });
    edges.forEach((edge) => {
      const labelText = [...edge.bindings].sort().join(', ');
      const attributes = labelText ? ` [label=${JSON.stringify(labelText)}, fontsize=7]` : '';
      lines.push(`    ${JSON.stringify(`${prefix}:${edge.from}`)} -> ${JSON.stringify(`${prefix}:${edge.to}`)}${attributes};`);
    });
    lines.push('  }');
  };

  renderCluster({
    prefix: 'before',
    label: `Before: ${report.baselineRef}`,
    edgeRecords: report.dependencyChanges.flatMap((entry) => (
      entry.before.map((to) => ({ from: entry.filePath, to }))
    ))
  });
  renderCluster({
    prefix: 'after',
    label: 'After: current working tree',
    after: true,
    edgeRecords: [
      ...report.dependencyChanges.flatMap((entry) => (
        entry.after.map((to) => ({ from: entry.filePath, to }))
      )),
      ...report.splitEdges
    ]
  });
  lines.push('}', '');
  return lines.join('\n');
}

function renderFunctionCsv(report) {
  const csvCell = (value) => {
    const text = Array.isArray(value) ? value.join('; ') : String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const rows = [[
    'before_owner',
    'before_line',
    'function',
    'scope',
    'after_destination',
    'after_line',
    'match',
    'previous_exports',
    'api_preserved',
    'classification'
  ]];
  report.movedFunctions.forEach((entry) => rows.push([
    entry.owner,
    entry.beforeLine,
    entry.name,
    entry.scope,
    entry.destination,
    entry.afterLine,
    entry.confidence,
    entry.publicNames,
    entry.apiPreserved,
    ''
  ]));
  report.missingFunctions.forEach((entry) => rows.push([
    entry.owner,
    entry.beforeLine,
    entry.name,
    entry.scope,
    '',
    '',
    'not located',
    entry.publicNames,
    entry.apiPreserved,
    entry.classification
  ]));
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

export { renderDot, renderFunctionCsv, renderMarkdown };
