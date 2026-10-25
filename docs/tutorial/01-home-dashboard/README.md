# Chapter 01 · Home dashboard

Open [index.html](index.html) in a browser for the illustrated reading view, or edit [home-dashboard.md](home-dashboard.md). The browser version works offline, has a chapter navigation, and lets you click screenshots to enlarge them. Use your browser's Print command if you want to print the chapter.

## Files

| File or folder | Purpose |
| --- | --- |
| `home-dashboard.md` | Authoritative tutorial text; edit this first. |
| `index.html` | Generated offline reading view of the same text. |
| `tutorial.css` | Reading, enlargement, mobile, and print styles. |
| `images/*.png` | Annotated screenshots used by the tutorial. |
| `images/*.svg` | Editable highlights, numbered callouts, and arrows; each embeds its original screenshot. |
| `images/raw/` | Original screenshots before adding annotations. |
| `capture-manifest.json` | Screenshot targets, source version, crop coordinates, and interaction checks. |
| `tools/dashboard-fixture.mjs` | Fictional example records and isolated desktop/AI adapters. |
| `tools/capture.cjs` | Reproducible screenshot capture and annotation renderer. |
| `tools/build.cjs` | Builds and checks the reading view from Markdown. |

## Capture scope

Prepared on **24 October 2026**, against the local **1.1.0-beta.9 source renderer**. This does not assert that an installed or released build has the same interface. Screenshots use a 1600 × 1000 CSS-pixel viewport, day appearance, and a fixed example date in America/Chicago. Smaller windows can change the layout and the modules visible in the dock.

The preview loads the current Home HTML, CSS, widget controllers, navigation renderer, and notebook review interface from this repository. All projects, observations, cell labels, timers, and citations are fictional. The AI response is a fixed illustrative proposal; the paper is a fictional citation. Neither represents a live model response or a real publication.

The capture process uses a temporary Electron profile and local preview state. It never selects a personal storage root. Persistence adapters are local preview adapters; interaction checks confirm renderer behavior, not native file durability, live AI quality, background schedule execution, PDF availability, or operating-system notifications. Remote resource requests are blocked during capture.

## Refresh the chapter

From the repository root, with the project's Electron dependency installed:

```sh
node docs/tutorial/01-home-dashboard/tools/capture.cjs
node docs/tutorial/01-home-dashboard/tools/build.cjs
```

The build tool uses `marked`. If that package is provided by a separate runtime, set `NODE_PATH` to its `node_modules` directory before running the build command. No dependency installation is performed by these scripts.

After capture, inspect every annotated PNG. Check that each arrow points to the intended visible control, that text remains readable, and that all instructions match the latest source behavior. The SVG sources retain editable annotation geometry. Generated reading-view links and image references are checked by `build.cjs`.

The screenshot script is a documentation tool, not part of Hikari startup or the application test suite. It writes only this chapter's generated images and manifest, plus its disposable temporary profile. It leaves the temporary profile in the system temporary directory for normal OS cleanup.
