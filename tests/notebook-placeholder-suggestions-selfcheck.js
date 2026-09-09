const assert = require('node:assert/strict');
const path = require('node:path');
const { loadEsmStyleModule } = require('./support/runtime.js');
const { matchPlaceholderSamples } = loadEsmStyleModule(path.join(__dirname, '../src/renderer/modules/biology-notebook/samples/placeholder-suggestions.js'));
const samples = [
  {id:'p1', name:'pET28a', code:'P-01', type:'plasmid'},
  {id:'p2', name:'pET28a', code:'P-02', type:'plasmid'},
  {id:'c1', name:'pET cells', code:'C-01', type:'cell_line'},
  {id:'x1', name:'pET lysate', code:'X-01', type:'custom_lysate'},
  {id:'other', name:'pET other', type:'other'}
];
const ids = (name, query, settings) => matchPlaceholderSamples(samples, name, query, settings).map(sample => sample.id).join(',');
assert.equal(ids('Plasmid','PET'), 'p1,p2');
assert.equal(ids('vectors','P-02'), 'p2');
assert.equal(ids('Cell Line','pet'), 'c1');
assert.equal(ids('cells','PET'), 'c1');
assert.equal(ids('Volume','pet'), '');
assert.equal(ids('Plasmid',''), '');
assert.equal(ids('Plasmid','   '), '');
assert.equal(ids('Plasmid','unmatched'), '');
assert.equal(ids('Lysate','pet', {sampleTypeLabels:{custom_lysate:'Lysate'}}), 'x1');
assert.equal(ids('DNA construct','pet', {sampleTypeLabels:{plasmid:'DNA construct'}}), 'p1,p2');
assert.equal(matchPlaceholderSamples(Array.from({length:30}, (_,i) => ({id:String(i), type:'plasmid', name:'pET'+i})), 'plasmid','pet').length, 12);
assert.equal(matchPlaceholderSamples([{id:'a',type:'plasmid',name:'extra pET'}, {id:'b',type:'plasmid',name:'pET28a'}, {id:'c',type:'plasmid',name:'pET'}], 'plasmid','pet')[0].id, 'c');
console.log('Notebook placeholder sample matching passed: types, aliases, custom labels, duplicate stocks, code/name search, ranking, limits, and free text.');
