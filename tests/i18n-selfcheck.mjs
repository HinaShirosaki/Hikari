import { createPresentation, presentationKey } from '../src/renderer/lib/i18n/presentation.js';
import assert from 'node:assert/strict';
import { plateEnglish } from '../src/renderer/modules/assay/locales/en.js';
import { dnaEnglish } from '../src/renderer/modules/sequence-viewer/locales/en.js';
import { dnaSpanish } from '../src/renderer/modules/sequence-viewer/locales/es.js';
import { agentEnglish } from '../src/renderer/modules/agent-chat/locales/en.js';
import { agentSpanish } from '../src/renderer/modules/agent-chat/locales/es.js';
import { papersEnglish } from '../src/renderer/modules/papers/locales/en.js';
import { papersSpanish } from '../src/renderer/modules/papers/locales/es.js';
import { relativePaperTimeMessage } from '../src/renderer/modules/papers/localization.js';
import { formatRelativePaperTime } from '../src/renderer/modules/papers/model.js';
import { plateSpanish } from '../src/renderer/modules/assay/locales/es.js';
import { notebookOptionMessage } from '../src/renderer/modules/assay/localization.js';
import { notebookLabel } from '../src/renderer/modules/assay/shared.js';
import { buildSerialDilutionSummaryModel, calculateSerialDilutionPlan } from '../src/renderer/modules/assay/serial-dilution-model.js';
import { samplesEnglish } from '../src/renderer/modules/personal-inventory/locales/en.js';
import { samplesSpanish } from '../src/renderer/modules/personal-inventory/locales/es.js';
import { sampleContainerType } from '../src/renderer/modules/personal-inventory/localization.js';
import { getContainerTypeLabel } from '../src/renderer/lib/inventory-containers.js';
import { chemicalsEnglish } from '../src/renderer/modules/lab-common-inventory/locales/en.js';
import { chemicalsSpanish } from '../src/renderer/modules/lab-common-inventory/locales/es.js';
import { CHEMICAL_IMPORT_FIELDS } from '../src/renderer/modules/lab-common-inventory/import-schema.js';
import { protocolEnglish } from '../src/renderer/modules/protocol/locales/en.js';
import { protocolSpanish } from '../src/renderer/modules/protocol/locales/es.js';
import { notebookEnglish } from '../src/renderer/modules/biology-notebook/locales/en.js';
import { notebookSpanish } from '../src/renderer/modules/biology-notebook/locales/es.js';
import { homeEnglish } from '../src/renderer/modules/home-dashboard/locales/en.js';
import { homeSpanish } from '../src/renderer/modules/home-dashboard/locales/es.js';
import { shellEnglish } from '../src/renderer/lib/i18n/shell-en.js';
import { shellSpanish } from '../src/renderer/lib/i18n/shell-es.js';
import { createI18n, i18n } from '../src/renderer/lib/i18n/index.js';
import { canonicalLocale, normalizeLocale } from '../src/renderer/lib/i18n/locale.js';
import { normalizeState } from '../src/renderer/modules/app-state/state-normalizer.js';
import { settingsEnglish } from '../src/renderer/modules/settings/locales/en.js';
import { commonEnglish } from '../src/renderer/lib/i18n/en.js';
import { commonSpanish } from '../src/renderer/lib/i18n/es.js';
import { settingsSpanish } from '../src/renderer/modules/settings/locales/es.js';
import { toolsEnglish } from '../src/renderer/modules/tool-box/locales/en.js';
import { workflowEnglish } from '../src/renderer/modules/workflow/locales/en.js';
import { toolsSpanish } from '../src/renderer/modules/tool-box/locales/es.js';
import { workflowSpanish } from '../src/renderer/modules/workflow/locales/es.js';
import { calculateMolarityDilution, calculateBufferIngredient, calculateFixedReactionReagent } from '../src/renderer/lib/bench-calculations.js';
import { translatedDate } from '../src/renderer/lib/i18n/dom.js';
import { messageAttributes } from '../src/renderer/lib/i18n/markup.js';

assert.notEqual(presentationKey('Info 🔥'), presentationKey('Info 💧'), 'Distinct supplementary Unicode characters have distinct source IDs');
assert.deepEqual(i18n.getAvailableLocales(), ['en', 'es'], 'English and the Spanish preview are bundled');
assert.equal(i18n.getLocale(), 'en', 'English remains the default');
assert.equal(normalizeLocale('es-MX'), 'es');
assert.equal(normalizeState({ settings: { locale: 'es_MX' } }).settings.locale, 'es');
assert.equal(canonicalLocale(' en_US '), 'en-US');
assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('zh_Hans_CN', ['en', 'zh-Hans']), 'zh-Hans');
for (const invalid of [null, {}, [], 42, '', 'not_a_locale_!', 'fr']) {
  assert.equal(normalizeLocale(invalid), 'en', 'Unsupported preferences remain English');
}
const oldState = { settings: { appearance: { mode: 'night' } }, protocols: [{ id: 'p', name: 'My protocol' }] };
const normalized = normalizeState(oldState);
assert.equal(normalized.settings.locale, 'en', 'Existing workspaces acquire the English default');
assert.equal(normalized.settings.appearance.mode, 'night');
assert.equal(normalized.protocols[0].name, 'My protocol');
assert.equal(oldState.settings.locale, undefined, 'Normalization does not mutate the imported state');
assert.equal(normalizeState({ settings: { locale: 'en_GB' } }).settings.locale, 'en');
assert.equal(normalizeState({ settings: { locale: { language: 'fr' } } }).settings.locale, 'en');

const translator = createI18n({ locale: 'fr-CA', catalogs: {
  en: { test: {
    greeting: 'Hello, {name}. {missing}',
    records: { one: '{count} record', other: '{count} records' },
    shared: 'English fallback',
    empty: ''
  }, settings: settingsEnglish },
  fr: { test: { shared: 'Français', localized: { one: '{count} élément', other: '{count} éléments' } } },
  'fr-CA': { test: { regional: 'Québec' } }
} });
assert.equal(translator.getLocale(), 'fr-CA');
assert.equal(translator.t('test.regional'), 'Québec');
assert.equal(translator.t('test.shared'), 'Français', 'A regional locale falls back to its parent');
assert.equal(translator.t('settings.appearance.title'), 'Appearance', 'An unmigrated namespace falls back to English');
assert.equal(translator.t('test.records', { count: 0 }), '0 records', 'Fallback plurals use the message language');
assert.equal(translator.t('test.records', { count: 1 }), '1 record');
assert.equal(translator.t('test.records', { count: 2 }), '2 records');
assert.equal(translator.t('test.localized', { count: 0 }), '0 élément');
assert.equal(translator.t('test.greeting', { name: '$& <img src=x>' }), 'Hello, $& <img src=x>. {missing}');
assert.equal(translator.t('test.empty'), '', 'Intentionally empty messages are supported');
assert.equal(translator.t('missing.key'), 'missing.key');
assert.equal(translator.t('missing.key', {}, 'Original English'), 'Original English');
assert.equal(translator.has('missing.key'), false);
assert.equal(translator.scope('settings')('startup.title'), 'Startup');
assert.equal(translator.scope('missing')('key', {}, 'Fallback'), 'Fallback');

assert.throws(() => translator.registerMessages('de', 'test', { valid: 'Text', invalid: { one: 'Incomplete' } }));
assert.equal(translator.getAvailableLocales().includes('de'), false, 'Invalid catalogs register nothing');
assert.throws(() => translator.registerMessages('en', undefined, { valid: 'Text' }));
assert.throws(() => translator.registerMessages('en', 'test', ['Text']));
assert.throws(() => translator.registerMessages('en', 'test', { invalid: () => 'Code' }));
translator.registerMessages('en', 'test', { added: 'Added later' });
assert.equal(translator.t('test.added'), 'Added later');

const changes = [];
const unsubscribe = translator.subscribe(locale => changes.push(locale));
translator.setLocale('en-US');
translator.setLocale('en');
translator.setLocale('unsupported');
assert.deepEqual(changes, ['en'], 'Unchanged resolved locales do not re-render');
assert.equal(translator.formatDate(new Date('2026-10-27T00:00:00Z'), {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
}), '10/27/2026');
unsubscribe();
translator.setLocale('fr');
assert.deepEqual(changes, ['en'], 'Module subscriptions can be disposed');

// Bundled Spanish is partial (missing keys fall back to English at runtime), so
// check only what it does contain: no stale keys, same interpolation parameters.
for (const [en, es] of [[commonEnglish, commonSpanish], [settingsEnglish, settingsSpanish], [toolsEnglish, toolsSpanish], [workflowEnglish, workflowSpanish], [dnaEnglish, dnaSpanish], [agentEnglish, agentSpanish], [papersEnglish, papersSpanish], [plateEnglish, plateSpanish], [samplesEnglish, samplesSpanish], [chemicalsEnglish, chemicalsSpanish], [protocolEnglish, protocolSpanish], [notebookEnglish, notebookSpanish], [homeEnglish, homeSpanish], [shellEnglish, shellSpanish]]) {
  const parameters = message => [...new Set(Object.values(typeof message === 'string' ? { other: message } : message)
    .flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1])))].sort();
  for (const [key, message] of Object.entries(es)) {
    assert.ok(Object.hasOwn(en, key), 'Spanish key has no English source: ' + key);
    assert.deepEqual(parameters(message), parameters(en[key]), 'Translation retains parameters: ' + key);
  }
}
for (const field of CHEMICAL_IMPORT_FIELDS) assert.equal(chemicalsEnglish['field.' + field.key], field.label, 'Chemical UI English matches the canonical import schema: ' + field.key);
const sampleEnglish = createI18n({ catalogs: { en: { samples: samplesEnglish } } });
for (const container of ['box25', 'box49', 'box64', 'box81', 'box100', 'plate96', 'single', 'customGrid', 'unknown',
  { type: 'customGrid', gridRows: 3, gridCols: 7 }, { type: 'customGrid', rows: 99, cols: 0 }]) {
  const { key, params } = sampleContainerType(container);
  assert.equal(sampleEnglish.t(`samples.${key}`, params), getContainerTypeLabel(container), 'Sample UI English matches canonical layout labels');
}
const plateEnglishText = createI18n({ catalogs: { en: { plate: plateEnglish } } });
for (const entry of [{ notebookType: 'biology', experimentName: 'Run <&>', updatedAt: '2026-10-27T10:00:00Z' },
  { notebookType: 'synthesis', protocolName: 'Prep' }, { experimentName: '  ' }]) {
  const { key, params } = notebookOptionMessage(entry);
  assert.equal(plateEnglishText.t(`plate.${key}`, params), notebookLabel(entry), 'Plate notebook options keep the canonical English label');
}
const papersEnglishText = createI18n({ catalogs: { en: { papers: papersEnglish } } });
for (const minutesAgo of [0, 5, 59, 61, 600, 1439, 1441, 5000, 10079, 10081, 60000]) {
  const stamp = new Date(Date.now() - minutesAgo * 60000).toISOString();
  const { key, params } = relativePaperTimeMessage(stamp);
  assert.equal(papersEnglishText.t(`papers.${key}`, params), formatRelativePaperTime(stamp), 'Paper ages keep the compact English format');
}
assert.equal(relativePaperTimeMessage('not a date'), null, 'Invalid paper dates keep the canonical dash');
// Serial-dilution UI descriptors render the model's canonical English exactly.
const entry = (wellLabel, magnitude) => ({ wellLabel, magnitude, concentrationLabel: String(magnitude), concentrationDisplay: String(magnitude) });
const dilutionGroup = (chainEntries, extra = {}) => ({ sampleId: 'S', hasConflict: false, trailingEntries: [], chainEntries, ...extra });
for (const [group, volumePerWellUl, stockConcentrationText] of [
  [dilutionGroup([entry('A1', 10)], { hasConflict: true, trailingEntries: [entry('A9', -1), entry('A10', -2)] }), 0, '100'],
  [dilutionGroup([]), 100, '100'], [dilutionGroup([entry('A1', -1)]), 100, '100'], [dilutionGroup([entry('A1', 10)]), 100, 'x'],
  [dilutionGroup([entry('A1', 10)]), 100, '5'], [dilutionGroup([entry('A1', 10), entry('A2', 20)]), 100, '100']]) {
  const plan = calculateSerialDilutionPlan({ group, volumePerWellUl, stockConcentrationText });
  assert.equal(plateEnglishText.t(`plate.${plan.errorMessage.id}`, plan.errorMessage.params), plan.error, 'Dilution error descriptor matches English: ' + plan.error);
  plan.notes.forEach((note, index) => assert.equal(plateEnglishText.t(`plate.${plan.noteMessages[index].id}`, plan.noteMessages[index].params), note, 'Dilution note descriptor matches English'));
}
const dilutionSummary = buildSerialDilutionSummaryModel({ groups: [dilutionGroup([entry('A1', 10), entry('A2', 5), entry('A3', 2.5)])],
  sampleAxis: 'row', volumePerWellUl: 100, getSerialDilutionStockValue: () => '100' });
assert.equal(dilutionSummary.followingDilutionRows.length, 2, 'Valid dilution produces following rows');
for (const row of dilutionSummary.followingDilutionRows) {
  assert.equal(plateEnglishText.t(`plate.${row.stepMessage.id}`, row.stepMessage.params), row.step, 'Dilution step descriptor matches English');
  assert.equal(plateEnglishText.t(`plate.${row.transferMessage.id}`, row.transferMessage.params), row.transferOrDiscard, 'Dilution transfer descriptor matches English');
}
for (const [count, text] of [[1, 'Auto-filled 1 concentration step at a 1:2 dilution.'], [3, 'Auto-filled 3 concentration steps at a 1:2 dilution.']]) {
  assert.equal(plateEnglishText.t('plate.status.filledSeries', { count, factor: 2 }), text, 'Plate fill status keeps its English plural');
}
const spanish = createI18n({ locale: 'es-MX', catalogs: {
  en: { common: commonEnglish, settings: settingsEnglish, tools: toolsEnglish, workflow: workflowEnglish, test: { fallback: 'English fallback' } },
  es: { common: commonSpanish, settings: settingsSpanish, tools: toolsSpanish, workflow: workflowSpanish, test: {
    greeting: 'Hola, {name}.',
    records: { one: '{count} registro', other: '{count} registros' }
  } }
} });
assert.equal(spanish.getLocale(), 'es', 'Mexican Spanish resolves to the bundled Spanish catalog');
assert.equal(spanish.t('settings.appearance.title'), 'Apariencia');
assert.equal(spanish.t('settings.appearance.day'), 'Día', 'Accented characters survive');
assert.equal(spanish.t('common.action.saveChanges'), 'Guardar cambios');
assert.equal(spanish.t('test.greeting', { name: 'José' }), 'Hola, José.');
assert.equal(spanish.t('test.records', { count: 0 }), '0 registros');
assert.equal(spanish.t('test.records', { count: 1 }), '1 registro');
assert.equal(spanish.t('test.records', { count: 2 }), '2 registros');
assert.equal(spanish.t('test.fallback'), 'English fallback');
assert.equal(spanish.t('tools.molarity.massResult', { value: '58.44', unit: 'mg' }), 'Masa: 58.44 mg');
assert.equal(spanish.t('tools.buffer.row.chemical', { index: 7 }), 'Sustancia química del ingrediente 7');
assert.equal(spanish.t('workflow.summary.runs', { count: 1 }), '1 ejecución');
assert.equal(spanish.t('workflow.summary.runs', { count: 3 }), '3 ejecuciones');
assert.equal(spanish.t('workflow.summary.steps', { count: 1 }), '1 paso');
assert.equal(spanish.t('workflow.summary.steps', { count: 2 }), '2 pasos');
assert.equal(spanish.t('workflow.block.title', { index: 1, title: '<my step>' }), 'Bloque 1: <my step>');
assert.throws(() => messageAttributes({ onclick: 'workflow.step.complete' }), /Unsupported translated attribute/);
const english = createI18n({ catalogs: { en: { tools: toolsEnglish } } });
for (const values of [
  { stockConcentrationValue: '100', targetConcentrationValue: '10', finalVolumeValue: '1' },
  { stockConcentrationValue: '10', targetConcentrationValue: '100', finalVolumeValue: '1' }
]) {
  const result = calculateMolarityDilution(values);
  const snapshot = JSON.stringify(result);
  const { id, params } = result.displayMessage;
  assert.equal(english.t(`tools.bench.${id}`, params), result.resultText, 'Dilution metadata preserves exact legacy English');
  assert.ok(spanish.t(`tools.bench.${id}`, params).startsWith(id.endsWith('higher') ? 'La concentración' : 'Usa '));
  assert.equal(JSON.stringify(result), snapshot, 'Translation does not change calculation data');
}
const ingredientCases = [
  { name: 'My compound', stockConcentration: '1 mg/mL', finalConcentration: '10 mM', volumeMl: '100' },
  { name: 'My compound', stockConcentration: '10 mM', finalConcentration: '100 mM', volumeMl: '100' },
  { name: 'My compound', stockConcentration: '100 mM', finalConcentration: '10 mM', volumeMl: '100' }
];
for (const values of ingredientCases) {
  const result = calculateBufferIngredient(values);
  const { id, params } = result.displayMessage;
  assert.equal(english.t(`tools.bench.${id}`, params), result.resultText.replace(/^My compound: /, '').replace(/\.$/, ''), 'Buffer placeholder metadata preserves English and quantity formatting');
}
for (const values of ingredientCases.slice(0, 2)) {
  const result = calculateFixedReactionReagent({ ...values, totalVolumeValue: '100', totalVolumeUnit: 'uL' });
  const { id, params } = result.displayMessage;
  assert.equal(english.t(`tools.bench.${id}`, params), result.resultText.replace(/^My compound: /, '').replace(/\.$/, ''), 'Reaction placeholder metadata preserves exact English warnings');
}
const dateValue = '2026-10-27T12:00:00Z';
assert.equal(translatedDate(dateValue, 'Oct 27', { month: 'short', day: 'numeric', timeZone: 'UTC' }, spanish), '27 oct');
assert.equal(translatedDate(dateValue, 'Original OS date', {}, english), 'Original OS date', 'English retains the existing OS date format');
assert.equal(translatedDate('invalid', 'Original', {}, spanish), 'Original');
assert.equal(translatedDate(dateValue, 'Original', { month: 'invalid' }, spanish), 'Original', 'Malformed date options fail safely');
assert.equal(spanish.formatDate(new Date('2026-10-27T00:00:00Z'), {
  year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC'
}), '27/10/2026');
spanish.registerMessages('es-MX', 'test', { regional: 'México' });
spanish.setLocale('es_MX');
assert.equal(spanish.getLocale(), 'es-MX');
assert.equal(spanish.t('test.regional'), 'México');
assert.equal(spanish.t('settings.startup.resume'), 'Reanudar el último módulo', 'Regional catalogs inherit Spanish module messages');
assert.deepEqual(i18n.getAvailableLocales(), ['en', 'es'], 'Only product locales are registered by default');
const uncatalogued = createPresentation('selfcheck');
assert.match(uncatalogued.html('Copy missing from the catalog'), />Copy missing from the catalog</, 'Uncatalogued copy renders its English source, not its key');
assert.match(uncatalogued.render(uncatalogued.compose([uncatalogued.message('Also missing {n}', { n: 2 })])), />Also missing 2</);
console.log('i18n selfcheck passed: English, Spanish, regional fallback, catalogs, interpolation, plurals, formatting, preferences, subscriptions.');
