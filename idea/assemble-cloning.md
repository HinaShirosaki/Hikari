# Cloning Assembly Agent Idea

## Goal
Build an agent-assisted cloning workflow that helps users assemble tags and multiple protein coding sequences into a single plasmid construct.

The system should support practical lab design decisions rather than only sequence manipulation.

## Core assumptions
- Protein coding sequences are already available in stock.
- For short inserts or edits shorter than about 30 amino acids, the system should prefer introducing them through primers or existing template sequence rather than gene synthesis.
- Full synthesis followed by in-house cloning is generally not meaningful when the needed sequence is already available.
- The workflow should choose between **traditional restriction-ligation cloning** and **Gibson assembly** based on construct structure and feasibility.

## Agent role
The LLM agent should help:
- plan cloning strategy
- choose assembly method
- design cloning logic
- call tools for primer and oligo generation
- generate a detailed experimental plan

The agent may reason about primers, overlaps, and restriction sites, but it is **not allowed to directly output primer sequences** in free text.

Instead, primer or oligo sequences must only be returned through a dedicated tool call that also reports relevant parameters such as:
- oligo sequence
- melting temperature (Tm)
- length
- GC content
- optional warnings

## Required functions

### 1. `overlap_pcr(array)`
Determine whether a set of input sequences can be assembled by overlap PCR.

**Expected behavior:**
- evaluate whether adjacent fragments contain sufficient overlap potential
- determine whether overlap PCR is feasible for the full assembly
- report calculated overlap Tm values
- identify problematic junctions
- suggest whether additional primer-introduced overlap is required

**Suggested output:**
- feasible: true/false
- junction-by-junction summary
- overlap lengths
- overlap Tm values
- warnings and failure reasons

### 2. `gibson_assemble(array)`
Determine whether a set of input sequences can be assembled by Gibson assembly.

**Expected behavior:**
- evaluate whether required overlaps can be created or already exist
- determine whether the full fragment set is suitable for Gibson assembly
- identify assembly bottlenecks
- report overlap quality and expected compatibility

**Suggested output:**
- feasible: true/false
- fragment order
- junction overlap summary
- overlap Tm values
- warnings and failure reasons

### 3. Site-directed mutagenesis function
Support point mutation, small insertion, deletion, or short sequence replacement workflows.

**Expected behavior:**
- determine whether the requested edit is suitable for site-directed mutagenesis
- recommend mutagenesis versus re-assembly when appropriate
- call primer-design tools when mutagenesis is feasible
- provide a mutation validation plan

## Decision logic
The agent should choose the cloning route using rules like these:
- use **restriction-ligation** when suitable unique restriction sites exist and the cloning path is simple
- use **Gibson assembly** when multiple fragments must be assembled or when restriction sites are limiting
- use **overlap PCR** when fragment fusion can be achieved efficiently through PCR-generated overlaps
- use **site-directed mutagenesis** for local edits rather than rebuilding the whole construct

## Final output
The final system output should include:
- recommended assembly strategy
- ordered fragment map
- assembled vector design
- primer/oligo tool calls where needed
- restriction enzyme selection when applicable
- expected junction logic
- step-by-step PCR and assembly procedure
- validation plan, including colony PCR or sequencing recommendations

## Future extensions
Possible future improvements:
- automatic backbone selection
- codon optimization recommendation when stock sequence is unsuitable
- cloning scar detection
- tag orientation and linker recommendation
- reading frame validation
- enzyme compatibility checking
- automated plasmid map rendering