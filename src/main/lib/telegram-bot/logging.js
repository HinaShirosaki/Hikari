'use strict';

// Telegram message/event logging: resolves a writable log path and appends
// structured JSON-lines entries for incoming messages and bot lifecycle events.

const fs = require('fs/promises');
const path = require('path');
const { app } = require('electron');

// This file lives at src/main/lib/telegram-bot/, so the repo root is four
// levels up.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function getTelegramLogPathCandidates() {
  const override = String(process.env.TELEGRAM_BOT_LOG_PATH || '').trim();
  if (override) {
    return [override];
  }

  const candidates = [];
  if (!app.isPackaged) {
    candidates.push(path.join(PROJECT_ROOT, 'data', 'telegram-events.log'));
    candidates.push(path.join(process.cwd(), 'data', 'telegram-events.log'));
  } else {
    candidates.push(path.join(process.cwd(), 'data', 'telegram-events.log'));
  }
  candidates.push(path.join(app.getPath('userData'), 'telegram-events.log'));

  return Array.from(new Set(candidates));
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

function createTelegramLogMetaEntry(type, extra = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    ...extra
  });
}

async function appendTelegramLogEntry(logPath, entry) {
  if (!logPath) {
    return;
  }

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
    return true;
  } catch (error) {
    console.error('Failed to initialize Telegram message log file:', error);
    return false;
  }
}

async function resolveTelegramLogPath() {
  const candidates = getTelegramLogPathCandidates();
  for (const candidate of candidates) {
    const ok = await ensureTelegramLogFile(candidate);
    if (ok) {
      return candidate;
    }
  }
  return '';
}

module.exports = {
  getTelegramLogPathCandidates,
  detectMessageType,
  formatTelegramLogEntry,
  createTelegramLogMetaEntry,
  appendTelegramLogEntry,
  ensureTelegramLogFile,
  resolveTelegramLogPath
};
