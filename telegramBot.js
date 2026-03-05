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

function sendTelegramCommandToRenderer(getMainWindow, payload) {
  const mainWindow = getMainWindowSafe(getMainWindow);
  if (!mainWindow) {
    return false;
  }
  mainWindow.webContents.send('telegram-command', payload);
  return true;
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
    `Minimized: ${mainWindow.isMinimized() ? 'yes' : 'no'}`
  ].join('\n');
}

function startTelegramBot(getMainWindow, tokenOverride = '') {
  const token = String(tokenOverride || process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) {
    console.log('Telegram bot disabled (no token configured)');
    return null;
  }

  const bot = new Telegraf(token);

  bot.start((ctx) => {
    ctx.reply('Enana lab assistant bot connected. Use /help for commands.');
  });

  bot.command('help', (ctx) => {
    ctx.reply([
      'Available commands:',
      '/help - list commands',
      '/modules - list openable modules',
      '/open <module> - open module',
      '/status - app/window status',
      '/app - same as /status',
      '/ping - health check',
      '/time - local app host time',
      '/version - Enana app version',
      '/focus - bring app window to front',
      '/minimize - minimize app window',
      '/inventory <query> - open chemicals and search',
      '/samples <query> - open sample registry and search',
      '/assay <query> - open assay and search',
      '/gel <query> - open gel and search',
      '/echo <text> - echo text back'
    ].join('\n'));
  });

  bot.command('modules', (ctx) => {
    ctx.reply(
      'Openable modules: home, members, instruments, protocols, collaborations, synthesis, biology, chemicals, samples, assay, gel, inventory, projects, workflows, papers, tools, settings'
    );
  });

  bot.command('open', (ctx) => {
    const tokenArg = getCommandArgs(ctx.message?.text);
    if (!tokenArg) {
      ctx.reply('Usage: /open <module>. Try /modules.');
      return;
    }

    const target = getModuleTarget(tokenArg);
    if (!target) {
      ctx.reply(`Unknown module: ${tokenArg}. Try /modules.`);
      return;
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
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-chemicals',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Chemicals and searched for: ${query}` : 'Opened Chemicals inventory.');
  });

  bot.command('chemicals', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-chemicals',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Chemicals and searched for: ${query}` : 'Opened Chemicals inventory.');
  });

  bot.command('samples', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-samples',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Samples and searched for: ${query}` : 'Opened Sample Registry.');
  });

  bot.command('assay', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-assays',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Assay and searched for: ${query}` : 'Opened Assay.');
  });

  bot.command('assays', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-assays',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Assay and searched for: ${query}` : 'Opened Assay.');
  });

  bot.command('gel', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-gels',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Gel and searched for: ${query}` : 'Opened Gel.');
  });

  bot.command('gels', (ctx) => {
    const query = getCommandArgs(ctx.message?.text);
    const sent = sendTelegramCommandToRenderer(getMainWindow, {
      type: 'search-gels',
      query
    });
    if (!sent) {
      ctx.reply('No active Enana window. Open the app window and try again.');
      return;
    }
    ctx.reply(query ? `Opened Gel and searched for: ${query}` : 'Opened Gel.');
  });

  bot.on('text', (ctx) => {
    const msg = ctx.message.text;
    if (msg.startsWith('/')) {
      return;
    }

    console.log('Telegram message:', msg);

    const mainWindow = getMainWindowSafe(getMainWindow);
    if (mainWindow) {
      mainWindow.webContents.send('telegram-message', msg);
    }

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

module.exports = startTelegramBot;
