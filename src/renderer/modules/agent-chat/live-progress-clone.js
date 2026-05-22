import { asArray, trimText } from './shared.js';

export function cloneLiveThinkingRows(source) {
  return asArray(source).map((row) => ({
    key: trimText(row?.key, 620),
    text: trimText(row?.text || row, 420)
  })).filter((row) => row.text);
}

export function cloneLiveActivityRows(source) {
  return asArray(source).map((row) => ({
    key: trimText(row?.key, 620),
    status: trimText(row?.status, 40),
    stage: trimText(row?.stage, 80),
    routing_intent: trimText(row?.routing_intent || row?.routingIntent, 120),
    tool_name: trimText(row?.tool_name || row?.toolName, 120),
    text: trimText(row?.text || row, 420)
  })).filter((row) => row.text);
}

export function cloneLiveCodexCliDisplayRows(source) {
  return asArray(source).map((row) => ({
    key: trimText(row?.key, 1500),
    stage: trimText(row?.stage, 80),
    routing_intent: trimText(row?.routing_intent || row?.routingIntent, 120),
    kind: trimText(row?.kind, 80),
    stream: trimText(row?.stream, 40),
    text: trimText(row?.text || row, 1200)
  })).filter((row) => row.text);
}
