const TELEGRAM_MODULE_MAP = new Map([
  ['home', { type: 'open-view', viewId: 'home-view', label: 'Home' }],
  ['protocols', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['protocol', { type: 'open-view', viewId: 'protocol-management-view', label: 'Protocols' }],
  ['biology', { type: 'open-view', viewId: 'biology-notebook-view', label: 'Notebook' }],
  ['chemicals', { type: 'open-view', viewId: 'lab-common-inventory-view', label: 'Chemicals' }],
  ['samples', { type: 'open-view', viewId: 'sample-registry-view', label: 'Samples' }],
  ['assay', { type: 'open-view', viewId: 'assay-view', label: 'Assay' }],
  ['gel', { type: 'open-view', viewId: 'gel-view', label: 'Gel' }],
  ['inventory', { type: 'open-view', viewId: 'sample-registry-view', label: 'Samples' }],
  ['projects', { type: 'open-view', viewId: 'biology-notebook-view', label: 'Notebook' }],
  ['workflows', { type: 'open-view', viewId: 'workflow-management-view', label: 'Workflows' }],
  ['papers', { type: 'open-view', viewId: 'papers-view', label: 'Papers' }],
  ['tools', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['toolbox', { type: 'open-view', viewId: 'tool-box-view', label: 'Tools' }],
  ['settings', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }],
  ['setting', { type: 'open-view', viewId: 'setting-view', label: 'Settings' }]
]);

const TELEGRAM_SEARCH_TARGETS = new Map([
  ['inventory', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemical', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['chemicals', { scope: 'chemicals', label: 'Chemicals', type: 'search-chemicals' }],
  ['sample', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['samples', { scope: 'samples', label: 'Samples', type: 'search-samples' }],
  ['assay', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['assays', { scope: 'assay', label: 'Assay', type: 'search-assays' }],
  ['gel', { scope: 'gel', label: 'Gel', type: 'search-gels' }],
  ['gels', { scope: 'gel', label: 'Gel', type: 'search-gels' }]
]);

const LOOKUP_ACTIONS = new Map([
  ['inventory', { label: 'Inventory', moduleToken: 'chemicals', searchToken: 'inventory', globalScope: 'chemical' }],
  ['sample', { label: 'Sample', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['construct', { label: 'Construct', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['protocol', { label: 'Protocol', moduleToken: 'protocols', globalScope: 'protocol' }],
  ['project', { label: 'Project', moduleToken: 'projects', globalScope: 'project' }],
  ['paper', { label: 'Paper', moduleToken: 'papers', globalScope: 'papers' }],
  ['lot', { label: 'Lot', moduleToken: 'chemicals', searchToken: 'chemicals', globalScope: 'chemical' }],
  ['location', { label: 'Location', moduleToken: 'samples', searchToken: 'samples', globalScope: 'sample' }],
  ['expiry', { label: 'Expiry', moduleToken: 'chemicals', searchToken: 'chemicals', globalScope: 'chemical' }]
]);

const SEARCH_SCOPE_TO_LOOKUP_SUBINTENT = new Map([
  ['inventory', 'inventory'],
  ['chemical', 'inventory'],
  ['chemicals', 'inventory'],
  ['sample', 'sample'],
  ['samples', 'sample'],
  ['construct', 'construct'],
  ['constructs', 'construct'],
  ['protocol', 'protocol'],
  ['protocols', 'protocol'],
  ['project', 'project'],
  ['projects', 'project'],
  ['paper', 'paper'],
  ['papers', 'paper'],
  ['library', 'paper'],
  ['lot', 'lot'],
  ['lots', 'lot'],
  ['expiry', 'expiry'],
  ['expiring', 'expiry'],
  ['location', 'location']
]);

const DEFAULT_PROTOCOL_STEPS = [
  'Clarify lysate by centrifugation at configured conditions.',
  'Equilibrate Ni-NTA resin with binding buffer.',
  'Load clarified lysate onto the affinity column.',
  'Wash resin with low-imidazole wash buffer.',
  'Elute target protein with high-imidazole buffer.',
  'Collect and label elution fractions.',
  'Assess fractions by SDS-PAGE.',
  'Pool target-containing fractions.',
  'Buffer-exchange and concentrate pooled protein.',
  'Store aliquots and record final yield.'
];

const EVENT_TO_DRAFT_TYPE = new Map([
  ['protein_expression', 'notebook'],
  ['transformation', 'notebook'],
  ['transfection', 'notebook'],
  ['cell_culture', 'notebook'],
  ['purification', 'notebook'],
  ['assay', 'assay'],
  ['gel', 'notebook'],
  ['inventory_usage', 'reagent_checklist'],
  ['decision', 'decision'],
  ['task', 'task'],
  ['sample_registration', 'notebook'],
  ['reagent_registration', 'reagent_checklist'],
  ['checklist', 'notebook'],
  ['daily_summary', 'notebook'],
  ['reservation_request', 'reservation'],
  ['observation', 'notebook']
]);

const DRAFT_TYPE_LABELS = new Map([
  ['notebook', 'notebook entry'],
  ['decision', 'decision record'],
  ['task', 'task list'],
  ['assay', 'assay plan'],
  ['reagent_checklist', 'reagent checklist'],
  ['reservation', 'reservation request']
]);

const FIELD_LABEL_MAP = new Map([
  ['target_protein', 'target protein'],
  ['construct', 'construct'],
  ['host_strain', 'host strain'],
  ['culture_id', 'culture ID'],
  ['induction_od600', 'induction OD600'],
  ['inducer', 'inducer'],
  ['inducer_concentration', 'inducer concentration'],
  ['temperature_c', 'temperature (C)'],
  ['start_time', 'start time'],
  ['harvest_time', 'harvest time'],
  ['project', 'project'],
  ['protocol', 'protocol'],
  ['cell_line', 'cell line'],
  ['action', 'action'],
  ['split_ratio', 'split ratio'],
  ['confluency', 'confluency'],
  ['vessel', 'vessel'],
  ['media', 'media'],
  ['target', 'target'],
  ['sample_input', 'input sample'],
  ['purification_method', 'purification method'],
  ['fractions', 'fractions'],
  ['buffers', 'buffers'],
  ['linked_gel', 'linked gel'],
  ['assay_type', 'assay type'],
  ['assay_id', 'assay ID'],
  ['sample_set', 'sample set'],
  ['readout', 'readout'],
  ['controls', 'controls'],
  ['gel_type', 'gel type'],
  ['ladder', 'ladder'],
  ['expected_band_kda', 'expected band (kDa)'],
  ['items', 'items'],
  ['decision_text', 'decision'],
  ['reason', 'reason'],
  ['evidence_refs', 'evidence refs'],
  ['task_text', 'task'],
  ['sample_id', 'sample ID'],
  ['sample_name', 'sample name'],
  ['sample_type', 'sample type'],
  ['location', 'location'],
  ['reagent_name', 'reagent name'],
  ['lot_number', 'lot number'],
  ['amount', 'amount'],
  ['unit', 'unit'],
  ['summary', 'summary'],
  ['events', 'events'],
  ['event_count', 'event count'],
  ['title', 'title'],
  ['message_text', 'message']
]);

module.exports = {
  TELEGRAM_MODULE_MAP,
  TELEGRAM_SEARCH_TARGETS,
  LOOKUP_ACTIONS,
  SEARCH_SCOPE_TO_LOOKUP_SUBINTENT,
  DEFAULT_PROTOCOL_STEPS,
  EVENT_TO_DRAFT_TYPE,
  DRAFT_TYPE_LABELS,
  FIELD_LABEL_MAP
};
