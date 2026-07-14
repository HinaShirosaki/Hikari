'use strict';

// Telegram bot runtime. Pure helpers (parsing, formatting, module/search
// routing, logging, IPC) live in ./telegram-bot/*; this file wires them into a
// stateful Telegraf instance with per-chat session state (drafts, protocol
// runs, reminders, history) and registers the command + message handlers.

const { app } = require('electron');
const { Telegraf } = require('telegraf');

const {
  TELEGRAM_MODULE_MAP,
  LOOKUP_ACTIONS,
  SEARCH_SCOPE_TO_LOOKUP_SUBINTENT,
  DEFAULT_PROTOCOL_STEPS,
  EVENT_TO_DRAFT_TYPE
} = require('./config.js');
const {
  getCommandArgs,
  normalizeTokenKey,
  splitFirstToken,
  levenshteinDistance,
  isoNow,
  compactObject
} = require('./text-utils.js');
const {
  getModuleTarget,
  getSearchTarget,
  getModuleCatalog,
  getModuleSuggestions
} = require('./modules.js');
const {
  getMainWindowSafe,
  sendTelegramCommandToRenderer,
  sendSearchCommand,
  sendGlobalSearchCommand,
  createStatusMessage
} = require('./renderer-bridge.js');
const {
  resolveTelegramLogPath,
  appendTelegramLogEntry,
  createTelegramLogMetaEntry,
  formatTelegramLogEntry
} = require('./logging.js');
const {
  parseDurationToMs,
  splitDurationAndLabel,
  parseTimerRequest,
  formatDuration
} = require('./duration.js');
const {
  parseProjectFromText,
  parseProtocolFromText,
  parseLabEvent,
  detectLabEventType,
  parseProteinExpressionEvent,
  parseTransformationEvent,
  parseTransfectionEvent,
  parseCellCultureEvent,
  parsePurificationEvent,
  parseAssayEvent,
  parseGelEvent,
  parseReagentUseEvent,
  parseDecisionEvent
} = require('./event-parsers.js');
const {
  parseNaturalLanguageIntent,
  mapIntentToEventType,
  eventTypeToIntentSubintent,
  parseLookupSubintent
} = require('./intent.js');
const {
  buildDraftTitle,
  formatDraftReply,
  formatProtocolStepReply,
  createDefaultChatContext,
  buildTodaySummaryFromHistory,
  formatSessionContextMessage
} = require('./formatting.js');

function startTelegramBot(getMainWindow, tokenOverride = '') {
  const token = String(tokenOverride || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Telegram bot disabled (no token configured)');
    return null;
  }

  const bot = new Telegraf(token);
  let telegramLogPath = '';

  const chatDefaultSearchScope = new Map();
  const chatContexts = new Map();
  const drafts = new Map();
  const protocolRuns = new Map();
  const reminders = new Map();
  const chatEventHistory = new Map();

  let draftCounter = 1;
  let runCounter = 1;
  let reminderCounter = 1;

  const MAX_HISTORY_PER_CHAT = 200;
  const MAX_TIMER_MS = 7 * 24 * 60 * 60 * 1000;

  const ensureLogPath = async () => {
    if (!telegramLogPath) {
      telegramLogPath = await resolveTelegramLogPath();
      if (telegramLogPath) {
        console.log(`Telegram message log: ${telegramLogPath}`);
        await appendTelegramLogEntry(
          telegramLogPath,
          createTelegramLogMetaEntry('bot-start', {
            pid: process.pid,
            cwd: process.cwd(),
            appPath: app.getAppPath(),
            isPackaged: app.isPackaged
          })
        );
      } else {
        console.error('Telegram message logging disabled: no writable log path found.');
      }
    }
    return telegramLogPath;
  };
  void ensureLogPath();

  bot.on('message', async (ctx, next) => {
    const logPath = await ensureLogPath();
    await appendTelegramLogEntry(logPath, formatTelegramLogEntry(ctx));
    return next();
  });

  const getChatScopeKey = (ctx) => String(ctx?.chat?.id || ctx?.from?.id || 'global');

  const getChatContext = (ctx) => {
    const key = getChatScopeKey(ctx);
    if (!chatContexts.has(key)) {
      chatContexts.set(key, createDefaultChatContext());
    }
    return chatContexts.get(key);
  };

  const getDefaultSearchTarget = (ctx) => {
    const scope = chatDefaultSearchScope.get(getChatScopeKey(ctx));
    return scope ? getSearchTarget(scope) : null;
  };

  const getActiveDraft = (ctx) => {
    const context = getChatContext(ctx);
    const draftId = context.active_draft_id;
    if (!draftId) {
      return null;
    }
    const draft = drafts.get(draftId) || null;
    if (!draft || draft.status !== 'active') {
      context.active_draft_id = '';
      return null;
    }
    return draft;
  };

  const getActiveRun = (ctx) => {
    const context = getChatContext(ctx);
    const runId = context.active_run_id;
    if (!runId) {
      return null;
    }
    const run = protocolRuns.get(runId) || null;
    if (!run || run.status === 'completed' || run.status === 'aborted') {
      context.active_run_id = '';
      return null;
    }
    return run;
  };

  const noWindowMessage = (ctx) => {
    ctx.reply('No active Hikari window. Open the app window and try again.');
  };

  const recordChatEvent = (ctx, event) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    history.push({
      timestamp: isoNow(),
      ...event
    });
    if (history.length > MAX_HISTORY_PER_CHAT) {
      history.splice(0, history.length - MAX_HISTORY_PER_CHAT);
    }
    chatEventHistory.set(key, history);
  };

  const performLookupAction = (ctx, subintent, queryText = '') => {
    const action = LOOKUP_ACTIONS.get(subintent) || LOOKUP_ACTIONS.get('inventory');
    const query = String(queryText || '').trim();
    const moduleTarget = getModuleTarget(action.moduleToken);

    if (action.searchToken) {
      const searchTarget = getSearchTarget(action.searchToken);
      if (!searchTarget) {
        return {
          ok: false,
          message: `No search target configured for ${action.label}.`
        };
      }
      const sent = sendSearchCommand(getMainWindow, searchTarget, query);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Hikari window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: query
          ? `Opened ${searchTarget.label} and searched for: ${query}`
          : `Opened ${searchTarget.label}.`
      };
    }

    if (query) {
      const sent = sendGlobalSearchCommand(getMainWindow, query, action.globalScope || subintent);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Hikari window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: `Opened ${action.label} and searched for: ${query}`
      };
    }

    if (!moduleTarget) {
      return {
        ok: false,
        message: `No module target configured for ${action.label}.`
      };
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: moduleTarget.viewId
    });
    if (!sent) {
      return {
        ok: false,
        message: 'No active Hikari window. Open the app window and try again.'
      };
    }

    return {
      ok: true,
      message: `Opened ${moduleTarget.label}.`
    };
  };

  const resolveSearchScope = (scopeArg) => {
    const normalized = normalizeTokenKey(scopeArg);
    const direct = getSearchTarget(normalized);
    if (direct) {
      return {
        type: 'search-target',
        searchTarget: direct,
        scope: direct.scope,
        label: direct.label
      };
    }

    const lookupSubintent = SEARCH_SCOPE_TO_LOOKUP_SUBINTENT.get(normalized);
    if (lookupSubintent) {
      return {
        type: 'lookup-subintent',
        subintent: lookupSubintent
      };
    }

    return null;
  };

  const performSearchScope = (ctx, scopeArg, query) => {
    const resolved = resolveSearchScope(scopeArg);
    if (!resolved) {
      return {
        ok: false,
        message: `Unknown scope: ${scopeArg}.`
      };
    }

    if (resolved.type === 'search-target') {
      const sent = sendSearchCommand(getMainWindow, resolved.searchTarget, query);
      if (!sent) {
        return {
          ok: false,
          message: 'No active Hikari window. Open the app window and try again.'
        };
      }
      return {
        ok: true,
        message: `Opened ${resolved.label} and searched for: ${query}`
      };
    }

    return performLookupAction(ctx, resolved.subintent, query);
  };

  const createDraft = (ctx, rawText, options = {}) => {
    const context = getChatContext(ctx);
    const intent = options.intent || parseNaturalLanguageIntent(rawText, context);
    const eventType = options.eventType || mapIntentToEventType(intent);
    const parsed = options.parsed || parseLabEvent(rawText, eventType, context);

    const draftType = options.draftType
      || EVENT_TO_DRAFT_TYPE.get(parsed.event_type)
      || EVENT_TO_DRAFT_TYPE.get(eventType)
      || 'notebook';

    const draftId = `DR-${String(draftCounter).padStart(5, '0')}`;
    draftCounter += 1;

    const now = isoNow();
    const project = parsed?.fields?.project || parseProjectFromText(rawText, context.active_project || context.default_project);
    const protocol = parsed?.fields?.protocol || parseProtocolFromText(rawText, context.active_protocol);

    const draft = {
      draft_id: draftId,
      user_id: String(ctx?.from?.id || ''),
      chat_id: String(ctx?.chat?.id || ''),
      draft_type: draftType,
      linked_project: project || '',
      linked_protocol: protocol || '',
      parsed_entities: compactObject({
        ...intent.entities,
        ...compactObject(parsed.fields)
      }),
      content: {
        event_type: parsed.event_type,
        fields: parsed.fields,
        missing_fields: Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [],
        source_messages: [rawText]
      },
      status: 'active',
      created_at: now,
      updated_at: now
    };

    drafts.set(draftId, draft);
    context.active_draft_id = draftId;
    if (project) {
      context.active_project = project;
    }
    if (protocol) {
      context.active_protocol = protocol;
    }
    context.last_entities = {
      ...context.last_entities,
      ...draft.parsed_entities
    };

    recordChatEvent(ctx, {
      type: 'draft-created',
      label: `Draft ${draftId}: ${buildDraftTitle(draft)}`,
      draft_id: draftId
    });

    return draft;
  };

  const updateDraft = (ctx, message) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }

    draft.content.source_messages.push(message);
    const combinedText = draft.content.source_messages.join(' ');
    const context = getChatContext(ctx);

    const parsed = parseLabEvent(combinedText, draft.content.event_type, context);
    draft.content.fields = parsed.fields;
    draft.content.missing_fields = Array.isArray(parsed.missing_fields) ? parsed.missing_fields : [];
    draft.parsed_entities = {
      ...draft.parsed_entities,
      ...compactObject(parsed.fields)
    };
    draft.updated_at = isoNow();

    if (parsed.fields?.project) {
      context.active_project = parsed.fields.project;
    }
    if (parsed.fields?.protocol) {
      context.active_protocol = parsed.fields.protocol;
    }
    context.last_entities = {
      ...context.last_entities,
      ...compactObject(parsed.fields)
    };

    recordChatEvent(ctx, {
      type: 'draft-updated',
      label: `Draft ${draft.draft_id} updated`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const saveActiveDraft = (ctx) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }
    draft.status = 'saved';
    draft.updated_at = isoNow();
    const context = getChatContext(ctx);
    context.active_draft_id = '';

    recordChatEvent(ctx, {
      type: 'draft-saved',
      label: `Saved draft ${draft.draft_id}`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const discardActiveDraft = (ctx) => {
    const draft = getActiveDraft(ctx);
    if (!draft) {
      return null;
    }
    draft.status = 'discarded';
    draft.updated_at = isoNow();
    const context = getChatContext(ctx);
    context.active_draft_id = '';

    recordChatEvent(ctx, {
      type: 'draft-discarded',
      label: `Discarded draft ${draft.draft_id}`,
      draft_id: draft.draft_id
    });

    return draft;
  };

  const openDraftInHikari = (ctx, draft) => {
    if (!draft) {
      return false;
    }

    let moduleToken = 'biology';
    if (draft.draft_type === 'reagent_checklist' || draft.content.event_type === 'inventory_usage' || draft.content.event_type === 'reagent_registration') {
      moduleToken = 'chemicals';
    } else if (draft.content.event_type === 'sample_registration') {
      moduleToken = 'samples';
    }

    const target = getModuleTarget(moduleToken);
    if (!target) {
      return false;
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: target.viewId
    });

    if (sent) {
      recordChatEvent(ctx, {
        type: 'draft-opened',
        label: `Opened ${draft.draft_id} in Hikari`,
        draft_id: draft.draft_id
      });
    }

    return sent;
  };

  const createProtocolRun = (ctx, protocolName) => {
    const context = getChatContext(ctx);
    const runId = `RUN-${String(runCounter).padStart(5, '0')}`;
    runCounter += 1;

    const run = {
      run_id: runId,
      protocol_name: protocolName,
      steps: [...DEFAULT_PROTOCOL_STEPS],
      current_step_index: 0,
      status: 'active',
      notes: [],
      deviations: [],
      project: context.active_project || context.default_project || null,
      created_at: isoNow(),
      updated_at: isoNow()
    };

    protocolRuns.set(runId, run);
    context.active_run_id = runId;
    context.active_protocol = protocolName;

    recordChatEvent(ctx, {
      type: 'protocol-run-started',
      label: `Started protocol run ${runId}: ${protocolName}`,
      run_id: runId
    });

    return run;
  };

  const handleExecutionSubintent = (ctx, subintent, payloadText = '') => {
    if (subintent === 'start') {
      const protocolName = String(payloadText || '').trim() || parseProtocolFromText(payloadText, getChatContext(ctx).active_protocol);
      if (!protocolName) {
        ctx.reply('Usage: /start-protocol <protocol name>');
        return true;
      }
      const run = createProtocolRun(ctx, protocolName);
      ctx.reply(formatProtocolStepReply(run, `Starting draft execution for protocol "${run.protocol_name}".`));
      return true;
    }

    const run = getActiveRun(ctx);
    if (!run) {
      ctx.reply('No active protocol run. Use /start-protocol <protocol> first.');
      return true;
    }

    if (subintent === 'pause') {
      run.status = 'paused';
      run.updated_at = isoNow();
      ctx.reply(`Paused protocol run ${run.run_id}. Reply "resume" to continue.`);
      return true;
    }

    if (subintent === 'resume') {
      run.status = 'active';
      run.updated_at = isoNow();
      ctx.reply(formatProtocolStepReply(run, `Resumed protocol run ${run.run_id}.`));
      return true;
    }

    if (subintent === 'repeat') {
      run.updated_at = isoNow();
      ctx.reply(formatProtocolStepReply(run, 'Repeating current step.'));
      return true;
    }

    if (subintent === 'add_note') {
      const note = String(payloadText || '').replace(/^note\s*/i, '').trim();
      if (!note) {
        ctx.reply('Usage: note <text>');
        return true;
      }
      run.notes.push({ text: note, at: isoNow() });
      run.updated_at = isoNow();
      ctx.reply(`Noted for run ${run.run_id}: ${note}`);
      return true;
    }

    if (subintent === 'add_deviation') {
      const deviation = String(payloadText || '').replace(/^deviation\s*/i, '').trim();
      if (!deviation) {
        ctx.reply('Usage: /deviation <text>');
        return true;
      }
      run.deviations.push({ text: deviation, at: isoNow() });
      run.updated_at = isoNow();
      ctx.reply(`Deviation logged for run ${run.run_id}: ${deviation}`);
      return true;
    }

    if (subintent === 'next' || subintent === 'done') {
      if (run.status === 'paused') {
        ctx.reply('Protocol is paused. Reply "resume" first.');
        return true;
      }

      if (run.current_step_index >= run.steps.length - 1) {
        run.status = 'completed';
        run.updated_at = isoNow();
        getChatContext(ctx).active_run_id = '';
        ctx.reply(`Protocol run ${run.run_id} completed.`);
        return true;
      }

      run.current_step_index += 1;
      run.updated_at = isoNow();
      const header = subintent === 'done'
        ? 'Marked step done. Moving to next step.'
        : 'Moved to next step.';
      ctx.reply(formatProtocolStepReply(run, header));
      return true;
    }

    return false;
  };

  const scheduleReminder = (ctx, durationMs, durationText, label) => {
    const ms = Number(durationMs);
    if (!Number.isFinite(ms) || ms <= 0) {
      return {
        ok: false,
        message: 'Could not parse timer duration. Example: /timer 45 min harvest culture'
      };
    }
    if (ms > MAX_TIMER_MS) {
      return {
        ok: false,
        message: 'Timer is too long for Telegram reminders in this version. Please keep timers under 7 days.'
      };
    }

    const reminderId = `RM-${String(reminderCounter).padStart(5, '0')}`;
    reminderCounter += 1;

    const chatId = ctx?.chat?.id;
    const chatKey = getChatScopeKey(ctx);
    const triggerAt = new Date(Date.now() + ms);

    const timer = setTimeout(() => {
      reminders.delete(reminderId);
      const context = chatContexts.get(chatKey) || createDefaultChatContext();
      if (!context.notifications_enabled) {
        return;
      }
      bot.telegram.sendMessage(chatId, `Timer completed (${label || 'Lab reminder'}).`).catch((error) => {
        console.error('Failed to deliver Telegram reminder:', error);
      });
    }, ms);

    reminders.set(reminderId, {
      reminder_id: reminderId,
      chat_id: String(chatId || ''),
      label: label || 'Lab reminder',
      trigger_at: triggerAt.toISOString(),
      status: 'scheduled',
      timer
    });

    recordChatEvent(ctx, {
      type: 'reminder-scheduled',
      label: `Reminder ${reminderId}: ${label || 'Lab reminder'} in ${formatDuration(ms)}`,
      reminder_id: reminderId
    });

    return {
      ok: true,
      reminder_id: reminderId,
      message: `Timer set for ${durationText || formatDuration(ms)} (${label || 'Lab reminder'}).`
    };
  };

  const createTodaySummaryDraft = (ctx) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    const summaryText = buildTodaySummaryFromHistory(history);

    const parsed = {
      event_type: 'daily_summary',
      fields: {
        summary: summaryText,
        event_count: history.length,
        events: history.slice(-10).map((item) => item.label || item.type || 'event'),
        project: getChatContext(ctx).active_project || getChatContext(ctx).default_project || null
      },
      missing_fields: []
    };

    return createDraft(ctx, summaryText, {
      intent: {
        intent: 'draft_record',
        subintent: 'daily_summary',
        entities: {
          message_text: summaryText
        }
      },
      eventType: 'daily_summary',
      parsed,
      draftType: 'notebook'
    });
  };

  const registerCommandAlias = (command, aliases, handler) => {
    bot.command(command, handler);
    aliases.forEach((alias) => {
      const escapedAlias = alias.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const pattern = new RegExp(`^\\/${escapedAlias}(?:@\\w+)?(?:\\s+([\\s\\S]*))?$`, 'i');
      bot.hears(pattern, (ctx) => {
        const argText = String(ctx.match?.[1] || '').trim();
        const original = ctx.message?.text;
        if (ctx.message) {
          ctx.message.text = `/${command}${argText ? ` ${argText}` : ''}`;
        }
        const result = handler(ctx);
        return Promise.resolve(result).finally(() => {
          if (ctx.message) {
            ctx.message.text = original;
          }
        });
      });
    });
  };

  bot.start((ctx) => {
    ctx.reply('Hikari lab assistant bot connected. Use /help for commands.');
  });

  registerCommandAlias('help', [], (ctx) => {
    ctx.reply([
      'Available commands:',
      '/help - list commands',
      '/modules - list openable modules',
      '/open <module> - open module',
      '/open <module> <query> - open/search module in one command',
      '/search <scope> <query> - scoped search',
      '/scope <scope|none> - set/clear default search scope',
      '/q <query> - search using saved scope',
      '/inventory <query>',
      '/sample <query> | /samples <query>',
      '/construct <query>',
      '/protocol <query>',
      '/project <query>',
      '/papers <query>',
      '/expiring | /lowstock | /today',
      '/log <message> | /note <message> | /decision <message> | /task <message>',
      '/use <message> | /register-sample <message> | /register-reagent <message>',
      '/start-protocol <name> | /next | /done | /repeat | /pause | /resume | /deviation <message>',
      '/timer <duration> <label>',
      '/draft-notebook | /draft-summary | /draft-checklist <topic> | /draft-assay <desc> | /draft-reservation <message>',
      '/link-project <project> | /set-default-project <project> | /my-context | /notifications [on|off]',
      '/status | /time | /version | /focus | /maximize | /restore | /minimize'
    ].join('\n'));
  });

  registerCommandAlias('modules', [], (ctx) => {
    const filterToken = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const modules = getModuleCatalog()
      .filter((entry) => !filterToken || entry.token.includes(filterToken) || normalizeTokenKey(entry.label).includes(filterToken))
      .map((entry) => entry.token);
    if (!modules.length) {
      ctx.reply(`No module matched "${filterToken}".`);
      return;
    }
    const prefix = filterToken ? `Openable modules matching "${filterToken}": ` : 'Openable modules: ';
    ctx.reply(`${prefix}${modules.join(', ')}`);
  });

  registerCommandAlias('open', [], (ctx) => {
    const rawArgs = getCommandArgs(ctx.message?.text);
    const { first: tokenArg, rest: trailingQuery } = splitFirstToken(rawArgs);
    if (!tokenArg) {
      ctx.reply('Usage: /open <module>. Try /modules.');
      return;
    }

    const target = getModuleTarget(tokenArg);
    if (!target) {
      const suggestions = getModuleSuggestions(tokenArg);
      const suggestionText = suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : '';
      ctx.reply(`Unknown module: ${tokenArg}.${suggestionText} Try /modules.`);
      return;
    }

    if (trailingQuery) {
      const searchTarget = getSearchTarget(tokenArg);
      if (searchTarget) {
        const sent = sendSearchCommand(getMainWindow, searchTarget, trailingQuery);
        if (!sent) {
          noWindowMessage(ctx);
          return;
        }
        ctx.reply(`Opened ${searchTarget.label} and searched for: ${trailingQuery}`);
        return;
      }

      const sentGlobal = sendGlobalSearchCommand(getMainWindow, trailingQuery, normalizeTokenKey(tokenArg));
      if (!sentGlobal) {
        noWindowMessage(ctx);
        return;
      }
      ctx.reply(`Opened ${target.label} and searched for: ${trailingQuery}`);
      return;
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: target.viewId
    });
    if (!sent) {
      noWindowMessage(ctx);
      return;
    }

    ctx.reply(`Opened ${target.label}.`);
  });

  registerCommandAlias('status', ['app'], (ctx) => {
    ctx.reply(createStatusMessage(getMainWindowSafe(getMainWindow)));
  });

  registerCommandAlias('ping', [], (ctx) => {
    ctx.reply('pong');
  });

  registerCommandAlias('time', [], (ctx) => {
    ctx.reply(`Server time: ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);
  });

  registerCommandAlias('version', [], (ctx) => {
    ctx.reply(`Hikari version: ${app.getVersion()}`);
  });

  registerCommandAlias('logfile', [], (ctx) => {
    if (!telegramLogPath) {
      ctx.reply('Telegram log file is not ready yet.');
      return;
    }
    ctx.reply(`Telegram log file: ${telegramLogPath}`);
  });

  registerCommandAlias('focus', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Hikari window to focus.');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Hikari window focused.');
  });

  registerCommandAlias('maximize', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Hikari window to maximize.');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Hikari window maximized.');
  });

  registerCommandAlias('restore', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Hikari window to restore.');
      return;
    }

    if (mainWindow.isMinimized() || mainWindow.isMaximized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Hikari window restored.');
  });

  registerCommandAlias('minimize', [], (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Hikari window to minimize.');
      return;
    }
    mainWindow.minimize();
    ctx.reply('Hikari window minimized.');
  });

  registerCommandAlias('echo', [], (ctx) => {
    const text = getCommandArgs(ctx.message?.text);
    if (!text) {
      ctx.reply('Usage: /echo <text>');
      return;
    }
    ctx.reply(text);
  });

  registerCommandAlias('inventory', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'inventory', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('chemicals', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'inventory', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('sample', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'sample', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('samples', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'sample', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('construct', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'construct', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('protocol', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'protocol', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('project', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'project', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('papers', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performLookupAction(ctx, 'paper', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('assay', ['assays'], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performSearchScope(ctx, 'assay', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('gel', ['gels'], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const result = performSearchScope(ctx, 'gel', query);
    ctx.reply(result.message);
  });

  registerCommandAlias('search', [], (ctx) => {
    const { first: scopeArg, rest: query } = splitFirstToken(getCommandArgs(ctx.message?.text));
    if (!scopeArg || !query) {
      ctx.reply('Usage: /search <scope> <query>. Scopes: chemicals, samples, assay, gel, protocol, project, papers');
      return;
    }
    const result = performSearchScope(ctx, scopeArg, query);
    ctx.reply(result.message);
  });

  registerCommandAlias('scope', [], (ctx) => {
    const scopeArg = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const chatKey = getChatScopeKey(ctx);
    if (!scopeArg) {
      const current = getDefaultSearchTarget(ctx);
      ctx.reply(current
        ? `Default search scope is "${current.scope}". Use /q <query>.`
        : 'No default search scope set. Use /scope <chemicals|samples|assay|gel>.');
      return;
    }

    if (scopeArg === 'none' || scopeArg === 'off' || scopeArg === 'clear') {
      chatDefaultSearchScope.delete(chatKey);
      ctx.reply('Default search scope cleared.');
      return;
    }

    const target = getSearchTarget(scopeArg);
    if (!target) {
      ctx.reply('Unknown scope for /scope. Use chemicals, samples, assay, or gel.');
      return;
    }

    chatDefaultSearchScope.set(chatKey, target.scope);
    ctx.reply(`Default search scope set to "${target.scope}". Use /q <query>.`);
  });

  registerCommandAlias('q', [], (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    if (!query) {
      ctx.reply('Usage: /q <query>. Set default scope with /scope first.');
      return;
    }
    const target = getDefaultSearchTarget(ctx);
    if (!target) {
      ctx.reply('No default search scope set. Use /scope <chemicals|samples|assay|gel> first.');
      return;
    }
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      noWindowMessage(ctx);
      return;
    }
    ctx.reply(`Opened ${target.label} and searched for: ${query}`);
  });

  registerCommandAlias('expiring', ['expiring-lots'], (ctx) => {
    const result = performLookupAction(ctx, 'expiry', 'expiring');
    ctx.reply(result.ok
      ? `${result.message}\nReview lot expiration in Chemicals.`
      : result.message);
  });

  registerCommandAlias('lowstock', ['low-stock'], (ctx) => {
    const result = performLookupAction(ctx, 'inventory', 'low stock');
    ctx.reply(result.ok
      ? `${result.message}\nReview stock levels in Chemicals.`
      : result.message);
  });

  registerCommandAlias('today', [], (ctx) => {
    const key = getChatScopeKey(ctx);
    const history = chatEventHistory.get(key) || [];
    ctx.reply(buildTodaySummaryFromHistory(history));
  });

  registerCommandAlias('log', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /log <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'log_experiment',
        subintent: eventTypeToIntentSubintent(detectLabEventType(message)),
        entities: {
          message_text: message
        }
      }
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('note', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /note <message>');
      return;
    }

    const run = getActiveRun(ctx);
    if (run) {
      handleExecutionSubintent(ctx, 'add_note', message);
      return;
    }

    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'notebook_entry',
        entities: {
          message_text: message
        }
      }
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('decision', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /decision <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'decision_record',
        entities: {
          decision_text: message
        }
      },
      eventType: 'decision'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('task', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /task <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'task_list',
        entities: {
          task_text: message
        }
      },
      eventType: 'task',
      draftType: 'task'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('use', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /use <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_usage',
        entities: {
          message_text: message
        }
      },
      eventType: 'inventory_usage',
      draftType: 'reagent_checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('register_sample', ['register-sample'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /register-sample <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'sample_registration',
        entities: {
          message_text: message
        }
      },
      eventType: 'sample_registration'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('register_reagent', ['register-reagent'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /register-reagent <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_registration',
        entities: {
          message_text: message
        }
      },
      eventType: 'reagent_registration',
      draftType: 'reagent_checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('start_protocol', ['start-protocol'], (ctx) => {
    const protocolName = getCommandArgs(ctx.message?.text);
    if (!protocolName) {
      ctx.reply('Usage: /start-protocol <protocol name>');
      return;
    }
    handleExecutionSubintent(ctx, 'start', protocolName);
  });

  registerCommandAlias('next', [], (ctx) => {
    handleExecutionSubintent(ctx, 'next');
  });

  registerCommandAlias('done', [], (ctx) => {
    handleExecutionSubintent(ctx, 'done');
  });

  registerCommandAlias('repeat', [], (ctx) => {
    handleExecutionSubintent(ctx, 'repeat');
  });

  registerCommandAlias('pause', [], (ctx) => {
    handleExecutionSubintent(ctx, 'pause');
  });

  registerCommandAlias('resume', [], (ctx) => {
    handleExecutionSubintent(ctx, 'resume');
  });

  registerCommandAlias('deviation', [], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /deviation <message>');
      return;
    }
    handleExecutionSubintent(ctx, 'add_deviation', message);
  });

  registerCommandAlias('timer', [], (ctx) => {
    const argText = getCommandArgs(ctx.message?.text);
    if (!argText) {
      ctx.reply('Usage: /timer <duration> <label>');
      return;
    }
    const parsed = splitDurationAndLabel(argText);
    const label = parsed.label || 'Lab reminder';
    const result = scheduleReminder(ctx, parsed.durationMs, parsed.durationText, label);
    ctx.reply(result.message);
  });

  registerCommandAlias('draft_notebook', ['draft-notebook'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text) || 'Draft notebook from latest updates';
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'notebook_entry',
        entities: {
          message_text: message
        }
      },
      eventType: detectLabEventType(message),
      draftType: 'notebook'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_summary', ['draft-summary'], (ctx) => {
    const draft = createTodaySummaryDraft(ctx);
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_checklist', ['draft-checklist'], (ctx) => {
    const topic = getCommandArgs(ctx.message?.text);
    if (!topic) {
      ctx.reply('Usage: /draft-checklist <protocol or task>');
      return;
    }
    const draft = createDraft(ctx, topic, {
      intent: {
        intent: 'draft_record',
        subintent: 'reagent_checklist',
        entities: {
          title: topic
        }
      },
      eventType: 'checklist'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_assay', ['draft-assay'], (ctx) => {
    const desc = getCommandArgs(ctx.message?.text);
    if (!desc) {
      ctx.reply('Usage: /draft-assay <description>');
      return;
    }
    const draft = createDraft(ctx, desc, {
      intent: {
        intent: 'draft_record',
        subintent: 'assay_plan',
        entities: {
          message_text: desc
        }
      },
      eventType: 'assay',
      draftType: 'assay'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('draft_reservation', ['draft-reservation'], (ctx) => {
    const message = getCommandArgs(ctx.message?.text);
    if (!message) {
      ctx.reply('Usage: /draft-reservation <message>');
      return;
    }
    const draft = createDraft(ctx, message, {
      intent: {
        intent: 'draft_record',
        subintent: 'reservation_request',
        entities: {
          message_text: message
        }
      },
      eventType: 'reservation_request',
      draftType: 'reservation'
    });
    ctx.reply(formatDraftReply(draft));
  });

  registerCommandAlias('link_project', ['link-project'], (ctx) => {
    const project = getCommandArgs(ctx.message?.text);
    if (!project) {
      ctx.reply('Usage: /link-project <project>');
      return;
    }
    const context = getChatContext(ctx);
    context.active_project = project;
    context.last_entities = {
      ...context.last_entities,
      project
    };
    ctx.reply(`Linked current Telegram session to project "${project}".`);
  });

  registerCommandAlias('set_default_project', ['set-default-project'], (ctx) => {
    const project = getCommandArgs(ctx.message?.text);
    if (!project) {
      ctx.reply('Usage: /set-default-project <project>');
      return;
    }
    const context = getChatContext(ctx);
    context.default_project = project;
    if (!context.active_project) {
      context.active_project = project;
    }
    ctx.reply(`Default project set to "${project}".`);
  });

  registerCommandAlias('my_context', ['my-context'], (ctx) => {
    const context = getChatContext(ctx);
    const activeDraft = getActiveDraft(ctx);
    const activeRun = getActiveRun(ctx);
    ctx.reply(formatSessionContextMessage(context, activeDraft, activeRun));
  });

  registerCommandAlias('notifications', [], (ctx) => {
    const raw = normalizeTokenKey(getCommandArgs(ctx.message?.text));
    const context = getChatContext(ctx);
    if (!raw) {
      ctx.reply(`Notifications are ${context.notifications_enabled ? 'on' : 'off'}. Use /notifications on|off.`);
      return;
    }

    if (['on', 'enable', 'enabled', 'yes'].includes(raw)) {
      context.notifications_enabled = true;
      ctx.reply('Notifications enabled.');
      return;
    }

    if (['off', 'disable', 'disabled', 'no'].includes(raw)) {
      context.notifications_enabled = false;
      ctx.reply('Notifications disabled.');
      return;
    }

    ctx.reply('Usage: /notifications on|off');
  });

  getModuleCatalog().forEach((entry) => {
    const cmd = entry.token;
    if ([
      'inventory',
      'chemicals',
      'samples',
      'sample',
      'assay',
      'gel',
      'protocol',
      'project',
      'papers'
    ].includes(cmd)) {
      return;
    }

    bot.command(cmd, (ctx) => {
      const sent = sendTelegramCommandToRenderer(getMainWindow, {
        type: 'open-view',
        viewId: TELEGRAM_MODULE_MAP.get(cmd)?.viewId
      });
      if (!sent) {
        noWindowMessage(ctx);
        return;
      }
      ctx.reply(`Opened ${entry.label}.`);
    });
  });

  bot.on('text', (ctx) => {
    const msg = String(ctx.message?.text || '').trim();
    if (!msg) {
      return;
    }
    if (msg.startsWith('/')) {
      return;
    }

    const context = getChatContext(ctx);
    const lower = msg.toLowerCase();
    const activeDraft = getActiveDraft(ctx);

    if (activeDraft) {
      if (/^save\s+draft$/i.test(msg) || /^save$/i.test(msg)) {
        const saved = saveActiveDraft(ctx);
        ctx.reply(`Saved as draft ${saved.draft_id}.`);
        return;
      }
      if (/^discard$/i.test(msg)) {
        const discarded = discardActiveDraft(ctx);
        ctx.reply(`Discarded draft ${discarded.draft_id}.`);
        return;
      }
      if (/^open\s+in\s+hikari$/i.test(msg)) {
        const sent = openDraftInHikari(ctx, activeDraft);
        if (!sent) {
          noWindowMessage(ctx);
          return;
        }
        ctx.reply(`Opened draft ${activeDraft.draft_id} context in Hikari.`);
        return;
      }

      if (/^(add|set)\s+/i.test(msg) || activeDraft.content.missing_fields?.length) {
        const cleaned = msg.replace(/^(add|set)\s+/i, '').trim() || msg;
        const updated = updateDraft(ctx, cleaned);
        ctx.reply(formatDraftReply(updated, { updated: true }));
        return;
      }
    }

    if (/^(done|next|repeat|pause|resume)$/i.test(msg)) {
      const executionIntent = msg.toLowerCase() === 'next' ? 'next' : msg.toLowerCase();
      handleExecutionSubintent(ctx, executionIntent);
      return;
    }

    if (/^note\s+/.test(lower)) {
      const activeRun = getActiveRun(ctx);
      if (activeRun) {
        handleExecutionSubintent(ctx, 'add_note', msg);
        return;
      }
    }

    if (/^deviation\s+/.test(lower)) {
      const activeRun = getActiveRun(ctx);
      if (activeRun) {
        handleExecutionSubintent(ctx, 'add_deviation', msg);
        return;
      }
    }

    const timerRequest = parseTimerRequest(msg);
    if (timerRequest) {
      const timerResult = scheduleReminder(ctx, timerRequest.duration_ms, timerRequest.duration, timerRequest.label);
      ctx.reply(timerResult.message);
      return;
    }

    const intent = parseNaturalLanguageIntent(msg, context);

    if (intent.intent === 'lookup') {
      const query = intent.entities?.query || '';
      const result = performLookupAction(ctx, intent.subintent, query);
      ctx.reply(result.message);
      recordChatEvent(ctx, {
        type: 'lookup',
        label: `Lookup ${intent.subintent}: ${query || '(none)'}`
      });
      return;
    }

    if (intent.intent === 'protocol_execution') {
      const payload = intent.subintent === 'start'
        ? parseProtocolFromText(msg, context.active_protocol)
        : msg;
      handleExecutionSubintent(ctx, intent.subintent, payload);
      return;
    }

    if (intent.intent === 'log_experiment' || intent.intent === 'draft_record') {
      const draft = createDraft(ctx, msg, { intent });
      ctx.reply(formatDraftReply(draft));
      return;
    }

    recordChatEvent(ctx, {
      type: 'message',
      label: msg
    });

    ctx.reply([
      'I can help with lookup, logging, draft creation, protocol steps, and timers.',
      'Try:',
      '- "Do we have imidazole?"',
      '- "I expressed a His-tagged construct in BL21"',
      '- "set timer 45 min harvest culture"',
      '- "summarize today"'
    ].join('\n'));
  });

  bot
    .launch()
    .then(() => {
      console.log('Telegram bot started');
      void ensureLogPath().then((logPath) => appendTelegramLogEntry(
        logPath,
        createTelegramLogMetaEntry('bot-launched')
      ));
    })
    .catch((error) => {
      console.error('Failed to start Telegram bot:', error);
      void ensureLogPath().then((logPath) => appendTelegramLogEntry(
        logPath,
        createTelegramLogMetaEntry('bot-launch-failed', { error: String(error) })
      ));
    });

  bot.catch((error, ctx) => {
    console.error('Telegram bot middleware error:', error);
    void ensureLogPath().then((logPath) => appendTelegramLogEntry(
      logPath,
      createTelegramLogMetaEntry('bot-error', {
        error: String(error),
        updateType: String(ctx?.updateType || '')
      })
    ));
  });

  return bot;
}

startTelegramBot._internals = {
  getCommandArgs,
  normalizeTokenKey,
  getModuleTarget,
  getSearchTarget,
  splitFirstToken,
  levenshteinDistance,
  getModuleCatalog,
  getModuleSuggestions,
  parseDurationToMs,
  splitDurationAndLabel,
  parseTimerRequest,
  parseProjectFromText,
  parseNaturalLanguageIntent,
  parseLookupSubintent,
  parseLabEvent,
  parseProteinExpressionEvent,
  parseTransformationEvent,
  parseTransfectionEvent,
  parseCellCultureEvent,
  parsePurificationEvent,
  parseAssayEvent,
  parseGelEvent,
  parseReagentUseEvent,
  parseDecisionEvent,
  sendGlobalSearchCommand
};

module.exports = startTelegramBot;
