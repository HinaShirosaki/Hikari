/* AUTO-GENERATED FILE. DO NOT EDIT DIRECTLY. */
/* Source config: ui/config/app-registry.json */

export const APP_REGISTRY = [
  {
    "id": "home",
    "viewKey": "HOME",
    "label": "Home",
    "viewId": "home-view",
    "subtitle": "Bench overview, contribution activity, reminders, and lab timers.",
    "icon": "home.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" />\n  <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "dashboard",
      "overview"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "protocols",
    "viewKey": "PROTOCOL_MANAGEMENT",
    "label": "Protocols",
    "viewId": "protocol-management-view",
    "subtitle": "Protocol library for drafting, editing, and reuse.",
    "icon": "protocols.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <rect width=\"8\" height=\"4\" x=\"8\" y=\"2\" rx=\"1\" ry=\"1\" />\n  <path d=\"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2\" />\n  <path d=\"M12 11h4\" />\n  <path d=\"M12 16h4\" />\n  <path d=\"M8 11h.01\" />\n  <path d=\"M8 16h.01\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "protocol",
      "procedure"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "biology-notebook",
    "viewKey": "BIOLOGY_NOTEBOOK",
    "label": "Notebook",
    "viewId": "biology-notebook-view",
    "subtitle": "Biology notebook entries and wet-lab context.",
    "icon": "biology-notebook.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4\" />\n  <path d=\"M2 6h4\" />\n  <path d=\"M2 10h4\" />\n  <path d=\"M2 14h4\" />\n  <path d=\"M2 18h4\" />\n  <path d=\"M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "biology",
      "bio notebook",
      "wet lab",
      "project",
      "projects"
    ],
    "searchInputId": "",
    "agentChatRail": true,
    "hiddenFromNavigation": false
  },
  {
    "id": "chemicals",
    "viewKey": "LAB_COMMON_INVENTORY",
    "label": "Chemicals",
    "viewId": "lab-common-inventory-view",
    "subtitle": "Chemical inventory, locations, and stock records.",
    "icon": "chemicals.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2\" />\n  <path d=\"M6.453 15h11.094\" />\n  <path d=\"M8.5 2h7\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "chemical",
      "reagents",
      "inventory chemicals"
    ],
    "searchInputId": "chemical-search",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "sample-inventory",
    "viewKey": "SAMPLE_REGISTRY",
    "label": "Samples",
    "viewId": "sample-registry-view",
    "subtitle": "Record and manage samples directly inside storage containers.",
    "icon": "sample-inventory.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M9 2v17.5A2.5 2.5 0 0 1 6.5 22A2.5 2.5 0 0 1 4 19.5V2\" />\n  <path d=\"M20 2v17.5a2.5 2.5 0 0 1-2.5 2.5a2.5 2.5 0 0 1-2.5-2.5V2\" />\n  <path d=\"M3 2h7\" />\n  <path d=\"M14 2h7\" />\n  <path d=\"M9 16H4\" />\n  <path d=\"M20 16h-5\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "sample",
      "samples",
      "inventory",
      "sample inventory",
      "sampleinventory"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "assay",
    "viewKey": "ASSAY",
    "label": "Plate",
    "viewId": "assay-view",
    "subtitle": "Plate setup, pasted results, and assay analysis.",
    "icon": "assay.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M3 9h18\" />\n  <path d=\"M3 15h18\" />\n  <path d=\"M9 3v18\" />\n  <path d=\"M15 3v18\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "assays",
      "plate"
    ],
    "searchInputId": "",
    "agentChatRail": true,
    "hiddenFromNavigation": false
  },
  {
    "id": "workflows",
    "viewKey": "WORKFLOW_MANAGEMENT",
    "label": "Workflows",
    "viewId": "workflow-management-view",
    "subtitle": "Workflow templates, reusable blocks, and next-step planning.",
    "icon": "workflows.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <rect width=\"8\" height=\"8\" x=\"3\" y=\"3\" rx=\"2\" />\n  <path d=\"M7 11v4a2 2 0 0 0 2 2h4\" />\n  <rect width=\"8\" height=\"8\" x=\"13\" y=\"13\" rx=\"2\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "workflow"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "papers",
    "viewKey": "PAPERS",
    "label": "Papers",
    "viewId": "papers-view",
    "subtitle": "Paper library, linked projects, comments, and summaries.",
    "icon": "papers.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8\" />\n  <path d=\"M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z\" />\n  <path d=\"M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "paper",
      "literature",
      "journal"
    ],
    "searchInputId": "",
    "agentChatRail": true,
    "hiddenFromNavigation": false
  },
  {
    "id": "agent",
    "viewKey": "AGENT",
    "label": "Agent",
    "viewId": "agent-view",
    "subtitle": "Assistant sessions with project context and evidence-grounded responses.",
    "icon": "agent.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z\" />\n  <path d=\"M20 2v4\" />\n  <path d=\"M22 4h-4\" />\n  <circle cx=\"4\" cy=\"20\" r=\"2\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "assistant",
      "chat",
      "lab assistant"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "sequence-viewer",
    "viewKey": "SEQUENCE_VIEWER",
    "label": "DNA",
    "viewId": "sequence-viewer-view",
    "subtitle": "Sequence records, annotations, overlays, and detail views.",
    "icon": "sequence-viewer.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"m10 16 1.5 1.5\" />\n  <path d=\"m14 8-1.5-1.5\" />\n  <path d=\"M15 2c-1.798 1.998-2.518 3.995-2.807 5.993\" />\n  <path d=\"m16.5 10.5 1 1\" />\n  <path d=\"m17 6-2.891-2.891\" />\n  <path d=\"M2 15c6.667-6 13.333 0 20-6\" />\n  <path d=\"m20 9 .891.891\" />\n  <path d=\"M3.109 14.109 4 15\" />\n  <path d=\"m6.5 12.5 1 1\" />\n  <path d=\"m7 18 2.891 2.891\" />\n  <path d=\"M9 22c1.798-1.998 2.518-3.995 2.807-5.993\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "sequence",
      "seqviewer",
      "sequence viewer",
      "dna"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "tools",
    "viewKey": "TOOL_BOX",
    "label": "Tools",
    "viewId": "tool-box-view",
    "subtitle": "Bench calculators, sequence utilities, and quick analysis tools.",
    "icon": "tools.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "tool",
      "toolbox",
      "calculator"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  },
  {
    "id": "settings",
    "viewKey": "SETTING",
    "label": "Settings",
    "viewId": "setting-view",
    "subtitle": "Workspace appearance, startup, storage, and model settings.",
    "icon": "settings.svg",
    "iconMarkup": "<!-- Lucide v1.17.0 (ISC); see LUCIDE-LICENSE.txt. -->\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\">\n  <path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" />\n  <circle cx=\"12\" cy=\"12\" r=\"3\" />\n</svg>",
    "placement": "dock",
    "aliases": [
      "setting",
      "preferences"
    ],
    "searchInputId": "",
    "agentChatRail": false,
    "hiddenFromNavigation": false
  }
];

export const APP_DOCK_ORDER = [
  "home",
  "protocols",
  "biology-notebook",
  "papers",
  "sample-inventory",
  "chemicals",
  "workflows",
  "agent",
  "sequence-viewer",
  "assay",
  "tools",
  "settings"
];
