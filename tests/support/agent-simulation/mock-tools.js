function pickMockRows(rows, projector, query, limit = 5) {
  const source = Array.isArray(rows) ? rows : [];
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) {
    return source.slice(0, limit);
  }
  const tokens = needle.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter(Boolean);
  return source
    .filter((item) => {
      const target = String(projector(item) || '').toLowerCase();
      if (!tokens.length) {
        return target.includes(needle);
      }
      return tokens.some((token) => token.length >= 2 && target.includes(token));
    })
    .slice(0, limit);
}

function buildMockToolArgs(toolName, message, snapshot) {
  if (toolName === 'toolbox_molarity_calculator') {
    return {
      operation: 'mass_from_concentration_volume',
      concentration_value: 10,
      concentration_unit: 'mM',
      volume_value: 5,
      volume_unit: 'mL',
      molecular_weight_g_mol: 58.44,
      output_unit: 'mg'
    };
  }
  if (toolName === 'toolbox_peptide_properties') {
    return { sequence_text: 'ACDEFGHIKLMNPQRSTVWY', ph: 7 };
  }
  if (toolName === 'toolbox_buffer_preparer') {
    return {
      volume_ml: 1000,
      components: [
        { name: 'NaCl', form: 'solid', molecular_weight_g_mol: 58.44, concentration_value: 150, concentration_unit: 'mM' },
        { name: 'Tween-20', form: 'liquid', concentration_value: 0.05, concentration_unit: 'percent_vv' }
      ]
    };
  }
  if (toolName === 'toolbox_dna_to_protein') {
    return {
      sequence_text: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG',
      sequence_type: 'DNA',
      frame: 1,
      stop_mode: 'star'
    };
  }
  if (toolName === 'toolbox_protein_to_dna') {
    return {
      protein_sequence: 'MKTIIALSYIFCLVFA',
      organism: 'ecoli',
      append_stop_codon: true,
      restriction_sites: ['GAATTC', 'AAGCTT']
    };
  }
  if (toolName === 'toolbox_oligo_properties') {
    return { sequence_text: 'ATGCGTATCGAT', oligo_type: 'DNA' };
  }
  if (toolName === 'toolbox_extinction_coefficient') {
    return { sequence_type: 'protein', sequence_text: 'MKWVTFISLLFLFSSAYS' };
  }
  if (toolName === 'toolbox_qpcr_efficiency') {
    return {
      points: [
        { quantity: 1, ct: 18.0 },
        { quantity: 0.1, ct: 21.3 },
        { quantity: 0.01, ct: 24.7 }
      ]
    };
  }
  if (toolName === 'toolbox_crispr_sgrna_designer') {
    return {
      targets_text: '>Target_A\\nGAGTCCGAGCAGAAGAAGAAGGGGAGGAGGAGGAGGAGGA',
      reference_genome_id: 'human-hg38',
      pam_pattern: 'NGG',
      guide_length: 20,
      top_count: 5,
      min_gc: 35,
      max_gc: 75
    };
  }
  if (toolName === 'run_python_sandbox') {
    return {
      code: 'import math\nprint(round((2 + 8) / 2, 2))',
      timeout_ms: 1200,
      files: [],
      readback_paths: []
    };
  }
  if (toolName === 'download_paper_pdf') {
    return {
      linked_type: 'project',
      linked_name: snapshot.projects[0]?.name || 'Atlas',
      paper_pdf_url: 'https://example.org/paper.pdf',
      paper_file_name: 'atlas-paper.pdf',
      storage_path: snapshot.settings?.storagePath || '/tmp/enana-storage'
    };
  }
  return {
    query: String(message || 'atlas'),
    limit: 5
  };
}

function buildMockToolDispatch(snapshot) {
  const calls = [];
  const handlers = {
    search_projects: (args) => {
      const items = pickMockRows(snapshot.projects, (item) => `${item.name} ${item.summary}`, args?.query, args?.limit)
        .map((item) => ({ id: item.id, name: item.name, summary: item.summary }));
      return {
        items,
        citations: items.map((item) => ({ source: 'project', pointer: item.id, reason: 'Matched project metadata.' })),
        summary: `Found ${items.length} matching projects.`
      };
    },
    search_protocols: (args) => {
      const items = pickMockRows(
        snapshot.protocols,
        (item) => `${item.name} ${item.category} ${(item.steps || []).join(' ')}`,
        args?.query,
        args?.limit
      ).map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        steps: Array.isArray(item.steps) ? item.steps : []
      }));
      return {
        items,
        citations: items.map((item) => ({ source: 'protocol', pointer: item.id, reason: 'Matched protocol name/steps.' })),
        summary: `Found ${items.length} matching protocols.`
      };
    },
    search_notebook_entries: (args) => {
      const items = pickMockRows(
        snapshot.notebookEntries,
        (item) => `${item.protocolName} ${item.result} ${item.updatedAt}`,
        args?.query,
        args?.limit
      ).map((item) => ({
        id: item.id,
        protocolName: item.protocolName,
        result: item.result,
        updatedAt: item.updatedAt
      }));
      return {
        items,
        citations: items.map((item) => ({ source: 'notebook_entry', pointer: item.id, reason: 'Matched notebook records.' })),
        summary: `Found ${items.length} matching notebook entries.`
      };
    },
    search_workflows: (args) => {
      const items = pickMockRows(
        snapshot.workflows,
        (item) => [item.name, item.description, (item.blocks || []).map((block) => block.text || block.protocolId).join(' ')].join(' '),
        args?.query,
        args?.limit
      ).map((item) => {
        const project = (snapshot.projects || []).find((row) => row.id === item.projectId);
        return {
          id: item.id,
          name: item.name,
          project_name: project?.name || '',
          description: item.description || '',
          block_count: Array.isArray(item.blocks) ? item.blocks.length : 0,
          link_count: Array.isArray(item.links) ? item.links.length : 0,
          steps_preview: (item.blocks || []).map((block) => String(block?.text || block?.protocolId || '').trim()).filter(Boolean).slice(0, 8),
          updated_at: item.updatedAt || item.createdAt || ''
        };
      });
      return {
        items,
        citations: items.map((item) => ({ source: 'workflow', pointer: item.id, reason: 'Matched workflow metadata.' })),
        summary: `Found ${items.length} matching workflows.`
      };
    },
    search_assays: (args) => ({
      items: pickMockRows(
        snapshot.assays,
        (item) => `${item.name} ${item.project_name} ${item.notebook_entry_protocol_name}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item })),
      citations: [],
      summary: 'Found assay matches.'
    }),
    search_gel_analyses: (args) => ({
      items: pickMockRows(
        snapshot.gelAnalyses,
        (item) => `${item.name} ${item.project_name} ${item.notebook_entry_protocol_name}`,
        args?.query,
        args?.limit
      ).map((item) => ({ ...item })),
      citations: [],
      summary: 'Found gel analysis matches.'
    }),
    search_inventory: (args) => {
      const merged = [
        ...(snapshot.inventory?.chemicals || []).map((item) => ({ kind: 'chemical_inventory', ...item })),
        ...((snapshot.inventory?.personal || []).flatMap((zone) => (
          (zone.items || []).map((item) => ({ kind: 'personal_inventory', zone: zone.zone, ...item }))
        )))
      ];
      return {
        items: pickMockRows(
          merged,
          (item) => `${item.name} ${item.cas || ''} ${item.location || ''} ${item.supplier || ''}`,
          args?.query,
          args?.limit
        ).map((item) => ({ ...item })),
        citations: [],
        summary: 'Found inventory matches.'
      };
    },
    search_papers: (args) => ({
      items: pickMockRows(snapshot.papers, (item) => `${item.title} ${item.summary}`, args?.query, args?.limit).map((item) => ({ ...item })),
      citations: [],
      summary: 'Found paper matches.'
    }),
    search_uniprot: () => ({ items: [{ accession: 'P12345' }], citations: [], summary: 'Found 1 matching UniProt records.' }),
    search_pubmed: () => ({ items: [{ pmid: '12345678' }], citations: [], summary: 'Found 1 matching PubMed records.' }),
    search_crossref: () => ({ items: [{ doi: '10.1000/crossref' }], citations: [], summary: 'Found 1 matching Crossref records.' }),
    search_europe_pmc: () => ({ items: [{ id: 'PMC1234567' }], citations: [], summary: 'Found 1 matching Europe PMC records.' }),
    search_web: () => ({ items: [{ title: 'PD-1 review article' }], citations: [], summary: 'Found 1 matching web source.' }),
    toolbox_molarity_calculator: () => ({ items: [{ operation: 'mass_from_concentration_volume', result_value: 2.922 }], citations: [], summary: 'Calculated mass from concentration and volume in mg.' }),
    toolbox_peptide_properties: () => ({ items: [{ sequence: 'ACDEFGHIKLMNPQRSTVWY', length: 20 }], citations: [], summary: 'Computed peptide properties for 20 residues.' }),
    toolbox_buffer_preparer: () => ({ items: [{ name: 'NaCl' }, { name: 'Tween-20' }], citations: [], summary: 'Calculated 2 buffer components.' }),
    toolbox_dna_to_protein: () => ({ items: [{ sequence_type: 'DNA', codons: 13 }], citations: [], summary: 'Translated 13 codons in frame +1.' }),
    toolbox_protein_to_dna: () => ({ items: [{ ok: true, nt_length: 51 }], citations: [], summary: 'Reverse-translated protein to 51 bp DNA.' }),
    toolbox_oligo_properties: () => ({ items: [{ oligo_type: 'DNA', length: 12 }], citations: [], summary: 'Computed oligo properties for 12 nt (DNA).' }),
    toolbox_extinction_coefficient: () => ({ items: [{ sequence_type: 'protein', length: 18 }], citations: [], summary: 'Computed protein extinction coefficient for 18 residues.' }),
    toolbox_qpcr_efficiency: () => ({ items: [{ efficiency_percent: 100.4 }], citations: [], summary: 'Computed qPCR efficiency as 100.40%.' }),
    toolbox_crispr_sgrna_designer: () => ({ items: [{ rank: 1 }], citations: [], summary: 'Designed 1 sgRNA candidate from 1 selected target.' }),
    run_python_sandbox: () => ({ items: [{ run_id: 'sandbox-run-1', stdout: '5.0' }], citations: [], summary: 'Python sandbox execution completed.' }),
    download_paper_pdf: (args) => ({
      items: [{ relative_path: `${String(args?.linked_name || 'Atlas')}/Papers/${String(args?.paper_file_name || 'paper.pdf')}` }],
      citations: [],
      summary: 'Downloaded 1 paper PDF and 0 SI PDF(s).'
    })
  };

  const dispatch = async (toolName, args) => {
    calls.push({ toolName, args: args && typeof args === 'object' ? { ...args } : {} });
    const handler = handlers[toolName];
    if (!handler) {
      throw new Error(`Unexpected tool in mock dispatch: ${toolName}`);
    }
    const raw = handler(args || {});
    return {
      ok: true,
      tool_name: toolName,
      input: args && typeof args === 'object' ? { ...args } : {},
      items: Array.isArray(raw?.items) ? raw.items : [],
      citations: Array.isArray(raw?.citations) ? raw.citations : [],
      summary: String(raw?.summary || '')
    };
  };

  return {
    dispatch,
    calls,
    coveredToolNames: new Set(Object.keys(handlers))
  };
}

module.exports = {
  pickMockRows,
  buildMockToolArgs,
  buildMockToolDispatch
};
