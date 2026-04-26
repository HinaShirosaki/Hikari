import { getWellName, isMultiWellContainer } from './personal-inventory/constants.js';

export function createUid(type, id) {
  return `${type}:${id}`;
}

export function rebuildObjectGraph(state) {
  const nodes = {};
  const edges = [];

  function addNode(type, id, label, data) {
    if (!id) {
      return null;
    }
    const uid = createUid(type, id);
    nodes[uid] = {
      uid,
      type,
      id: String(id),
      label: String(label || `${type} ${id}`),
      data: data || {}
    };
    return uid;
  }

  function ensureNode(type, id, fallbackLabel) {
    if (!id) {
      return null;
    }
    const uid = createUid(type, id);
    if (!nodes[uid]) {
      addNode(type, id, fallbackLabel || `${type} ${id}`, {});
    }
    return uid;
  }

  function addEdge(fromType, fromId, relation, toType, toId, meta) {
    const fromUid = ensureNode(fromType, fromId);
    const toUid = ensureNode(toType, toId);
    if (!fromUid || !toUid) {
      return;
    }
    edges.push({
      from: fromUid,
      to: toUid,
      relation: String(relation || 'related_to'),
      at: new Date().toISOString(),
      meta: meta || {}
    });
  }

  (state.members || []).forEach((member) => {
    addNode('person', member.id, member.name, member);
  });

  (state.projects || []).forEach((project) => {
    addNode('project', project.id, project.name, project);
  });

  (state.protocols || []).forEach((protocol) => {
    addNode('protocol', protocol.id, protocol.name, protocol);
  });

  (state.workflowTemplates || []).forEach((template) => {
    addNode('workflow_template', template.id, template.name || template.id, template);

    const blocks = Array.isArray(template.blocks) ? template.blocks : [];
    blocks.forEach((block, index) => {
      const scopedBlockId = `${template.id}:block:${block?.id || index + 1}`;
      addNode('workflow_template_block', scopedBlockId, `Template Block ${index + 1}`, {
        ...(block || {}),
        templateId: template.id
      });
      addEdge('workflow_template', template.id, 'has_block', 'workflow_template_block', scopedBlockId);
      addEdge('workflow_template_block', scopedBlockId, 'uses_protocol', 'protocol', block?.protocolId);
      addEdge('workflow_template_block', scopedBlockId, 'suggested_assignee', 'person', block?.assigneeId, {
        templateId: template.id
      });
    });
  });

  (state.workflows || []).forEach((workflow) => {
    addNode('workflow', workflow.id, workflow.name || workflow.id, workflow);
    addEdge('workflow', workflow.id, 'uses_project', 'project', workflow.projectId);
    (workflow.notebookEntryIds || []).forEach((entryId) => {
      addEdge('workflow', workflow.id, 'links_notebook_page', 'notebook_entry', entryId);
    });

    const blocks = Array.isArray(workflow.blocks) ? workflow.blocks : [];
    const blockScopedIds = new Map();

    blocks.forEach((block, index) => {
      const scopedBlockId = `${workflow.id}:block:${block?.id || index + 1}`;
      blockScopedIds.set(String(block?.id || ''), scopedBlockId);
      addNode('workflow_block', scopedBlockId, `Workflow Block ${index + 1}`, {
        ...(block || {}),
        workflowId: workflow.id
      });
      addEdge('workflow', workflow.id, 'has_block', 'workflow_block', scopedBlockId);
      addEdge('workflow_block', scopedBlockId, 'uses_protocol', 'protocol', block?.protocolId);
      addEdge('workflow_block', scopedBlockId, 'assigned_to', 'person', block?.assigneeId, {
        workflowId: workflow.id
      });
    });

    (workflow.links || []).forEach((link) => {
      const fromScopedId = blockScopedIds.get(String(link?.fromBlockId || ''));
      const toScopedId = blockScopedIds.get(String(link?.toBlockId || ''));
      if (!fromScopedId || !toScopedId) {
        return;
      }
      addEdge('workflow_block', fromScopedId, 'workflow_next', 'workflow_block', toScopedId, {
        workflowId: workflow.id
      });
    });
  });

  (state.instruments || []).forEach((instrument) => {
    addNode('instrument', instrument.id, instrument.name, instrument);
  });

  (state.papers || []).forEach((paper) => {
    addNode('paper', paper.id, paper.title || paper.fileName, paper);
    (paper.methodsExtract || []).forEach((method, index) => {
      const methodId = `${paper.id}:method:${index + 1}`;
      addNode('method', methodId, method.title || `Method ${index + 1}`, method);
      addEdge('paper', paper.id, 'describes_method', 'method', methodId);
    });
    (paper.keyReagents || []).forEach((reagent, index) => {
      const reagentId = `${paper.id}:reagent:${index + 1}`;
      addNode('reagent', reagentId, reagent.name || `Reagent ${index + 1}`, reagent);
      addEdge('paper', paper.id, 'mentions_reagent', 'reagent', reagentId);
    });
  });

  (state.labInventory?.chemicals || []).forEach((chemical) => {
    addNode('chemical', chemical.id, chemical.name, chemical);
  });

  (state.samples || []).forEach((sample) => {
    const sampleKey = sample.code || sample.id;
    addNode('sample', sampleKey, sample.name || sampleKey, sample);
    const locationLabel = formatSampleLocation(sample.location);
    if (locationLabel && locationLabel !== '-') {
      addNode('location', locationLabel, locationLabel, sample.location || {});
      addEdge('sample', sampleKey, 'stored_at', 'location', locationLabel, {
        storageType: sample.location?.storageType || ''
      });
    }

    (sample.chemicalLinks || []).forEach((chemicalId) => {
      addEdge('sample', sampleKey, 'related_chemical', 'chemical', chemicalId);
    });

    const link = sample.inventoryLink;
    if (link?.containerId) {
      addEdge('sample', sampleKey, 'stored_in_container', 'container', link.containerId, {
        section: link.section || '',
        wellIndex: link.wellIndex === null || link.wellIndex === undefined ? '' : link.wellIndex
      });
    }
  });

  Object.entries(state.inventory || {}).forEach(([section, containers]) => {
    (containers || []).forEach((container) => {
      const containerUid = addNode(
        'container',
        container.id,
        `${section} / ${container.name || container.id}`,
        { ...container, section }
      );
      if (!containerUid) {
        return;
      }

      if (isMultiWellContainer(container)) {
        (container.wells || []).forEach((rawWell, index) => {
          const well = typeof rawWell === 'object' && rawWell
            ? rawWell
            : { name: getWellName(container, index), content: String(rawWell || '') };
          const sampleId = `${container.id}:well:${index + 1}`;
          addNode('sample', sampleId, well.name || sampleId, {
            ...well,
            section,
            containerId: container.id,
            wellIndex: index + 1
          });
          addEdge('sample', sampleId, 'stored_in', 'container', container.id, { section });
        });
      } else {
        const sampleId = `${container.id}:single`;
        addNode('sample', sampleId, container.name || sampleId, {
          content: container.singleContent || '',
          section,
          containerId: container.id
        });
        addEdge('sample', sampleId, 'stored_in', 'container', container.id, { section });
      }
    });
  });

  (state.notebookEntries || []).forEach((entry) => {
    addNode('notebook_entry', entry.id, entry.protocolName || entry.id, entry);
    addEdge('notebook_entry', entry.id, 'uses_project', 'project', entry.projectId);
    addEdge('notebook_entry', entry.id, 'uses_protocol', 'protocol', entry.protocolId);

    const refs = entry.references || {};
    if (refs.instrumentId) {
      addEdge('notebook_entry', entry.id, 'uses_instrument', 'instrument', refs.instrumentId);
    }

    (refs.chemicalIds || []).forEach((chemicalId) => {
      addEdge('notebook_entry', entry.id, 'uses_chemical', 'chemical', chemicalId);
    });
    (refs.sampleIds || []).forEach((sampleId) => {
      addEdge('notebook_entry', entry.id, 'uses_sample', 'sample', sampleId);
    });
    (refs.paperIds || []).forEach((paperId) => {
      addEdge('notebook_entry', entry.id, 'references_paper', 'paper', paperId);
    });
    (refs.peopleIds || []).forEach((personId) => {
      addEdge('notebook_entry', entry.id, 'performed_by', 'person', personId);
    });
    (refs.reagentLots || []).forEach((lot) => {
      addNode('reagent_lot', lot, lot, { lot });
      addEdge('notebook_entry', entry.id, 'uses_reagent_lot', 'reagent_lot', lot);
    });

    if (entry.synthesisOutcome?.producedCompoundCode) {
      const compoundId = entry.synthesisOutcome.producedCompoundCode;
      addNode('compound', compoundId, compoundId, entry.synthesisOutcome);
      addEdge('notebook_entry', entry.id, 'produces_compound', 'compound', compoundId, {
        purityPercent: entry.synthesisOutcome.purityPercent || '',
        usedInAssay: entry.synthesisOutcome.usedInAssay || ''
      });
    }

    (entry.resultFiles || []).forEach((name) => {
      const fileId = `${entry.id}:${name}`;
      addNode('file', fileId, name, { name, notebookEntryId: entry.id });
      addEdge('notebook_entry', entry.id, 'has_attachment', 'file', fileId);
    });
  });

  (state.assays || []).forEach((assay) => {
    addNode('assay', assay.id, assay.name || assay.id, assay);
    addEdge('assay', assay.id, 'uses_project', 'project', assay.projectId);
    if (assay.notebookEntryId) {
      addEdge('assay', assay.id, 'links_notebook_page', 'notebook_entry', assay.notebookEntryId, {
        sampleAxis: assay.sampleAxis || '',
        concentrationAxis: assay.concentrationAxis || '',
        plateType: assay.plateType || ''
      });
    }
  });

  (state.gelAnalyses || []).forEach((analysis) => {
    addNode('gel_analysis', analysis.id, analysis.name || analysis.id, analysis);
    addEdge('gel_analysis', analysis.id, 'uses_project', 'project', analysis.projectId);
    if (analysis.notebookEntryId) {
      addEdge('gel_analysis', analysis.id, 'links_notebook_page', 'notebook_entry', analysis.notebookEntryId, {
        analysisType: analysis.analysisType || '',
        confidence: analysis.report?.confidence?.score || ''
      });
    }
  });

  (state.paperExperimentLinks || []).forEach((link) => {
    addEdge('paper', link.paperId, 'inspires_experiment', 'notebook_entry', link.entryId, {
      projectId: link.projectId,
      note: link.note || ''
    });
  });

  const backlinks = {};
  edges.forEach((edge) => {
    if (!backlinks[edge.to]) {
      backlinks[edge.to] = [];
    }
    backlinks[edge.to].push(edge);
  });

  return {
    nodes,
    edges,
    backlinks,
    updatedAt: new Date().toISOString()
  };
}

function formatSampleLocation(location) {
  if (!location || typeof location !== 'object') {
    return '-';
  }
  if (location.storageType === 'freezer') {
    return [location.freezer, location.rack, location.box, location.position].filter(Boolean).join(' -> ') || '-';
  }
  if (location.storageType === 'fridge') {
    return [location.fridge, location.shelf].filter(Boolean).join(' -> ') || '-';
  }
  if (location.storageType === 'desiccator') {
    return [location.desiccator, location.position].filter(Boolean).join(' -> ') || '-';
  }
  return [location.cabinet, location.slot].filter(Boolean).join(' -> ') || '-';
}

export function queryNotebookEntriesByRelation(state, { relation, targetType, targetId }) {
  const graph = state.objectGraph || rebuildObjectGraph(state);
  const targetUid = createUid(targetType, targetId);

  return (graph.backlinks[targetUid] || [])
    .filter((edge) => edge.relation === relation && edge.from.startsWith('notebook_entry:'))
    .map((edge) => edge.from.replace('notebook_entry:', ''))
    .map((entryId) => (state.notebookEntries || []).find((entry) => entry.id === entryId))
    .filter(Boolean);
}

export function queryInstrumentUsageInRange(state, instrumentId, startIso, endIso) {
  const startTime = Date.parse(startIso || '');
  const endTime = Date.parse(endIso || '');
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    return [];
  }

  return (state.notebookEntries || []).filter((entry) => {
    const timestamp = Date.parse(entry.updatedAt || '');
    const sameInstrument = entry.references?.instrumentId === instrumentId;
    return sameInstrument && Number.isFinite(timestamp) && timestamp >= startTime && timestamp <= endTime;
  });
}
