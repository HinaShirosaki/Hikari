'use strict';
// Creates only labeled demo chats in the currently configured workspace.
// No provider requests, notebook writes, or protocol approvals are performed.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const { createAgentChatLogRuntime } = require('../../src/main/agent/context/agent-chat-log.js');

async function main() {
  const pointer = JSON.parse(fs.readFileSync(path.join(require('node:os').homedir(), 'Documents/Hikari/Config/last-storage-root.json')));
  const storagePath = path.resolve(pointer.storagePath);
  assert.equal(storagePath, path.join(root, 'TestData3'), 'Recheck authorization if the active workspace changes.');
  const chat = createAgentChatLogRuntime();
  const indexPath = path.join(storagePath, 'chat_log/index.json');
  const before = JSON.parse(fs.readFileSync(indexPath));
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const hashes = Object.fromEntries(before.sessions.map(s => [s.id, digest(path.join(storagePath, 'chat_log', s.log_file))]));
  const outputSample = await chat.getSession({ storagePath, sessionId: 'demo-output-20260912-02' });
  const html = outputSample.messages.find(message => message.meta?.html_artifacts?.length)?.meta.html_artifacts;
  assert.equal(html?.length, 1, 'The existing synthetic threshold example must be available.');
  const demos = [
    {
      id: 'rendering-demo-20260913-01', title: 'Rendering 1 · Answers & tables',
      prompt: 'Compare these sample runs and tell me what is still missing.',
      text: '### Run 03 needs its raw result file\n\nThis is a **sample conversation** showing the new reading layout. The fictional records below illustrate how Hikari separates evidence from missing information.\n\n| Record | Run 02 | Run 03 |\n| --- | --- | --- |\n| Notebook entry | Available | Available |\n| Raw results | Attached | Missing |\n| Numerical comparison | Ready | Waiting for data |\n\nAttach the Run 03 file before comparing the measurements. Until then, a summary can describe the recorded methods and flag the missing result.\n\nExpand **Activity** to inspect the sample updates, or use the copy icon below.',
      meta: { activity_trace_rows: ['Demo: checked two fictional notebook entries', 'Demo: compared their attachment lists', 'Demo: identified the missing raw result file'] }
    },
    {
      id: 'rendering-demo-20260913-02', title: 'Rendering 2 · Notebook review',
      prompt: 'Prepare a notebook page that I can review before saving.',
      text: 'The sample page is ready to preview. Open **Review draft** to read its purpose, steps, and checkpoints directly in the conversation.\n\nThis is an unbound demo: no project or protocol is assigned, so creating a notebook page requires those bindings first.',
      meta: {
        activity_trace_rows: ['Demo: assembled a reviewable notebook proposal'],
        notebookDraft: {
          proposal: { proposal_id: 'rendering-demo-notebook-20260913', title: 'Demo · Run comparison summary', purpose: 'Keep the available observations and missing data together.', rationale: 'Separate documented observations from results that still need an attachment.', planned_materials: ['Fictional Run 02 summary', 'Fictional Run 03 attachment checklist'], checkpoints: ['Both raw result files are attached before numerical comparison.', 'All sample values remain labeled as illustrative.'] },
          rendered_steps: ['Review the two sample record summaries.', 'Mark the Run 03 result file as missing.', 'Add a comparison once both source files are available.'],
          unresolved_placeholders: [{ step_id: 'binding', placeholder_id: 'project-protocol', display: 'Choose a real project and protocol before saving this demo.' }],
          save: { mode: 'confirm_before_save', applied: false, status: 'pending' },
          entry_template: { notebookState: 'planned', experimentName: 'Demo · Run comparison summary', result: 'Illustrative preview only. No experimental findings.' }
        }
      }
    },
    {
      id: 'rendering-demo-20260913-03', title: 'Rendering 3 · Protocol review',
      prompt: 'Show me a protocol draft with inline approval controls.',
      text: 'Open the card to inspect this short **sample document-review checklist**. Its approval buttons use the same workflow as generated protocols. Choosing **Add to protocols** will save this labeled demo checklist; it has not been added yet.',
      meta: { protocol_generation: { protocols: [{ name: 'Demo · Document review checklist', purpose: 'Demonstrate an inline protocol preview using administrative steps.', materials: ['A sample document', 'A list of source attachments'], steps: ['Confirm the title and date of the sample document.', 'Check that each cited attachment is present.', 'Record missing information without inventing values.'], troubleshooting: 'If a source is missing, mark it as unavailable and request it before completing the comparison.' }] } }
    },
    {
      id: 'rendering-demo-20260913-04', title: 'Rendering 4 · Interactive output',
      prompt: 'Let me filter a small sample dataset inside the conversation.',
      text: 'Move the threshold slider in this **synthetic dataset** to change which samples remain. At **0.8**, one of the four samples meets the threshold.\n\nYou can collapse and reopen the output while keeping its controls intact. Reopening the saved chat starts a fresh preview.',
      meta: { html_artifacts: html }
    },
    {
      id: 'rendering-demo-20260913-05', title: 'Rendering 5 · Clarification',
      prompt: 'Show how Hikari asks for a choice without interrupting the chat.',
      text: 'This sample request needs one choice before continuing. The question stays above the composer, with suggested options and space for your own answer.\n\nSubmitting an answer continues this demo as a normal agent conversation.',
      meta: { codex_agent: { status: 'needs_more_info' }, user_question: { id: 'rendering-demo-choice', question: 'How should the sample report handle missing data?', context: 'Choose a direction, or write your own answer.', options: [{ label: 'Summarize available records', description: 'Keep missing results clearly marked.', value: 'For this rendering demo, summarize the fictional records and mark missing data.' }, { label: 'List what is needed', description: 'Prepare a short attachment checklist.', value: 'For this rendering demo, list the missing attachments without using real records.' }], allow_custom: true, placeholder: 'Describe another approach' } }
    },
    {
      id: 'rendering-demo-20260913-06', title: 'Rendering 6 · Error state',
      prompt: 'Show an example of a request that could not finish.',
      text: '**Sample error: the result file could not be read.**\n\nThis is a rendering demonstration; no request failed. In a real conversation, the next step would be to check that the file is still available, attach it again, and retry the request.',
      meta: { parser: { clarification_reason: 'agent_error' } }
    }
  ];
  for (const demo of [...demos].reverse()) {
    if (!before.sessions.some(session => session.id === demo.id)) {
      await chat.createSession({ storagePath, sessionId: demo.id, title: demo.title });
      const timestamp = new Date().toISOString();
      await chat.appendRows(storagePath, demo.id, [
        { type: 'user-message', session_id: demo.id, message_id: demo.id + '-user', timestamp, text: demo.prompt },
        { type: 'assistant-message', session_id: demo.id, message_id: demo.id + '-assistant', timestamp, text: demo.text, meta: { ...demo.meta, demo: true } }
      ]);
    }
    const loaded = await chat.getSession({ storagePath, sessionId: demo.id });
    assert.equal(loaded.messages.length, 2);
    assert.equal(loaded.messages[1].meta.demo, true);
    console.log('Saved: ' + demo.title);
  }
  const after = JSON.parse(fs.readFileSync(indexPath));
  for (const original of before.sessions) {
    assert.deepEqual(after.sessions.find(session => session.id === original.id), original);
    assert.equal(digest(path.join(storagePath, 'chat_log', original.log_file)), hashes[original.id]);
  }
  const manifestPath = path.join(__dirname, 'demos.json');
  if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ storagePath, existingSessionsPreserved: before.sessions.length, demos: demos.map(demo => ({ id: demo.id, title: demo.title, log: path.join(storagePath, 'chat_log', demo.id + '.log') })) }, null, 2) + '\n');
  console.log('Preserved all ' + before.sessions.length + ' existing session summaries and log files.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
