// Stored step text marks each fill-in value as {{ph:<placeholderId>}}; the
// editor shows it as [name]. Notebook pages key recorded values by that id, so
// ids must stay stable across edits (see buildStepEntriesFromText).
export const PLACEHOLDER_TOKEN_REGEX = /\{\{ph:([^}]+)\}\}/g;
