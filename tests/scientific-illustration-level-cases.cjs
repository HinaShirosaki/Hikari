// Distinct natural user requests. Renderer hints come from saved preferences,
// not injected into these visible prompts. All subjects are textbook-level.
module.exports = [
  { id: 'level-0-gene-expression', percent: 0, title: 'Gene expression',
    prompt: 'Draw a compact gene-expression diagram: DNA, messenger RNA and a protein as three independently editable biological components, arranged left to right. Show transcription and translation with two directional arrows. Label DNA, mRNA, Protein, Transcription and Translation. Use a clean textbook composition with no extra structures.',
    labels: ['DNA', 'mRNA', 'Protein'], expected: 'svg' },
  { id: 'level-25-receptor-signalling', percent: 25, title: 'Receptor signalling',
    prompt: 'Illustrate receptor signalling with one extracellular ligand, one receptor crossing a plasma membrane, and one intracellular kinase. Make the ligand recognizable as an irregular organic protein; show ligand binding and downstream activation with arrows. Label Ligand, Receptor, Plasma membrane and Kinase. Keep the figure compact and lightly shaded, with no invented pathway details.',
    labels: ['Ligand', 'Receptor', 'Kinase'], expected: 'hybrid' },
  { id: 'level-50-organelles', percent: 50, title: 'Cellular organelles',
    prompt: 'Create a textbook comparison of a mitochondrion and a lysosome, with comparable visual sizes in two separate panels. Show the mitochondrion cut open to reveal recognizable cristae, and the lysosome as a single-membrane vesicle with a simple interior. Label Mitochondrion, Cristae and Lysosome, and connect Cristae to its target with a thin leader arrow. Use light organic shading; no scale bar or measured data.',
    labels: ['Mitochondrion', 'Cristae', 'Lysosome'], expected: 'hybrid' },
  { id: 'level-75-phagocytosis', percent: 75, title: 'Phagocytosis',
    prompt: 'Illustrate a large macrophage extending around one smaller rod-shaped bacterium during phagocytosis. Keep the macrophage and bacterium independently editable. Use recognizable organic cell contours with a clear engulfment opening, and a directional arrow indicating engulfment. Label Macrophage, Bacterium and Engulfment. Use a clean white background; do not add unrequested cargo, surface appendages or extra cells.',
    labels: ['Macrophage', 'Bacterium', 'Engulfment'], expected: 'hybrid' },
  { id: 'level-100-blood-cells', percent: 100, title: 'Blood cell portraits',
    prompt: 'Create two independent educational blood-cell portraits: a red blood cell with its biconcave shape, and a smaller resting platelet with a rounded organic contour. Give each subject its own editable artwork component. Put them in separate thin panel frames, label Red blood cell and Platelet, and add a thin leader arrow from Central depression to the red blood cell centre. Use natural surface detail and soft lighting. This is illustrative artwork, not microscopy or measured data.',
    labels: ['Red blood cell', 'Platelet', 'Central depression'], expected: 'hybrid' },
  { id: 'complex-hybrid-secretion', percent: 75, complexity: 'detailed', width: 2400, height: 1600, title: 'Protein secretion: detailed hybrid',
    prompt: 'Create a detailed three-stage scientific illustration of protein secretion: synthesis at the rough endoplasmic reticulum, processing at the Golgi apparatus, and a transport vesicle fusing with the plasma membrane to release protein outside the cell. Use recognizable cutaway anatomy and organic surface detail for the ER and Golgi. Show a small protein cargo, transport vesicles, a budding membrane neck and the final fusion opening clearly. Keep the ER, Golgi, cargo, vesicles and plasma membrane independently editable. Connect the stages with precise directional arrows and place them in three thin panel frames. Add separate labels Rough ER, Golgi apparatus, Transport vesicle, Plasma membrane and Secreted protein, plus stage numbers 1, 2 and 3. Use a coordinated scientific palette and legible labels; show no nucleus, mitochondria or unrelated cells.',
    labels: ['Rough ER', 'Golgi apparatus', 'Transport vesicle', 'Plasma membrane', 'Secreted protein'], expected: 'hybrid' }
];
