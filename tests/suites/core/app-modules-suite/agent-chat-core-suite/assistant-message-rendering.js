module.exports = function registerAppAgentChatCoreSuiteAssistantMessageRendering(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();
  with (scope) {
test('agent-chat live progress keeps tool display JSON out of assistant text', () => {
  const liveProgressModule = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'live-progress-state.js'
  ));
  const placeholder = liveProgressModule.buildLiveAssistantPlaceholder(
    'agent-request-tool-json',
    'Find papers',
    () => 'live-id'
  );
  const withToolOutput = liveProgressModule.applyLiveProgressEvent(placeholder, {
    client_request_id: 'agent-request-tool-json',
    stage: 'codex_cli_display',
    status: 'completed',
    message: 'literature_search: {"selected_papers":[{"title":"A very long tool payload"}]}',
    meta: {
      codex_display_kind: 'tool',
      codex_display_text: 'literature_search: {"selected_papers":[{"title":"A very long tool payload"}]}'
    }
  });

  assert.equal(withToolOutput.text, 'Working on this...');
  assert.equal(withToolOutput.meta.live_progress.response_text, '');
  assert.equal(withToolOutput.meta.live_progress.codex_cli_display_rows.length, 1);

  const withAssistantAnswer = liveProgressModule.applyLiveProgressEvent(withToolOutput, {
    client_request_id: 'agent-request-tool-json',
    stage: 'codex_cli_display',
    status: 'streaming',
    message: 'Final paper search answer.',
    meta: {
      codex_display_kind: 'assistant',
      codex_display_text: 'Final paper search answer.'
    }
  });

  assert.equal(withAssistantAnswer.text, 'Final paper search answer.');
  assert.equal(withAssistantAnswer.meta.live_progress.response_text, 'Final paper search answer.');

  const waitingForUser = liveProgressModule.applyLiveProgressEvent(withAssistantAnswer, {
    client_request_id: 'agent-request-tool-json',
    stage: 'codex_agent_completed',
    status: 'ok',
    message: 'Codex agent completed.',
    meta: {
      status: 'needs_more_info'
    }
  });
  const waitingRow = waitingForUser.meta.live_progress.activity_rows
    .find((row) => row.stage === 'codex_agent_completed');
  assert.equal(waitingRow.text, 'Waiting for your answer');
});
test('agent-chat clarification cards disappear after one answer or any later user turn', () => {
  const questionRenderer = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'rendering-question-card.js'
  ));
  const questionMeta = {
    codex_agent: {
      status: 'needs_more_info'
    },
    user_question: {
      question: 'Which project should I use?',
      options: [{ label: 'Atlas', value: 'Use Atlas.' }],
      allow_custom: true
    }
  };

  assert.match(
    questionRenderer.renderUserQuestionCard(questionMeta, 'assistant-question', shared.safeText),
    /agent-user-question-card/
  );
  assert.match(
    questionRenderer.renderUserQuestionCard(questionMeta, 'assistant-question', shared.safeText),
    /agent-user-question-custom-field[\s\S]*<span>Other<\/span>[\s\S]*type="text"/
  );
  assert.match(
    questionRenderer.renderUserQuestionCard(questionMeta, 'assistant-question', shared.safeText),
    /agent-send-icon-btn[\s\S]*aria-label="Send answer"[\s\S]*agent-send-icon/
  );
  assert.equal(
    questionRenderer.renderUserQuestionCard({
      ...questionMeta,
      user_question: {
        ...questionMeta.user_question,
        status: 'answered',
        answered: { answer: 'Use Atlas.' }
      }
    }, 'assistant-question', shared.safeText),
    ''
  );
  assert.equal(
    questionRenderer.renderUserQuestionCard(questionMeta, 'assistant-question', shared.safeText, { disabled: true }),
    ''
  );
});
test('agent-chat maps assay experiment data with numeric summaries and preview caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [
      { id: 'n1', projectId: 'p1', protocolId: 'pr1', protocolName: 'Cell Prep', result: 'Done', updatedAt: '2026-01-01T00:00:00.000Z' }
    ],
    assays: [
      {
        id: 'a1',
        assayNumber: 'ASSAY-1',
        name: 'Viability Plate',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        plateType: '96',
        plateLabel: '96-well plate',
        plateRows: 8,
        plateColumns: 12,
        wellCount: 96,
        sampleAxis: 'row',
        concentrationAxis: 'column',
        sampleAxisValues: Array.from({ length: 14 }, (_value, index) => `sample-${index + 1}`),
        concentrationAxisValues: Array.from({ length: 14 }, (_value, index) => `${index + 1}`),
        wellLayout: Array.from({ length: 14 }, (_value, index) => ({
          well: `A${index + 1}`,
          sampleId: index % 2 === 0 ? 'sample-a' : 'sample-b',
          concentration: `${index + 1}`
        })),
        resultValues: {
          A1: '1',
          A2: '2.5',
          A3: 'not_numeric',
          A4: 4,
          A5: '',
          A6: '6',
          A7: '7',
          A8: '8',
          A9: '9',
          A10: '10',
          A11: '11',
          A12: '12',
          A13: '13'
        },
        notes: 'plate notes',
        updatedAt: '2026-02-01T00:00:00.000Z'
      },
      {
        id: 'a2',
        name: 'Other Project Assay',
        projectId: 'p2',
        updatedAt: '2026-03-01T00:00:00.000Z'
      }
    ],
    gelAnalyses: []
  }, 'p1');

  assert.equal(mapped.schema_name, 'hikari_experiment_json');
  assert.equal(mapped.schema_version, '1.0');
  assert.equal(mapped.notebook_runs.length, 1);
  assert.equal(mapped.assay_runs.length, 1);
  assert.equal(mapped.gel_runs.length, 0);

  const assayRun = mapped.assay_runs[0];
  assert.equal(assayRun.project_id, 'p1');
  assert.equal(assayRun.layout_summary.mapped_well_count, 14);
  assert.equal(assayRun.layout_summary.unique_sample_count, 2);
  assert.equal(assayRun.layout_summary.preview.length, 12);
  assert.equal(assayRun.axis.sample_values.length, 12);
  assert.equal(assayRun.axis.concentration_values.length, 12);
  assert.equal(assayRun.result_summary.result_well_count, 13);
  assert.equal(assayRun.result_summary.numeric_count, 11);
  assert.equal(assayRun.result_summary.min, 1);
  assert.equal(assayRun.result_summary.max, 13);
  assertClose(assayRun.result_summary.mean, 7.590909090909091, 1e-12);
  assert.equal(assayRun.result_summary.preview.length, 12);
});
test('agent-chat extracts Plotly graph artifacts from progress metadata', () => {
  const plotlyArtifacts = loadEsmStyleModule(path.join(
    __dirname,
    'src',
    'renderer',
    'modules',
    'agent-chat',
    'plotly-artifacts.js'
  ));
  const artifact = plotlyArtifacts.extractPlotlyGraphArtifactFromProgressEvent({
    stage: 'tool_call_completed',
    status: 'completed',
    tool_name: 'plotly_graph',
    meta: {
      plotly_graph_artifact: {
        id: '1',
        name: 'Assay dose response',
        summary: 'Created graph.',
        figure: {
          data: [{ type: 'scatter', x: [0.1, 1], y: [12, 42], name: 'Sample A' }],
          layout: { title: { text: 'Assay dose response' } },
          config: { responsive: true }
        }
      }
    }
  });

  assert.equal(artifact.id, '1');
  assert.equal(artifact.name, 'Assay dose response');
  assert.equal(artifact.figure.data[0].name, 'Sample A');
  assert.equal(artifact.figure.layout.title.text, 'Assay dose response');
});
test('agent-chat maps gel experiment data with confidence, calibration, and warning caps', () => {
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'));
  const mapped = agentModule.mapExperimentDataToLlmJson({
    notebookEntries: [],
    assays: [],
    gelAnalyses: [
      {
        id: 'g1',
        name: 'Gel Run 1',
        projectId: 'p1',
        projectName: 'Cancer Study',
        notebookEntryId: 'n1',
        notebookEntryProtocolName: 'Cell Prep',
        analysisType: 'western',
        imageName: 'gel-1.tiff',
        updatedAt: '2026-02-02T00:00:00.000Z',
        report: {
          confidence: { score: 0.91, label: 'high' },
          calibration: { ok: true, r2: 0.88, ladderLane: 2 },
          lanes: [{ bands: [{}, {}] }, { bands: [{}] }],
          bandGroups: [{ id: 'bg1' }, { id: 'bg2' }],
          warnings: Array.from({ length: 12 }, (_value, index) => `warning-${index + 1}`),
          preprocessing: {
            manualOverridesSummary: {
              laneSegmentationLeft: 10,
              laneSegmentationRight: 210,
              laneSegmentationDividers: 7,
              laneSegmentationBandTop: 20,
              laneSegmentationBandBottom: 44,
              addedBands: 2,
              ladderLaneOverride: 2,
              ladderBands: 3,
              ladderBandsDone: true
            }
          }
        }
      },
      {
        id: 'g2',
        name: 'Gel Run Other Project',
        projectId: 'p2',
        updatedAt: '2026-02-03T00:00:00.000Z'
      }
    ]
  }, 'p1');

  assert.equal(mapped.gel_runs.length, 1);
  const gelRun = mapped.gel_runs[0];
  assert.equal(gelRun.project_id, 'p1');
  assert.equal(gelRun.analysis_type, 'western');
  assert.equal(gelRun.lane_count, 2);
  assert.equal(gelRun.band_count, 3);
  assert.equal(gelRun.band_group_count, 2);
  assert.equal(gelRun.confidence.label, 'high');
  assert.equal(gelRun.confidence.score, 0.91);
  assert.equal(gelRun.calibration.ok, true);
  assert.equal(gelRun.calibration.r2, 0.88);
  assert.equal(gelRun.calibration.ladder_lane, 2);
  assert.equal(gelRun.warnings.length, 10);
  assert.equal(gelRun.manual_override_summary.lane_segmentation_dividers, 7);
  assert.equal(gelRun.manual_override_summary.ladder_bands_done, true);
});
test('agent-chat renders assistant markdown with emphasis, tables, and escaped HTML', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: [
          '## Summary',
          '',
          'Use **bold** and *italic* safely.',
          '',
          '| Sample | Value |',
          '| --- | ---: |',
          '| A1 | 42 |',
          '',
          '<script>alert("xss")</script>'
        ].join('\n'),
        createdAt: '2026-03-22T17:00:05.000Z'
      }
    ],
    state: {
      settings: {
        agent: {}
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /<h2>Summary<\/h2>/);
  assert.match(history.innerHTML, /<strong>bold<\/strong>/);
  assert.match(history.innerHTML, /<em>italic<\/em>/);
  assert.match(history.innerHTML, /<table class="agent-chat-table">/);
  assert.match(history.innerHTML, /data-align="right">42<\/td>/);
  assert.match(history.innerHTML, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(history.innerHTML, /<script>/);
});
test('agent-chat normalizes Codex agent answer envelopes', () => {
  const responseModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'public-api.js'));
  const completed = responseModule.normalizeAgentResponse({
    parser: {
      primary_intent: 'codex_agent',
      needs_clarification: false,
      reasoning_summary: 'Parser fallback should not render first.'
    },
    codex_agent: {
      status: 'completed',
      answer: 'Codex owned the lifecycle and produced this answer.',
      follow_up_questions: [],
      citations: [
        {
          source: 'notebook-lookup',
          pointer: 'notebook:1',
          reason: 'Matched local evidence.'
        }
      ],
      reasoning_summary: 'Verified with local records.'
    }
  });

  assert.equal(completed.assistantText, 'Codex owned the lifecycle and produced this answer.');
  assert.equal(completed.codexAgent.status, 'completed');
  assert.equal(completed.codexAgent.citations.length, 1);
  assert.equal(completed.userQuestion, null);

  const completedWithStaleQuestion = responseModule.normalizeAgentResponse({
    parser: {
      primary_intent: 'codex_agent',
      needs_clarification: false,
      reasoning_summary: 'Codex completed the answer.'
    },
    codex_agent: {
      status: 'completed',
      answer: 'mRNA display links peptides to their encoding mRNA.',
      user_question: {
        question: 'mRNA display links peptides to their encoding mRNA.',
        options: [],
        allow_custom: true
      },
      follow_up_questions: [],
      citations: []
    }
  });

  assert.equal(completedWithStaleQuestion.assistantText, 'mRNA display links peptides to their encoding mRNA.');
  assert.equal(completedWithStaleQuestion.userQuestion, null);

  const needsMoreInfo = responseModule.normalizeAgentResponse({
    parser: {
      primary_intent: 'codex_agent',
      needs_clarification: true,
      reasoning_summary: 'Fallback parser text.'
    },
    codex_agent: {
      status: 'needs_more_info',
      answer: 'Which project should I use?',
      follow_up_questions: ['Which project should I use?'],
      citations: []
    }
  });

  assert.equal(needsMoreInfo.assistantText, 'Which project should I use?');
  assert.equal(needsMoreInfo.codexAgent.status, 'needs_more_info');
});
test('agent-chat renders Codex user questions and returns option answers', async () => {
  const document = createMockDocument([
    'agent-project-select',
    'agent-chat-history',
    'agent-message-input',
    'agent-send-btn',
    'agent-clear-btn',
    'agent-status'
  ]);
  const history = document.getElementById('agent-chat-history');
  const questionDock = document.getElementById('agent-question-dock');
  const messageInput = document.getElementById('agent-message-input');
  const sendBtn = document.getElementById('agent-send-btn');
  const payloads = [];
  const state = {
    projects: [],
    protocols: [],
    notebookEntries: [],
    assays: [],
    gelAnalyses: [],
    workflows: [],
    papers: [],
    inventory: {},
    labInventory: { chemicals: [] },
    settings: {
      storagePath: '',
      llm: {
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'medium'
      },
      agent: {}
    },
    agentChat: { projectId: '', messages: [] }
  };
  const window = {
    hikariApi: {
      agentChat: async (payload) => {
        payloads.push(payload);
        if (payloads.length === 1) {
          return {
            ok: true,
            parser: {
              primary_intent: 'codex_agent',
              needs_clarification: true,
              clarification_reason: 'Which project should I use?',
              reasoning_summary: 'Codex needs project scope.'
            },
            codex_agent: {
              status: 'needs_more_info',
              answer: 'Which project should I use?',
              follow_up_questions: ['Which project should I use?'],
              user_question: {
                question: 'Which project should I use?',
                options: [
                  { label: 'Atlas', value: 'Use Atlas.', description: 'Continue in Atlas.' },
                  { label: 'All projects', value: 'Search all projects.' }
                ],
                allow_custom: true
              },
              citations: []
            }
          };
        }
        return {
          ok: true,
          parser: {
            primary_intent: 'codex_agent',
            needs_clarification: false,
            reasoning_summary: 'Codex continued with the selected scope.'
          },
          codex_agent: {
            status: 'completed',
            answer: 'Using Atlas.',
            follow_up_questions: [],
            citations: []
          }
        };
      }
    }
  };
  const agentModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'index.js'), {
    document,
    window
  });
  const agent = agentModule.initAgentChat({
    state,
    persist: () => {},
    createId: (() => {
      let idx = 0;
      return () => `question-msg-${idx += 1}`;
    })(),
    safeText: shared.safeText
  });

  agent.render();
  messageInput.value = 'Summarize this.';
  trigger(sendBtn, 'click');
  await flushAsync();
  await flushAsync();

  assert.equal(payloads.length, 1);
  assert.equal(document.getElementById('agent-status').textContent, 'Waiting for your answer.');
  assert.doesNotMatch(history.innerHTML, /agent-user-question-card/);
  assert.equal(questionDock.hidden, false);
  assert.match(questionDock.innerHTML, /agent-user-question-card/);
  assert.match(questionDock.innerHTML, /data-agent-question-answer="Use Atlas\."/);
  const optionButton = questionDock.querySelector('[data-agent-question-option]');
  assert.equal(optionButton.dataset.agentQuestionOption, state.agentChat.messages[1].id);
  trigger(questionDock, 'click', {
    target: {
      dataset: {
        agentQuestionOption: optionButton.dataset.agentQuestionOption,
        agentQuestionAnswer: 'Use Atlas.'
      }
    }
  });
  await flushAsync();
  await flushAsync();

  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].message, 'Use Atlas.');
  assert.equal(state.agentChat.messages.length, 4);
  assert.equal(state.agentChat.messages[1].meta.user_question.status, 'answered');
  assert.equal(state.agentChat.messages[1].meta.user_question.answered.answer, 'Use Atlas.');
  assert.equal(state.agentChat.messages[2].role, 'user');
  assert.equal(state.agentChat.messages[2].text, 'Use Atlas.');
  assert.equal(state.agentChat.messages[3].text, 'Using Atlas.');
  assert.doesNotMatch(history.innerHTML, /agent-user-question-card/);
  assert.equal(questionDock.hidden, true);
  assert.equal(questionDock.innerHTML, '');
  assert.equal(document.getElementById('agent-status').textContent, 'Complete.');
});
test('agent-chat renders completed science thinking trace details in assistant metadata', () => {
  const renderingModule = loadEsmStyleModule(path.join(__dirname, 'src', 'renderer', 'modules', 'agent-chat', 'rendering.js'));
  const document = createMockDocument(['agent-chat-history']);
  const history = document.getElementById('agent-chat-history');

  renderingModule.renderHistory({
    historyNode: history,
    messages: [
      {
        id: 'assistant-thinking-1',
        role: 'assistant',
        text: 'MAPK resistance commonly involves pathway reactivation.',
        createdAt: '2026-03-22T17:00:05.000Z',
        meta: {
          parser: {
            primary_intent: 'general_science_question',
            needs_clarification: false,
            reasoning_summary: 'This is a general science question.'
          },
          thinking_trace: {
            intent_parse_question: 'This is a general science question.',
            question_clarifier: 'I am clarifying which resistance mechanism the user wants explained.',
            criteria_generate: 'I am defining what evidence would be enough to answer safely.',
            tool_rounds: [
              {
                round: 1,
                tool_selection: 'I am choosing the most targeted literature step first.',
                tool_call: 'I want to use literature-search to investigate "MAPK inhibitor resistance".',
                tool_results: 'Based on the tool result, it seems pathway reactivation is a common explanation.'
              }
            ],
            pre_synthesize_answer: 'Based on the evidence so far, pathway reactivation is the leading answer.',
            judge: 'I am checking whether the current evidence is sufficient.',
            final_synthesize: 'I am synthesizing the final grounded answer from the evidence collected so far.',
            final_synthesized_question: 'What causes MAPK inhibitor resistance?'
          },
          general_science_question: {
            status: 'completed',
            confidence: 0.77,
            confidence_label: 'medium',
            rounds_executed: 1,
            citations: [],
            follow_up_questions: []
          }
        }
      }
    ],
    state: {
      settings: {
        agent: {}
      }
    },
    safeText: shared.safeText
  });

  assert.match(history.innerHTML, /Agent Trace/);
  assert.match(history.innerHTML, /<details[\s\S]*class="agent-thinking-trace"[\s\S]*aria-label="Agent Trace"/);
  assert.match(history.innerHTML, /data-agent-generated-trace="true"/);
  assert.match(history.innerHTML, /data-agent-trace-open="false"/);
  assert.doesNotMatch(history.innerHTML, /<details[^>]*\sopen(?:\s|=|>)/);
  assert.match(history.innerHTML, /Intent parse: This is a general science question/);
  assert.match(history.innerHTML, /Round 1 call: I want to use literature-search to investigate/);
  assert.match(history.innerHTML, /Final synthesis: I am synthesizing the final grounded answer/);
  assert.equal(
    history.innerHTML.indexOf('Agent Trace') < history.innerHTML.indexOf('MAPK resistance commonly involves pathway reactivation.'),
    true
  );
});
  }
};
