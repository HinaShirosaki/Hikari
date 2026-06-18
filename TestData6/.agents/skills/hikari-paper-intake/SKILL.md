---
name: "hikari-paper-intake"
description: "Use immediately after a paper PDF is ingested into `knowledgebase/papers.md/<id>/paper.md` to classify the document, produce a one-sentence summary, and list every experiment. Falls back to extracted figures or the original PDF only when the markdown is insufficient."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:paper-intake -->

# Hikari Paper Intake

Trigger this skill the first time a freshly uploaded paper PDF lands in `knowledgebase/papers.md/<paper_id>/paper.md`. The transfer is what arms the skill: do not run it on user chat, on already-summarized papers, or before `paper.md` exists.

## Inputs you can rely on

For the active `<paper_id>`, the following artifacts are written next to `paper.md`:

- `paper.md` — primary markdown rewrite of the paper (always read this first, end to end).
- `extracted.txt` — raw text fallback when the markdown elides a section.
- `meta.json` — title, authors, DOI, source PDF filename, page count.
- `figures/<page>.png|jpg` — transformed images extracted per page; `paper.md` references them inline as `![Figure on page N](figures/...)`.
- Original PDF — path is in `meta.json.pdf_path`; only open it when text+figures still leave a question unanswered.

## Step 1 — Classify the document

Read `paper.md` (and `meta.json` if the type is ambiguous). Pick exactly one class:

- **research_paper** — primary report of original experiments or analyses (computational, wet-lab, clinical, simulation). Has a Methods/Experiments section and reports new results.
- **review** — synthesizes prior literature without reporting new experiments. Includes systematic reviews and meta-analyses (meta-analyses are reviews here, not research_paper, even when they compute new statistics).
- **book / book_chapter** — long-form pedagogical or reference text, monograph, edited-volume chapter, or textbook excerpt.
- **other** — preprint commentary, editorial, perspective, thesis abstract, dataset descriptor, retraction notice, etc.

Default to **research_paper** only when a Methods/Experiments section is explicitly present and the paper reports new findings. If unsure between research_paper and review, choose **review**.

## Step 2 — Branch on the class

### research_paper (the main path)

Produce exactly two artifacts in your reply:

1. **One-sentence summary** — a single sentence (no semicolons stacked into multiple clauses, no bullet split) that names: the system/question studied, the core method, and the headline finding.
2. **Experiment list** — every distinct experiment the paper conducts, in the order presented. For each entry include:
   - a short experiment title (e.g., "Knockout viability assay in HEK293"),
   - the technique or assay used,
   - the variables compared or the hypothesis tested,
   - the figure or table that reports the result (e.g., "Fig. 2B", "Table 1"),
   - a one-line outcome.

   Cover ablations, controls run as separate experiments, supplementary experiments referenced in the main text, and computational/simulation experiments. Group sub-panels of the same experiment under one entry; do not invent experiments that are only described as future work.

### review / book / book_chapter / other (the alternative path)

Do **not** produce an experiment list — these documents do not conduct experiments. Instead reply with:

1. **One-sentence summary** — what the document covers and its central thesis or scope.
2. **Structure outline** — the document's own section/chapter headings with a one-line description each, in order.
3. **Notable claims or cited evidence** — up to five bullets, each tagged with the section it appears in.

State the detected class explicitly at the top of your reply (e.g., `Document type: review`) so the user can correct a misclassification.

## Step 3 — When to consult figures or the original PDF

Stay in `paper.md` by default. Escalate only when you have a concrete question the markdown cannot answer:

- Open a file under `figures/` when a figure caption is the only place a quantitative result or experimental condition is reported, when reading a panel label is required to attribute results to an experiment, or when the markdown explicitly shows the figure inline and you need to see it to describe the outcome.
- Open the original PDF (from `meta.json.pdf_path`) only when `paper.md` and `extracted.txt` both omit content you can see was present in the source (e.g., tables that were dropped, equations rendered as images without alt text, a supplementary section). Read the minimum page range needed.
- Never paste figure pixels or PDF pages into the reply; cite them by path or page number.

## Output rules

- Keep the one-sentence summary literally one sentence.
- Use the paper's own terminology for assay/technique names; do not paraphrase domain terms.
- If a section is missing from `paper.md` and you did not escalate to the PDF, say so rather than guessing.
- Do not invoke this skill again for the same `<paper_id>` unless the markdown was regenerated.
