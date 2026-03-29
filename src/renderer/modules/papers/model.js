export function buildFolderKey(type, id) {
  const normalizedType = type === 'journal-club' ? 'journal-club' : 'project';
  const normalizedId = String(id || '').trim();
  return normalizedId ? `${normalizedType}:${normalizedId}` : '';
}

export function getLibraryFolders(state) {
  const projectFolders = (state.projects || [])
    .map((project) => ({
      key: buildFolderKey('project', project.id),
      id: project.id,
      type: 'project',
      name: String(project.name || 'Untitled project').trim() || 'Untitled project',
      description: '',
      removable: false
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  const journalClubFolders = (state.journalClubs || [])
    .map((club) => ({
      key: buildFolderKey('journal-club', club.id),
      id: club.id,
      type: 'journal-club',
      name: String(club.name || 'Untitled journal club').trim() || 'Untitled journal club',
      description: String(club.description || '').trim(),
      removable: true
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...projectFolders, ...journalClubFolders];
}

export function getFolderForPaper(state, paper) {
  const folderKey = buildFolderKey(paper?.linkedType, paper?.linkedId);
  return getLibraryFolders(state).find((folder) => folder.key === folderKey) || null;
}

export function ensurePaperComments(paper) {
  if (!paper || typeof paper !== 'object') {
    return [];
  }
  if (!Array.isArray(paper.comments)) {
    paper.comments = [];
  }
  return paper.comments;
}

export function getPaperCommentCount(paper) {
  return ensurePaperComments(paper).length;
}

export function getFolderPaperCount(state, folder) {
  if (!folder) {
    return 0;
  }
  return (state.papers || []).filter((paper) => paper.linkedType === folder.type && paper.linkedId === folder.id).length;
}

export function getVisiblePapersForFolder(state, selectedFolder) {
  return (state.papers || [])
    .filter((paper) => {
      if (!selectedFolder) {
        return true;
      }
      return paper.linkedType === selectedFolder.type && paper.linkedId === selectedFolder.id;
    })
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export function getCommentsForPage(paper, pageNumber) {
  return ensurePaperComments(paper)
    .filter((comment) => comment.pageNumber === pageNumber)
    .slice()
    .sort((left, right) => {
      const updatedLeft = Date.parse(left.updatedAt || left.createdAt || '');
      const updatedRight = Date.parse(right.updatedAt || right.createdAt || '');
      if (Number.isFinite(updatedLeft) && Number.isFinite(updatedRight) && updatedLeft !== updatedRight) {
        return updatedRight - updatedLeft;
      }
      return String(left.id || '').localeCompare(String(right.id || ''));
    });
}

export function getCommentAuthorLabel(state) {
  return String(
    state.settings?.personalInfo?.name
    || state.settings?.personalInfo?.enanaEmail
    || 'Local user'
  ).trim() || 'Local user';
}

export function normalizeKeyFigures(paper) {
  const source = paper && typeof paper === 'object' ? paper : {};
  const fromPaper = Array.isArray(source.keyFigures) ? source.keyFigures : [];
  const fromSummary = Array.isArray(source.summaryStructured?.important_figures_or_tables)
    ? source.summaryStructured.important_figures_or_tables
    : [];
  const merged = fromPaper.length ? fromPaper : fromSummary.map((item) => {
    if (typeof item === 'string') {
      return String(item || '').trim();
    }
    if (!item || typeof item !== 'object') {
      return '';
    }
    const label = String(item.item || item.label || item.figure || item.table || '').trim();
    const summary = String(item.summary || item.description || '').trim();
    return [label, summary].filter(Boolean).join(': ');
  });
  const seen = new Set();
  return merged
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}

export function updatePaperAvailability(paper) {
  if (!paper || typeof paper !== 'object') {
    return;
  }
  const hasUploadedPdf = Boolean(String(paper.pdfDataUrl || '').trim())
    || Boolean(String(paper.storedFilePath || '').trim())
    || Boolean(String(paper.storedRelativePath || '').trim());
  const hasSummary = Boolean(String(paper.summary || '').trim())
    && !String(paper.summary || '').trim().startsWith('Failed to summarize');
  const methodCount = Array.isArray(paper.methodsExtract) ? paper.methodsExtract.length : 0;
  const reagentCount = Array.isArray(paper.keyReagents) ? paper.keyReagents.length : 0;
  paper.keyFigures = normalizeKeyFigures(paper);
  const figureCount = Array.isArray(paper.keyFigures) ? paper.keyFigures.length : 0;

  paper.deepReadReady = Boolean(hasUploadedPdf && (hasSummary || methodCount > 0 || reagentCount > 0 || figureCount > 0));
  if (paper.deepReadReady) {
    paper.availabilityStatus = 'deep_ready';
  } else if (hasUploadedPdf) {
    paper.availabilityStatus = 'uploaded_pdf';
  } else if (hasSummary) {
    paper.availabilityStatus = 'metadata_only';
  } else {
    paper.availabilityStatus = 'unavailable';
  }
}

export function formatLinkedTarget(paper) {
  const prefix = paper.linkedType === 'journal-club' ? 'Journal Club' : 'Project';
  return `${prefix}: ${paper.linkedName || 'Unknown'}`;
}

export function formatRelativePaperTime(timestamp) {
  const parsed = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(parsed)) {
    return '-';
  }

  const elapsedMs = Math.max(Date.now() - parsed, 0);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (elapsedMs < hour) {
    return `${Math.max(1, Math.round(elapsedMs / minute))}m`;
  }
  if (elapsedMs < day) {
    return `${Math.max(1, Math.round(elapsedMs / hour))}h`;
  }
  if (elapsedMs < week) {
    return `${Math.max(1, Math.round(elapsedMs / day))}d`;
  }
  return `${Math.max(1, Math.round(elapsedMs / week))}w`;
}

export function statusLabel(status) {
  if (status === 'queued') {
    return 'Queued';
  }
  if (status === 'running') {
    return 'Running';
  }
  if (status === 'error') {
    return 'Error';
  }
  if (status === 'ready') {
    return 'Ready';
  }
  if (status === 'uploaded') {
    return 'Uploaded';
  }
  return 'Idle';
}
