# README screenshots

These images show the current Hikari renderer with fictional teaching-lab data at 1600 × 1000. The bundled Gel workspace is captured from its actual plugin renderer at the same size.

Twelve of the fourteen images were refreshed on 2026-11-06 against the 1.1.0 source renderer: the seven used in the main README (home, notebook-entry, papers-viewer, sequence-detail, assay-layout, gel-analysis, agent-chat) and five used only in the guide (protocols-editor, notebook-project-dashboard, samples-registry, chemicals-list, workflows-graph). Ten of them are the full-window captures the [illustrated tutorials](../tutorial/README.md) already take and verify, so the gallery cannot drift from the chapters. The notebook page and the agent rail have no tutorial figure that shows what the gallery needs, so both are captured here from the Notebook chapter's fixture: the page builds a result table through the real table controls, and the rail mounts the real chat rail and history renderer. The conversation, the paper it cites, and the evidence behind the citation buttons are written for documentation. The two images that are not refreshed, tools-molarity and settings-appearance, are older manual captures from workspaces that have no tutorial chapter. None of them represent a real experiment, a functional plasmid, a published paper, or a live model response.

Previews use in-memory adapters for desktop-only storage, chat-history, sequence-library, and plugin-host calls. Screenshots demonstrate the rendered interfaces, not native persistence or AI execution. No personal storage root, research files, manuscripts, credentials, or private project records were used.

## Refresh

Re-run the chapter captures that feed the gallery, then this script, from the repository root:

```sh
for chapter in 01-home-dashboard 02-protocols 03-notebook 04-papers 05-samples 06-chemicals 07-workflows 08-dna 09-plate 10-gel; do
  node docs/tutorial/$chapter/tools/capture.cjs
done
node docs/screenshots/tools/capture.cjs
```

`tools/capture.cjs` copies each chapter's workspace capture into this folder, then captures `notebook-entry.png` and `agent-chat.png` in a disposable Electron profile with remote requests blocked. It fails rather than writing a misleading image if the result table does not keep its values, the rail does not expand, the scripted conversation does not render, or the citation buttons do not resolve. Which chapter capture feeds which image is the `FROM_TUTORIALS` map at the top of the script.

Inspect every refreshed image, and check that the alt text in [Readme.md](../../Readme.md) and the [guide](../guide/README.md) still describes what the picture shows. `tools-molarity.png` and `settings-appearance.png` have no capture script: take them in a disposable profile with fictional records, and never connect a screenshot session to a real research storage folder.
