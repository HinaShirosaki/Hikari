export function initPapersManagement({ state, persist, createId, safeText, onCreateProtocolDraft }) {
  const paperForm = document.getElementById('paper-form');
  const paperTitleInput = document.getElementById('paper-title');
  const paperPdfInput = document.getElementById('paper-pdf');
  const paperLinkTypeSelect = document.getElementById('paper-link-type');
  const paperLinkTargetSelect = document.getElementById('paper-link-target');
  const paperList = document.getElementById('paper-list');

  const journalClubNameInput = document.getElementById('journal-club-name');
  const journalClubDescriptionInput = document.getElementById('journal-club-description');
  const journalClubAddBtn = document.getElementById('journal-club-add-btn');
  const journalClubList = document.getElementById('journal-club-list');

  const knowledgeProjectSelect = document.getElementById('knowledge-project-select');
  const knowledgeQuestionInput = document.getElementById('knowledge-question');
  const knowledgeAskBtn = document.getElementById('knowledge-ask-btn');
  const knowledgeAnswer = document.getElementById('knowledge-answer');
  const knowledgeChatHistory = document.getElementById('knowledge-chat-history');

  paperForm.addEventListener('submit', onPaperSubmit);
  paperLinkTypeSelect.addEventListener('change', renderLinkTargets);
  journalClubAddBtn.addEventListener('click', onAddJournalClub);
  knowledgeAskBtn?.addEventListener('click', onAskKnowledge);
  knowledgeProjectSelect?.addEventListener('change', renderKnowledgeSection);
  paperList.addEventListener('click', onPaperListClick);

  function getCurrentLinkOptions() {
    if (paperLinkTypeSelect.value === 'journal-club') {
      return (state.journalClubs || []).map((club) => ({
        id: club.id,
        name: club.name
      }));
    }

    return (state.projects || []).map((project) => ({
      id: project.id,
      name: project.name
    }));
  }

  async function onPaperSubmit(event) {
    event.preventDefault();
    const options = getCurrentLinkOptions();
    const file = paperPdfInput.files?.[0];
    const linkId = paperLinkTargetSelect.value;
    const linked = options.find((item) => item.id === linkId);

    if (!file || !linkId || !linked) {
      return;
    }

    const paper = {
      id: createId(),
      title: paperTitleInput.value.trim() || file.name.replace(/\.pdf$/i, ''),
      fileName: file.name,
      pdfDataUrl: await fileToDataUrl(file),
      linkedType: paperLinkTypeSelect.value,
      linkedId: linkId,
      linkedName: linked.name,
      summary: '',
      summaryStatus: 'idle',
      methodsExtract: [],
      methodsStatus: 'idle',
      keyReagents: [],
      reagentsStatus: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.papers.push(paper);
    persist();
    paperForm.reset();
    paperLinkTypeSelect.value = 'project';
    render();
  }

  function onAddJournalClub() {
    const name = journalClubNameInput.value.trim();
    if (!name) {
      return;
    }

    state.journalClubs.push({
      id: createId(),
      name,
      description: journalClubDescriptionInput.value.trim()
    });

    persist();
    journalClubNameInput.value = '';
    journalClubDescriptionInput.value = '';
    renderJournalClubList();
    renderLinkTargets();
  }

  function deleteJournalClub(journalClubId) {
    state.journalClubs = state.journalClubs.filter((item) => item.id !== journalClubId);
    state.papers = state.papers.filter((paper) => !(paper.linkedType === 'journal-club' && paper.linkedId === journalClubId));
    persist();
    render();
  }

  function deletePaper(paperId) {
    state.papers = state.papers.filter((item) => item.id !== paperId);
    state.paperExperimentLinks = (state.paperExperimentLinks || []).filter((item) => item.paperId !== paperId);
    persist();
    renderPaperList();
    renderKnowledgeSection();
  }

  async function summarizePaper(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.summaryStatus === 'running') {
      return;
    }

    paper.summaryStatus = 'running';
    paper.summary = 'Summarizing...';
    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();

    try {
      const summary = await requestSummary({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title
      });
      paper.summary = summary || 'No summary generated.';
      paper.summaryStatus = 'idle';
    } catch (error) {
      paper.summary = `Failed to summarize: ${String(error.message || error)}`;
      paper.summaryStatus = 'error';
    }

    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();
  }

  async function extractMethods(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.methodsStatus === 'running') {
      return;
    }

    paper.methodsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractMethods')
      });

      const methods = Array.isArray(result?.methods) ? result.methods : [];
      paper.methodsExtract = methods.map((item, index) => ({
        title: String(item?.title || `Method ${index + 1}`),
        steps: Array.isArray(item?.steps) ? item.steps.map((step) => String(step || '').trim()).filter(Boolean) : [],
        citations: Array.isArray(item?.citations) ? item.citations.map((cit) => String(cit || '').trim()).filter(Boolean) : []
      }));
      paper.methodsStatus = 'idle';
    } catch (error) {
      paper.methodsStatus = 'error';
      paper.methodsExtract = [];
    }

    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();
  }

  async function extractReagents(paperId) {
    const paper = state.papers.find((item) => item.id === paperId);
    if (!paper || paper.reagentsStatus === 'running') {
      return;
    }

    paper.reagentsStatus = 'running';
    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();

    try {
      const prompts = await getLlmPrompts();
      const result = await requestStructuredFromPaper({
        llm: state.settings.llm,
        pdfDataUrl: paper.pdfDataUrl,
        fileName: paper.fileName,
        title: paper.title,
        instruction: requirePrompt(prompts, 'extractReagents')
      });

      const reagents = Array.isArray(result?.reagents) ? result.reagents : [];
      paper.keyReagents = reagents.map((item) => ({
        name: String(item?.name || '').trim(),
        type: String(item?.type || 'other').trim(),
        identifier: String(item?.identifier || '').trim(),
        notes: String(item?.notes || '').trim(),
        citation: String(item?.citation || '').trim()
      })).filter((item) => item.name);
      paper.reagentsStatus = 'idle';
    } catch (error) {
      paper.reagentsStatus = 'error';
      paper.keyReagents = [];
    }

    paper.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();
  }

  function linkExperimentToPaper(paperId, projectId, entryId, note) {
    if (!paperId || !projectId || !entryId) {
      return;
    }

    const entry = (state.notebookEntries || []).find((item) => item.id === entryId && item.projectId === projectId);
    if (!entry) {
      return;
    }

    state.paperExperimentLinks = Array.isArray(state.paperExperimentLinks) ? state.paperExperimentLinks : [];

    const existingIndex = state.paperExperimentLinks.findIndex(
      (item) => item.paperId === paperId && item.entryId === entryId
    );
    const record = {
      id: existingIndex >= 0 ? state.paperExperimentLinks[existingIndex].id : createId(),
      paperId,
      projectId,
      entryId,
      note: String(note || '').trim(),
      updatedAt: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      state.paperExperimentLinks[existingIndex] = record;
    } else {
      state.paperExperimentLinks.push(record);
    }

    entry.references = entry.references || {};
    entry.references.paperIds = Array.isArray(entry.references.paperIds) ? entry.references.paperIds : [];
    if (!entry.references.paperIds.includes(paperId)) {
      entry.references.paperIds.push(paperId);
    }
    entry.references.paperInspiration = Array.isArray(entry.references.paperInspiration)
      ? entry.references.paperInspiration
      : [];
    const inspirationIndex = entry.references.paperInspiration.findIndex((item) => item.paperId === paperId);
    const inspiration = {
      paperId,
      note: String(note || '').trim(),
      updatedAt: new Date().toISOString()
    };
    if (inspirationIndex >= 0) {
      entry.references.paperInspiration[inspirationIndex] = inspiration;
    } else {
      entry.references.paperInspiration.push(inspiration);
    }

    entry.updatedAt = new Date().toISOString();
    persist();
    renderPaperList();
  }

  async function onAskKnowledge() {
    const projectId = knowledgeProjectSelect?.value || '';
    const question = knowledgeQuestionInput?.value.trim() || '';
    if (!projectId || !question) {
      return;
    }

    const project = (state.projects || []).find((item) => item.id === projectId);
    if (!project) {
      return;
    }

    ensureKnowledgeState();
    const previous = state.knowledgeChats[projectId] || [];
    const context = buildProjectKnowledgeContext(projectId);
    const prompts = await getLlmPrompts();
    const prompt = renderPromptTemplate(requirePrompt(prompts, 'knowledgeQa'), {
      projectName: project.name,
      context,
      question
    });

    knowledgeAnswer.textContent = 'Thinking...';
    renderKnowledgeHistory(projectId);

    try {
      const answer = await requestText({
        llm: state.settings.llm,
        modelFallbackPrompt: prompt
      });
      previous.push({
        id: createId(),
        role: 'user',
        text: question,
        createdAt: new Date().toISOString()
      });
      previous.push({
        id: createId(),
        role: 'assistant',
        text: answer || 'No answer generated.',
        createdAt: new Date().toISOString()
      });
      state.knowledgeChats[projectId] = previous.slice(-30);
      persist();
      knowledgeAnswer.textContent = answer || 'No answer generated.';
      renderKnowledgeHistory(projectId);
    } catch (error) {
      knowledgeAnswer.textContent = `Q&A failed: ${String(error.message || error)}`;
    }
  }

  function buildProjectKnowledgeContext(projectId) {
    const papers = (state.papers || []).filter((paper) => paper.linkedType === 'project' && paper.linkedId === projectId);
    const entries = (state.notebookEntries || []).filter((entry) => entry.projectId === projectId);
    const protocolIds = Array.from(new Set(entries.map((entry) => entry.protocolId).filter(Boolean)));
    const protocols = (state.protocols || []).filter((item) => protocolIds.includes(item.id));
    const links = (state.paperExperimentLinks || []).filter((item) => item.projectId === projectId);

    const paperText = papers.map((paper) => [
      `Paper: ${paper.title}`,
      `Summary: ${paper.summary || '-'}`,
      `Methods: ${(paper.methodsExtract || []).map((method) => `${method.title}: ${(method.steps || []).join(' | ')}`).join(' || ') || '-'}`,
      `Reagents: ${(paper.keyReagents || []).map((item) => `${item.type}:${item.name} (${item.identifier || '-'})`).join(' | ') || '-'}`
    ].join('\n')).join('\n\n');

    const entryText = entries.map((entry) => [
      `Experiment: ${entry.protocolName || '-'} @ ${entry.updatedAt || '-'}`,
      `Notes: ${entry.result || '-'}`,
      `References: papers=${(entry.references?.paperIds || []).join(', ') || '-'} lots=${(entry.references?.reagentLots || []).join(', ') || '-'}`
    ].join('\n')).join('\n\n');

    const protocolText = protocols.map((protocol) => (
      `Protocol: ${protocol.name}\nSteps: ${(protocol.steps || []).map((step) => step.text).join(' | ')}`
    )).join('\n\n');

    const linkText = links.map((link) => `Paper ${link.paperId} inspired experiment ${link.entryId}: ${link.note || '-'}`).join('\n');

    return [
      `Papers:\n${paperText || '-'}`,
      `Protocols:\n${protocolText || '-'}`,
      `Experiments:\n${entryText || '-'}`,
      `Paper-Experiment links:\n${linkText || '-'}`
    ].join('\n\n');
  }

  function ensureKnowledgeState() {
    if (!state.knowledgeChats || typeof state.knowledgeChats !== 'object') {
      state.knowledgeChats = {};
    }
  }

  function renderKnowledgeProjectOptions() {
    if (!knowledgeProjectSelect) {
      return;
    }
    const selected = knowledgeProjectSelect.value;
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = selected === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    knowledgeProjectSelect.innerHTML = options.join('');
    if (selected && (state.projects || []).some((item) => item.id === selected)) {
      knowledgeProjectSelect.value = selected;
    }
  }

  function renderKnowledgeHistory(projectId) {
    if (!knowledgeChatHistory) {
      return;
    }
    const chats = (state.knowledgeChats?.[projectId] || []).slice(-10);
    if (!chats.length) {
      knowledgeChatHistory.innerHTML = '<p class="small-note">No Q&A history yet for this project.</p>';
      return;
    }
    knowledgeChatHistory.innerHTML = chats.map((item) => `
      <article class="card">
        <p><strong>${item.role === 'assistant' ? 'Assistant' : 'You'}:</strong> ${safeText(item.text || '')}</p>
        <p class="small-note">${new Date(item.createdAt).toLocaleString()}</p>
      </article>
    `).join('');
  }

  function renderKnowledgeSection() {
    renderKnowledgeProjectOptions();
    const projectId = knowledgeProjectSelect?.value || '';
    if (knowledgeAnswer) {
      knowledgeAnswer.textContent = projectId
        ? 'Ask a question scoped to this project.'
        : 'Select a project to start Q&A.';
    }
    renderKnowledgeHistory(projectId);
  }

  function onPaperListClick(event) {
    const summarizeBtn = event.target.closest('[data-paper-summarize]');
    if (summarizeBtn) {
      summarizePaper(summarizeBtn.dataset.paperSummarize);
      return;
    }

    const deleteBtn = event.target.closest('[data-paper-delete]');
    if (deleteBtn) {
      deletePaper(deleteBtn.dataset.paperDelete);
      return;
    }

    const extractMethodsBtn = event.target.closest('[data-paper-extract-methods]');
    if (extractMethodsBtn) {
      extractMethods(extractMethodsBtn.dataset.paperExtractMethods);
      return;
    }

    const extractReagentsBtn = event.target.closest('[data-paper-extract-reagents]');
    if (extractReagentsBtn) {
      extractReagents(extractReagentsBtn.dataset.paperExtractReagents);
      return;
    }

    const protocolBtn = event.target.closest('[data-paper-method-to-protocol]');
    if (protocolBtn) {
      const paper = state.papers.find((item) => item.id === protocolBtn.dataset.paperId);
      const index = Number(protocolBtn.dataset.methodIndex);
      const method = paper?.methodsExtract?.[index];
      if (paper && method && typeof onCreateProtocolDraft === 'function') {
        onCreateProtocolDraft({ method, paper });
      }
      return;
    }

    const linkBtn = event.target.closest('[data-paper-link-entry]');
    if (linkBtn) {
      const paperId = linkBtn.dataset.paperId;
      const card = linkBtn.closest('[data-paper-card]');
      if (!card) {
        return;
      }
      const projectId = card.querySelector('[data-link-project]')?.value || '';
      const entryId = card.querySelector('[data-link-entry]')?.value || '';
      const note = card.querySelector('[data-link-note]')?.value || '';
      linkExperimentToPaper(paperId, projectId, entryId, note);
      return;
    }

    const projectSelect = event.target.closest('[data-link-project]');
    if (projectSelect) {
      const card = projectSelect.closest('[data-paper-card]');
      const entrySelect = card?.querySelector('[data-link-entry]');
      if (entrySelect) {
        entrySelect.innerHTML = renderEntryOptionsForProject(projectSelect.value || '', '');
      }
    }
  }

  function renderJournalClubList() {
    if (!state.journalClubs.length) {
      journalClubList.innerHTML = '<p class="small-note">No journal clubs yet.</p>';
      return;
    }

    journalClubList.innerHTML = state.journalClubs.map((club) => `
      <article class="card">
        <h4>${safeText(club.name)}</h4>
        <p>${safeText(club.description || 'No description')}</p>
        <div class="card-actions">
          <button class="danger-btn" data-journal-club-delete="${club.id}">Delete</button>
        </div>
      </article>
    `).join('');

    journalClubList.querySelectorAll('[data-journal-club-delete]').forEach((button) => {
      button.addEventListener('click', () => deleteJournalClub(button.dataset.journalClubDelete));
    });
  }

  function renderLinkTargets() {
    const selected = paperLinkTargetSelect.value;
    const options = getCurrentLinkOptions();

    if (!options.length) {
      paperLinkTargetSelect.innerHTML = '<option value="">No target available</option>';
      return;
    }

    paperLinkTargetSelect.innerHTML = options
      .map((item) => `<option value="${item.id}">${safeText(item.name)}</option>`)
      .join('');

    if (selected && options.some((item) => item.id === selected)) {
      paperLinkTargetSelect.value = selected;
    }
  }

  function renderEntryOptionsForProject(projectId, selectedEntryId) {
    const entries = (state.notebookEntries || [])
      .filter((entry) => entry.projectId === projectId)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (!entries.length) {
      return '<option value="">No experiment entries</option>';
    }
    const options = ['<option value="">Select experiment entry</option>'];
    entries.forEach((entry) => {
      const isSelected = selectedEntryId === entry.id ? ' selected' : '';
      options.push(`<option value="${entry.id}"${isSelected}>${safeText(entry.protocolName || entry.id)} (${safeText(entry.updatedAt || '-')})</option>`);
    });
    return options.join('');
  }

  function renderProjectOptions(selectedProjectId) {
    const options = ['<option value="">Select project</option>'];
    (state.projects || []).forEach((project) => {
      const isSelected = selectedProjectId === project.id ? ' selected' : '';
      options.push(`<option value="${project.id}"${isSelected}>${safeText(project.name)}</option>`);
    });
    return options.join('');
  }

  function renderPaperList() {
    if (!state.papers.length) {
      paperList.innerHTML = '<p class="small-note">No papers uploaded yet.</p>';
      return;
    }

    paperList.innerHTML = state.papers
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((paper) => {
        const methodsHtml = (paper.methodsExtract || []).map((method, index) => `
          <article class="card">
            <p><strong>${safeText(method.title || `Method ${index + 1}`)}</strong></p>
            <p>${safeText((method.steps || []).join(' | ') || '-')}</p>
            <p><strong>Citations:</strong> ${safeText((method.citations || []).join('; ') || '-')}</p>
            <button class="ghost-btn" data-paper-method-to-protocol data-paper-id="${paper.id}" data-method-index="${index}">Create Protocol Draft</button>
          </article>
        `).join('');

        const reagentsHtml = (paper.keyReagents || []).map((item) => `
          <article class="card">
            <p><strong>${safeText(item.name)}</strong> <span class="small-note">(${safeText(item.type)})</span></p>
            <p><strong>ID:</strong> ${safeText(item.identifier || '-')}</p>
            <p><strong>Notes:</strong> ${safeText(item.notes || '-')}</p>
            <p><strong>Citation:</strong> ${safeText(item.citation || '-')}</p>
          </article>
        `).join('');

        const projectIdDefault = paper.linkedType === 'project' ? paper.linkedId : '';
        const links = (state.paperExperimentLinks || []).filter((item) => item.paperId === paper.id);
        const linksHtml = links.map((link) => `
          <p class="small-note">Experiment link: project=${safeText(link.projectId)} entry=${safeText(link.entryId)} note=${safeText(link.note || '-')}</p>
        `).join('');

        return `
          <article class="card" data-paper-card="${paper.id}">
            <h3>${safeText(paper.title)}</h3>
            <p><strong>PDF:</strong> ${safeText(paper.fileName)}</p>
            <p><strong>Linked To:</strong> ${safeText(formatLinkedTarget(paper))}</p>
            <p><strong>Status:</strong> <span class="status-badge ${statusClass(paper.summaryStatus)}">${safeText(statusLabel(paper.summaryStatus))}</span></p>
            <p><strong>Updated:</strong> ${new Date(paper.updatedAt).toLocaleString()}</p>
            <p><strong>Summary:</strong> ${safeText(paper.summary || 'No summary yet.')}</p>
            <div class="card-actions">
              <a class="ghost-btn" href="${paper.pdfDataUrl}" target="_blank" rel="noopener noreferrer">Open PDF</a>
              <button class="primary-btn" data-paper-summarize="${paper.id}" ${paper.summaryStatus === 'running' ? 'disabled' : ''}>
                ${paper.summaryStatus === 'running' ? 'Summarizing...' : 'Summarize'}
              </button>
              <button class="ghost-btn" data-paper-extract-methods="${paper.id}" ${paper.methodsStatus === 'running' ? 'disabled' : ''}>
                ${paper.methodsStatus === 'running' ? 'Extracting Methods...' : 'Extract Methods'}
              </button>
              <button class="ghost-btn" data-paper-extract-reagents="${paper.id}" ${paper.reagentsStatus === 'running' ? 'disabled' : ''}>
                ${paper.reagentsStatus === 'running' ? 'Extracting Reagents...' : 'Extract Reagents'}
              </button>
              <button class="danger-btn" data-paper-delete="${paper.id}">Delete</button>
            </div>
            <div class="stack-form">
              <p><strong>Methods Extraction</strong></p>
              ${methodsHtml || '<p class="small-note">No methods extracted yet.</p>'}
              <p><strong>Key Reagents</strong></p>
              ${reagentsHtml || '<p class="small-note">No key reagents extracted yet.</p>'}
            </div>
            <div class="stack-form">
              <p><strong>Link to Experiment</strong></p>
              <label>
                Project
                <select data-link-project>${renderProjectOptions(projectIdDefault)}</select>
              </label>
              <label>
                Experiment Entry
                <select data-link-entry>${renderEntryOptionsForProject(projectIdDefault, '')}</select>
              </label>
              <label>
                Inspiration Note
                <input data-link-note placeholder="e.g. Inspired by Fig 2 panel C" />
              </label>
              <button class="ghost-btn" data-paper-link-entry data-paper-id="${paper.id}">Save Paper-Experiment Link</button>
              ${linksHtml || '<p class="small-note">No experiment links yet.</p>'}
            </div>
          </article>
        `;
      })
      .join('');
  }

  function formatLinkedTarget(paper) {
    const prefix = paper.linkedType === 'journal-club' ? 'Journal Club' : 'Project';
    return `${prefix}: ${paper.linkedName || 'Unknown'}`;
  }

  function statusLabel(status) {
    if (status === 'running') {
      return 'Running';
    }
    if (status === 'error') {
      return 'Error';
    }
    return 'Idle';
  }

  function statusClass(status) {
    if (status === 'running') {
      return 'status-running';
    }
    if (status === 'error') {
      return 'status-error';
    }
    return 'status-idle';
  }

  function render() {
    renderJournalClubList();
    renderLinkTargets();
    renderPaperList();
    renderKnowledgeSection();
  }

  return { render, renderLinkTargets };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read PDF file.'));
    reader.readAsDataURL(file);
  });
}

const LLM_PROVIDER_ENDPOINTS = {
  openai: 'https://api.openai.com/v1/responses',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  claude: 'https://api.anthropic.com/v1/messages'
};

function inferProviderFromEndpoint(endpoint) {
  const value = String(endpoint || '').trim().toLowerCase();
  if (!value) {
    return '';
  }
  if (value.includes('anthropic.com')) {
    return 'claude';
  }
  if (value.includes('generativelanguage.googleapis.com') || value.includes('ai.google')) {
    return 'gemini';
  }
  if (value.includes('openai.com') || value.includes('/openai/')) {
    return 'openai';
  }
  return '';
}

function normalizeLlmProvider(provider, endpoint = '') {
  const clean = String(provider || '').trim().toLowerCase();
  if (clean === 'openai' || clean === 'gemini' || clean === 'claude') {
    return clean;
  }
  return inferProviderFromEndpoint(endpoint) || 'openai';
}

function defaultEndpointForProvider(provider) {
  const resolved = normalizeLlmProvider(provider);
  return LLM_PROVIDER_ENDPOINTS[resolved] || LLM_PROVIDER_ENDPOINTS.openai;
}

function getLlmRequestConfig(llm) {
  const legacySetting = String(llm?.api || '').trim();
  const endpointCandidate = String(llm?.apiEndpoint || '').trim() || (legacySetting.startsWith('http') ? legacySetting : '');
  const provider = normalizeLlmProvider(llm?.provider, endpointCandidate);
  const endpoint = endpointCandidate || defaultEndpointForProvider(provider);
  const token = String(llm?.apiKey || '').trim() || (legacySetting && !legacySetting.startsWith('http') ? legacySetting : '');

  if (!token) {
    throw new Error('Missing API key in Settings > LLM Model & API.');
  }

  return { provider, endpoint, token };
}

async function requestResponses({ llm, modelFallbackPrompt, fileName, pdfDataUrl, prompt }) {
  const model = String(llm?.model || '').trim();
  if (!model) {
    throw new Error('Missing model in Settings > LLM Model & API.');
  }
  const { provider, endpoint, token } = getLlmRequestConfig(llm);

  if (provider === 'claude') {
    return requestClaude({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  if (provider === 'gemini') {
    return requestGemini({
      endpoint,
      token,
      model,
      prompt: prompt || modelFallbackPrompt || '',
      pdfDataUrl
    });
  }
  return requestOpenAi({
    endpoint,
    token,
    model,
    prompt: prompt || modelFallbackPrompt || '',
    fileName,
    pdfDataUrl
  });
}

function parsePdfDataUrl(pdfDataUrl) {
  const value = String(pdfDataUrl || '').trim();
  const match = value.match(/^data:application\/pdf(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match?.[1]) {
    return '';
  }
  return match[1];
}

async function requestOpenAi({ endpoint, token, model, prompt, fileName, pdfDataUrl }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: pdfDataUrl
            ? [
              { type: 'input_text', text: prompt },
              {
                type: 'input_file',
                filename: fileName || 'paper.pdf',
                file_data: pdfDataUrl
              }
            ]
            : [
              { type: 'input_text', text: prompt }
            ]
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  if (payload.output_text) {
    return payload.output_text;
  }

  const chunks = [];
  (payload.output || []).forEach((item) => {
    (item.content || []).forEach((content) => {
      if (content.type === 'output_text' && content.text) {
        chunks.push(content.text);
      }
    });
  });
  return chunks.join('\n').trim();
}

async function requestClaude({ endpoint, token, model, prompt, pdfDataUrl }) {
  const content = [{ type: 'text', text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Claude request.');
  }
  if (pdfBase64) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      messages: [
        {
          role: 'user',
          content
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  return (payload?.content || [])
    .filter((item) => item?.type === 'text' && item.text)
    .map((item) => item.text)
    .join('\n')
    .trim();
}

function buildGeminiGenerateContentUrl(endpoint, model, token) {
  const cleanEndpoint = String(endpoint || '').trim() || LLM_PROVIDER_ENDPOINTS.gemini;
  let url = cleanEndpoint.replace(/\/+$/, '');
  if (!url.includes(':generateContent')) {
    if (/\/models\/[^/?#]+$/i.test(url)) {
      url = `${url}:generateContent`;
    } else if (/\/models$/i.test(url)) {
      url = `${url}/${encodeURIComponent(model)}:generateContent`;
    } else {
      url = `${url}/models/${encodeURIComponent(model)}:generateContent`;
    }
  }
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(token)}`;
}

async function requestGemini({ endpoint, token, model, prompt, pdfDataUrl }) {
  const parts = [{ text: prompt }];
  const pdfBase64 = parsePdfDataUrl(pdfDataUrl);
  if (pdfDataUrl && !pdfBase64) {
    throw new Error('Failed to parse PDF data for Gemini request.');
  }
  if (pdfBase64) {
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBase64
      }
    });
  }

  const response = await fetch(buildGeminiGenerateContentUrl(endpoint, model, token), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts
        }
      ],
      generationConfig: {
        maxOutputTokens: 1400
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const payload = await response.json();
  const candidate = Array.isArray(payload?.candidates) ? payload.candidates[0] : null;
  if (!candidate?.content?.parts) {
    return '';
  }
  return candidate.content.parts
    .filter((part) => typeof part?.text === 'string' && part.text.trim())
    .map((part) => part.text)
    .join('\n')
    .trim();
}

async function requestSummary({ llm, pdfDataUrl, fileName, title }) {
  const prompts = await getLlmPrompts();
  return requestResponses({
    llm,
    fileName,
    pdfDataUrl,
    prompt: renderPromptTemplate(requirePrompt(prompts, 'paperSummary'), {
      title: title || fileName
    })
  });
}

async function requestStructuredFromPaper({ llm, pdfDataUrl, fileName, title, instruction }) {
  const prompts = await getLlmPrompts();
  const raw = await requestResponses({
    llm,
    fileName,
    pdfDataUrl,
    prompt: `${instruction}\n\n${renderPromptTemplate(requirePrompt(prompts, 'paperTitleSuffix'), {
      title: title || fileName
    })}`
  });
  return parseJsonFromText(raw);
}

async function requestText({ llm, modelFallbackPrompt }) {
  return requestResponses({
    llm,
    modelFallbackPrompt
  });
}

function parseJsonFromText(raw) {
  const clean = String(raw || '').trim();
  if (!clean) {
    return {};
  }
  try {
    return JSON.parse(clean);
  } catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) {
      return {};
    }
    try {
      return JSON.parse(match[0]);
    } catch {
      return {};
    }
  }
}

const LLM_PROMPTS_PATH = './data/llm-prompts.json';
const DEFAULT_LLM_PROMPTS = {
  paperSummary: '',
  extractMethods: '',
  extractReagents: '',
  knowledgeQa: '',
  paperTitleSuffix: ''
};

let llmPromptCache = null;
let llmPromptPromise = null;

function normalizePromptConfig(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const fromNested = source.papers && typeof source.papers === 'object' ? source.papers : {};
  const fromFlat = source;
  return {
    ...DEFAULT_LLM_PROMPTS,
    ...fromFlat,
    ...fromNested
  };
}

async function getLlmPrompts() {
  if (llmPromptCache) {
    return llmPromptCache;
  }

  if (!llmPromptPromise) {
    llmPromptPromise = fetch(LLM_PROMPTS_PATH)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load prompts: ${response.status}`);
        }
        return response.json();
      })
      .then((parsed) => {
        llmPromptCache = normalizePromptConfig(parsed);
        return llmPromptCache;
      })
      .catch(() => {
        llmPromptCache = normalizePromptConfig({});
        return llmPromptCache;
      });
  }

  return llmPromptPromise;
}

function requirePrompt(prompts, key) {
  const value = String(prompts?.[key] || '').trim();
  if (!value) {
    throw new Error(`Missing LLM prompt "${key}" in ${LLM_PROMPTS_PATH}.`);
  }
  return value;
}

function renderPromptTemplate(template, vars = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key) => {
    return String(vars[key] ?? '');
  });
}
