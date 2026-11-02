import { createPresentation } from '../../../lib/i18n/presentation.js';
import '../localization.js';
import { createQuickSampleController } from '../../../lib/quick-sample-controller.js';
import { buildNotebookSampleCapture } from './notebook-capture-record.js';

const i18nUi = createPresentation('notebook');

// Save the notebook page first, then capture and persist the placed sample.
export function createNotebookQuickSampleController({ ensureEntry, onCreated, ...config } = {}) {
  return createQuickSampleController({
    ...config,
    prepareCreate: async () => {
      const entry = await ensureEntry?.();
      if (!entry) throw new Error(i18nUi.text('Open a notebook page before adding a sample.'));
      return entry;
    },
    onCreated: async ({ record, context: entry }) => {
      const capture = buildNotebookSampleCapture({ state: config.state }, record, {
        notebookEntryId: entry.id,
        requestedAt: record.updatedAt,
        source: 'notebook-quick-add'
      });
      if (!capture) throw new Error(i18nUi.text('Could not link the sample to this notebook page.'));
      await onCreated?.({ entry, record, ...capture });
    }
  });
}
