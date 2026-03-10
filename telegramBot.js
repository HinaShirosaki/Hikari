const fs = require('fs/promises');
const path = require('path');
const { app } = require('electron');
const { Telegraf } = require('telegraf');

const TELEGRAM_MODULE_MAP = new Map([
  ['home', { type: 'open-view', viewId: 'home-view', label: 'Home' }],
  ['members', { type: 'open-view', viewId: 'lab-management-view', label: 'Members' }],
  ['member', { type: 'open-view', viewId: 'lab-management-view', label: 'Members' }],
  ['instruments', { type: 'open-view', viewId: 'instrument-management-view', label: 'Instruments' }],
  ['instrument', { type: 'open-view', viewId: 'instrument-management-view', label: 'Instruments' }],
  ['protocols', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['protocol', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['collaborations', { type: 'open-view', viewId: 'collaboration-management-view', label: 'Collaborations' }],
  ['collaboration', { type: 'open-view', viewId: 'collaboration-management-view', label: 'Collaborations' }],
  ['synthesis', { type: 'open-view', viewId: 'synthesis-notebook-view', label: 'Synthesis Notebook' }],
  ['biology', { type: 'open-view', viewId: 'biology-notebook-view', label: 'Biology Notebook' }],
  ['chemicals', { type: 'open-view', viewId: 'lab-common-inventory-view', label: 'Chemicals' }],
  ['samples', { type: 'open-view', viewId: 'sample-registry-view', label: 'Samples' }],
  ['assay', { type: 'open-view', viewId: 'assay-view', label: 'Assay' }],
  ['gel', { type: 'open-view', viewId: 'gel-view', label: 'Gel' }],
  ['inventory', { type: 'open-view', viewId: 'personal-inventory-view', label: 'Personal Inventory' }],
  ['projects', { type: 'open-view', viewId: 'project-management-view', label: 'Projects' }],
  ['workflows', { type: 'open-view', viewId: 'workflow-management-view', label: 'Workflows' }],
  ['papers', { type: 'open-view', viewId: 'papers-view', label: 'Papers' }],
  ['tools', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['toolbox', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['settings', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }],
  ['setting', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }]
]);

const TELEGRAM_SEARCH_TARGETS = new Map([
  ['inventory', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemical', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemicals', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['sample', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['samples', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['assay', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['assays', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['gel', { scope: 'gel', label: 'Gel', type: 'search-gels' }],
  ['gels', { scope: 'gel', label: 'Gel', type: 'search-gels' }]
]);

function getMainWindowSafe(getMainWindow) {
  const mainWindow = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function getCommandArgs(text) {
  return String(text || '').replace(/^\/\S+\s*/, '').trim();
}

function normalizeTokenKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function getModuleTarget(token) {
  return TELEGRAM_MODULE_MAP.get(normalizeTokenKey(token)) || null;
}

function getSearchTarget(token) {
  return TELEGRAM_SEARCH_TARGETS.get(normalizeTokenKey(token)) || null;
}

function splitFirstToken(value) {
  const text = String(value || '').trim();
  if (!text) {
    return { first: '', rest: '' };
  }
  const firstSpace = text.indexOf(' ');
  if (firstSpace < 0) {
    return { first: text, rest: '' };
  }
  return {
    first: text.slice(0, firstSpace).trim(),
    rest: text.slice(firstSpace + 1).trim()
  };
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a) {
    return b.length;
  }
  if (!b) {
    return a.length;
  }

  const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j <= b.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function getModuleCatalog() {
  // Keep one canonical token per view; TELEGRAM_MODULE_MAP also includes aliases.
  const byView = new Map();
  TELEGRAM_MODULE_MAP.forEach((target, token) => {
    if (!byView.has(target.viewId)) {
      byView.set(target.viewId, {
        token,
        label: target.label
      });
    }
  });
  return Array.from(byView.values()).sort((a, b) => a.token.localeCompare(b.token));
}

function getModuleSuggestions(token, limit = 3) {
  const query = normalizeTokenKey(token);
  if (!query) {
    return [];
  }

  const candidates = getModuleCatalog().map((entry) => entry.token);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      score: levenshteinDistance(query, candidate)
    }))
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate));

  const threshold = Math.max(2, Math.floor(query.length / 2));
  const closeMatches = scored
    .filter((entry) => entry.score <= threshold)
    .slice(0, limit)
    .map((entry) => entry.candidate);
  if (closeMatches.length) {
    return closeMatches;
  }

  return candidates
    .filter((candidate) => candidate.includes(query) || query.includes(candidate))
    .slice(0, limit);
}

function sendTelegramCommandToRenderer(getMainWindow, payload) {
  const mainWindow = getMainWindowSafe(getMainWindow);
  if (!mainWindow) {
    return false;
  }
  mainWindow.webContents.send('telegram-command', payload);
  return true;
}

function getTelegramLogPath() {
  const override = String(process.env.TELEGRAM_BOT_LOG_PATH || '').trim();
  if (override) {
    return override;
  }
  return path.join(__dirname, 'data', 'telegram-messages.log');
}

function detectMessageType(message) {
  if (!message) {
    return 'unknown';
  }
  if (typeof message.text === 'string') {
    return 'text';
  }
  if (typeof message.caption === 'string') {
    return 'caption';
  }

  const knownTypes = [
    'photo',
    'video',
    'document',
    'audio',
    'voice',
    'animation',
    'sticker',
    'location',
    'contact',
    'poll'
  ];
  for (const type of knownTypes) {
    if (message[type]) {
      return type;
    }
  }
  return 'other';
}

function formatTelegramLogEntry(ctx) {
  const message = ctx.message || null;
  const body = typeof message?.text === 'string'
    ? message.text
    : typeof message?.caption === 'string'
      ? message.caption
      : '';

  return JSON.stringify({
    timestamp: new Date().toISOString(),
    updateType: String(ctx.updateType || ''),
    messageType: detectMessageType(message),
    chatId: message?.chat?.id ?? ctx.chat?.id ?? null,
    chatType: message?.chat?.type ?? ctx.chat?.type ?? '',
    fromId: message?.from?.id ?? ctx.from?.id ?? null,
    fromUsername: message?.from?.username ?? ctx.from?.username ?? '',
    fromName: [message?.from?.first_name, message?.from?.last_name].filter(Boolean).join(' ').trim(),
    messageId: message?.message_id ?? null,
    body
  });
}

async function appendTelegramLogEntry(logPath, entry) {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, `${entry}\n`, 'utf8');
  } catch (error) {
    console.error('Failed to append Telegram message log:', error);
  }
}

async function ensureTelegramLogFile(logPath) {
  try {
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, '', 'utf8');
  } catch (error) {
    console.error('Failed to initialize Telegram message log file:', error);
  }
}

function createStatusMessage(mainWindow) {
  if (!mainWindow) {
    return [
      'Enana app is running.',
      'Window: not available'
    ].join('\n');
  }

  return [
    'Enana app is running.',
    'Window: available',
    `Visible: ${mainWindow.isVisible() ? 'yes' : 'no'}`,
    `Minimized: ${mainWindow.isMinimized() ? 'yes' : 'no'}`,
    `Maximized: ${mainWindow.isMaximized() ? 'yes' : 'no'}`
  ].join('\n');
}

function sendSearchCommand(getMainWindow, target, query) {
  return sendTelegramCommandToRenderer(getMainWindow, {
    type: target.type,
    query: String(query || '').trim()
  });
}

function startTelegramBot(getMainWindow, tokenOverride = '') {
  const token = String(tokenOverride || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Telegram bot disabled (no token configured)');
    return null;
  }

  const bot = new Telegraf(token);
  const telegramLogPath = getTelegramLogPath();
  console.log(`Telegram message log: ${telegramLogPath}`);
  const chatDefaultSearchScope = new Map();
  void ensureTelegramLogFile(telegramLogPath);

  bot.use(async (ctx, next) => {
    if (ctx.message) {
      await appendTelegramLogEntry(telegramLogPath, formatTelegramLogEntry(ctx));
    }
    return next();
  });

  const getChatScopeKey = (ctx) => String(ctx?.chat?.id || ctx?.from?.id || 'global');
  const getDefaultSearchTarget = (ctx) => {
    const scope = chatDefaultSearchScope.get(getChatScopeKey(ctx));
    return scope ? getSearchTarget(scope) : null;
  };

  bot.start((ctx) => {
    ctx.reply('Enana lab assistant bot connected. Use /help for commands.');
  });

  bot.command('help', (ctx) => {
    ctx.reply([
      'Available commands:',
      '/help - list commands',
      '/modules - list openable modules',
      '/modules <keyword> - filter openable modules',
      '/open <module> - open module',
      '/open <module> <query> - open/search module in one command',
      '/search <scope> <query> - unified search (chemicals, samples, assay, gel)',
      '/scope <scope|none> - set/clear default search scope',
      '/q <query> - search using the saved default scope',
      '/status - app/window status',
      '/app - same as /status',
      '/ping - health check',
      '/time - local app host time',
      '/version - Enana app version',
      '/focus - bring app window to front',
      '/maximize - maximize app window',
      '/restore - restore app window',
      '/minimize - minimize app window',
      '/inventory <query> - open chemicals and search',
      '/samples <query> - open sample registry and search',
      '/assay <query> - open assay and search',
      '/gel <query> - open gel and search',
      '/echo <text> - echo text back'
    ].join('\n'));
  });

  bot.command('modules', (ctx) => {
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

  bot.command('open', (ctx) => {
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

    // If a trailing query exists and module supports search, run search directly.
    if (trailingQuery) {
      const searchTarget = getSearchTarget(tokenArg);
      if (searchTarget) {
        const sent = sendSearchCommand(getMainWindow, searchTarget, trailingQuery);
        if (!sent) {
          ctx.reply('No active Enana window. Open the app window and try again.');
          return;
        }
        ctx.reply(`Opened ${searchTarget.label} and searched for: ${trailingQuery}`);
        return;
      }
    }

    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'open-view',
      viewId: target.viewId
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }

    ctx.reply(`Opened ${target.label}.`);
  });

  bot.command('status', (ctx) => {
    ctx.reply(createStatusMessage(getMainWindowSafe(getMainWindow)));
  });

  bot.command('app', (ctx) => {
    ctx.reply(createStatusMessage(getMainWindowSafe(getMainWindow)));
  });

  bot.command('ping', (ctx) => {
    ctx.reply('pong');
  });

  bot.command('time', (ctx) => {
    ctx.reply(`Server time: ${new Date().toLocaleString('en-US', { timeZoneName: 'short' })}`);
  });

  bot.command('version', (ctx) => {
    ctx.reply(`Enana version: ${app.getVersion()}`);
  });

  bot.command('focus', (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to focus.');
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window focused.');
  });

  bot.command('maximize', (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to maximize.');
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.maximize();
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window maximized.');
  });

  bot.command('restore', (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to restore.');
      return;
    }
    if (mainWindow.isMinimized() || mainWindow.isMaximized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
    ctx.reply('Enana window restored.');
  });

  bot.command('minimize', (ctx) => {
    const mainWindow = getMainWindowSafe(getMainWindow);
    if (!mainWindow) {
      ctx.reply('No active Enana window to minimize.');
      return;
    }

    mainWindow.minimize();
    ctx.reply('Enana window minimized.');
  });

  bot.command('echo', (ctx) => {
    const text = getCommandArgs(ctx.message?.text);
    if (!text) {
      ctx.reply('Usage: /echo <text>');
      return;
    }
    ctx.reply(text);
  });

  bot.command('inventory', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('inventory');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Chemicals and searched for: ${query}` : 'Opened Chemicals inventory.');
  });

  bot.command('chemicals', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('chemicals');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Chemicals and searched for: ${query}` : 'Opened Chemicals inventory.');
  });

  bot.command('samples', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('samples');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Samples and searched for: ${query}` : 'Opened Sample Registry.');
  });

  bot.command('assay', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('assay');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Assay and searched for: ${query}` : 'Opened Assay.');
  });

  bot.command('assays', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('assays');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Assay and searched for: ${query}` : 'Opened Assay.');
  });

  bot.command('gel', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('gel');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Gel and searched for: ${query}` : 'Opened Gel.');
  });

  bot.command('gels', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const target = getSearchTarget('gels');
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Gel and searched for: ${query}` : 'Opened Gel.');
  });

  bot.command('search', (ctx) => {
    const { first: scopeArg, rest: query } = splitFirstToken(getCommandArgs(ctx.message?.text));
    if (!scopeArg || !query) {
      ctx.reply('Usage: /search <scope> <query>. Scopes: chemicals, samples, assay, gel');
      return;
    }
    const target = getSearchTarget(scopeArg);
    if (!target) {
      ctx.reply(`Unknown search scope: ${scopeArg}. Use one of: chemicals, samples, assay, gel.`);
      return;
    }
    const sent = sendSearchCommand(getMainWindow, target, query);
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(`Opened ${target.label} and searched for: ${query}`);
  });

  bot.command('scope', (ctx) => {
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
      ctx.reply(`Unknown scope: ${scopeArg}. Use chemicals, samples, assay, or gel.`);
      return;
    }
    chatDefaultSearchScope.set(chatKey, target.scope);
    ctx.reply(`Default search scope set to "${target.scope}". Use /q <query>.`);
  });

  bot.command('q', (ctx) => {
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
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(`Opened ${target.label} and searched for: ${query}`);
  });

  // Quick open aliases for common modules so users do not always need /open.
  getModuleCatalog().forEach((entry) => {
    const cmd = entry.token;
    if (['inventory', 'chemicals', 'samples', 'assay', 'gel'].includes(cmd)) {
      return;
    }
    bot.command(cmd, (ctx) => {
      const sent = sendTelegramCommandToRenderer(getMainWindow, {
        type: 'open-view',
        viewId: TELEGRAM_MODULE_MAP.get(cmd)?.viewId
      });
      if (!sent) {
        ctx.reply('No active Enana window. Open the app window and try again.');
        return;
      }
      ctx.reply(`Opened ${entry.label}.`);
    });
  });

  bot.on('text', (ctx) => {
    const msg = ctx.message.text;
    if (msg.startsWith('/')) {
      return;
    }

    console.log('Telegram message:', msg);
    ctx.reply(`Received: ${msg}`);
  });

  bot
    .launch()
    .then(() => {
      console.log('Telegram bot started');
    })
    .catch((error) => {
      console.error('Failed to start Telegram bot:', error);
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
  getModuleSuggestions
};

module.exports = startTelegramBot;
