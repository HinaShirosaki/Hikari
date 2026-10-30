export function createPaperAgentChatContextGetter({ state, getActivePaperId } = {}) {
  return () => {
    const paperId = String(getActivePaperId?.() || '').trim();
    const paper = paperId
      ? (state?.papers || []).find((item) => String(item?.id || '').trim() === paperId)
      : null;
    const projectId = paper?.linkedType === 'project'
      ? String(paper?.linkedId || '').trim()
      : '';
    return {
      scopeType: 'paper',
      paperId,
      paperTitle: String(paper?.title || paper?.fileName || '').trim(),
      projectId,
      knowledgeMarkdownRelativePath: String(
        paper?.knowledgeMarkdownRelativePath || paper?.knowledge_markdown_relative_path || ''
      ).trim(),
      knowledgeExtractedTextRelativePath: String(
        paper?.knowledgeExtractedTextRelativePath || paper?.knowledge_extracted_text_relative_path || ''
      ).trim(),
      knowledgeMetaRelativePath: String(
        paper?.knowledgeMetaRelativePath || paper?.knowledge_meta_relative_path || ''
      ).trim(),
      knowledgeStatus: String(paper?.knowledgeStatus || paper?.knowledge_status || '').trim()
    };
  };
}
