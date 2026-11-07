import { matchesNotebookType } from '../modules/biology-notebook/entry/entry-helpers.js';

export function createOpenRecordCitation({ state, modules, showView, views }) {
  return ({ source_type: type, record_id: id }) => {
    if (type === 'protocol' && state.protocols?.some(protocol => protocol.id === id)
      && typeof modules.protocol?.viewProtocol === 'function') {
      showView(views.PROTOCOL_MANAGEMENT);
      return { ok: modules.protocol.viewProtocol(id) === true };
    }
    if (type === 'notebook' && state.notebookEntries?.some(entry => entry.id === id && matchesNotebookType(entry, 'biology'))
      && typeof modules.biologyNotebook?.openEntry === 'function') {
      showView(views.BIOLOGY_NOTEBOOK);
      return { ok: modules.biologyNotebook.openEntry(id) === true };
    }
    return { ok: false };
  };
}
