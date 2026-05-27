function buildAgentSimulationSnapshot() {
  return {
    projects: [
      { id: 'project-atlas', name: 'Atlas', summary: 'PD-1 binder optimization and expression rescue.' },
      { id: 'project-mercury', name: 'Mercury', summary: 'Secondary screening workflow.' }
    ],
    protocols: [
      {
        id: 'protocol-transfection',
        name: 'HEK293 Transfection',
        category: 'cell',
        steps: ['Seed cells', 'Mix DNA and reagent', 'Incubate for [time]']
      },
      {
        id: 'protocol-assay',
        name: 'ELISA Workflow',
        category: 'assay',
        steps: ['Prepare plate', 'Add samples', 'Read plate']
      }
    ],
    notebookEntries: [
      {
        id: 'note-1',
        projectId: 'project-atlas',
        protocolId: 'protocol-transfection',
        protocolName: 'HEK293 Transfection',
        result: 'Expression dropped after day 3.',
        updatedAt: '2026-02-10T10:00:00.000Z'
      }
    ],
    workflows: [
      {
        id: 'workflow-1',
        name: 'Atlas Transfection Recovery',
        description: 'Rescue expression workflow after transfection.',
        projectId: 'project-atlas',
        notebookEntryIds: ['note-1'],
        blocks: [
          { id: 'wf-1-b1', protocolId: 'protocol-transfection' },
          { id: 'wf-1-b2', type: 'text', text: 'Check viability after 24 hours.' }
        ],
        links: [{ fromBlockId: 'wf-1-b1', toBlockId: 'wf-1-b2' }],
        updatedAt: '2026-02-10T09:00:00.000Z'
      },
      {
        id: 'workflow-2',
        name: 'Mercury ELISA Sweep',
        description: 'Secondary screen assay workflow.',
        projectId: 'project-mercury',
        notebookEntryIds: [],
        blocks: [
          { id: 'wf-2-b1', protocolId: 'protocol-assay' }
        ],
        links: [],
        updatedAt: '2026-02-08T09:00:00.000Z'
      }
    ],
    assays: [
      {
        id: 'assay-1',
        assay_number: 'ASSAY-101',
        name: 'PD-1 Viability',
        project_name: 'Atlas',
        notebook_entry_protocol_name: 'HEK293 Transfection',
        sample_axis: 'row',
        concentration_axis: 'column',
        result_well_count: 96,
        numeric_count: 96,
        updated_at: '2026-02-10T11:00:00.000Z'
      }
    ],
    gelAnalyses: [
      {
        id: 'gel-1',
        name: 'Western Atlas 1',
        analysis_type: 'western',
        project_name: 'Atlas',
        notebook_entry_protocol_name: 'HEK293 Transfection',
        image_name: 'atlas-western-1.tiff',
        lane_count: 8,
        band_count: 20,
        confidence_label: 'high',
        confidence_score: 0.91,
        warnings: ['Minor background noise'],
        updated_at: '2026-02-10T12:00:00.000Z'
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'PD-1 Binder Design 2025',
        linkedType: 'project',
        linkedId: 'project-atlas',
        summary: 'Discusses expression bottlenecks and rescue strategies.',
        methods: [
          {
            title: 'Transfection method',
            steps: ['Culture cells', 'Transfect', 'Measure expression'],
            citations: ['doi:10.1000/pd1']
          }
        ]
      }
    ],
    inventory: {
      personal: [
        {
          zone: 'Bench',
          items: [{ id: 'pi-1', name: 'PD-1 plasmid', quantity: '2', location: 'Box A1' }]
        }
      ],
      chemicals: [
        { id: 'chem-1', name: 'Biotin', amount: '10 g', cas: '58-85-5', location: 'Shelf 2', supplier: 'Sigma' },
        { id: 'chem-2', name: 'Imidazole', amount: '500 g', cas: '288-32-4', location: 'Shelf 4', supplier: 'TCI' }
      ]
    },
    settings: {
      storagePath: '/tmp/enana-storage'
    }
  };
}

module.exports = {
  buildAgentSimulationSnapshot
};
