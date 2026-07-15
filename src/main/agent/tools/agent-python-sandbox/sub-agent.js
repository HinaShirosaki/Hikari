'use strict';

const {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MIN_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA
} = require('./constants.js');
const {
  asArray,
  ensureObject,
  cleanText,
  clamp
} = require('./utils.js');
const {
  normalizePythonSandboxFiles,
  normalizePythonSandboxReadbackPaths,
  buildStoredPythonSandboxInput,
  buildStoredPythonSandboxResult
} = require('./normalize.js');
const { classifyPythonSandboxFailure } = require('./classifier.js');

function defaultManagedPythonSubAgentTurn({ phase, message, metadata }) {
  if (phase === 'create') {
    return {
      assistant_message: 'Python sandbox sub-agent is ready to supervise one sandbox run and report debugging notes if execution fails.',
      summary: 'Created Python sandbox supervisor.'
    };
  }

  const details = classifyPythonSandboxFailure(ensureObject(metadata).debug_payload);
  return {
    assistant_message: [
      `Observed sandbox issue: ${details.likely_cause}`,
      `Suggested next step: ${details.suggested_fix}`,
      cleanText(message, 1200) ? `Debug context: ${cleanText(message, 1200)}` : ''
    ].filter(Boolean).join('\n'),
    summary: `Processed Python sandbox failure (${details.classification}).`,
    metadata: {
      classification: details.classification
    }
  };
}

function buildManagedPythonCreateMessage(source) {
  return [
    'Supervise this Python sandbox execution.',
    cleanText(source.task_type, 120) ? `Task type: ${cleanText(source.task_type, 120)}.` : '',
    `Readback paths: ${asArray(source.readback_paths).map((value) => cleanText(value, 180)).filter(Boolean).join(', ') || 'none'}.`,
    `Code preview:\n${cleanText(source.code, 1200)}`
  ].filter(Boolean).join('\n');
}

function buildManagedPythonDebugMessage(source, sandboxResult) {
  return [
    `Sandbox run ${cleanText(sandboxResult.run_id, 120) || 'unknown'} failed.`,
    cleanText(source.task_type, 120) ? `Task type: ${cleanText(source.task_type, 120)}.` : '',
    `Exit code: ${Number.isFinite(Number(sandboxResult.exit_code)) ? Number(sandboxResult.exit_code) : 'unknown'}.`,
    cleanText(sandboxResult.signal, 40) ? `Signal: ${cleanText(sandboxResult.signal, 40)}.` : '',
    sandboxResult.timed_out === true ? 'The run timed out.' : '',
    cleanText(sandboxResult.stderr, 1600) ? `stderr:\n${cleanText(sandboxResult.stderr, 1600)}` : '',
    cleanText(sandboxResult.stdout, 800) ? `stdout:\n${cleanText(sandboxResult.stdout, 800)}` : '',
    `Code preview:\n${cleanText(source.code, 1600)}`
  ].filter(Boolean).join('\n\n');
}

function buildPythonSandboxSubAgentSystemPrompt() {
  return [
    'You are the Python sandbox worker sub-agent.',
    'Own the sandbox task end to end: if a run fails, repair it yourself instead of asking the main agent to debug for you.',
    'When the main agent says the latest result is not sufficient, continue the work yourself and prepare the next sandbox run.',
    'Only return JSON that matches the requested schema.',
    'When you return action "rerun", provide a complete updated sandbox plan or only the fields that must change; omitted fields keep their prior values.',
    'Use action "return_result" only when the latest sandbox output is already good enough to hand back to the main agent without another run.',
    'Use action "give_up" only when you cannot make further progress from the available code, files, and feedback.'
  ].join('\n');
}

function buildPythonSandboxPlanFallback(requestType, metadata = {}) {
  const latestResult = buildStoredPythonSandboxResult(ensureObject(metadata.latest_sandbox_result));
  const feedback = cleanText(metadata.feedback, 2000);
  if (requestType === 'continue_plan' && latestResult.ok === true && !feedback) {
    return {
      action: 'return_result',
      assistant_message: 'The latest sandbox result is ready to return to the main agent.',
      summary: 'Returned the latest sandbox result without another run.'
    };
  }

  const details = classifyPythonSandboxFailure(ensureObject(metadata.latest_sandbox_result));
  if (requestType === 'repair_plan') {
    return {
      action: 'give_up',
      assistant_message: [
        `Observed sandbox issue: ${details.likely_cause}`,
        `Suggested next step: ${details.suggested_fix}`
      ].filter(Boolean).join('\n'),
      summary: `Unable to self-repair sandbox failure (${details.classification}) without model guidance.`
    };
  }

  return {
    action: 'give_up',
    assistant_message: feedback
      ? `The main agent asked for more work, but the sandbox helper needs model guidance to continue automatically. Feedback: ${feedback}`
      : 'The sandbox helper needs more guidance before it can continue automatically.',
    summary: 'Unable to continue the sandbox task automatically.'
  };
}

function normalizePythonSandboxPlan(rawPayload, fallback = {}) {
  const source = ensureObject(rawPayload);
  const normalizedAction = cleanText(source.action, 40).toLowerCase();
  const action = ['rerun', 'return_result', 'give_up'].includes(normalizedAction)
    ? normalizedAction
    : cleanText(fallback.action, 40).toLowerCase() || 'give_up';
  return {
    action,
    assistant_message: cleanText(source.assistant_message, 4000)
      || cleanText(fallback.assistant_message, 4000)
      || 'Python sandbox helper reviewed the latest run.',
    summary: cleanText(source.summary, 500)
      || cleanText(fallback.summary, 500)
      || 'Python sandbox helper returned a follow-up decision.',
    code: Object.prototype.hasOwnProperty.call(source, 'code')
      ? String(source.code || '')
      : (Object.prototype.hasOwnProperty.call(fallback, 'code') ? String(fallback.code || '') : ''),
    timeout_ms: Object.prototype.hasOwnProperty.call(source, 'timeout_ms')
      ? clamp(Number(source.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS, SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
      : (Number.isFinite(Number(fallback.timeout_ms))
        ? clamp(Number(fallback.timeout_ms), SANDBOX_MIN_TIMEOUT_MS, SANDBOX_MAX_TIMEOUT_MS)
        : null),
    files: Object.prototype.hasOwnProperty.call(source, 'files')
      ? normalizePythonSandboxFiles(source.files)
      : (Object.prototype.hasOwnProperty.call(fallback, 'files')
        ? normalizePythonSandboxFiles(fallback.files)
        : null),
    readback_paths: Object.prototype.hasOwnProperty.call(source, 'readback_paths')
      ? normalizePythonSandboxReadbackPaths(source.readback_paths)
      : (Object.prototype.hasOwnProperty.call(fallback, 'readback_paths')
        ? normalizePythonSandboxReadbackPaths(fallback.readback_paths)
        : null)
  };
}

function buildPythonSandboxPlanMessage({
  requestType,
  originalRequest,
  currentInput,
  latestResult,
  feedback = '',
  attemptNumber = 0,
  maxRepairAttempts = 0
} = {}) {
  const phaseLabel = requestType === 'continue_plan'
    ? 'The main agent was not satisfied with the last sandbox result and wants you to continue.'
    : 'The latest sandbox run failed. Repair the sandbox task yourself.';
  return [
    phaseLabel,
    originalRequest ? `Original main-agent request:\n${cleanText(originalRequest, 6000)}` : '',
    `Current sandbox input JSON:\n${JSON.stringify(buildStoredPythonSandboxInput(currentInput), null, 2)}`,
    `Latest sandbox result JSON:\n${JSON.stringify(buildStoredPythonSandboxResult(latestResult), null, 2)}`,
    feedback ? `Main-agent feedback:\n${cleanText(feedback, 6000)}` : '',
    requestType === 'repair_plan'
      ? `Repair attempts used: ${Math.max(0, Number(attemptNumber) || 0)} / ${Math.max(0, Number(maxRepairAttempts) || 0)}`
      : '',
    'Return JSON only.',
    'If you need another sandbox run, choose action "rerun".',
    'If the latest result is already sufficient, choose action "return_result".',
    'If you cannot make further progress, choose action "give_up".'
  ].filter(Boolean).join('\n\n');
}

function createManagedPythonSubAgentTurnRuntime(deps = {}) {
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const defaultSystemPrompt = typeof deps.buildSystemPrompt === 'function'
    ? deps.buildSystemPrompt
    : buildPythonSandboxSubAgentSystemPrompt;

  return async function managedPythonSubAgentTurn({ phase, message, metadata, system_prompt }) {
    const requestType = cleanText(ensureObject(metadata).request_type, 80).toLowerCase();
    if (phase === 'create') {
      return {
        assistant_message: 'Python sandbox sub-agent is ready to execute, repair, and continue sandbox work as needed.',
        summary: 'Created Python sandbox worker.'
      };
    }

    if (!['repair_plan', 'continue_plan'].includes(requestType)) {
      return defaultManagedPythonSubAgentTurn({ phase, message, metadata });
    }

    const fallback = buildPythonSandboxPlanFallback(requestType, metadata);
    if (!requestStructuredJsonPayload) {
      const normalizedFallback = normalizePythonSandboxPlan(fallback, fallback);
      return {
        assistant_message: normalizedFallback.assistant_message,
        summary: normalizedFallback.summary,
        output: normalizedFallback,
        metadata: {
          mode: 'fallback',
          request_type: requestType,
          action: normalizedFallback.action
        }
      };
    }

    const result = await requestStructuredJsonPayload({
      source: metadata,
      stage: requestType === 'continue_plan'
        ? 'python_sandbox_sub_agent_continue'
        : 'python_sandbox_sub_agent_repair',
      systemPrompt: cleanText(system_prompt, 12000) || defaultSystemPrompt(),
      userPrompt: cleanText(message, 48000),
      schema: PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA,
      traceContext: metadata?.traceContext || null,
      defaultError: 'Python sandbox sub-agent planning is not configured.'
    });

    const normalized = normalizePythonSandboxPlan(result?.payload, fallback);
    return {
      assistant_message: normalized.assistant_message,
      summary: normalized.summary,
      output: normalized,
      metadata: {
        mode: result?.ok && result.payload ? 'llm' : 'fallback',
        request_type: requestType,
        action: normalized.action
      }
    };
  };
}

function buildManagedPythonExecutionSummary(baseSummary, state = {}) {
  const summary = cleanText(baseSummary, 320);
  const repairRounds = Math.max(0, Number(state.repair_rounds) || 0);
  const continued = state.continued_from_sub_agent === true;
  const suffixes = [];
  if (continued) {
    suffixes.push(`Continued from Python sandbox sub-agent ${cleanText(state.sub_agent_id, 120) || 'session'}.`);
  }
  if (repairRounds > 0) {
    suffixes.push(`Self-repaired after ${repairRounds} round${repairRounds === 1 ? '' : 's'}.`);
  }
  return [summary, ...suffixes].filter(Boolean).join(' ');
}

module.exports = {
  defaultManagedPythonSubAgentTurn,
  buildManagedPythonCreateMessage,
  buildManagedPythonDebugMessage,
  buildPythonSandboxSubAgentSystemPrompt,
  buildPythonSandboxPlanFallback,
  normalizePythonSandboxPlan,
  buildPythonSandboxPlanMessage,
  createManagedPythonSubAgentTurnRuntime,
  buildManagedPythonExecutionSummary
};
