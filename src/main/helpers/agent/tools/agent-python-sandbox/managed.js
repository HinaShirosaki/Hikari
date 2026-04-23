'use strict';

const { createAgentSubAgentRuntime } = require('../agent-sub-agent.js');
const {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_DEFAULT_REPAIR_ATTEMPTS,
  SANDBOX_MAX_REPAIR_ATTEMPTS
} = require('./constants.js');
const {
  ensureObject,
  cleanText,
  clamp,
  isProcessAlive
} = require('./utils.js');
const {
  buildStoredPythonSandboxInput,
  buildStoredPythonSandboxResult,
  mergePythonSandboxInput,
  pythonSandboxInputsEqual
} = require('./normalize.js');
const { runPythonSandbox } = require('./runner.js');
const {
  buildManagedPythonCreateMessage,
  buildManagedPythonDebugMessage,
  buildPythonSandboxSubAgentSystemPrompt,
  normalizePythonSandboxPlan,
  buildPythonSandboxPlanMessage,
  createManagedPythonSubAgentTurnRuntime,
  buildManagedPythonExecutionSummary
} = require('./sub-agent.js');
const { cloneJson } = require('./utils.js');

function createManagedPythonSandboxRuntime(deps = {}) {
  const now = typeof deps.now === 'function' ? deps.now : (() => new Date().toISOString());
  const runPythonSandboxFn = typeof deps.runPythonSandbox === 'function' ? deps.runPythonSandbox : runPythonSandbox;
  const defaultSandboxRoot = cleanText(deps.sandboxRoot, 1200);
  const defaultPreferredPythonBin = cleanText(deps.preferredPythonBin, 240);
  const requestStructuredJsonPayload = typeof deps.requestStructuredJsonPayload === 'function'
    ? deps.requestStructuredJsonPayload
    : null;
  const buildCreateMessage = typeof deps.buildCreateMessage === 'function'
    ? deps.buildCreateMessage
    : buildManagedPythonCreateMessage;
  const buildDebugMessage = typeof deps.buildDebugMessage === 'function'
    ? deps.buildDebugMessage
    : buildManagedPythonDebugMessage;
  const buildSystemPrompt = typeof deps.buildSystemPrompt === 'function'
    ? deps.buildSystemPrompt
    : buildPythonSandboxSubAgentSystemPrompt;
  const subAgentRuntime = deps.subAgentRuntime && typeof deps.subAgentRuntime.createSubAgent === 'function'
    ? deps.subAgentRuntime
    : createAgentSubAgentRuntime({
      now,
      isProcessAlive: typeof deps.isProcessAlive === 'function' ? deps.isProcessAlive : isProcessAlive,
      getDefaultSystemPrompt: () => buildSystemPrompt(),
      runSubAgentTurn: typeof deps.runSubAgentTurn === 'function'
        ? deps.runSubAgentTurn
        : createManagedPythonSubAgentTurnRuntime({
          requestStructuredJsonPayload,
          buildSystemPrompt
        })
    });

  async function execute(input = {}, options = {}) {
    const source = ensureObject(input);
    const executionOptions = ensureObject(options);
    const requestedAgentId = cleanText(source.sub_agent_id || source.subAgentId, 160);
    const feedback = cleanText(source.feedback || executionOptions.feedback, 40000);
    const originalRequest = cleanText(
      executionOptions.message
      || executionOptions.originalMessage
      || source.message
      || source.request
      || '',
      6000
    );
    const rawMaxRepairAttempts = Object.prototype.hasOwnProperty.call(source, 'max_repair_attempts')
      ? source.max_repair_attempts
      : executionOptions.maxRepairAttempts;
    const maxRepairAttempts = Number.isFinite(Number(rawMaxRepairAttempts))
      ? clamp(Number(rawMaxRepairAttempts), 0, SANDBOX_MAX_REPAIR_ATTEMPTS)
      : SANDBOX_DEFAULT_REPAIR_ATTEMPTS;

    let created = null;
    let inspected = requestedAgentId
      ? subAgentRuntime.getSubAgent({ agent_id: requestedAgentId })
      : null;
    if (requestedAgentId && inspected?.ok !== true) {
      return {
        ok: false,
        sandbox: {
          ok: false,
          status: 'error',
          error: `Python sandbox sub-agent "${requestedAgentId}" was not found.`,
          summary: 'Python sandbox continuation failed before launch.'
        },
        sub_agent: null,
        debug: null,
        sub_agent_id: requestedAgentId,
        repair_rounds: 0,
        continued_from_sub_agent: true,
        summary: 'Python sandbox continuation failed before launch.'
      };
    }

    const storedTaskMetadata = ensureObject(inspected?.agent?.task?.metadata);
    const storedInput = buildStoredPythonSandboxInput(storedTaskMetadata.latest_input);
    const storedResult = buildStoredPythonSandboxResult(storedTaskMetadata.latest_sandbox_result);
    const baseInput = requestedAgentId
      ? mergePythonSandboxInput(storedInput, source)
      : mergePythonSandboxInput({}, source);

    if (!baseInput.code.trim()) {
      return {
        ok: false,
        sandbox: {
          ok: false,
          status: 'error',
          error: 'python-sandbox requires code for a new run or a resumable sub_agent_id with stored code.',
          summary: 'Python sandbox execution failed before launch.'
        },
        sub_agent: inspected?.agent || null,
        debug: null,
        sub_agent_id: requestedAgentId,
        repair_rounds: 0,
        continued_from_sub_agent: Boolean(requestedAgentId),
        summary: 'Python sandbox execution failed before launch.'
      };
    }

    if (!requestedAgentId) {
      created = await subAgentRuntime.createSubAgent({
        name: cleanText(executionOptions.name, 160) || `python-sandbox-${Date.now()}`,
        message: cleanText(buildCreateMessage(baseInput, executionOptions), 40000) || 'Supervise the next Python sandbox execution.',
        metadata: {
          task_type: 'python-sandbox',
          parent_request_id: cleanText(executionOptions.parent_request_id || executionOptions.parentRequestId, 160),
          main_agent_message: originalRequest,
          tags: ['python', 'sandbox', cleanText(baseInput.task_type, 80)].filter(Boolean).slice(0, 12)
        }
      });
      inspected = created?.agent?.id
        ? subAgentRuntime.getSubAgent({ agent_id: created.agent.id })
        : null;
    }

    const agentId = cleanText(requestedAgentId || created?.agent?.id, 160);
    const continuationOriginalRequest = originalRequest
      || cleanText(inspected?.agent?.metadata?.main_agent_message, 6000);
    const continuationInputChanged = requestedAgentId
      ? !pythonSandboxInputsEqual(storedInput, baseInput)
      : false;
    let workingInput = baseInput;
    let latestSandboxResult = storedResult?.run_id
      ? storedResult
      : null;
    let repairRounds = 0;
    let cumulativeRepairRounds = Math.max(0, Number(storedTaskMetadata.total_repair_attempts) || 0);
    let latestTurn = null;
    let returnedStoredResultDirectly = false;
    let shouldRunSandbox = true;
    let syntheticFailureResult = null;

    function buildManagedSandboxFailureResult(errorText, summaryText) {
      return {
        ok: false,
        run_id: '',
        status: 'error',
        error: cleanText(errorText, 4000) || 'Python sandbox continuation failed before another run.',
        timeout_ms: Number(workingInput.timeout_ms) || SANDBOX_DEFAULT_TIMEOUT_MS,
        python_executable: '',
        process_id: null,
        exit_code: null,
        signal: null,
        timed_out: false,
        stdout: '',
        stderr: '',
        files_written: [],
        readback_files: [],
        render_outputs: [],
        warnings: [],
        summary: cleanText(summaryText, 320) || 'Python sandbox continuation failed before another run.'
      };
    }

    async function requestSubAgentPlan(requestType, currentInput, currentResult, attemptNumber = 0) {
      if (!agentId) {
        return null;
      }
      const turn = await subAgentRuntime.sendSubAgentMessage({
        agent_id: agentId,
        message: buildPythonSandboxPlanMessage({
          requestType,
          originalRequest: continuationOriginalRequest,
          currentInput,
          latestResult: currentResult,
          feedback,
          attemptNumber,
          maxRepairAttempts
        }),
        metadata: {
          request_type: requestType,
          provider: cleanText(executionOptions.provider, 80),
          endpoint: cleanText(executionOptions.endpoint, 2000),
          apiKey: cleanText(executionOptions.apiKey, 400),
          model: cleanText(executionOptions.model, 120),
          traceContext: executionOptions.traceContext || null,
          feedback,
          latest_input: buildStoredPythonSandboxInput(currentInput),
          latest_sandbox_result: buildStoredPythonSandboxResult(currentResult),
          attempt_number: attemptNumber,
          max_repair_attempts: maxRepairAttempts,
          total_repair_attempts: cumulativeRepairRounds
        }
      });
      latestTurn = turn;
      return normalizePythonSandboxPlan(turn?.agent?.last_response?.output, {
        action: 'give_up',
        assistant_message: cleanText(turn?.agent?.last_response?.assistant_message, 4000),
        summary: cleanText(turn?.summary, 500)
      });
    }

    async function runManagedAttempt(currentInput) {
      const storedAttemptInput = buildStoredPythonSandboxInput(currentInput);
      return runPythonSandboxFn(currentInput, {
        sandboxRoot: cleanText(executionOptions.sandboxRoot, 1200) || defaultSandboxRoot,
        preferredPythonBin: cleanText(executionOptions.preferredPythonBin, 240) || defaultPreferredPythonBin,
        pythonExecutable: cleanText(executionOptions.pythonExecutable, 240),
        heartbeatIntervalMs: Number(executionOptions.heartbeatIntervalMs),
        onTaskStarted: async (event) => {
          if (agentId) {
            subAgentRuntime.startSubAgentTask({
              agent_id: agentId,
              task_type: 'python-sandbox',
              started_at: event.started_at,
              process_id: event.process_id,
              summary: `Running Python sandbox ${cleanText(event.run_id, 120)}.`,
              metadata: {
                run_id: cleanText(event.run_id, 120),
                python_executable: cleanText(event.python_executable, 240),
                timeout_ms: Number(event.timeout_ms) || 0,
                python_task_type: cleanText(currentInput.task_type, 80),
                latest_input: storedAttemptInput,
                latest_feedback: feedback,
                total_repair_attempts: cumulativeRepairRounds,
                main_agent_message: continuationOriginalRequest
              }
            });
          }
        },
        onHeartbeat: async (event) => {
          if (agentId) {
            subAgentRuntime.recordSubAgentHeartbeat({
              agent_id: agentId,
              timestamp: event.timestamp,
              process_id: event.process_id,
              progress: event.progress === true,
              summary: cleanText(event.summary, 240),
              metadata: {
                elapsed_ms: Number(event.elapsed_ms) || 0,
                stdout_chars: Number(event.stdout_chars) || 0,
                stderr_chars: Number(event.stderr_chars) || 0,
                latest_input: storedAttemptInput,
                total_repair_attempts: cumulativeRepairRounds,
                latest_feedback: feedback
              }
            });
          }
        }
      });
    }

    function persistFinalTaskState(currentInput, currentResult) {
      if (!agentId || !currentResult) {
        return;
      }
      const taskUpdater = currentResult.ok === true
        ? subAgentRuntime.completeSubAgentTask
        : subAgentRuntime.failSubAgentTask;
      taskUpdater({
        agent_id: agentId,
        finished_at: now(),
        exit_code: currentResult.exit_code,
        signal: currentResult.signal,
        timed_out: currentResult.timed_out === true,
        summary: cleanText(currentResult.summary || currentResult.error, 240),
        metadata: {
          latest_input: buildStoredPythonSandboxInput(currentInput),
          latest_sandbox_result: buildStoredPythonSandboxResult(currentResult),
          total_repair_attempts: cumulativeRepairRounds,
          latest_feedback: feedback,
          main_agent_message: continuationOriginalRequest
        }
      });
    }

    if (requestedAgentId && feedback) {
      const continuationPlan = await requestSubAgentPlan('continue_plan', workingInput, latestSandboxResult, repairRounds);
      if (continuationPlan?.action === 'return_result' && latestSandboxResult?.run_id) {
        returnedStoredResultDirectly = true;
        shouldRunSandbox = false;
      } else if (continuationPlan?.action === 'rerun') {
        const nextInput = mergePythonSandboxInput(workingInput, continuationPlan);
        if (!pythonSandboxInputsEqual(workingInput, nextInput)) {
          workingInput = nextInput;
        } else {
          shouldRunSandbox = false;
          syntheticFailureResult = buildManagedSandboxFailureResult(
            continuationPlan?.assistant_message,
            continuationPlan?.summary || 'Python sandbox continuation stalled before another run.'
          );
        }
      } else {
        shouldRunSandbox = false;
        syntheticFailureResult = buildManagedSandboxFailureResult(
          continuationPlan?.assistant_message,
          continuationPlan?.summary || 'Python sandbox continuation could not progress.'
        );
      }
    } else if (requestedAgentId && !feedback && !continuationInputChanged && latestSandboxResult?.run_id) {
      returnedStoredResultDirectly = true;
      shouldRunSandbox = false;
    }

    let sandboxResult = latestSandboxResult;
    if (shouldRunSandbox && !returnedStoredResultDirectly) {
      while (true) {
        sandboxResult = await runManagedAttempt(workingInput);
        latestSandboxResult = buildStoredPythonSandboxResult(sandboxResult);
        persistFinalTaskState(workingInput, sandboxResult);

        if (sandboxResult.ok === true) {
          break;
        }

        if (repairRounds >= maxRepairAttempts) {
          if (agentId) {
            latestTurn = await subAgentRuntime.sendSubAgentMessage({
              agent_id: agentId,
              message: buildDebugMessage(workingInput, sandboxResult),
              metadata: {
                debug_payload: buildStoredPythonSandboxResult(sandboxResult)
              }
            });
          }
          break;
        }

        const repairPlan = await requestSubAgentPlan('repair_plan', workingInput, sandboxResult, repairRounds + 1);
        if (!repairPlan || repairPlan.action !== 'rerun') {
          break;
        }

        const nextInput = mergePythonSandboxInput(workingInput, repairPlan);
        if (pythonSandboxInputsEqual(workingInput, nextInput)) {
          break;
        }

        workingInput = nextInput;
        repairRounds += 1;
        cumulativeRepairRounds += 1;
      }
    } else if (returnedStoredResultDirectly && latestSandboxResult) {
      sandboxResult = latestSandboxResult;
      persistFinalTaskState(workingInput, sandboxResult);
    } else {
      sandboxResult = syntheticFailureResult
        || latestSandboxResult
        || buildManagedSandboxFailureResult(
          cleanText(latestTurn?.agent?.last_response?.assistant_message, 4000),
          cleanText(latestTurn?.summary, 320) || 'Python sandbox continuation failed before another run.'
        );
      latestSandboxResult = buildStoredPythonSandboxResult(sandboxResult);
      persistFinalTaskState(workingInput, sandboxResult);
    }

    const finalInspection = agentId ? subAgentRuntime.getSubAgent({ agent_id: agentId }) : null;
    const agent = finalInspection?.ok === true
      ? finalInspection.agent
      : (created?.agent || inspected?.agent || null);
    const debug = latestTurn?.agent?.last_response
      ? cloneJson(latestTurn.agent.last_response, null)
      : (sandboxResult?.ok === true && !returnedStoredResultDirectly
        ? null
        : cloneJson(agent?.last_response, null));
    const summary = buildManagedPythonExecutionSummary(
      cleanText(sandboxResult?.summary, 320)
        || (sandboxResult?.ok ? 'Python sandbox execution completed.' : 'Python sandbox execution failed.'),
      {
        repair_rounds: repairRounds,
        continued_from_sub_agent: Boolean(requestedAgentId),
        sub_agent_id: agentId
      }
    );

    return {
      ok: sandboxResult?.ok === true,
      sandbox: sandboxResult,
      sub_agent: agent,
      debug,
      sub_agent_id: agentId,
      repair_rounds: repairRounds,
      continued_from_sub_agent: Boolean(requestedAgentId),
      summary
    };
  }

  return {
    execute,
    getSubAgent: (input = {}) => subAgentRuntime.getSubAgent(input),
    listSubAgents: () => subAgentRuntime.listSubAgents(),
    subAgentRuntime
  };
}

module.exports = {
  createManagedPythonSandboxRuntime
};
