# UI Design Specification

## Principles

The application should follow a neutral, compact desktop-style interface.
The overall feeling should be lightweight, efficient, and visually quiet.
Avoid a dashboard made of large cards or boxed modules.
Instead, use spacing, typography, alignment, and subtle dividers to create structure.
The interface should feel like a continuous workspace rather than a collection of separate panels.

## Layout Structure

The UI should be organized into a small number of stable layout regions:

- **Top toolbar**: global actions such as search, create, import, settings, and project context.
- **Main workspace**: the central working area where the active sub-app is displayed.
- **Optional side panel**: contextual inspector, metadata, details, or quick actions.
- **Bottom dock**: sub-app switching area with icon-based navigation.

Do not place every section inside a visible box.
Use section headers, spacing, and divider lines instead of card containers.

## Navigation

Sub-app navigation should be placed at the bottom of the window.
Each sub-app is represented by a simple SVG icon.
When the user hovers over an icon, show the app name as a tooltip.

The currently active sub-app must be visually clear without requiring hover.
Possible active-state indicators include:

- filled icon
- underline
- soft background highlight
- small active marker

Keep the dock compact and easy to scan.
Try to keep the number of main sub-app icons limited so the navigation remains clear.

## Icon System

Store all SVG assets in a dedicated folder.
Recommended structure:

```text
assets/icons/
```

Use a JSON file to define which icon belongs to which sub-app.
This allows the icon system to stay maintainable and makes it easy to expand later.

Example:

```json
{
  "apps": [
    {
      "id": "dashboard",
      "label": "Dashboard",
      "icon": "dashboard.svg",
      "route": "/dashboard"
    },
    {
      "id": "sequence",
      "label": "Sequence Viewer",
      "icon": "sequence.svg",
      "route": "/sequence"
    },
    {
      "id": "workflow",
      "label": "Workflow",
      "icon": "workflow.svg",
      "route": "/workflow"
    }
  ]
}
```

Each icon entry should include at least:

- app id
- display label
- svg file name
- route or view target

## Buttons

Buttons should be visually minimal.
Do not use heavy outlines or visible boxed borders in the default state.
A quiet default appearance is preferred.

Buttons should communicate interactivity through:

- hover background change
- pressed state
- cursor change
- visible keyboard focus state

The design goal is:

**quiet by default, clear on interaction**

Do not make controls feel hidden.
Even minimal buttons should still feel clickable.

## Visual Style

The interface should remain neutral and restrained.
Use compact spacing, small corner radius, light separators, and minimal shadows.
Visual hierarchy should come from:

- typography
- spacing
- alignment
- contrast

Avoid relying on cards, heavy borders, or decorative containers.

## Interaction Rules

Hover feedback should be subtle but noticeable.
Tooltips should be short and informative.
Use tooltips mainly for icon-only controls.
Do not depend on tooltips to communicate critical navigation structure.

Focus states must remain visible for accessibility and keyboard navigation.
Interaction patterns should be consistent across the app.

## Do / Don't

### Do

- use a flat workspace layout
- use subtle dividers instead of card boxes
- keep buttons visually lightweight
- use a bottom dock for sub-app switching
- store icons in a dedicated svg folder
- map icons and labels in a json config
- make the active app state clearly visible

### Don't

- do not design the whole UI as stacked cards
- do not add unnecessary border boxes around every section
- do not rely on hover alone to explain navigation
- do not make buttons invisible or ambiguous
- do not mix multiple different icon behaviors

## Suggestions for This App

1. Use a compact top toolbar for universal actions.
2. Keep the center area as the main uninterrupted workspace.
3. Use a right-side inspector when detailed properties or metadata are needed.
4. Use the bottom dock as the main sub-app switcher.
5. Keep icon behavior, tooltip behavior, and active-state behavior fully consistent.
6. Prefer section titles and separators over cards.

## Summary

The app should feel like a focused desktop tool rather than a web dashboard.
The UI should be compact, neutral, and structured without relying on card-based layouts.
Icons, buttons, and navigation should stay minimal, but interaction feedback must remain clear and consistent.