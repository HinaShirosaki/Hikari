import { asArray } from '../../lib/normalize.js';
import { trimText } from './text.js';

function getMethodStepText(step) {
  if (typeof step === 'string') {
    return trimText(step, 180);
  }
  return trimText(step?.action || step?.text || step?.instruction || step?.description, 180);
}

export function mapPaper(paper) {
  const summaryStructured = paper?.summaryStructured && typeof paper.summaryStructured === 'object'
    ? paper.summaryStructured
    : {};
  const keyFigures = asArray(paper?.keyFigures).length
    ? asArray(paper.keyFigures)
    : asArray(summaryStructured?.important_figures_or_tables).map((item) => (
      typeof item === 'string'
        ? trimText(item, 220)
        : trimText(`${item?.item || item?.label || item?.figure || 'figure'}: ${item?.summary || item?.description || ''}`, 220)
    ));
  const hasUploadedPdf = Boolean(trimText(paper?.pdfDataUrl, 40))
    || Boolean(trimText(paper?.storedFilePath, 80))
    || Boolean(trimText(paper?.storedRelativePath, 80));
  const knowledgeMarkdownRelativePath = trimText(
    paper?.knowledgeMarkdownRelativePath || paper?.knowledge_markdown_relative_path,
    2400
  );
  const knowledgeExtractedTextRelativePath = trimText(
    paper?.knowledgeExtractedTextRelativePath || paper?.knowledge_extracted_text_relative_path,
    2400
  );
  const knowledgeMetaRelativePath = trimText(
    paper?.knowledgeMetaRelativePath || paper?.knowledge_meta_relative_path,
    2400
  );

  return {
    id: String(paper?.id || ''),
    title: trimText(paper?.title, 220),
    linkedType: String(paper?.linkedType || ''),
    linkedId: String(paper?.linkedId || ''),
    linked_project_name: trimText(paper?.linkedName || paper?.projectName, 220),
    summary: trimText(paper?.summary, 1200),
    methods: asArray(paper?.methodsExtract)
      .slice(0, 6)
      .map((method) => ({
        title: trimText(method?.title, 180),
        steps: asArray(method?.steps).slice(0, 10).map((step) => getMethodStepText(step)).filter(Boolean),
        citations: asArray(method?.citations).slice(0, 8).map((item) => trimText(item, 120)).filter(Boolean)
      })),
    reagents: asArray(paper?.keyReagents)
      .slice(0, 12)
      .map((item) => ({
        name: trimText(item?.name, 160),
        type: trimText(item?.type, 80),
        identifier: trimText(item?.identifier, 120),
        notes: trimText(item?.notes, 220)
      }))
      .filter((item) => item.name),
    key_figures: keyFigures.map((item) => trimText(item, 220)).filter(Boolean).slice(0, 10),
    has_uploaded_pdf: hasUploadedPdf,
    deep_read_ready: paper?.deepReadReady === true || paper?.deep_read_ready === true,
    availability_status: trimText(paper?.availabilityStatus || paper?.availability_status, 80),
    ingestion_status: trimText(paper?.ingestionStatus || paper?.ingestion_status, 80),
    ingestion_updated_at: trimText(paper?.ingestionUpdatedAt || paper?.ingestion_updated_at || paper?.updatedAt, 80),
    ingestion_errors: asArray(paper?.ingestionErrors || paper?.ingestion_errors).map((item) => trimText(item, 220)).filter(Boolean).slice(0, 5),
    transformed_markdown_relative_path: knowledgeMarkdownRelativePath,
    knowledge_markdown_relative_path: knowledgeMarkdownRelativePath,
    knowledge_extracted_text_relative_path: knowledgeExtractedTextRelativePath,
    knowledge_meta_relative_path: knowledgeMetaRelativePath,
    knowledge_status: trimText(paper?.knowledgeStatus || paper?.knowledge_status, 80),
    knowledge_generation_method: trimText(paper?.knowledgeGenerationMethod || paper?.knowledge_generation_method, 120),
    updated_at: trimText(paper?.updatedAt || paper?.createdAt, 80)
  };
}

export function toConversation(messages) {
  return asArray(messages)
    .slice(-12)
    .map((message) => ({
      role: message?.role === 'assistant' ? 'assistant' : 'user',
      text: trimText([
        trimText(message?.text, 3600),
        asArray(message?.attachments).length
          ? `Attachments: ${asArray(message.attachments).map((attachment) => trimText(attachment?.name, 120)).filter(Boolean).join(', ')}`
          : ''
      ].filter(Boolean).join('\n\n'), 4000)
    }))
    .filter((item) => item.text);
}
