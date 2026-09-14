// Sample data for layout review; no library records are read or written.
import { createSequenceViewerCloningDesignController } from '../../src/renderer/modules/sequence-viewer/cloning-design.js';
import { IN_FUSION_PROCEDURE } from '../../src/renderer/modules/sequence-viewer/cloning-design/strategies.js';
const elements = {};
for (const [key, suffix] of Object.entries({cloningDesignWorkspace:'workspace',cloningDesignBackBtn:'back-btn',cloningDesignStrategyList:'strategy-list',cloningDesignRunBtn:'run-btn',cloningDesignConfirmBtn:'confirm-btn',cloningDesignStatus:'status',cloningDesignResult:'result'})) elements[key] = document.getElementById(`sequence-viewer-cloning-design-${suffix}`);
const source = {editRequest:{type:'replacement',start:136,end:944},editedSequence:'ATGC'.repeat(1118),templateSequence:'ATGC'.repeat(1129),editedRange:{start:136,end:944},defaultStrategy:'in-fusion'};
const record = {sequence:source.editedSequence,name:'Sample construct',topology:'circular',features:[]};
const primer = (name,role,groupLabel,sequence,tm,gcContent) => ({name,role,groupLabel,sequence,tm,gcContent});
const plan = {strategy:'in-fusion',feasible:true,summary:{templateLength:4517,resultLength:4472},warnings:[],primers:[
primer('vector F','assembly-forward-start','pYDL13 · Aga2p Q35A g.137delins808bp backbone PCR','CTGTCAGACCAAGTTTACTCATATATACTTTAGATTGA',56.4,31.6),
primer('vector R','assembly-reverse-overlap','pYDL13 · Aga2p Q35A g.137delins808bp backbone PCR','TTCCCGTTGAATATGGCTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGG',58,35),
primer('KanR F','assembly-forward','Insert amplicon PCR','ATGAGCCATATTCAACGGGAAACGTCTTGC',61.4,46.7),
primer('KanR R','assembly-reverse-overlap','Insert amplicon PCR','TGAGTAAACTTGGTCTGACAGTTAGAAAAACTCATCGAGCATCAAATGAACTGCA',59.5,37.5)
],plans:[{label:'In-Fusion assembly',plan:{recommendedAssemblyStrategy:'gibson',primerOligoPlan:{selectedThresholdLevel:'relaxed'},stepByStepProcedure:IN_FUSION_PROCEDURE}}]};
const state = {};
window.review = {state,plan,events:[],copied:[]};
Object.defineProperty(navigator,'clipboard',{value:{writeText: async value => window.review.copied.push(value)},configurable:true});
const controller = createSequenceViewerCloningDesignController({elements,state,getSelectedRecord:()=>record,getCloningDesignSource:()=>source,onReturnToDetail:()=>window.review.events.push('back'),onRequestPrimerOrder:primers=>window.review.events.push(`order:${primers.length}`)});
controller.bindEvents();controller.render();
window.review.restore = () => {state.cloningDesign.strategy='in-fusion';state.cloningDesign.insertStart=131;state.cloningDesign.insertEnd=947;state.cloningDesign.displayPlan=structuredClone(plan);controller.render();};
window.review.controller=controller;window.review.restore();window.review.ready=true;
