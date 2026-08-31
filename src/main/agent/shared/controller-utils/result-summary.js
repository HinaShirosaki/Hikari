'use strict';

// Condenses a finished agent result into the one-line-per-tool shape the chat
// log stores.
function createAgentResultSummary({
  asArray,
  cleanText
} = {}) {
  function summarizeAgentResultForLog(result) {
    const source = result && typeof result === 'object' ? result : {};
    const parser = source.parser && typeof source.parser === 'object' ? source.parser : {};
    const entities = parser.entities && typeof parser.entities === 'object' ? parser.entities : {};
    const inventorySearch = parser.inventory_search && typeof parser.inventory_search === 'object'
      ? parser.inventory_search
      : {};
    const protocolNotebook = source.protocol_to_notebook && typeof source.protocol_to_notebook === 'object'
      ? source.protocol_to_notebook
      : null;
    const notebookDraft = source.notebook_draft && typeof source.notebook_draft === 'object'
      ? source.notebook_draft
      : null;
    const notebookAppend = source.notebook_append && typeof source.notebook_append === 'object'
      ? source.notebook_append
      : null;
    const inventoryLookup = source.inventory_lookup && typeof source.inventory_lookup === 'object'
      ? source.inventory_lookup
      : null;
    const notebookLookup = source.notebook_lookup && typeof source.notebook_lookup === 'object'
      ? source.notebook_lookup
      : null;
    const purchaseRecommendation = source.purchase_recommendation && typeof source.purchase_recommendation === 'object'
      ? source.purchase_recommendation
      : null;
    const skillCommand = source.skill_command && typeof source.skill_command === 'object'
      ? source.skill_command
      : null;
    const codexAgent = source.codex_agent && typeof source.codex_agent === 'object'
      ? source.codex_agent
      : null;
    const generalScienceQuestion = source.general_science_question && typeof source.general_science_question === 'object'
      ? source.general_science_question
      : null;
    const projectScienceQuestion = source.project_science_question && typeof source.project_science_question === 'object'
      ? source.project_science_question
      : null;
    const resultAnalysis = source.result_analysis && typeof source.result_analysis === 'object'
      ? source.result_analysis
      : null;
    const notebook = protocolNotebook?.notebook && typeof protocolNotebook.notebook === 'object'
      ? protocolNotebook.notebook
      : null;
    const notebookProtocol = notebook?.protocol && typeof notebook.protocol === 'object'
      ? notebook.protocol
      : {};
    const notebookProject = notebook?.project && typeof notebook.project === 'object'
      ? notebook.project
      : {};
    return {
      ok: source.ok === true,
      parser: {
        primary_intent: cleanText(parser.primary_intent, 80),
        reasoning_effort: Number.isFinite(Number(parser.reasoning_effort)) ? Number(parser.reasoning_effort) : 0,
        direct_answer: cleanText(parser.direct_answer, 12000) || null,
        needs_clarification: parser.needs_clarification === true,
        clarification_reason: cleanText(parser.clarification_reason, 260) || null,
        entities: Object.entries(entities).reduce((acc, [key, value]) => {
          acc[cleanText(key, 80)] = cleanText(value, 240) || null;
          return acc;
        }, {}),
        inventory_search: {
          candidate_terms: asArray(inventorySearch.candidate_terms).map((item) => cleanText(item, 180)).filter(Boolean)
        },
        protocol_candidates: asArray(parser.protocol_candidates).map((item) => cleanText(item, 220)).filter(Boolean),
        reasoning_summary: cleanText(parser.reasoning_summary, 1200)
      },
      protocol_to_notebook: protocolNotebook
        ? {
          status: cleanText(protocolNotebook.status, 40),
          candidate_matches: asArray(protocolNotebook.candidate_matches).map((item) => ({
            id: cleanText(item?.id, 120),
            name: cleanText(item?.name, 220),
            score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null
          })).filter((item) => item.id || item.name),
          selected_protocol: protocolNotebook.selected_protocol && typeof protocolNotebook.selected_protocol === 'object'
            ? {
              id: cleanText(protocolNotebook.selected_protocol.id, 120),
              name: cleanText(protocolNotebook.selected_protocol.name, 220),
              selection_method: cleanText(protocolNotebook.selected_protocol.selection_method, 80)
            }
            : null,
          missing_placeholders: asArray(protocolNotebook.missing_placeholders).map((item) => ({
            placeholder_key: cleanText(item?.placeholder_key, 160),
            display: cleanText(item?.display, 160),
            reason: cleanText(item?.reason, 220)
          })).filter((item) => item.placeholder_key || item.display),
          follow_up_questions: asArray(protocolNotebook.follow_up_questions).map((item) => cleanText(item, 260)).filter(Boolean),
          project_name: cleanText(protocolNotebook.project_name, 200),
          notebook: notebook
            ? {
              protocol: {
                id: cleanText(notebookProtocol.id, 120),
                name: cleanText(notebookProtocol.name, 220)
              },
              project: {
                id: cleanText(notebookProject.id, 120),
                name: cleanText(notebookProject.name, 220)
              },
              rendered_step_count: asArray(notebook.rendered_steps).length,
              unresolved_placeholder_count: asArray(notebook.unresolved_placeholders).length
            }
            : null
        }
        : null,
      notebook_draft: notebookDraft
        ? {
          status: cleanText(notebookDraft.status, 40),
          project_name: cleanText(notebookDraft.project_name, 200),
          selected_protocol: notebookDraft.selected_protocol && typeof notebookDraft.selected_protocol === 'object'
            ? {
              id: cleanText(notebookDraft.selected_protocol.id, 120),
              name: cleanText(notebookDraft.selected_protocol.name, 220),
              selection_method: cleanText(notebookDraft.selected_protocol.selection_method, 80)
            }
            : null,
          source_workflow: notebookDraft.source_workflow && typeof notebookDraft.source_workflow === 'object'
            ? {
              id: cleanText(notebookDraft.source_workflow.id, 120),
              name: cleanText(notebookDraft.source_workflow.name, 220),
              block_id: cleanText(notebookDraft.source_workflow.block_id, 120),
              block_title: cleanText(notebookDraft.source_workflow.block_title, 220)
            }
            : null,
          missing_placeholders: asArray(notebookDraft.missing_placeholders).map((item) => ({
            placeholder_key: cleanText(item?.placeholder_key, 160),
            display: cleanText(item?.display, 160),
            reason: cleanText(item?.reason, 220)
          })).filter((item) => item.placeholder_key || item.display),
          follow_up_questions: asArray(notebookDraft.follow_up_questions).map((item) => cleanText(item, 260)).filter(Boolean),
          proposal: notebookDraft.proposal && typeof notebookDraft.proposal === 'object'
            ? {
              proposal_id: cleanText(notebookDraft.proposal.proposal_id, 160),
              title: cleanText(notebookDraft.proposal.title, 220),
              purpose: cleanText(notebookDraft.proposal.purpose, 500)
            }
            : null
        }
        : null,
      notebook_append: notebookAppend
        ? {
          status: cleanText(notebookAppend.status, 40),
          proposal: notebookAppend.proposal && typeof notebookAppend.proposal === 'object'
            ? {
              proposal_id: cleanText(notebookAppend.proposal.proposal_id, 200),
              notebook_entry_id: cleanText(notebookAppend.proposal.notebook_entry_id, 220),
              page_title: cleanText(notebookAppend.proposal.page_title, 320),
              section_title: cleanText(notebookAppend.proposal.section_title, 220),
              source_count: asArray(notebookAppend.proposal.sources).length
            }
            : null
        }
        : null,
      inventory_lookup: inventoryLookup
        ? {
          status: cleanText(inventoryLookup.status, 40),
          query: cleanText(inventoryLookup.query, 320),
          source: cleanText(inventoryLookup.source, 80),
          backfilled_sql: inventoryLookup.backfilled_sql === true,
          item_count: asArray(inventoryLookup.items).length
        }
        : null,
      notebook_lookup: notebookLookup
        ? {
          status: cleanText(notebookLookup.status, 40),
          query: cleanText(notebookLookup.query, 320),
          source: cleanText(notebookLookup.source, 80),
          backfilled_sql: notebookLookup.backfilled_sql === true,
          item_count: asArray(notebookLookup.items).length
        }
        : null,
      purchase_recommendation: purchaseRecommendation
        ? {
          status: cleanText(purchaseRecommendation.status, 40),
          query: cleanText(purchaseRecommendation.query, 320),
          source: cleanText(purchaseRecommendation.source, 80),
          budget_preference: cleanText(purchaseRecommendation?.filters?.budget_preference, 80),
          item_count: asArray(purchaseRecommendation.items).length
        }
        : null,
      skill_command: skillCommand
        ? {
          status: cleanText(skillCommand.status, 40),
          skill_name: cleanText(skillCommand.skill_name, 160),
          command_name: cleanText(skillCommand.command_name, 80),
          tool_name: cleanText(skillCommand.tool_name, 120),
          summary: cleanText(skillCommand.summary, 500)
        }
        : null,
      codex_agent: codexAgent
        ? {
          status: cleanText(codexAgent.status, 40),
          codex_session_id: cleanText(codexAgent.codex_session_id || codexAgent.codexSessionId, 240),
          resumed_codex_session_id: cleanText(codexAgent.resumed_codex_session_id || codexAgent.resumedCodexSessionId, 240),
          recovered_from_codex_session_id: cleanText(
            codexAgent.recovered_from_codex_session_id || codexAgent.recoveredFromCodexSessionId,
            240
          ),
          answer: cleanText(codexAgent.answer, 500),
          reasoning_summary: cleanText(codexAgent.reasoning_summary, 500),
          follow_up_count: asArray(codexAgent.follow_up_questions).length,
          citation_count: asArray(codexAgent.citations).length
        }
        : null,
      codex_session_id: cleanText(
        source.codex_session_id
          || source.codexSessionId
          || codexAgent?.codex_session_id
          || codexAgent?.codexSessionId,
        240
      ),
      resumed_codex_session_id: cleanText(
        source.resumed_codex_session_id
          || source.resumedCodexSessionId
          || codexAgent?.resumed_codex_session_id
          || codexAgent?.resumedCodexSessionId,
        240
      ),
      recovered_from_codex_session_id: cleanText(
        source.recovered_from_codex_session_id
          || source.recoveredFromCodexSessionId
          || codexAgent?.recovered_from_codex_session_id
          || codexAgent?.recoveredFromCodexSessionId,
        240
      ),
      general_science_question: generalScienceQuestion
        ? {
          status: cleanText(generalScienceQuestion.status, 40),
          answer: cleanText(generalScienceQuestion.answer, 500),
          confidence: Number.isFinite(Number(generalScienceQuestion.confidence))
            ? Number(generalScienceQuestion.confidence)
            : null,
          citation_count: asArray(generalScienceQuestion.citations).length,
          rounds_executed: Number.isFinite(Number(generalScienceQuestion.rounds_executed))
            ? Number(generalScienceQuestion.rounds_executed)
            : 0
        }
        : null,
      project_science_question: projectScienceQuestion
        ? {
          status: cleanText(projectScienceQuestion.status, 40),
          answer: cleanText(projectScienceQuestion.answer, 500),
          confidence: Number.isFinite(Number(projectScienceQuestion.confidence))
            ? Number(projectScienceQuestion.confidence)
            : null,
          citation_count: asArray(projectScienceQuestion.citations).length,
          rounds_executed: Number.isFinite(Number(projectScienceQuestion.rounds_executed))
            ? Number(projectScienceQuestion.rounds_executed)
            : 0
        }
        : null,
      result_analysis: resultAnalysis
        ? {
          status: cleanText(resultAnalysis.status, 40),
          answer: cleanText(resultAnalysis.answer, 500),
          confidence: Number.isFinite(Number(resultAnalysis.confidence))
            ? Number(resultAnalysis.confidence)
            : null,
          citation_count: asArray(resultAnalysis.citations).length,
          rounds_executed: Number.isFinite(Number(resultAnalysis.rounds_executed))
            ? Number(resultAnalysis.rounds_executed)
            : 0
        }
        : null,
      error: cleanText(source.error, 2000)
    };
  }

  return {
    summarizeAgentResultForLog
  };
}

module.exports = { createAgentResultSummary };
