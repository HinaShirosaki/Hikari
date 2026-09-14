# HTML output contract

Pass only the arguments object to `html_output`:

```json
{
  "title": "Threshold explorer",
  "html": "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>body{font:1rem system-ui;margin:1rem}button{font:inherit}</style></head><body><h1>Count</h1><button type=\"button\" id=\"add\">Add one</button><p>Count: <output id=\"count\" aria-live=\"polite\">0</output></p><script>let n=0;document.querySelector('#add').addEventListener('click',()=>{document.querySelector('#count').textContent=++n;});</script></body></html>",
  "caption": "Click Add one to update the count.",
  "height": 24
}
```

`title` and `html` must be nonempty strings. Title is at most 220 characters; caption is at most 2,000. Height is an integer from 16 through 64 in rem. HTML is at most 524,288 UTF-8 bytes; non-ASCII text may use multiple bytes per character. NUL bytes are rejected. Unknown arguments are rejected. There is no `path`, `url`, dependency installer, or external access option.

The MCP response has a short JSON text block, matching structured metadata, and one embedded resource with `mimeType: "text/html"`, `text` containing the document, and a `hikari-html-artifact://<id>` URI. That URI identifies embedded content, not a website to open. `html_artifact` metadata includes `type: "html"`, stable content-derived `id`, title, caption, and height. Hikari reconstructs the document for display and saves it with the assistant message. Identical outputs are deduplicated; changed HTML produces a new output.

A successful call is `{ "ok": true, "status": "completed", ... }`. It confirms Hikari accepted the artifact, not that every calculation or interaction is correct. Browser verification remains separate. A revised document is a new artifact; this tool does not replace earlier chat records.

For `invalid_arguments`, correct the named field or reduce the document size. For `disabled`, the tool is switched off in Hikari settings. It is also unavailable to background notebook suggestion runs. Do not repeatedly retry unchanged arguments.

If a preview appears without working controls, check for remote imports, blocked assets, syntax errors, or reliance on parent/window APIs. Use only inline scripts and styles and embedded data; attach events with `addEventListener`. Avoid navigation and form submission. For more vertical space, set `height` or let the document scroll. The user can resize the frame vertically.
