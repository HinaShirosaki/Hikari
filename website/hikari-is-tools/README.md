# Hikari product, agent, and trial website

The website uses [Rosé Pine](https://rosepinetheme.com/palette/) with a gold accent:
background `#191724`, main text `#e0def4`, secondary text `#908caa`, and accent `#f6c177`.
Headers, hover states, dividers, and the install command derive from the shared
palette tokens. Light app windows retain Hikari's day-mode colors; controls on
light screenshot panels use Rosé Pine Dawn's pine color for visible focus rings.

`index.html` contains the Product and Agent presentations and shared
Product / Agent / Trial / Plugins header. Agent sits between Product and Trial.
The Plugins tab opens `#plugins`, with a Figura preview,
installation instructions, and links to the plugin source and
developer quickstart. Header keyboard navigation cycles through all four tabs.
Product and Agent independently restore their scroll positions; opened Trial
workspaces stay mounted. Inactive app iframes keep their viewport dimensions with visibility hiding, and are inert and excluded from accessibility navigation. This avoids collapsing live spreadsheet layouts to zero during demo switches. Frame sizing writes only changed CSS values and batches resize notifications. Run `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron website/hikari-is-tools/trial-calculations-electron.cjs` to check local-file and HTTP startup, switching, molarity editing, and worksheet draft preservation. Below 420px, the brand uses its icon to keep all four
tabs and Install visible on one line.
On phones, the feature menu becomes a horizontal row of labels below the header,
with 44px controls and all three feature highlights visible. The animated stages
use the stable small viewport height; tall sections still pan through their full
content. Only the current and next feature screenshots load during browsing.
Hero captures use responsive WebP variants; see `hikari-is/tools/HERO_CAPTURES.md`
for generation and the mobile browsing check.
The right-side progress dots on desktop are also a feature menu. Hover the dots or focus one
with the keyboard to reveal all feature labels, then select one to jump directly
to that section. Product includes Notebook, Samples, Calculations, and the other
features; Agent has its own labels. The current section is marked with
`aria-current`, and selecting a feature moves keyboard focus to its heading.
Each section has a shareable hash link; the existing notebook, workflow, and
Protein Builder links remain valid.
The Install footer detects macOS or Windows in the visitor's browser and shows
the matching Terminal or PowerShell command, with an instruction to open that app,
paste the command, and press Return or Enter. The platform buttons let visitors
switch manually. Mobile, Linux, and unrecognized platforms start with a chooser;
both commands remain available without JavaScript. Detection runs locally.
After the command, the same platform selection explains how to open the output:
move Hikari.app to Applications on macOS, or run HikariSetup.exe and launch from
Start on Windows. A native “Install guide” disclosure, closed by default,
contains only two installation steps: wait for the command to finish, then open
the app. The wait note names the selected terminal and explains the default
hikari-out output folder. The two steps sit side by side on desktop and stack on
smaller screens. One link leads to the full installation instructions. Tutorials,
workspace setup, general FAQs, and issue reporting are outside this disclosure.
Figura's installation steps are likewise folded under “Install Figura”. Both
disclosures work with the keyboard and without JavaScript.
Figura installation links to the public Hikari source ZIP and identifies the
scientific-illustration folder under Hikari-main/plugins. Visitors keep that
folder, add it in Settings, review its access, enable it, and reload. The website
continues to serve only the Figura preview, not a bundled plugin archive.
Product and Agent distinguish the free, open-source app from optional AI, which
uses a ChatGPT plan with Codex CLI access.
The Product opening states that records are saved locally. The Codex introduction
explains that AI uses remote processing. Approval wording applies specifically to
notebook drafts, page additions, and generated protocols; it does not promise
approval for every saved result, such as explanations attached to a selection.
The inline Copy button copies the selected platform's exact command, confirms
success, and falls back to browser copy support when the Clipboard API is
unavailable. It restores focus after the fallback and announces copy results.
Six Product features have a Try It link to `#trial/<feature>`. Links into the Trial are
hidden on phones, using the same media query that shows its "Try Hikari on a computer" message. The first AI
introduction uses a wider vector diagram connecting protocols, samples, notebook,
and papers to Hikari Agent, with examples of writing, finding, explaining, and
plotting across the workspace. Drafted pages and protocols remain subject to review.
Explore Agent links to `#agent`. The plugin introduction uses an open hexagonal
lattice around the shared Hikari mark. Analyze and Create cells show gel bands
and a scientific-figure motif; a dashed Extend cell leaves space for another tool.
Explore Plugins links to `#plugins`.
The Product illustrations use restrained motion: traces connect records to Agent
tasks, notebook values highlight in sequence before the saved-method check draws,
and short plugin edge traces travel around the open lattice.
Text and Hikari marks remain still. Motion pauses in hidden sections and tabs,
and reduced-motion preferences disable it. Editing a notebook example pauses its
ambient cues; the existing See another run action still controls the example data.
Figura has no trial, and the website ships no plugin code; old
`#trial/plugins` links redirect to `#plugins`, and the Trial feature picker lists
cloning, Protein Builder, calculations, protocols, workflows, and samples. Trial starts with cloning; old
`#trial/experiments` links redirect to Agent. AI scenes are capture-only,
and direct app URLs resolve to a public trial unless capture mode is enabled.
Saved records and the existing per-feature try counts are preserved.
Every public Trial window uses the same native dock treatment: one icon and the
selected feature's name. The desktop module registry is scoped before startup,
so resizing keeps the feature visible without an unrelated More modules menu.
The Agent tab opens `#agent` and uses the same scroll-story renderer as Product:
an opening, six sections with the “Hikari is…” decode and dot indicator, and a
closing line linking to Install. The first section introduces Codex CLI, ChatGPT
plan access, and no API key setup with a responsive vector illustration
(`codex-flow.css`). The five feature sections then cover protocol writing and polish,
saved selection explanations and supplier options, paper search, PDF downloads, and questions,
agent charts, and draft approval. The closing explains that the desktop app uses
the Codex CLI with your ChatGPT plan. Agent is a static showcase;
its prepared capture replies never appear in the public Trial picker.
The Codex introduction connects the Hikari mark, a terminal glyph for Codex CLI,
and the white OpenAI Blossom for ChatGPT, joined by dashed lines, with "No API key
to create or paste" below. Small signals travel out and back along the connections,
and the terminal cursor blinks; all icons keep their size and position. These
animations pause outside the visible section and stop for reduced-motion preferences.
The OpenAI Blossom belongs to OpenAI; its unmodified path comes from the
[official brand artwork](https://openai.com/brand/). It identifies ChatGPT access
and stays the same size as the other diagram icons.
The Product AI and Plugins diagrams use Hikari's transparent star-and-helix
artwork from `assets/icon.svg`. One shared SVG symbol keeps the original filled
shapes without the extra stroke intended for small action buttons. `hikari-mark.css`
keeps all illustration marks static, with their original proportions. The header
retains its static app icon. Browser tabs prefer the original gold star-and-helix
artwork as a transparent SVG, with PNG and ICO fallbacks. The vector contains no
navy tile or square border; a fresh Safari preview shows the mark without the
white frame seen on the previously cached tile. Run
`node node_modules/electron/cli.js website/hikari-is-tools/build-favicons.cjs`
to regenerate the favicon assets from `assets/icon.svg`; the desktop app icons
are unchanged. The landing page, standalone Trial, file-preview frame,
and 404 page use the same vector favicon. Rebuilding the Trial preserves its link.
Product and Agent finish with matching install commands, platform controls,
copy buttons, guides, and project links. Each footer holds for 1.2 viewport heights
of scrolling, matching the feature cycle. A tall footer first scrolls fully into
view, then holds with the command visible. The header Install link targets the
current story's footer. Both footers work independently with distinct IDs.
On desktop the Codex chain's center follows the vertical midpoint of the visible
section, independently of the copy height; narrow screens retain the stacked layout.
Feature headings, descriptions, and lists use their natural height, so short copy
leaves no gaps. Compact desktop typography keeps the complete description in view.
Each feature takes 1.2 viewport heights of scrolling (`CYCLE`); the first section's
headline shrink and detail fade are fractions of that cycle.
If a feature is taller than the viewport, its content moves upward with the page
scroll so the bottom is revealed before the next section. Short windows retain
the media's natural aspect ratio, and keyboard focus reveals off-screen actions
or editable illustration controls without requiring wheel positioning.
The website pairs Newsreader for the opening, scrolling headlines,
closing line, and Plugins introduction with DM Sans for feature headings, body
text, controls, and illustration labels. Both use automatic optical sizing;
the scrolling headlines use a slightly stronger weight for smaller text.
Display sizes are restrained for Newsreader, with a smaller "Hikari is" lead-in
and a shared responsive size for feature and plugin headings. Body text stays
at 17px on a regular desktop viewport.
Product and Agent openings share the same serif title scale,
two-line statement, line spacing, and description area. Both reserve the same
space below the description so their titles align when switching tabs.
The first feature phrase resolves from random
code, then its heading shrinks once into the feature layout as you scroll.
Later sections keep "Hikari is" at a consistent size and position; changing
phrases scramble the outgoing heading into random code, briefly hold the code,
then resolve the next heading. The heading stays visible at section boundaries,
in either scroll direction; the feature content retains its brief fade and 8px
movement. Rapid switches cancel the earlier reveal. Reduced motion
shows the small headings and final phrases immediately. Reserved heading space
keeps the content position steady when a phrase wraps or code is resolving.
Protocol → Notebook uses an editable HTML illustration: a saved method with blank
fields becomes a notebook record with run values, an observation, and a method
snapshot. See another run reuses the same method with a second set of example
values. Its canvas follows the content height, with larger type and a wider
media column. The illustration and its Try It action stay centered at a maximum
width of 840px on wide displays, while shrinking with the available column on
smaller screens. Shared header and step rows align both pages and center the
transfer arrow beside the steps. `#protocol-to-notebook` opens this Product
introduction directly.
Product has eight scroll sections. Protein Builder follows Cloning Design and
shows an ordered chain of protein, tag, linker, and cleavage-site blocks, then
the assembled amino acid sequence and reverse-translated coding DNA. Users can
copy either sequence into Twist Bioscience’s ordering platform for gene synthesis.
Its real UI screenshot shows an illustrative VH–VL–Fc–VHH fusion with three
(GGGGS)3 linkers: a 614-aa construct and matching 1,842-nt coding
DNA using Human codon usage, and both sequence copy controls. Close-up focuses on the assembly and output
panels. `#protein-builder` opens this introduction,
and Try It opens `#trial/protein-builder`. Its trial starts with a fictional 103-aa
protein–GS–TEV–6×His chain. Visitors can add and reorder blocks, enter a custom
protein, choose codon usage, and copy protein or coding DNA. Actions are unlimited within this feature. Drafts and built output
survive reloads in isolated browser storage. The walkthrough includes a visible Next
button on every step and waits for required actions before advancing.
Workflows follows Protocol → Notebook and
explains reusable processes, progress for each run, completion dates, results,
and linked notebook pages. Its 3840 × 2400 screenshot shows three fictional runs
of one protein-production workflow, with Run 02's recorded purification step,
dates, result, and Notebook button. `#workflow-trace` opens this introduction.
Try It opens `#trial/workflows`; the public Trial contains six features.
All four conceptual illustrations sit directly on the dark page, with transparent
canvases and Rosé Pine colors. Codex, AI, and Plugins use open line drawings,
direct labels, and connecting paths; Protocol uses open method/run columns with
underlined editable values. They have no enclosing cards. `illustrations.css` removes window bars, outer
frames, shadows, and action-strip dividers for illustration media; real UI
screenshots retain their existing framing and close-up controls.
The Product plugin introduction uses the Open lattice concept, with shared-edge
hexagons and faint empty cells suggesting room to grow. Its line is “Room for your
next idea.” The transparent vector keeps regular proportions on desktop and
phones. Smaller, stronger labels keep space around each symbol; compact phones
use larger SVG type to preserve readability. The artwork has a bounded size on
large displays. A staggered loop traces cell edges, reads gel bands, draws the
figure connections, and highlights the plus. Labels and the Hikari mark remain
static. All motion pauses outside the active section and is disabled for reduced
motion. The copy describes shaping
Hikari around your work, with access review before enabling a plugin. Explore
Plugins opens the separate Plugins tab with its concrete Figura preview.

The seven Product assets in `shots/` are 3840 × 2400 captures of fictional demo
workspaces. Responsive 1280px and 1920px variants keep the presentation quick to
load. The screenshots include their own macOS title bars. The Protocol → Notebook
introduction retains its interactive illustration; its screenshot asset is also
refreshed for reuse. `shots/overview.jpg` shows the Product capture set.
`shots/plugins.webp` is captured separately from the current Figura plugin in an
isolated host. The website ships only the image; Figura stays out of the Trial runtime.
Product screenshots and the Plugins preview default to focused close-ups of the
primer plan/table, molarity worksheet, workflow runs and step records, sample box/record,
and illustration canvas. `PHOTO_FOCUS` in `index.html` defines the focal points;
`screenshot-focus.css` crops the original captures in the page without changing
or upscaling the source assets. Responsive image sizes account for the closer
view. Screenshots keep their focused crops without a Full window control.
Product's Try It and Explore links sit below the image frame on the page background.
The Trial snapshot includes Hikari's numeric-factor simplification for pending
molarity formulas, so `5000/(100*E1)` displays as `50/E1`. Formula and unit-conversion
regressions are covered by `trial-selfcheck.cjs`.
Agent shows focused screenshots without an added window bar or zoom control. Plot keeps both axes,
legend, export controls, and chat visible; Review keeps Reject and Approve in
frame. Papers opens the fictional preprint’s second page with Methods beside
the answer about its three controls. `shots/agent-overview.jpg` shows the five
Agent captures. All five have 3840 × 2400 originals and 1280/1920px variants.
The Figura preview shows a five-panel receptor-response figure: a lipid membrane
with a ligand/receptor mechanism, internalization, kinase and transcriptional signaling;
three modular receptor constructs; dose-response curves; single-cell distributions;
and a time-response matrix. Its 104 layers include 64 independent text labels and
five editable groups. Measurements and the receptor design are illustrative.
The crop retains every panel and its axis labels. On desktop, the preview receives
three quarters of the showcase row, and its aspect ratio is not capped by the
Product story's viewport-height limit.

To refresh Figura without adding plugin source to the website runtime:

```sh
node website/hikari-is-tools/prepare-figura-capture.mjs
python3 -m http.server 8792 --bind 127.0.0.1 --directory tmp/hikari-is-figura/capture
```

Open `http://127.0.0.1:8792/index.html?feature=plugins&capture=1` at 3840 × 2400,
wait for the complete figure and bundled Inter font, then save a full-page PNG as
`tmp/hikari-is-figura/plugins.png`. The actual Figura plugin renders a 1600 × 1000
logical workspace at 2.4×. The host supplies only an in-memory fictional library;
it has no desktop storage, account, or agent connection. The preparation command
also saves the editable scene as `tmp/hikari-is-figura/receptor-response.figura.json`.
Record the URL, source, logical size, scale, and visible label audit in
`tmp/hikari-is-figura/capture-manifest.json`, then run:

```sh
python3 website/hikari-is-tools/prepare-screenshots.py tmp/hikari-is-figura figura
```

To refresh screenshots, open `trial-app.html?feature=<feature>&capture=1` in the
browser preview at 3840 × 2446, wait for `body[data-trial-ready="true"]`, and save a
full-page JPEG for each feature. Capture mode starts only from fictional fixtures
and uses separate app and usage storage keys. It never reads saved
Trial projects or desktop storage. `screenshot-capture.css` renders a 1280 × 800
logical app at 3× and accounts for widget measurements at that density.
For AI experiments, select the suggested page to show its rationale. For
calculations, collapse Protocol to focus on the worksheet (`capture-scenes.cjs` does this). Its
capture rows divide evenly, so the pending formulas read `40*D2`, `0.025*C2`, and `50000/E4`
instead of 13-digit factors. Samples needs no manual steps: capture fixtures in
`trial-adapter.js` fill 21 wells of the 9 × 9 box (one sample type per row) and the
protein's MW, tag, buffer, and expression host. Saving by hand left a "Save sample"
tooltip in the frame. Protocol Polish captures with an opaque copy of the dialog's
backdrop tone (`screenshot-capture.css`), so the editor behind it does not bleed between
the two cards. Its two cards span the window, so that scene alone captures at Hikari's
17px text size (other scenes keep 14px); both cards still fit without scrolling (18px
overflows). The dialog spans the window's width, so the site shows it as the full window. Keep the capture URL and visible-text audit in
`capture-manifest.json`. Workflows uses the current desktop renderer, generated
HTML, and styles directly in a separate offscreen window. It reads only explicit
fictional fixture records and blocks network requests. The capture command leaves
the frozen Trial snapshot unchanged. Capture it before preparing Product assets:

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  website/hikari-is-tools/capture-workflows.cjs
```

Then run:

```sh
python3 website/hikari-is-tools/prepare-screenshots.py tmp/hikari-is-synthetic-captures
```

To refresh only some Product assets (and the overview), append `product <feature ...>`
to the preparation command. `capture-scenes.cjs calculations` writes `calculations.jpg`;
copy it to `calc.jpg` and its manifest entry to the name `calc` first. Capture `samples`
with `--native`.
On desktops wider than 980px, every feature uses a 4 : 9 copy-to-media split, so captured
app text renders near 11px at a 1440px viewport.

For the Agent screenshots, keep `python3 website/hikari-is-tools/serve.py` running in
another terminal, then run these commands from the repository root:

```sh
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  website/hikari-is-tools/capture-scenes.cjs --native \
  agent-protocols agent-insights agent-papers agent-plot agent-review
python3 website/hikari-is-tools/prepare-screenshots.py tmp/hikari-is-synthetic-captures agent
```

Protocol Polish and the Agent chart can be refreshed from the current Hikari
sources without replacing the other frozen Trial modules:

```sh
node website/hikari-is-tools/refresh-agent-trial.cjs
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
  website/hikari-is-tools/capture-scenes.cjs --native agent-protocols agent-plot
python3 website/hikari-is-tools/prepare-screenshots.py tmp/hikari-is-synthetic-captures agent agent-protocols agent-plot
```

The current captures omit the Protocol Polish helper sentence and the extra
agent-chart caption, matching Hikari. This refresh copies only the two renderers
and the chart stylesheet; fictional fixtures and the other screenshots stay in place.

`capture-scenes.cjs` waits for each scene to be ready and records its URL and
visible-text audit. `--native` renders at 1280 × 800 logical pixels with a 3×
device density, preserving chart and PDF text measurements. The website does not
ship PDF.js or Plotly: for `agent-papers` and `agent-plot` the script copies them
(and the PDF worker) from the repository's `vendor/` and `src/` into `runtime/`,
then removes them after the capture. The preparation step
removes any blank strip below the app and writes the responsive WebP assets,
hash manifest, and overview. `HIKARI_SITE` can override the preview origin, and
`HIKARI_CAPTURES` can override the raw capture directory; pass that directory to
the preparation command too. `agent-scenes.js` owns the fictional records and
prepared replies; `openAgentScene` in `trial-app.js` stages the real UI controls.
After changing its capture setup, bundle with `node website/hikari-is-tools/optimize-trial.cjs`
before recapturing. After replacing an image, update its `SHOT_VERSIONS` entry in
`index.html` to refresh browser caches.

Protein Builder uses the current desktop controller, HTML, and styles with an
illustrative VH–VL–Fc–VHH construct; its sequence fixture does not claim validated
binding or production. `node website/hikari-is-tools/prepare-protein-builder-capture.cjs`
creates an isolated capture folder at `tmp/hikari-is-protein-builder/capture`.
Serve only that folder, open `/?feature=protein-builder&capture=1`, and wait for
`body[data-capture-ready="true"]`. At a 3840 × 2400 viewport, use a full-page
screenshot to retain the complete app window; CSS renders a 1600 × 1000 UI at 2.4×
so every domain in the seven-block chain fits. Record that logical size and scale
in the capture manifest.
Save it as `tmp/hikari-is-protein-builder/protein-builder.jpg` and record the URL,
visible-text audit, and source in `capture-manifest.json` in that same parent folder.
The fixture verifies that the DNA translates to the displayed protein and that
both copy controls are enabled. Refresh its responsive assets with:

```sh
python3 website/hikari-is-tools/prepare-screenshots.py tmp/hikari-is-protein-builder protein
```

Trial embeds Hikari's actual generated HTML, styles, and renderer modules.
`build-trial.cjs` reads these into a temporary build tree, bundles them, then
keeps the bundle's sources in `../hikari-trial-source/` and creates `trial-app.html`;
it does not modify desktop app sources. Run
`node website/hikari-is-tools/build-trial.cjs` from the repository root to refresh the
snapshot after building Hikari's UI. `trial-app.js` opens the appropriate module;
`trial-adapter.js` substitutes browser-only services and fictional records.
The build also runs `optimize-trial.cjs`, using the repository's installed webpack
to bundle the renderer and flatten the imported stylesheets. `trial-runtime.cjs`
selects the notebook, protocols, workflows, samples, sequence viewer, papers, assay, settings,
and shared agent rail used by the public demos and capture scenes. It omits Home,
Toolbox and shared chemical inventory. The current snapshot packages
666 transitive modules and 57 stylesheets into two files, avoiding the sequential
module downloads that left the example preview unresponsive on slower servers.
After editing `trial-app.js`, run `node website/hikari-is-tools/optimize-trial.cjs` to
re-bundle from `../hikari-trial-source/` without refreshing the desktop snapshot.
That frozen copy is the only way to rebuild the current Trial unchanged: the
desktop source has moved on (Sample Registry was merged into Inventory).
To refresh just the Workflow module, its required imports, HTML, and two stylesheets,
run `node website/hikari-is-tools/refresh-workflow-trial.cjs`. This preserves existing
shared sources and the other Trial modules, then rebuilds and prunes the bundle.
Content fingerprints in both pages prevent cached Trial scripts or a cached bundle from hiding an update.
Both build commands prune the snapshot after a successful bundle, then copy only
the files the browser loads into `runtime/`. Webpack supplies the renderer
dependency graph; its sources stay in the snapshot. The resource collector follows
stylesheet URLs; no renderer source file is served. Required license notices remain.
`trial-runtime-manifest.json` records the exact served files and byte total; the
self-check rejects unexpected files and served renderer source.
`runtime/` is 4.3 MiB (32 files), down from 19.3 MiB (965 files): the bundled
source and stylesheet files, the Figura plugin, PDF.js, and Plotly are no longer
published.
Opened workspaces stay mounted while switching tabs or trial features,
so drafts can finish.

Trial presents a day-mode Hikari window on the site's dark canvas, shifted right
beside a wider feature list. The icon rail uses the site's DM Sans type and
small outline icons. The selected row has a quiet background and gold icon,
with no colored side bar. Its description expands directly below the row,
aligned with its label on larger windows. Clicking it again collapses
the description while keeping the trial open. Row widths stay fixed; descriptions
reveal smoothly, with immediate changes when reduced motion is enabled. The list is
centered vertically with the app window. Actions are unlimited within each selected feature.
Links open the corresponding trial without remounting workspaces or losing drafts.
Walkthrough captions avoid covering the list. The dimming mask and arrow are
visual only: clicks pass through to Hikari, so opening a guide does not lock the
app. Only the caption itself receives clicks; Skip guide and Escape dismiss it.
The app's macOS title-bar spacing, decorative traffic lights, rounded corners,
and shadow give it desktop window styling. A compact strip below it contains
Restart trial; return to Product using the header tab. Descriptions appear in the selected feature
on the left, and instructions appear in the walkthrough captions. There is no
inline message below the window.
If startup fails, the preview stays visible and Reload demo retries without clearing saved
edits or usage. The main worksheet action has a readable label.
The molarity worksheet includes a two-known-value Formula example: 100 g/mol
and 5 mg leave Volume and Molarity as simplified `50/E4` and `50/D4` expressions.
Its walkthrough explains cell addresses, then fills Volume to show the remaining
formula becoming a number. Clearing Volume reveals both formulas again. Returning
trials receive the extra row without overwriting existing inputs or units; edits to the formula example persist. Capture fixtures remain unchanged.
The app and its outer window fit the viewport; longer records, results, and sample forms scroll inside their own
panels. On computers, the app renders at the display's logical screen resolution
and scales uniformly into the presentation window, preserving that display's
aspect ratio for the page visit. The preview grows or shrinks to fit the browser's
available width and height after reserving space for the feature list and controls,
without a maximum width or a scale cap. Resizing the browser changes the preview
size without changing the app's desktop resolution. The outer frame clips without becoming a scroll
container, keeping its title bar visible when app controls receive focus.
Public Trial typography adapts to the actual preview size rather than using a
fixed 32px root font. A 14–24px desktop font range compensates for window scaling,
with an additional limit based on the desktop canvas width and height to keep
labels and controls from colliding. Resizing updates already-open trials without
reloading their records. Hikari's rem-based typography and spacing reflow together,
and tables and sequences remeasure after a change. The sidebar also responds to
browser width and height. Guide text, headings, padding, and caption width use
the Hikari window's container dimensions; long instructions retain internal
scrolling and visible navigation. Returning trials use the same adaptive sizes.
Product capture scenes retain their original 14px root font.
Phones and narrow screens show a "Try Hikari on a computer" message without
loading the app frame. The interactive Trial is for desktop computers.
`trial-guide.js` provides numbered walkthroughs for the six public trials.
Calculation guidance follows the committed numeric result rather than relying on
Enter reaching an editor that Tabulator may replace. Protocol guidance gives
method fields and Notes separate targets, so its caption cannot cover Notes
while requesting an observation.
Opening `index.html` directly in Safari uses a same-origin `srcdoc` frame,
so the guide can read the real controls despite Safari isolating separate file
documents. `trial-file-frame.js` is generated from the current `trial-app.html`
by `optimize-trial.cjs` and is loaded only for file previews. Frame messages
accept opaque file origins only from the expected parent or Trial window;
hosted previews retain strict origin checks and the regular app URL.
A dimmed mask leaves the current real app control clickable; a gold arrow and
caption point out the next action. The overlay is mounted inside the Hikari
window, outside the scaled iframe, keeping captions readable at any desktop
preview size. All targets use coordinates relative to that window. Highlights,
captions, arrows, and shadows are clipped to its rounded boundary; captions fit
within an inset margin and scroll their text when needed while keeping the
navigation buttons visible. When the full caption would overlap a target, it
uses the available space beside, above, or below it and scrolls its body.
The mask cutout and
gold outline share the same rounded corners; the outside edge of the mask also
follows the Hikari window's rounding. The guide follows
clicks and validated action events, repositions on resizing and panel scrolling,
and watches the highlighted control, clipping panels, and outer window for late
layout changes. During panel transitions and animations it follows the moving
control each frame, then stops tracking once the layout settles. Font loading and
iframe viewport changes also refresh the anchor. Geometry observers disconnect when
the guide closes or switches features.
Captions fit the window overlay's measured bounds. The guide reveals clipped
controls by scrolling inside the app, and keeps each spotlight
within the visible panel and Hikari window,
and can be skipped with Skip guide or Escape. Next stays visible on every step.
When an app action is required, Next is disabled and a prompt explains that the
highlighted action advances the guide automatically. Workflow result entry and
sample fields enable Next after the required text is entered, so visitors
can explicitly continue without guessing when to leave a field.
Restart trial restores the selected feature's original example data and the first guide step. It recreates that feature's app window to clear
unsaved edits, undo history, selections, dialogs, and scroll positions. Workflow
therefore starts with the same runs and unfinished step every time. Other trials
keep their records and progress; switching tabs still preserves open drafts.
Cloning begins in the actual Sequence Viewer with a fictional 399 bp fragment.
Visitors can click between bases and type DNA to insert, or drag to select bases
and type to replace them or press Delete. The existing Hikari edit dialog confirms
the change. The guide follows the sequence and edit dialog, then points to
Cloning Design, route selection, Design Primers, and the resulting primer pair.
The public trial uses Hikari's own editor and cloning controller, so repeated
edits accumulate against the original sequence and the primers follow the actual
insertion, replacement, or deletion. Back to Sequence returns to the edited DNA.
Editing and navigating are free;
requested primer designs and sequence edits remain unlimited. Capture mode still
opens the worked design directly for the existing screenshot workflow.
Feature descriptions expand in the left-hand list; the guide explains each action.
The website omits the desktop loading splash and opens directly into the app.
`trial-entry.js` shows populated example HTML immediately, before renderer startup;
the live feature replaces it after its record is open. Home remains hidden in Trial.
Bench calculations loads a smaller build of the same renderer entry, with only
Notebook and Protocol modules. It avoids starting sequence tools, papers,
plotting, and the Agent rail. `trial-launch.js` selects this build for public
worksheets; screenshot captures and the other demos keep the full build.
The frame URL supplies the fitted font size before startup, so its first table
layout already matches the website preview. Resizing still updates it live.
`optimize-trial.cjs` rebuilds and fingerprints both, and the self-check verifies
the routing and bundle size.
Examples include a molarity worksheet, a saved protocol
page, a worked cloning design, and a 5 × 5 freezer box with three sample records.
The Samples guide uses W25, then reveals Sample Code and Sample Name separately
below the sticky toolbar before pointing to the actual Add/Save Sample button.
Returning 9 × 9 examples compact saved samples and
well notes into available positions while preserving their edits; densely occupied
saved boxes retain enough wells for their records. Product captures keep 9 × 9.
Workflows starts with three independent protein-production runs: one finished,
one halfway through, and one after its first step. The guide chooses an unfinished
step and points directly to its hollow, unfinished timeline dot. The details panel
starts closed, including on guide restart, so it cannot cover that dot. Clicking
opens the step's editor. Visitors edit a placeholder before entering a result; Next waits
for a changed value and complete method fields. After completion, the guide reopens
the same step and highlights its recorded values inside the run details. Notebook
navigation remains optional. Restarting or reloading chooses the next available
step while retaining previous results. Optional branches remain separate from
the main process until activated.
Returning trials expand the original 5 × 5 example box to 81 positions while
retaining its existing well contents and sample links.
Missing fixtures are also
added to returning workspaces without overwriting edits or clearing their data.

Each public Trial exposes its selected feature with unlimited actions and fictional data:

- Cloning: insert, replace, or delete DNA; compare routes; inspect and copy primers; download an order CSV; save sequences in a browser-local library.
- Protein Builder: arrange blocks, add custom proteins or stored CDS features, choose codon usage, copy sequences, and assemble with an example backbone.
- Calculations: edit the native molarity worksheet, choose units, save, export PDF, and print formulas with the experiment steps.
- Protocols: reuse and edit saved methods; create notebook runs with independent values, sample links, notes, and attachments.
- Workflows: edit templates, start independent runs, complete/reopen steps, activate branches, and save values, results, and attachments with linked notebook pages.
- Samples: manage containers and wells, edit records, copy samples, import/export CSV, and inspect or add links to example experiments without leaving the inventory.

The left captions describe the same actions as the Product introductions. The native router also enforces the selected feature's view boundary, including routes invoked by callbacks. Unrelated desktop tools, settings, and AI controls are hidden. Legacy three-use counters are ignored and never disable actions or switch the guide to read-only mode.

Each feature's app state is separate under `hikari-website-app-v3/<feature>`; the desktop `hikari_state_v1` key is redirected within the trial frame. Browser-only sequence libraries, folders, backbones, and attachments survive desktop autosaves and reloads. Restart trial clears the selected feature's complete snapshot and starts its guide again; other features are preserved. Storage remains local to the browser/origin. Attachments report a clear error if browser storage is full.

No desktop folder, account, filesystem, or live model is connected. Unsupported
native actions return an explicit error, including every plugin action.

Everything the site serves is in `website/hikari-is/`, and nothing else is
there. This README, the build, capture, and check scripts, `social-card.html`,
and the build reports (`trial-build.json`, `trial-runtime-manifest.json`,
`shots-manifest.json`) live in `website/hikari-is-tools/`, so they are never
uploaded. Bare file names elsewhere in this README refer to whichever of the
two folders holds them. The module-based trial
requires HTTP: run `python3 website/hikari-is-tools/serve.py` and open
`http://127.0.0.1:8790`. Run `node website/hikari-is-tools/trial-selfcheck.cjs` for scoped
checks of unlimited actions, feature scope, local sequence/file persistence, data isolation, absence of shipped plugins, capture-only Agent
fixtures, Workflow progress and linked notebook records, and native-action boundaries. Browser verification covers all six
public Trial workflows and the Product, Agent, and Plugins presentations.

## Search visibility and launch

The canonical public address is **https://hikari-lab-agent.com/**. Changes in
this local export affect the public site only after its deployment updates.

- `index.html` includes a descriptive title, description, canonical URL,
  Open Graph and Twitter cards, and JSON-LD.
- Existing Product and Agent feature-copy panels are pre-rendered in HTML.
  The animated tour selects the active panel as before; no visible sections are added.
  Run `node website/hikari-is/tools/build-search-content.cjs`, then
  `node website/hikari-is/tools/search-content-selfcheck.cjs` after editing the claims.
  Metadata lists only features described by the existing Product tour.
- `social-card.jpg` is the 1200 × 630 sharing image. Its editable HTML source is
  `social-card.html` in the tools folder; capture that page at exactly
  1200 × 630 and save the result as `website/hikari-is/social-card.jpg`.
- `robots.txt` allows crawling and points to `sitemap.xml`. The sitemap lists
  only the homepage; hash links are sections, not separate
  indexable pages. Add future substantive pages to the sitemap.
- The standalone Trial shell and synthetic paper HTML use `noindex`.
  `optimize-trial.cjs` preserves the shell tag on rebuild and regenerates its
  file-preview fallback. `_headers` also applies `X-Robots-Tag: noindex` to
  support files, including synthetic PDFs, when hosted on Cloudflare Pages.
  It does not block crawlers from fetching scripts, styles, or images.
- `404.html` gives Cloudflare Pages a real missing-page response instead of
  falling back to the homepage for every unknown URL.

Upload the **contents of `website/hikari-is/` at the domain root**, including
`runtime/`, `shots/`, the sharing image, `robots.txt`, `sitemap.xml`, `_headers`,
and `404.html`. The site is already static; serving it does not require a Node
server. The `_headers` file is interpreted by Cloudflare Pages, not by the local
Python preview server. If using a different host, configure equivalent HTTP
headers and a real 404 response there.

After deployment:

1. Check that `/`, `/robots.txt`, `/sitemap.xml`, and the sharing
   image return successfully on HTTPS, and an unknown path returns HTTP 404.
2. Verify the domain in [Google Search Console](https://search.google.com/search-console/).
   Submit `https://hikari-lab-agent.com/sitemap.xml`, inspect the homepage URL,
   and request indexing.
3. Check Search Console's indexing report after Google has crawled the site.
   If alternate hosts such as `www` or `pages.dev` serve the same production
   content, redirect them to the canonical domain.

JSON-LD describes the real software and its free core offering. It deliberately
contains no invented ratings or reviews, so it does not claim eligibility for
Google's rated-software rich result. Search visibility and rankings still depend
on deployment, crawling, and Google's indexing decisions.

References: [Google's JavaScript SEO guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics),
[sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap),
[Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/),
and [Cloudflare Pages routing and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).
