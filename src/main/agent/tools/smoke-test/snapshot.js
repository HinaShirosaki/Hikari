'use strict';

// Fixed in-memory lab snapshot every smoke check runs against.

function buildSmokeSnapshot() {
  const timestamp = '2026-03-22T12:00:00.000Z';
  return {
    projects: [
      {
        id: 'proj-1',
        name: 'Atlas',
        summary: 'Binder optimization project.'
      }
    ],
    protocols: [
      {
        id: 'prot-1',
        name: 'Cell Prep',
        purpose: 'Prepare HEK293 cells for a downstream assay.',
        aliases: ['HEK293 prep', 'atlas cell prep'],
        projectId: 'proj-1',
        projectName: 'Atlas',
        steps: [
          {
            id: 'step-1',
            text: 'Record {{ph:run_date}} for {{ph:project_name}}.',
            placeholders: [
              { id: 'run_date', name: 'date' },
              { id: 'project_name', name: 'project name' }
            ]
          },
          {
            id: 'step-2',
            text: 'Use {{ph:cell_line}} with {{ph:protocol_name}} on [sample name].',
            placeholders: [
              { id: 'cell_line', name: 'cell line' },
              { id: 'protocol_name', name: 'protocol name' }
            ]
          }
        ]
      },
      {
        id: 'prot-2',
        name: 'Viability Assay',
        purpose: 'Measure post-prep viability for Atlas samples.',
        aliases: ['atlas viability'],
        projectId: 'proj-1',
        projectName: 'Atlas',
        steps: [
          {
            id: 'step-1',
            text: 'Label assay plate for {{ph:sample_name}}.',
            placeholders: [
              { id: 'sample_name', name: 'sample name' }
            ]
          },
          {
            id: 'step-2',
            text: 'Measure viability and record observations.',
            placeholders: []
          }
        ]
      }
    ],
    notebookEntries: [
      {
        id: 'note-1',
        projectId: 'proj-1',
        projectName: 'Atlas',
        protocolId: 'prot-1',
        protocolName: 'Cell Prep',
        result: 'Prepared HEK293 cells for the Atlas assay.',
        notebookState: 'executed',
        executedAt: timestamp,
        updatedAt: timestamp
      }
    ],
    workflows: [
      {
        id: 'wf-1',
        name: 'Atlas Workflow',
        description: 'Run cell prep before viability assay.',
        projectId: 'proj-1',
        blocks: [
          { id: 'block-1', protocolId: 'prot-1' },
          { id: 'block-2', type: 'text', text: 'Move prepared cells into the viability assay.' },
          { id: 'block-3', protocolId: 'prot-2' }
        ],
        links: [
          { id: 'link-1', fromBlockId: 'block-1', toBlockId: 'block-2' },
          { id: 'link-2', fromBlockId: 'block-2', toBlockId: 'block-3' }
        ],
        notebookEntryIds: ['note-1'],
        updatedAt: timestamp
      }
    ],
    assays: [
      {
        id: 'assay-1',
        name: 'Atlas Viability Assay',
        projectId: 'proj-1',
        projectName: 'Atlas',
        updatedAt: timestamp
      }
    ],
    gelAnalyses: [
      {
        id: 'gel-1',
        name: 'Atlas QC Gel',
        projectId: 'proj-1',
        projectName: 'Atlas',
        updatedAt: timestamp
      }
    ],
    papers: [
      {
        id: 'paper-1',
        title: 'Binder Methods',
        linkedType: 'project',
        linkedId: 'proj-1',
        linkedName: 'Atlas',
        summary: 'Describes a concise binder purification workflow.',
        methodsExtract: [
          {
            title: 'Purification',
            steps: [
              { action: 'Clarify lysate.' },
              { action: 'Bind clarified lysate to Ni-NTA resin.' }
            ]
          }
        ],
        keyReagents: [
          { name: 'Ni-NTA resin', type: 'resin', identifier: 'NTA-1', notes: 'For His-tag purification.' }
        ],
        updatedAt: timestamp
      }
    ],
    inventory: {
      '-20 Degree': [
        {
          id: 'container-1',
          name: 'Atlas Box',
          type: 'box81',
          wells: [
            { name: 'A1', content: 'Atlas construct sample' }
          ]
        }
      ]
    },
    samples: [
      {
        id: 'sample-1',
        code: 'ATLAS-1',
        name: 'Atlas construct sample',
        type: 'plasmid',
        notes: 'Binder construct',
        location: {
          storageType: 'freezer',
          freezer: '-20 Degree',
          box: 'Atlas Box',
          position: 'A1'
        },
        inventoryLink: {
          section: '-20 Degree',
          containerId: 'container-1',
          wellIndex: 0
        },
        chemicalLinks: [],
        updatedAt: timestamp
      }
    ],
    labInventory: {
      chemicals: [
        {
          id: 'chem-1',
          name: 'IPTG',
          aliases: ['isopropyl beta-d-thiogalactopyranoside'],
          zone: 'Lab Inventory',
          location: 'Shelf 4'
        }
      ]
    }
  };
}

module.exports = { buildSmokeSnapshot };
