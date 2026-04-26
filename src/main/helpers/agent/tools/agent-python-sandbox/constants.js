'use strict';

const SANDBOX_DEFAULT_TIMEOUT_MS = 6000;
const SANDBOX_MIN_TIMEOUT_MS = 500;
const SANDBOX_MAX_TIMEOUT_MS = 15000;
const SANDBOX_MAX_STDIO_CHARS = 120000;
const SANDBOX_MAX_READBACK_CHARS = 60000;
const SANDBOX_MAX_READBACK_FILES = 20;
const SANDBOX_MAX_INPUT_FILES = 32;
const SANDBOX_CAPTURE_MAX_CHARS = 1024 * 1024 * 4;
const SANDBOX_DEFAULT_HEARTBEAT_INTERVAL_MS = 1000;
const SANDBOX_HELPER_MODULE_NAME = 'enana_sandbox.py';
const SANDBOX_RENDER_OUTPUT_FILE_NAME = '.enana_sandbox_render_outputs.json';
const SANDBOX_MAX_RENDER_OUTPUTS = 12;
const SANDBOX_MAX_RENDER_TEXT_CHARS = 24000;
const SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS = 1024 * 1024;
const SANDBOX_DEFAULT_REPAIR_ATTEMPTS = 2;
const SANDBOX_MAX_REPAIR_ATTEMPTS = 6;
const SANDBOX_ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
]);

const PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['action', 'assistant_message'],
  properties: {
    action: {
      type: 'string',
      enum: ['rerun', 'return_result', 'give_up']
    },
    assistant_message: {
      type: 'string',
      maxLength: 4000
    },
    summary: {
      type: 'string',
      maxLength: 500
    },
    code: {
      type: 'string',
      maxLength: 40000
    },
    timeout_ms: {
      type: 'integer',
      minimum: SANDBOX_MIN_TIMEOUT_MS,
      maximum: SANDBOX_MAX_TIMEOUT_MS
    },
    files: {
      type: 'array',
      maxItems: SANDBOX_MAX_INPUT_FILES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: {
          path: {
            type: 'string',
            minLength: 1,
            maxLength: 240
          },
          content: {
            type: 'string'
          }
        }
      }
    },
    readback_paths: {
      type: 'array',
      maxItems: SANDBOX_MAX_READBACK_FILES,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 240
      }
    }
  }
});

module.exports = {
  SANDBOX_DEFAULT_TIMEOUT_MS,
  SANDBOX_MIN_TIMEOUT_MS,
  SANDBOX_MAX_TIMEOUT_MS,
  SANDBOX_MAX_STDIO_CHARS,
  SANDBOX_MAX_READBACK_CHARS,
  SANDBOX_MAX_READBACK_FILES,
  SANDBOX_MAX_INPUT_FILES,
  SANDBOX_CAPTURE_MAX_CHARS,
  SANDBOX_DEFAULT_HEARTBEAT_INTERVAL_MS,
  SANDBOX_HELPER_MODULE_NAME,
  SANDBOX_RENDER_OUTPUT_FILE_NAME,
  SANDBOX_MAX_RENDER_OUTPUTS,
  SANDBOX_MAX_RENDER_TEXT_CHARS,
  SANDBOX_MAX_RENDER_IMAGE_BASE64_CHARS,
  SANDBOX_DEFAULT_REPAIR_ATTEMPTS,
  SANDBOX_MAX_REPAIR_ATTEMPTS,
  SANDBOX_ALLOWED_IMAGE_MIME_TYPES,
  PYTHON_SANDBOX_SUB_AGENT_PLAN_SCHEMA
};
