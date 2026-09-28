import { asArray } from '../../lib/normalize.js';
import { joinSublabel, protocolSearchText } from './scoring.js';

// Builds the searchable candidate list the topbar scores against: every app,
// plus the records the open-item handlers can jump straight to.
function createSearchCandidates({
  state,
  VIEWS,
  TITLES,
  appSuggestionEntries,
  getScopeTarget
} = {}) {
  function buildGlobalSearchCandidates() {
    const candidates = [];
    let nextCandidateId = 0;
    const addCandidate = (target, text, displayInfo = {}) => {
      if (!target || !target.viewId) {
        return;
      }
      const searchText = String(text || '').trim();
      if (!searchText) {
        return;
      }
      const label = String(displayInfo.label || '').trim() || searchText;
      const sublabel = String(displayInfo.sublabel || '').trim();
      const kind = String(displayInfo.kind || target.label || '').trim();
      const applyQueryRaw = displayInfo.applyQuery == null ? label : displayInfo.applyQuery;
      const applyQuery = String(applyQueryRaw || '').trim();
      const itemId = String(displayInfo.itemId || '').trim();
      candidates.push({
        id: `c${nextCandidateId++}`,
        target,
        text: searchText,
        label,
        sublabel,
        kind,
        applyQuery,
        itemId
      });
    };

    const chemicalTarget = getScopeTarget('chemicals');
    asArray(state.labInventory?.chemicals).forEach((chemical) => {
      const label = chemical?.name || chemical?.casNumber || chemical?.catalogNumber;
      addCandidate(chemicalTarget, [
        chemical?.name,
        chemical?.casNumber,
        chemical?.vendor,
        chemical?.catalogNumber,
        chemical?.location,
        chemical?.unitSize,
        chemical?.amountInStock
      ].join(' '), {
        label,
        sublabel: joinSublabel([chemical?.casNumber, chemical?.vendor, chemical?.location]),
        kind: 'Chemical',
        applyQuery: label,
        itemId: chemical?.id
      });
    });

    const sampleTarget = getScopeTarget('samples');
    asArray(state.samples).forEach((sample) => {
      const label = sample?.name || sample?.code;
      addCandidate(sampleTarget, [
        sample?.code,
        sample?.name,
        sample?.type,
        sample?.lot,
        sample?.concentration,
        sample?.notes
      ].join(' '), {
        label,
        sublabel: joinSublabel([sample?.code, sample?.type, sample?.concentration]),
        kind: 'Sample',
        applyQuery: sample?.code || label,
        itemId: sample?.id
      });
    });

    const assayTarget = getScopeTarget('assay');
    asArray(state.assays).forEach((assayItem) => {
      const label = assayItem?.name || assayItem?.assayNumber;
      addCandidate(assayTarget, [
        assayItem?.assayNumber,
        assayItem?.name,
        assayItem?.projectName,
        assayItem?.plateLabel,
        assayItem?.notebookEntryProtocolName,
        assayItem?.notes,
        asArray(assayItem?.sampleAxisValues).join(' '),
        asArray(assayItem?.concentrationAxisValues).join(' ')
      ].join(' '), {
        label,
        sublabel: joinSublabel([assayItem?.assayNumber, assayItem?.projectName, assayItem?.plateLabel]),
        kind: 'Plate',
        applyQuery: assayItem?.assayNumber || label,
        itemId: assayItem?.id
      });
    });

    const projectTarget = getScopeTarget('projects');
    asArray(state.projects).forEach((project) => {
      const label = project?.name;
      addCandidate(projectTarget, [project?.name, project?.description].join(' '), {
        label,
        sublabel: project?.description,
        kind: 'Project',
        applyQuery: label,
        itemId: project?.id
      });
    });

    const protocolTarget = getScopeTarget('protocols');
    asArray(state.protocols).forEach((protocolItem) => {
      const label = protocolItem?.name;
      addCandidate(protocolTarget, protocolSearchText(protocolItem), {
        label,
        sublabel: protocolItem?.purpose,
        kind: 'Protocol',
        applyQuery: label,
        itemId: protocolItem?.id
      });
    });

    const paperTarget = getScopeTarget('papers');
    asArray(state.papers).forEach((paper) => {
      const label = paper?.title || paper?.fileName;
      addCandidate(paperTarget, [
        paper?.title,
        paper?.linkedName,
        paper?.summary,
        paper?.fileName
      ].join(' '), {
        label,
        sublabel: joinSublabel([paper?.linkedName, paper?.fileName]),
        kind: 'Paper',
        applyQuery: label,
        itemId: paper?.id
      });
    });

    const memberTarget = getScopeTarget('members');
    asArray(state.members).forEach((member) => {
      const label = member?.name;
      addCandidate(memberTarget, [
        member?.name,
        member?.position,
        member?.institutionEmail,
        member?.hikariEmail
      ].join(' '), {
        label,
        sublabel: joinSublabel([member?.position, member?.institutionEmail || member?.hikariEmail]),
        kind: 'Member',
        applyQuery: label
      });
    });

    const workflowTarget = {
      viewId: VIEWS.WORKFLOW_MANAGEMENT,
      inputId: '',
      label: 'Workflows'
    };
    asArray(state.workflows).forEach((workflow) => {
      const label = workflow?.name;
      addCandidate(workflowTarget, [workflow?.name, workflow?.description].join(' '), {
        label,
        sublabel: workflow?.description,
        kind: 'Workflow',
        applyQuery: '',
        itemId: workflow?.id
      });
    });

    const biologyNotebookTarget = {
      viewId: VIEWS.BIOLOGY_NOTEBOOK,
      inputId: '',
      label: 'Notebook'
    };
    asArray(state.notebookEntries).forEach((entry) => {
      if (entry?.notebookType !== 'biology') {
        return;
      }
      const label = entry?.protocolName || entry?.projectName;
      addCandidate(biologyNotebookTarget, [
        entry?.projectName,
        entry?.protocolName,
        entry?.result,
        asArray(entry?.resultFiles).join(' '),
        entry?.updatedAt
      ].join(' '), {
        label,
        sublabel: joinSublabel([entry?.projectName, entry?.updatedAt]),
        kind: 'Notebook',
        applyQuery: '',
        itemId: entry?.id
      });
    });

    const personalInventoryTarget = {
      viewId: VIEWS.PERSONAL_INVENTORY,
      inputId: '',
      label: 'Containers'
    };
    Object.entries(state.inventory || {}).forEach(([zone, containers]) => {
      asArray(containers).forEach((container) => {
        const label = container?.name;
        addCandidate(personalInventoryTarget, [
          zone,
          container?.name,
          container?.type,
          container?.singleContent,
          asArray(container?.wells)
            .map((well) => (typeof well === 'string' ? well : `${well?.name || ''} ${well?.content || ''}`))
            .join(' ')
        ].join(' '), {
          label,
          sublabel: joinSublabel([container?.type, zone]),
          kind: 'Container',
          applyQuery: ''
        });
      });
    });

    return candidates;
  }

  function buildAppSuggestionCandidates() {
    return appSuggestionEntries.map((entry, index) => ({
      id: `app-${index}`,
      target: entry.target,
      text: entry.aliasText,
      label: entry.app?.label || '',
      sublabel: TITLES[entry.viewId] || '',
      kind: 'Module',
      applyQuery: ''
    }));
  }

  return { buildGlobalSearchCandidates, buildAppSuggestionCandidates };
}

export { createSearchCandidates };
