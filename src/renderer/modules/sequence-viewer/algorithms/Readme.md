# Sequence Viewer Algorithms

This folder owns Sequence Viewer algorithms, including AB1 trace post-processing, ORF and restriction analysis, circular plasmid annotation, and backbone recognition.

Most files are renderer-side. The main-process sequence-library adapter also invokes the process-neutral backbone-recognition entrypoint because it needs direct access to Sequence Viewer storage.
