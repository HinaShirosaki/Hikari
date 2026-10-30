// Fictional fixtures for the website's Agent screenshots (trial-app.html?feature=agent-…&capture=1).
// No live model is connected, so each scene's model replies are written here in the shapes the
// desktop bridge returns. Hikari's real renderer parses, stores, and draws all of it.
(function (root) {
  'use strict';
  const SCENES = ['agent-protocols', 'agent-insights', 'agent-papers', 'agent-plot', 'agent-review'];
  const VIEWS = { 'agent-protocols': 'protocol-management-view', 'agent-insights': 'protocol-management-view',
    'agent-papers': 'papers-view', 'agent-plot': 'assay-view', 'agent-review': 'biology-notebook-view' };

  // A rough draft as someone might type it at the bench, then the polished version the model returns.
  const roughProtocol = {
    name: 'his tag purification', category: 'Example methods',
    purpose: 'get the enzyme out of the lysate using the his tag',
    materials: ['lysate from 50 ml culture', 'ni-nta resin 1 ml', 'wash buffer 20mM imidazole', 'elution buffer 250 mM imidazole'],
    steps: ['spin lysate 20 min to clear it', 'put lysate on the resin and mix 30 min in the cold',
      'wash with wash buffer 3 times', 'elute with elution buffer, collect 0.5 ml fractions', 'check the fractions on a gel'],
    troubleshooting: 'if protein is in the flowthrough mix longer'
  };
  const polishedProtocol = {
    name: 'His-Tag Purification on Ni-NTA Resin', category: 'Example methods',
    purpose: 'Purify a His6-tagged enzyme from clarified cell lysate by immobilized metal affinity chromatography.',
    materials: ['Cell lysate from a 50 mL culture', 'Ni-NTA resin, 1 mL bed volume', 'Wash buffer with 20 mM imidazole', 'Elution buffer with 250 mM imidazole'],
    steps: ['Clarify the lysate by centrifugation for 20 min.', 'Apply the cleared lysate to the resin and mix gently for 30 min in the cold.',
      'Wash the resin three times with wash buffer.', 'Elute with elution buffer and collect 0.5 mL fractions.', 'Analyze the fractions by SDS-PAGE.'],
    troubleshooting: 'If the target protein appears in the flow-through, extend the binding step.'
  };
  const asRecord = (id, source, now, extra = {}) => ({ id, ...structuredClone(source),
    steps: source.steps.map((text, i) => ({ id: `${id}-step-${i}`, text, placeholders: [] })), createdAt: now, updatedAt: now, ...extra });

  // Product thumbnails are drawn here: no vendor artwork or real product pages.
  const bottle = (hue, label) => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="18" fill="hsl(${hue},40%,94%)"/><rect x="60" y="24" width="40" height="18" rx="4" fill="hsl(${hue},35%,38%)"/><path d="M52 50h56v80a10 10 0 0 1-10 10H62a10 10 0 0 1-10-10Z" fill="#fff" stroke="hsl(${hue},30%,70%)" stroke-width="3"/><rect x="58" y="78" width="44" height="30" rx="3" fill="hsl(${hue},45%,82%)"/><text x="80" y="98" font-family="Helvetica,Arial,sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="hsl(${hue},40%,28%)">${label}</text></svg>`);
  const imidazoleInsight = (now) => ({
    id: 'demo-insight-imidazole', segmentId: 'protocol:material:3', segmentLabel: 'Material 3', selectedText: 'imidazole', occurrenceIndex: 1,
    contextText: 'Wash buffer with 20 mM imidazole', createdAt: now, updatedAt: now,
    answers: {
      what_is_it: { actionType: 'what_is_it', status: 'completed', requestedAt: now, answeredAt: now, summary: '', payload: null, error: '',
        text: 'Imidazole competes with the histidine tag for the nickel ions on the resin. At 20 mM it washes off weakly bound host proteins while the tagged enzyme stays bound; the 250 mM elution buffer then releases it.' },
      where_to_buy: { actionType: 'where_to_buy', status: 'completed', requestedAt: now, answeredAt: now, text: '', error: '',
        summary: 'Reagent-grade imidazole (≥99%) works for both buffers. Choose a low-UV grade if you read fractions at 280 nm.',
        payload: { summary: '', items: [
          { title: 'Imidazole, ≥99%, 100 g', vendor: 'Northwind Lab Supply · example', price_text: '$42.00', product_url: '', image_url: bottle(210, 'IMID') },
          { title: 'Imidazole, low UV absorbance, 250 g', vendor: 'Bench Reagents Co. · example', price_text: '$78.50', product_url: '', image_url: bottle(150, 'IMID') }
        ] } }
    }
  });

  // The paper is a two-page synthetic PDF in fixtures/; its record carries the saved analysis.
  const PAPER_PATH = '/demo/hikari/Papers/example-lipase-salt-bridges.pdf';
  const paper = (project, now) => ({
    id: 'demo-paper-lipase', title: 'Surface salt bridges raise the thermal stability of an example lipase',
    fileName: 'example-lipase-salt-bridges.pdf', pdfDataUrl: '', storedFilePath: PAPER_PATH, storedRelativePath: '',
    linkedType: 'project', linkedId: project.id, linkedName: project.name, doi: '', url: '',
    authors: ['Example Research Group'], journal: 'Illustrative preprint · synthetic data', year: 2026,
    summary: 'Two engineered salt bridges on the lid domain raised the melting temperature of an example lipase by 6.4 °C without lowering activity. Thermal shift, residual activity, and a short heat challenge agreed.',
    summaryStructured: { question: 'Do surface salt bridges stabilize the example lipase without costing activity?', answer: 'Yes. Variant A melts 6.4 °C higher than wild type and keeps full activity at 37 °C.' },
    summaryStatus: 'complete',
    methodsExtract: ['His6-tagged variants purified on Ni-NTA resin and desalted.', 'Thermal shift assay at 1 °C/min in triplicate, with wild-type, buffer-only, and no-dye controls.', 'Residual activity measured after 10 min at each temperature.'],
    methodsStatus: 'complete', keyReagents: ['Ni-NTA resin', 'Imidazole', 'Fluorescent protein dye', 'p-Nitrophenyl butyrate'], reagentsStatus: 'complete',
    keyFigures: [{ label: 'Fig. 1', summary: 'Melting curves for wild type and two variants.' }, { label: 'Fig. 2', summary: 'Residual activity after heating.' }],
    highlights: ['+6.4 °C Tm', 'Activity retained', 'Three assay controls'], comments: [], deepReadReady: true,
    availabilityStatus: 'available', discoverySource: 'agent', createdAt: now, updatedAt: now
  });

  const codexRows = (rows) => rows.map(([kind, text]) => ({ stage: 'codex_cli_display', routing_intent: 'codex_agent', kind, stream: '', text }));
  const codex = (answer, rows, extra = {}) => ({ parser: { primary_intent: 'codex_agent' },
    codex_agent: { status: 'completed', answer, follow_up_questions: [], user_question: null, citations: [] },
    codex_cli_display_rows: codexRows(rows), ...extra });
  const chat = (messages, now) => ({ projectId: 'demo-project', currentSessionId: '', sessions: [],
    messages: messages.map(([role, text, meta], i) => ({ id: `demo-agent-message-${i}`, role, text, ...(meta ? { meta } : {}), timestamp: now })) });

  // Inhibitor dose response: a 12-point, 2-fold dilution from 50 µM across the plate columns,
  // with a four-parameter logistic fall-off around each variant's IC50 (µM).
  const doses = Array.from({ length: 12 }, (_, c) => +(50 / 2 ** c).toPrecision(3));
  const variants = [['Wild type', 0.85, ['A', 'B']], ['Variant A', 3.2, ['C', 'D']], ['Variant B', 1.6, ['E', 'F']]];
  const activity = (dose, ic50, wobble) => Math.max(1, 2 + 98 / (1 + (dose / ic50) ** 1.2) + wobble);
  function assay(project, now) {
    const sampleAxisValues = ['Wild type', 'Wild type', 'Variant A', 'Variant A', 'Variant B', 'Variant B', 'No enzyme', 'No enzyme'];
    const wellLayout = [], resultValues = {};
    'ABCDEFGH'.split('').forEach((row, r) => doses.forEach((dose, c) => {
      const well = `${row}${c + 1}`;
      wellLayout.push({ well, sampleId: sampleAxisValues[r], concentration: String(dose) });
      const variant = variants.find(([, , rows]) => rows.includes(row));
      resultValues[well] = variant ? activity(dose, variant[1], ((r * 7 + c * 5) % 5 - 2) * 0.9).toFixed(1) : (0.6 + ((c * 3) % 4) * 0.2).toFixed(1);
    }));
    return { id: 'demo-assay-inhibition', assayNumber: 1, name: 'Inhibitor dose response', projectId: project.id, projectName: project.name,
      plateType: '96', sampleAxis: 'row', concentrationAxis: 'column', sampleAxisValues, concentrationAxisValues: doses.map(String), concentrationUnit: 'µM',
      wellLayout, resultValues, manualWellOverrides: {}, suppressedWells: [], createdAt: now, updatedAt: now };
  }
  function doseResponseFigure(values) {
    const palette = ['#7d8794', '#4169d8', '#d9822b'];
    const fine = Array.from({ length: 81 }, (_, i) => 10 ** (-1.75 + i * 0.045));
    const data = [];
    variants.forEach(([name, ic50, rows], v) => {
      const means = doses.map((dose, c) => rows.reduce((sum, row) => sum + Number(values[`${row}${c + 1}`]), 0) / rows.length);
      data.push({ type: 'scatter', mode: 'markers', name, x: doses, y: means.map(m => +m.toFixed(1)), marker: { color: palette[v], size: 8 }, legendgroup: name });
      data.push({ type: 'scatter', mode: 'lines', name: `${name} fit`, x: fine, y: fine.map(dose => +activity(dose, ic50, 0).toFixed(2)),
        line: { color: palette[v], width: 2 }, legendgroup: name, showlegend: false, hoverinfo: 'skip' });
    });
    // Keep the figure uncluttered; the assay name and chat provide its context.
    // Log10 concentration axis with one label per power of ten, as Hikari's own charts draw it.
    return { data, layout: { height: 390,
      xaxis: { type: 'log', dtick: 1, title: { text: 'Inhibitor (µM)' }, range: [-1.78, 1.84] }, yaxis: { title: { text: 'Activity (%)' }, range: [0, 110] },
      legend: { x: 0.98, y: 0.98, xanchor: 'right', yanchor: 'top' }, margin: { t: 16, r: 16, b: 56, l: 64 } } };
  }

  root.HikariAgentScenes = { SCENES, VIEWS, build(feature, { now, project }) {
    const scene = { protocols: [], notebookEntries: [], papers: [], assays: [], paperAgentChatSessions: {}, llm: {}, files: {}, startView: VIEWS[feature] };
    if (feature === 'agent-protocols') {
      scene.protocols.push(asRecord('demo-protocol-rough', roughProtocol, now));
      scene.llm['protocol-polish'] = JSON.stringify({ ...polishedProtocol, category: undefined });
    }
    if (feature === 'agent-insights') {
      scene.protocols.push(asRecord('demo-protocol-his', polishedProtocol, now, { selectionInsights: [imidazoleInsight(now)] }));
    }
    if (feature === 'agent-papers') {
      scene.papers.push(paper(project, now));
      scene.files[PAPER_PATH] = '../fixtures/example-lipase-salt-bridges.pdf';
      scene.paperAgentChatSessions['paper:demo-paper-lipase'] = chat([
        ['user', 'Find recent papers on stabilizing lipases with surface salt bridges.'],
        ['assistant', 'I found three papers in the paper database. The closest match is open now:\n\n1. **Surface salt bridges raise the thermal stability of an example lipase** · Example Research Group, 2026\n2. Charge networks and unfolding kinetics in lipase variants · Example Structural Biology Lab, 2025\n3. Screening thermostable enzymes by differential scanning fluorimetry · Example Methods Group, 2024',
          codex('Found three papers.', [['assistant', 'Searching the paper database for lipase salt-bridge stabilization.'],
            ['command', 'mcp__hikari__literature_search {"query":"lipase surface salt bridge thermostability","limit":3}'], ['tool', 'literature_search completed · 3 papers']])],
        ['user', 'What controls did they use for the thermal shift assay?'],
        ['assistant', 'Three controls, described in Methods on page 2:\n\n- **Wild-type enzyme** on every plate, as the reference melt.\n- **Buffer with dye and no protein**, to set the fluorescence baseline.\n- **Protein without dye**, to rule out intrinsic fluorescence.\n\nEach variant ran in triplicate, and Tm was taken at the maximum of the first derivative.',
          codex('Three controls.', [['tool', 'paper_read completed · Methods, page 2']])]
      ], now);
    }
    if (feature === 'agent-plot') {
      const plate = assay(project, now);
      scene.assays.push(plate);
      scene.plot = { type: 'plotly_graph', tool_name: 'plotly_graph', status: 'completed', id: 'demo-plot-inhibition', name: 'Inhibitor dose response · 4PL fit',
        summary: 'Means of duplicate wells with a four-parameter logistic fit for each variant.', figure: doseResponseFigure(plate.resultValues) };
      scene.paperAgentChatSessions['assay:demo-assay-inhibition'] = chat([
        ['user', 'Plot activity against inhibitor concentration for each variant, with a 4PL fit and the IC50s.'],
        ['assistant', 'Plotted the duplicate means on a log concentration axis with a four-parameter logistic fit for each variant. IC50: wild type **0.85 µM**, Variant B 1.6 µM, and Variant A **3.2 µM**, about four times wild type.',
          codex('Plotted three variants.', [['tool', 'assay_results_read completed · 96 wells'], ['tool', 'plotly_graph completed']])]
      ], now);
    }
    if (feature === 'agent-review') {
      scene.notebookEntries.push({ id: 'demo-review-page', notebookType: 'biology', projectId: project.id, projectName: project.name,
        protocolId: 'demo-protocol', protocolName: 'Protein comparison', experimentName: 'Thermal shift · Variant A vs wild type', experimentNameSource: 'manual',
        values: {}, result: 'Variant A melted at 59.4 °C and wild type at 53.0 °C on one example plate. A single preparation of each.',
        resultTables: [], sampleLinks: [], resultFiles: [], createdAt: now, updatedAt: now, notebookState: 'executed' });
      scene.openEntry = 'demo-review-page';
      scene.paperAgentChatSessions['notebook:demo-review-page'] = chat([
        ['user', 'Plan a repeat with a fresh preparation, and write the melt as a reusable protocol.'],
        ['assistant', 'I drafted a notebook page for the repeat and a protocol for the melt. Review each one; nothing is saved until you approve it.', {
          notebookDrafts: [{ notebook_type: 'biology', project: { id: project.id, name: project.name }, protocol: { id: 'demo-protocol', name: 'Protein comparison' },
            proposal: { proposal_id: 'demo-draft-repeat', title: 'Repeat thermal shift with a fresh preparation',
              purpose: 'Confirm the 6.4 °C shift for Variant A on an independent preparation.',
              rationale: 'The shift comes from one plate and one preparation of each enzyme. A fresh preparation tells you whether it holds before you pick a lead.',
              planned_materials: ['Fresh Variant A preparation', 'Wild-type reference', 'Protein dye', 'Example buffer'],
              checkpoints: ['Match protein concentrations before the melt', 'Triplicate wells for each sample'] },
            rendered_steps: ['Purify a fresh Variant A preparation.', 'Match both proteins to the same concentration.', 'Run the melt in triplicate with wild type on the same plate.', 'Compare Tm values with the first run.'],
            save: { mode: 'confirm_before_save' },
            entry_template: { experimentName: 'Repeat thermal shift with a fresh preparation', notebookState: 'planned', result: '' } }],
          protocol_generation: { protocol: { name: 'Thermal shift melt (protein dye)', purpose: 'Measure protein melting temperature from dye fluorescence during a temperature ramp.',
            materials: ['Purified protein', 'Protein dye', 'Example buffer', 'qPCR plate and seal'],
            steps: ['Dilute each protein to the same concentration in buffer.', 'Add dye and mix; keep triplicate wells for each sample.', 'Include buffer-with-dye and protein-without-dye controls.',
              'Ramp from 25 °C to 95 °C at 1 °C/min while recording fluorescence.', 'Take Tm at the maximum of the first derivative.'] } } }]
      ], now);
    }
    return scene;
  } };
})(typeof window === 'undefined' ? globalThis : window);
