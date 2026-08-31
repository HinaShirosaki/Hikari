'use strict';

const {
  buildToolCitations,
  buildExecutorSummary,
  resolveContextProject
} = require('./shared.js');

function registerSystemToolExecutors(genericAgentToolRuntime, context = {}) {
  const {
    cleanText,
    subAgentRuntime,
    memoryRuntime,
    containerRuntime,
    pythonSandboxToolRuntime,
    commandLineRuntime,
    getAgentPythonSandboxRoot
  } = context;

  genericAgentToolRuntime.registerToolExecutor('sub-agent', async ({ args, context }) => {
    if (!subAgentRuntime || typeof subAgentRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Sub-agent runtime is not configured.',
        summary: 'Sub-agent runtime is not configured.'
      };
    }
    const parentRequestId = cleanText(
      args?.metadata?.parent_request_id || context?.lifecycleRecorder?.requestId || context?.requestId,
      160
    );
    const metadata = {
      ...(args?.metadata && typeof args.metadata === 'object' ? args.metadata : {}),
      ...(parentRequestId ? { parent_request_id: parentRequestId } : {})
    };
    const result = await subAgentRuntime.execute({
      ...args,
      metadata
    });
    const agent = result?.agent && typeof result.agent === 'object' ? result.agent : null;
    return {
      ...result,
      items: Array.isArray(result?.items) ? result.items : (agent ? [agent] : []),
      summary: cleanText(result?.summary, 320)
        || (agent
          ? `sub-agent ${cleanText(agent?.id, 160) || 'session'} ${cleanText(result?.status, 80) || 'updated'}.`
          : `sub-agent ${cleanText(result?.status, 80) || 'completed'}.`)
    };
  });

  genericAgentToolRuntime.registerToolExecutor('memory', async ({ args, context }) => {
    if (!memoryRuntime || typeof memoryRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Memory runtime is not configured.',
        summary: 'Memory runtime is not configured.'
      };
    }
    const project = resolveContextProject(args, context);
    const projectName = cleanText(
      args?.project_name
      || args?.projectName
      || args?.record?.project_name
      || args?.record?.projectName
      || project?.name
      || project?.projectName,
      220
    );
    const record = args?.record && typeof args.record === 'object'
      ? {
        ...args.record,
        ...(projectName && !cleanText(args.record.project_name || args.record.projectName, 220)
          ? { project_name: projectName }
          : {})
      }
      : undefined;
    const result = await memoryRuntime.execute({
      ...args,
      ...(projectName && !cleanText(args?.project_name || args?.projectName, 220) ? { project_name: projectName } : {}),
      ...(record ? { record } : {})
    });
    return {
      ...result,
      citations: buildToolCitations(
        cleanText,
        result?.items,
        'memory',
        'Matched long-term agent memory records.'
      ),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'memory', result?.items, 'memory returned no matches.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('container', async ({ args }) => {
    if (!containerRuntime || typeof containerRuntime.execute !== 'function') {
      return {
        ok: false,
        status: 'error',
        error: 'Container runtime is not configured.',
        summary: 'Container runtime is not configured.'
      };
    }
    const result = await containerRuntime.execute(args);
    return {
      ...result,
      items: Array.isArray(result?.items)
        ? result.items
        : (result?.container ? [result.container] : []),
      summary: cleanText(result?.summary, 320)
        || buildExecutorSummary(cleanText, 'container', result?.items, 'container returned no items.')
    };
  });

  genericAgentToolRuntime.registerToolExecutor('python-sandbox', async ({ args, context }) => {
    const result = await pythonSandboxToolRuntime.execute(args, {
      parent_request_id: cleanText(context?.lifecycleRecorder?.requestId || context?.requestId, 160),
      sandboxRoot: getAgentPythonSandboxRoot(),
      preferredPythonBin: cleanText(context?.preferredPythonBin, 240),
      pythonExecutable: cleanText(context?.pythonExecutable, 240),
      provider: cleanText(context?.provider, 80),
      endpoint: cleanText(context?.endpoint, 2000),
      apiKey: cleanText(context?.apiKey, 400),
      model: cleanText(context?.model, 120),
      traceContext: context?.traceContext || null,
      message: cleanText(context?.message, 12000)
    });
    const sandbox = result?.sandbox && typeof result.sandbox === 'object' ? result.sandbox : {};
    const runId = cleanText(sandbox?.run_id, 120);

    return {
      ...result,
      status: cleanText(sandbox?.status, 40),
      run_id: runId,
      error: cleanText(sandbox?.error || result?.debug?.assistant_message, 4000),
      stdout: cleanText(sandbox?.stdout, 4000),
      stderr: cleanText(sandbox?.stderr, 12000),
      readback_files: Array.isArray(sandbox?.readback_files) ? sandbox.readback_files : [],
      render_outputs: Array.isArray(sandbox?.render_outputs) ? sandbox.render_outputs : [],
      items: runId
        ? [{
          run_id: runId,
          status: cleanText(sandbox?.status, 40),
          ok: result?.ok === true
        }]
        : [],
      citations: result?.ok === true && runId
        ? [{
          source: 'python-sandbox',
          pointer: runId,
          reason: cleanText(result?.summary, 220) || 'Python sandbox execution completed.'
        }]
        : []
    };
  });

  genericAgentToolRuntime.registerToolExecutor('command-line', async ({ args, context }) => {
    if (!commandLineRuntime || typeof commandLineRuntime.execute !== 'function') {
      return {
        status: 'error',
        error: 'Command-line runtime is not configured.',
        summary: 'Command-line runtime is not configured.'
      };
    }
    return commandLineRuntime.execute(args, {
      cwd: cleanText(context?.cwd, 1200),
      allowWriteTools: context?.allowWriteTools === true
    });
  });
}

module.exports = { registerSystemToolExecutors };
