---
name: "hikari-html-output"
description: "Build and publish interactive HTML explanations, calculators, filters, and analysis explorers inside Hikari Agent Chat using html_output. Use when interaction helps answer the user's request or the user asks for HTML output in chat."
---

<!-- HIKARI_OFFICIAL_MCP_SKILL:html-output -->

# Interactive HTML in Hikari Agent Chat

Use the connected Hikari `html_output` tool to put a working interactive document in the conversation. The tool takes a complete HTML string; it does not read a file path, host a website, run the analysis for you, or save changes to Hikari records.

Author a self-contained document with inline CSS, inline JavaScript, and the relevant data embedded in the document. Use `textContent` for user-entered values and escape data when inserting it into HTML or a script. State what the data represents, units, assumptions, and whether values are measured, calculated, or illustrative. Keep the initial state useful before the user changes any controls.

Call `html_output` with `title`, `html`, optional `caption`, and optional `height` in rem (16–64; default 32). Keep the full UTF-8 document within 512 KiB. Use the raw tool name exposed by the server. On success, give a short explanation of the interaction and its main result; Hikari renders the returned artifact automatically. Do not paste the document into the final answer or claim successful display after a failed tool call.

The preview allows inline scripts and styles, inline SVG/canvas, and data-URL images/fonts. It has **no network, CDN imports, relative or local file loading, Hikari/Electron bridge, persistent browser storage, popups, downloads, or navigation to another document**. Put all required values and small dependencies inside the HTML. Use ordinary JavaScript instead of `eval`, `new Function`, workers, or external libraries. Controls change the preview only. Source HTML survives chat reloads; user control changes reset to their initial values after reopening the chat.

- Read [the contract and troubleshooting guide](references/contract.md) for exact argument and return shapes or a failed call.
- Adapt [the threshold explorer](assets/threshold-explorer.html) when a small interactive filter is useful. Its values are explicitly illustrative; replace them with the user's actual data before presenting an analysis.

Use labeled, keyboard-operable controls and visible results. Fit both desktop and narrow chat widths; avoid fixed page widths and document-wide horizontal scrolling. Test at least one control and a meaningful edge case when a browser or local preview is available. Separate those checks from a claim that the underlying scientific calculation is validated.

For a static exported figure, `image_output` is more appropriate if enabled. For a scratch Assay Plotly figure, use `plotly_graph` if enabled. If `html_output` is disabled or unavailable, explain that limit briefly and answer with the available text/static output instead of imitating tool success.
