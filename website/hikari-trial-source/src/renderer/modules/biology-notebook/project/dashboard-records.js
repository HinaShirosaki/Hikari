import { normalizeNotebookState, notebookStateLabel } from '../entry/entry-helpers.js';
import { getGelAnalyses } from '../../../lib/gel-records.js';

// Everything a project dashboard needs to gather: which notebook pages,
// workflows, assays, gels, papers, and samples belong to one project.
function createDashboardRecords({ state } = {}) {
  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function cleanText(value) {
    return String(value || '').trim();
  }

  function normalizeKey(value) {
    return cleanText(value).toLowerCase();
  }

  function getProjectById(projectId) {
    return asArray(state?.projects).find((project) => String(project?.id || '') === String(projectId || '')) || null;
  }

  function getRecordProjectIds(record) {
    if (!record || typeof record !== 'object') {
      return [];
    }
    const ids = [
      record.projectId,
      record.project_id,
      record.linkedProjectId,
      record.linked_project_id,
      record.project?.id,
      record.meta?.projectId,
      record.metadata?.projectId
    ];
    if (normalizeKey(record.linkedType) === 'project') {
      ids.push(record.linkedId, record.linked_id);
    }
    return ids.map(cleanText).filter(Boolean);
  }

  function getRecordProjectNames(record) {
    if (!record || typeof record !== 'object') {
      return [];
    }
    return [
      record.projectName,
      record.project_name,
      record.linkedProject,
      record.linkedProjectName,
      record.linked_project,
      record.linked_project_name,
      record.project?.name,
      record.meta?.projectName,
      record.metadata?.projectName,
      normalizeKey(record.linkedType) === 'project' ? (record.linkedName || record.linked_name) : ''
    ].map(normalizeKey).filter(Boolean);
  }

  function recordMatchesProject(record, project) {
    if (!record || !project) {
      return false;
    }
    const projectId = cleanText(project.id);
    const recordProjectIds = getRecordProjectIds(record);
    if (recordProjectIds.length) {
      return Boolean(projectId && recordProjectIds.includes(projectId));
    }

    const projectName = normalizeKey(project.name);
    if (!projectName) {
      return false;
    }
    return getRecordProjectNames(record).includes(projectName);
  }

  function parseTimestamp(raw) {
    const value = Date.parse(String(raw || ''));
    return Number.isFinite(value) ? value : 0;
  }

  function getWorkflowNotebookEntryIds(project) {
    const entryIds = new Set();
    asArray(state?.workflows)
      .filter((workflow) => recordMatchesProject(workflow, project))
      .forEach((workflow) => {
        asArray(workflow.notebookEntryIds).forEach((entryId) => {
          if (entryId) {
            entryIds.add(entryId);
          }
        });
        asArray(workflow.entries).forEach((entry) => {
          if (entry?.notebookEntryId) {
            entryIds.add(entry.notebookEntryId);
          }
        });
      });
    return entryIds;
  }

  function getProjectNotebookEntries(project) {
    const workflowEntryIds = getWorkflowNotebookEntryIds(project);
    return asArray(state?.notebookEntries)
      .filter((entry) => recordMatchesProject(entry, project) || workflowEntryIds.has(entry.id))
      .sort((a, b) => parseTimestamp(b.updatedAt) - parseTimestamp(a.updatedAt));
  }

  function getProjectWorkflows(project, notebookEntryIds) {
    return asArray(state?.workflows)
      .filter((workflow) => (
        recordMatchesProject(workflow, project)
        || asArray(workflow.notebookEntryIds).some((entryId) => notebookEntryIds.has(entryId))
        || asArray(workflow.entries).some((entry) => notebookEntryIds.has(entry?.notebookEntryId))
      ))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getProjectAssays(project, notebookEntryIds) {
    return asArray(state?.assays)
      .filter((assay) => recordMatchesProject(assay, project) || notebookEntryIds.has(assay.notebookEntryId))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getProjectGelAnalyses(project, notebookEntryIds) {
    return asArray(getGelAnalyses(state))
      .filter((analysis) => recordMatchesProject(analysis, project) || notebookEntryIds.has(analysis.notebookEntryId))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  function getNotebookPaperIds(notebookEntries) {
    const ids = new Set();
    notebookEntries.forEach((entry) => {
      asArray(entry?.references?.paperIds).forEach((paperId) => {
        if (paperId) {
          ids.add(paperId);
        }
      });
    });
    return ids;
  }

  function getProjectPapers(project, notebookEntryIds, notebookEntries) {
    const paperIds = getNotebookPaperIds(notebookEntries);
    asArray(state?.paperExperimentLinks).forEach((link) => {
      if (recordMatchesProject(link, project) || notebookEntryIds.has(link?.entryId)) {
        paperIds.add(link.paperId);
      }
    });

    return asArray(state?.papers)
      .filter((paper) => recordMatchesProject(paper, project) || paperIds.has(paper.id))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.discoveredAt || b.createdAt) - parseTimestamp(a.updatedAt || a.discoveredAt || a.createdAt));
  }

  function getProjectSampleKeys(notebookEntries, assays) {
    const keys = new Set();
    notebookEntries.forEach((entry) => {
      asArray(entry?.references?.sampleIds).forEach((sampleId) => {
        if (sampleId) {
          keys.add(String(sampleId));
        }
      });
    });
    assays.forEach((assay) => {
      asArray(assay?.sampleAxisValues).forEach((sampleId) => {
        if (sampleId) {
          keys.add(String(sampleId));
        }
      });
      asArray(assay?.wellLayout).forEach((well) => {
        if (well?.sampleId) {
          keys.add(String(well.sampleId));
        }
      });
    });
    return keys;
  }

  function sampleMatchesProject(sample, project, sampleKeys) {
    if (recordMatchesProject(sample, project)) {
      return true;
    }
    return [
      sample?.id,
      sample?.code,
      sample?.name
    ].some((value) => value && sampleKeys.has(String(value)));
  }

  function getProjectSamples(project, notebookEntries, assays) {
    const sampleKeys = getProjectSampleKeys(notebookEntries, assays);
    return asArray(state?.samples)
      .filter((sample) => sampleMatchesProject(sample, project, sampleKeys))
      .sort((a, b) => parseTimestamp(b.updatedAt || b.createdAt) - parseTimestamp(a.updatedAt || a.createdAt));
  }

  return {
    asArray,
    cleanText,
    normalizeKey,
    getProjectById,
    normalizeNotebookState,
    notebookStateLabel,
    getRecordProjectIds,
    getRecordProjectNames,
    recordMatchesProject,
    parseTimestamp,
    getWorkflowNotebookEntryIds,
    getProjectNotebookEntries,
    getProjectWorkflows,
    getProjectAssays,
    getProjectGelAnalyses,
    getNotebookPaperIds,
    getProjectPapers,
    getProjectSampleKeys,
    sampleMatchesProject,
    getProjectSamples
  };
}

export { createDashboardRecords };
