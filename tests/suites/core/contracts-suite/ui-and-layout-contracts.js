module.exports = function registerUiAndLayoutContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), 'utf8');
    const readMainProcessSource = () => [
      readLocalSource('src', 'main', 'main.js'),
      readLocalSource('src', 'main', 'app', 'start-main-app.js'),
      readLocalSource('src', 'main', 'core', 'main-services.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-mcp-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-codex-service.js'),
      readLocalSource('src', 'main', 'core', 'services', 'create-agent-services.js'),
      readLocalSource('src', 'main', 'ipc', 'register-data-ipc.js'),
      readLocalSource('src', 'main', 'ipc', 'register-agent-ipc', 'index.js'),
      readLocalSource('src', 'main', 'ipc', 'register-system-ipc.js')
    ].join('\n');
    const readPreloadSource = () => [
      readLocalSource('src', 'main', 'preload.js'),
      readLocalSource('src', 'main', 'preload', 'create-preload-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'agent-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'llm-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'sequence-library-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'storage-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'system-api.js'),
      readLocalSource('src', 'main', 'preload', 'api', 'telegram-api.js')
    ].join('\n');
    const readRendererShellSource = () => [
      readLocalSource('src', 'renderer', 'renderer.js'),
      readLocalSource('src', 'renderer', 'core', 'start-hikari-core.js'),
      readLocalSource('src', 'renderer', 'app', 'navigation-shell.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-open-handlers.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-search.js')
    ].join('\n');
    const readRendererModuleRuntimeSource = () => [
      readLocalSource('src', 'renderer', 'core', 'module-runtime.js'),
      ...fs.readdirSync(path.join(__dirname, 'src', 'renderer', 'module-manifests'))
        .filter((fileName) => fileName.endsWith('.js'))
        .sort()
        .map((fileName) => readLocalSource('src', 'renderer', 'module-manifests', fileName))
    ].join('\n');

    test('view constants, index sections, and app registry stay in sync', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const viewValues = Object.values(shared.VIEWS);
      const sectionViews = new Set([...html.matchAll(/<section id=\"([^\"]+)\" class=\"view\"/g)].map((match) => match[1]));
      const navViews = new Set((registry.apps || []).map((app) => app.viewId));

      const nonHomeViews = viewValues.filter((value) => value !== shared.VIEWS.HOME);
      const navRequiredViews = nonHomeViews.filter((value) => value !== shared.VIEWS.PERSONAL_INVENTORY);
      const missingSections = nonHomeViews.filter((value) => !sectionViews.has(value));
      const missingNav = navRequiredViews.filter((value) => !navViews.has(value));
      const unknownNav = [...navViews].filter((value) => !viewValues.includes(value));

      assert.deepEqual(missingSections, []);
      assert.deepEqual(missingNav, []);
      assert.deepEqual(unknownNav, []);
      assert.match(html, /id="app-dock-nav"/);
      assert.match(html, /id="app-more-menu"/);
    });

    test('sample and inventory use a merged navigation entry', () => {
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
      assert.ok(sampleEntry);
      assert.equal(sampleEntry.viewId, 'sample-registry-view');
      assert.equal(sampleEntry.label, 'Samples');
      assert.equal(sampleEntry.placement, 'dock');
      assert.equal(registry.apps.some((app) => app.viewId === 'personal-inventory-view'), false);
    });

    test('folder rows share one glyph, including the Sequence Viewer library', () => {
      const sharedCss = readLocalSource('ui', 'css', 'overrides', 'universal-left-rail-lists.css');
      const agentCss = readLocalSource('ui', 'css', 'views', 'agent-view.css');
      const papersCss = readLocalSource('ui', 'css', 'views', 'papers-view.css');
      const notebookCss = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');
      const agentSource = readLocalSource('src', 'renderer', 'modules', 'agent-chat', 'session-manager.js');
      const papersSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'library.js');
      const notebookSource = readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'entry', 'entry-list-renderer.js');
      const sequenceSource = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'home-controller.js');

      assert.match(sharedCss, /\.left-rail-template__rail \.left-rail-folder-glyph\s*\{[\s\S]*-webkit-mask:\s*url\("\.\.\/\.\.\/\.\.\/assets\/icons\/folder-2-svgrepo-com\.svg"\)/);
      assert.match(agentSource, /class="left-rail-folder-glyph agent-session-folder-glyph"/);
      assert.match(papersSource, /class="left-rail-folder-glyph papers-folder-glyph"/);
      assert.match(notebookSource, /class="left-rail-folder-glyph biology-notebook-folder-glyph"/);
      assert.match(sequenceSource, /class="left-rail-folder-glyph sequence-viewer-library-folder-glyph"/);
      assert.doesNotMatch(agentCss, /\.agent-session-folder-glyph\s*\{/);
      assert.doesNotMatch(papersCss, /\.papers-folder-glyph\s*\{/);
      assert.doesNotMatch(notebookCss, /\.biology-notebook-folder-glyph\s*\{/);
    });

    // The shared left-rail template gives every view the same three-part rail:
    // a pinned action block sitting above exactly one scroller. That document
    // order is the real contract — the per-view CSS that positions it is just
    // the template's own variables and doesn't need re-asserting here.
    test('every left rail pins its actions above a single scroller', () => {
      const rails = [
        { file: 'agent-view.html', rail: 'agent-session-rail', scroll: 'agent-session-list' },
        { file: 'biology-notebook-view.html', rail: 'biology-notebook-rail', scroll: 'biology-notebook-page-list' },
        { file: 'personal-inventory-view.html', rail: 'inventory-rail-panel', scroll: 'inventory-rail-scroll', action: 'id="inventory-add-container-btn"' },
        { file: 'protocol-management-view.html', rail: 'protocol-list-panel', scroll: 'protocol-list-scroll', after: 'id="protocol-list"' },
        { file: 'papers-view.html', rail: 'papers-library-rail', scroll: 'papers-library-scroll', action: 'id="paper-upload-trigger"' },
        { file: 'workflow-management-view.html', rail: 'workflow-editor-sidebar', scroll: 'workflow-editor-sidebar-scroll', action: 'id="workflow-entry-view-btn"' },
        { file: 'sequence-viewer-view.html', rail: 'sequence-viewer-home-sidebar', scroll: 'sequence-viewer-home-sidebar-scroll', action: 'id="sequence-viewer-home-paste-btn"' },
        { file: 'sequence-viewer-detail-view.html', rail: 'sequence-viewer-detail-sidebar', scroll: 'sequence-viewer-detail-sidebar-scroll', action: 'id="sequence-viewer-detail-new-btn"' },
        { file: 'assay-view.html', rail: 'assay-create-sidebar', scroll: 'assay-create-sidebar-scroll' }
      ];

      const orderOf = (html, label, tokens) => {
        let from = 0;
        for (const token of tokens) {
          const at = html.indexOf(token, from);
          assert.ok(at >= 0, `${label}: "${token}" missing or out of order`);
          from = at + token.length;
        }
      };

      for (const { file, rail, scroll, action, after } of rails) {
        const html = readLocalSource('ui', 'html', 'views', file);
        const tokens = [
          `${rail} app-left-rail left-rail-template__rail left-rail-template__rail--pinned`,
          'left-rail-template__pinned',
          ...(action ? [action] : []),
          `${scroll} left-rail-template__scroll`,
          ...(after ? [after] : [])
        ];
        orderOf(html, file, tokens);
      }
    });

    test('biology notebook page header stays fixed above its detail scroller', () => {
      const html = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');
      const viewerRule = /\.biology-notebook-viewer\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s;
      const scrollRule = /\.biology-notebook-viewer-scroll\s*\{[^}]*display:\s*grid;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;/s;

      assert.match(html, /class="biology-notebook-viewer-head"[\s\S]*?<\/div>\s*<div class="biology-notebook-viewer-scroll">[\s\S]*?<details class="biology-notebook-viewer-section"/);
      assert.match(css, viewerRule);
      assert.match(css, scrollRule);
    });

    test('Samples and Inventory omits redundant container and section-count copy', () => {
      const html = readLocalSource('ui', 'html', 'views', 'personal-inventory-view.html');
      const containerForm = readLocalSource('src', 'renderer', 'modules', 'personal-inventory', 'container-form.js');
      const sectionNavigation = readLocalSource('src', 'renderer', 'modules', 'personal-inventory', 'section-navigation.js');

      assert.match(html, /id="inventory-add-container-note"[^>]*hidden><\/p>/);
      assert.doesNotMatch(html, /Create a storage box, plate, tube, or custom grid\./);
      // The note is contextual: it only has copy when a parent folder is targeted,
      // and it stays hidden the rest of the time.
      assert.match(containerForm, /const note = target\?\.folder[\s\S]*?:\s*'';/);
      assert.match(containerForm, /addContainerNote\.hidden\s*=\s*!note;/);
      assert.doesNotMatch(containerForm, /Create a storage box, plate, tube, or custom grid\./);
      assert.doesNotMatch(sectionNavigation, /container\(s\) and .*linked sample\(s\)/);
    });

    test('biology notebook New Experiment dialog owns project and protocol selection', () => {
      const html = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      assert.match(html, /id="biology-notebook-new-experiment-btn"[\s\S]*New Experiment/);
      assert.match(html, /id="biology-notebook-experiment-dialog-overlay"[\s\S]*id="biology-notebook-project-select"[\s\S]*Search &amp; Select Protocol[\s\S]*id="biology-notebook-protocol-search"[\s\S]*id="biology-notebook-protocol-search-results"[\s\S]*id="biology-notebook-protocol-select" hidden aria-hidden="true" tabindex="-1"[\s\S]*id="biology-notebook-experiment-start-btn"/);
    });

    test('protocol rail pins its actions above the sole scrolling protocol list', () => {
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');
      const railRule = /\.left-rail-template\.protocol-workspace\s*>\s*\.protocol-list-panel\.left-rail-template__rail--pinned\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\);[^}]*gap:\s*0;[^}]*padding:\s*0 !important;[^}]*overflow:\s*hidden !important;[^}]*scrollbar-gutter:\s*auto !important;[^}]*\}/s;
      const pinnedRule = /\.left-rail-template\.protocol-workspace\s*>\s*\.protocol-list-panel\s*>\s*\.protocol-list-pinned\.left-rail-template__pinned\s*\{[^}]*padding:\s*14px\s+calc\(var\(--app-left-rail-padding-inline,\s*16px\)\s*\+\s*var\(--theme-scrollbar-size,\s*8px\)\)\s+12px\s+var\(--app-left-rail-padding-inline,\s*16px\);[^}]*border-bottom:\s*1px\s+solid\s+var\(--app-left-rail-divider\);[^}]*\}/s;
      const listRule = /\.left-rail-template\.protocol-workspace\s*>\s*\.protocol-list-panel\s*>\s*\.protocol-list-scroll\.left-rail-template__scroll\s*\{[^}]*padding:\s*8px\s+var\(--app-left-rail-padding-inline,\s*16px\);[^}]*scrollbar-gutter:\s*stable;[^}]*\}/s;

      assert.match(html, /class="protocol-list-panel[^"]*left-rail-template__rail--pinned[^"]*"[\s\S]*class="protocol-list-pinned left-rail-template__pinned"[\s\S]*class="protocol-list-scroll left-rail-template__scroll"[\s\S]*id="protocol-list"/);
      assert.match(css, railRule);
      assert.match(css, pinnedRule);
      assert.match(css, listRule);
    });

    test('protocol rail uses one borderless icon menu for its four sort combinations', () => {
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');

      assert.match(html, /id="protocol-sort-menu-btn"[^>]*aria-label="Sort protocols"[\s\S]*<svg[\s\S]*id="protocol-sort-menu"[\s\S]*data-protocol-sort="time:asc"[\s\S]*data-protocol-sort="time:desc"[\s\S]*data-protocol-sort="name:asc"[\s\S]*data-protocol-sort="name:desc"/);
      assert.doesNotMatch(html, /id="protocol-sort-(?:field|order)-btn"/);
      assert.match(css, /\.protocol-sort-menu-btn\.ghost-btn\s*\{[^}]*border:\s*0;/s);
    });

    test('protocol placeholder presets keep the selected bar visibly active', () => {
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const controller = readLocalSource('src', 'renderer', 'modules', 'protocol', 'index.js');

      assert.match(html, /data-protocol-placeholder-preset="plasmid" aria-pressed="false"/);
      assert.match(css, /\.protocol-placeholder-preset\.is-active,[\s\S]*\.protocol-placeholder-preset\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--theme-accent\);/);
      assert.match(controller, /function setActivePlaceholderPreset\(placeholderName = ''\)[\s\S]*classList\.toggle\('is-active', isActive\)[\s\S]*setAttribute\('aria-pressed', String\(isActive\)\)/);
    });

    test('Protocols does not expose the retired share function', () => {
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const list = readLocalSource('src', 'renderer', 'modules', 'protocol', 'list.js');
      const controller = readLocalSource('src', 'renderer', 'modules', 'protocol', 'index.js');
      const manifest = readLocalSource('src', 'renderer', 'module-manifests', 'protocol.js');
      const sharingModulePath = path.join(__dirname, 'src', 'renderer', 'modules', 'protocol', 'sharing.js');

      assert.doesNotMatch(html, /protocol-share|Portable Share Link/);
      assert.doesNotMatch(css, /protocol-(?:share|list-row-share-open)/);
      assert.doesNotMatch(list, /data-protocol-(?:share|copy-link)|data-protocol-action="share"|activeShare/);
      assert.doesNotMatch(controller, /createProtocolSharingController|renderShareTargets|sharingController|DEFAULT_SHARE_STATUS/);
      assert.doesNotMatch(manifest, /renderShareTargets/);
      assert.equal(fs.existsSync(sharingModulePath), false);
    });

    test('sequence viewer cloning design toolbar splits back and run actions', () => {
      const sequenceDetailHtml = readLocalSource('ui', 'html', 'views', 'sequence-viewer-detail-view.html');

      assert.match(sequenceDetailHtml, /class="sequence-viewer-cloning-design-toolbar"[\s\S]*class="sequence-viewer-cloning-design-toolbar-nav"[\s\S]*id="sequence-viewer-cloning-design-back-btn"[\s\S]*class="sequence-viewer-cloning-design-toolbar-main"[\s\S]*id="sequence-viewer-cloning-design-run-btn"/);
    });

    test('Workflow keeps the Add Blocks composer in the left rail for edit modes', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'workflow-management-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'workflow', 'dom.js');
      const renderer = readLocalSource('src', 'renderer', 'modules', 'workflow', 'renderer.js');
      const mainMarkup = html.slice(html.indexOf('<div class="workflow-editor-main'));

      assert.match(html, /class="workflow-editor-sidebar-scroll left-rail-template__scroll"[\s\S]*class="workflow-block-composer-panel app-left-rail-section"[\s\S]*<h3>Add Blocks<\/h3>[\s\S]*id="workflow-block-add-btn"/);
      assert.doesNotMatch(mainMarkup, /<h3>Add Blocks<\/h3>/);
      assert.match(css, /\.workflow-block-composer-panel\s+\.workflow-block-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
      assert.match(dom, /workflowBlockComposerPanels:/);
      assert.match(renderer, /workflowBlockComposerPanels\s*\|\|\s*\[\]\)\.forEach\(\(panel\)\s*=>\s*\{[^}]*panel\.hidden\s*=\s*!showMainEditor;/s);
    });

    test('Workflow editor modes retain a pinned Back to Home rail action', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');
      const renderer = readLocalSource('src', 'renderer', 'modules', 'workflow', 'renderer.js');

      assert.match(html, /id="workflow-entry-back-btn"[^>]*>&larr; Back to Home<\/button>/);
      assert.match(renderer, /workflowEntryPanel\.hidden\s*=\s*false;/);
      assert.match(renderer, /workflowEntryViewBtn\.hidden\s*=\s*!showHome;/);
      assert.match(renderer, /workflowEntryTemplateBtn\.hidden\s*=\s*!showHome;/);
      assert.match(renderer, /workflowEntryBackBtn\.hidden\s*=\s*showHome;/);
    });

    test('Workflow graph editor omits redundant interaction instructions', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');

      assert.match(html, /<h3>Graph Editor<\/h3>[\s\S]*id="workflow-graph-canvas"/);
      assert.doesNotMatch(html, /Drag blocks to arrange\. Hover the top-left corner of a block to delete it\./);
    });

    test('Workflow graph selection omits redundant group-drag status copy', () => {
      const graphController = readLocalSource('src', 'renderer', 'modules', 'workflow', 'graph-controller.js');

      assert.doesNotMatch(graphController, /block\(s\) selected\. Drag any selected block to move the group\./);
      assert.match(graphController, /Tip: Drag blocks\. Output dot -> input dot to connect\./);
    });

    test('Workflow execution omits redundant template and workflow-count copy', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');
      const dom = readLocalSource('src', 'renderer', 'modules', 'workflow', 'dom.js');
      const renderer = readLocalSource('src', 'renderer', 'modules', 'workflow', 'renderer.js');

      assert.doesNotMatch(html, /Template Workflows|workflow-execution-status/);
      assert.doesNotMatch(dom, /workflowExecutionStatus/);
      assert.doesNotMatch(renderer, /specific workflow.*created from this template/);
      assert.match(renderer, /Use Add Workflow to create one\./);
    });

    test('Protein Builder uses the active DNA source instead of manual POI fields', () => {
      const html = readLocalSource('ui', 'html', 'views', 'sequence-viewer-view.html');
      const dom = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'dom.js');
      const context = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'controller-context.js');
      const source = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'record-dna.js');

      assert.match(html, /active DNA coding sequence/i);
      assert.match(html, /CurrentDNA/);
      assert.doesNotMatch(html, /protein-builder-poi-(?:name|sequence)|protein-builder-add-poi-btn|POI Name|Add POI Block/);
      assert.doesNotMatch(dom, /proteinBuilderPoi(?:Name|Sequence)Input|proteinBuilderAddPoiBtn/);
      assert.match(context, /activeDnaSource:\s*ctx\.getCurrentDnaSource\(\)/);
      assert.match(source, /export function resolvePoiSourceFromRecord\(record, selectedFeature = null\)/);
      assert.match(source, /reusedSource: `Reused active DNA from \$\{sourceDescription\}\.`/);
    });

    test('Assay result actions use accessible compact icons', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');

      assert.match(html, /id="assay-attach-result-file-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Attach result file"[\s\S]*?<svg/);
      assert.match(html, /id="assay-save-results-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Save results"[\s\S]*?<svg/);
      assert.match(html, /id="assay-clear-results-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Clear results"[\s\S]*?<svg/);
      assert.doesNotMatch(html, /id="assay-(?:attach-result-file|save-results|clear-results)-btn"[^>]*>\s*(?:Attach Result File|Save Results|Clear Results)\s*<\//);
      assert.match(css, /\.assay-results-actions\s*>\s*\.assay-results-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
    });

    test('Assay Analyze uses the same searchable Existing Assays browser as Setup', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const browserView = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'browser-view.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');

      assert.match(html, /class="assay-results-browser-scroll left-rail-template__scroll"[\s\S]*?id="assay-results-browser-panel"[^>]*assay-browser-panel[^>]*open[\s\S]*?Existing Assays[\s\S]*?id="assay-results-search"[\s\S]*?id="assay-results-list"[^>]*assay-browser-list[\s\S]*?class="assay-results-controls-pinned left-rail-template__pinned"[\s\S]*?id="assay-chart-style-panel"/);
      assert.match(html, /id="assay-results-assay-select" hidden/);
      assert.match(css, /\.assay-results-controls-panel\.left-rail-template__rail--pinned\s*\{[^}]*grid-template-rows:\s*minmax\(148px,\s*1fr\) minmax\(0,\s*3fr\);/s);
      assert.match(css, /\.assay-results-controls-pinned\.left-rail-template__pinned\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto !important;[^}]*scrollbar-gutter:\s*stable;/s);
      assert.match(dom, /assayResultsList:\s*root\.getElementById\('assay-results-list'\)/);
      assert.match(browserView, /data-assay-results-select=/);
      assert.match(bindings, /assayResultsList\?\.addEventListener\('click',\s*onListClick\)/);

      const workflowIds = [
        'assay-results-list',
        'assay-result-file-input',
        'assay-analysis-group-visualization',
        'assay-analysis-method',
        'assay-chart-style-panel'
      ];
      const workflowPositions = workflowIds.map((id) => html.indexOf(`id="${id}"`));
      assert.equal(workflowPositions.every((position) => position >= 0), true);
      assert.equal(workflowPositions.every((position, index) => index === 0 || position > workflowPositions[index - 1]), true);
      assert.match(html, /assay-display-label">Result Data</);
      assert.match(html, /assay-display-label">Groups \(optional\)</);
      assert.doesNotMatch(html, /assay-analyze-results-btn|Analyze Results/);
      assert.doesNotMatch(dom, /assayAnalyzeResultsBtn/);
      assert.doesNotMatch(bindings, /onAnalyzeResults/);
    });

    test('Assay setup actions stay at the top of the form as accessible compact icons', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');
      const assay = readLocalSource('src', 'renderer', 'modules', 'assay', 'index.js');

      assert.match(html, /id="assay-form"[^>]*>[\s\S]*?id="assay-id"[\s\S]*?class="form-actions assay-form-actions"[\s\S]*?class="assay-display-field"/);
      assert.match(html, /id="assay-new-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Create new assay"[\s\S]*?<svg/);
      assert.match(html, /id="assay-export-template-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Export CSV template"[\s\S]*?<svg/);
      assert.match(html, /id="assay-import-template-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Import CSV"[\s\S]*?<svg/);
      assert.match(html, /type="submit"[^>]*assay-form-save-icon-btn[^>]*aria-label="Save assay"[\s\S]*?<svg/);
      assert.match(html, /id="assay-cancel-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Cancel edit"[\s\S]*?<svg/);
      assert.doesNotMatch(html, /id="assay-(?:export-template|import-template|cancel)-btn"[^>]*>\s*(?:Export CSV Template|Import CSV|Cancel Edit)\s*<\//);
      assert.match(css, /\.assay-form-actions\s*>\s*\.assay-form-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
      assert.match(dom, /assayNewBtn:\s*root\.getElementById\('assay-new-btn'\)/);
      assert.match(bindings, /assayNewBtn\?\.addEventListener\('click',\s*startNewAssay\)/);
      assert.match(assay, /function startNewAssay\(\)\s*\{\s*resetForm\(\);\s*elements\.assayNameInput\?\.focus\(\);\s*\}/s);
    });

    test('Papers upload trigger is an icon-only button with an accessible label', () => {
      const html = readLocalSource('ui', 'html', 'views', 'papers-view.html');

      assert.match(html, /id="paper-upload-trigger"[^>]*aria-label="Upload PDF"[^>]*title="Upload PDF"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Upload PDF<\/span>/);
      assert.doesNotMatch(html, /id="paper-upload-trigger"[^>]*>\s*Upload PDF\s*<\/button>/);
    });

    test('the shared left-rail template contains only structural selectors', () => {
      const css = readLocalSource('ui', 'css', 'overrides', 'left-rail-template.css');
      assert.doesNotMatch(css, /\b(?:agent|assay|biology|chemical|gel|inventory|papers|protocol|sample|tool|workflow)\b/i);
    });

    test('the shared folder tree stylesheet is registered in the CSS load order', () => {
      const cssOrder = readLocalSource('ui', 'config', 'css-order.json');
      assert.match(cssOrder, /ui\/css\/overrides\/folder-tree-template\.css/);
    });

    test('gel tools omit manual steps and keep ladder MW in analysis controls', () => {
      const gelView = readLocalSource('ui', 'html', 'views', 'gel-view.html');
      const analysisStart = gelView.indexOf('<summary>Analysis</summary>');
      const ladderMwInput = gelView.indexOf('id="gel-ladder-band-mw"');

      assert.equal(gelView.includes('Manual Steps'), false);
      assert.equal(gelView.includes('gel-step-list'), false);
      assert.equal(gelView.includes('gel-manual-progress'), false);
      assert.ok(analysisStart >= 0);
      assert.ok(ladderMwInput > analysisStart);
    });

    test('projects are notebook-owned and created from the biology notebook context menu', () => {
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const generatedRegistry = readLocalSource('src', 'renderer', 'modules', 'app-registry.generated.js');
      const biologyNotebookView = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      const biologyNotebookManifest = readLocalSource('src', 'renderer', 'module-manifests', 'biology-notebook.js');

      assert.equal(registry.apps.some((app) => app.id === 'projects'), false);
      assert.equal(registry.viewOrder.includes('project-management-view'), false);
      assert.doesNotMatch(generatedRegistry, /"id": "projects"/);
      assert.match(biologyNotebookView, /id="biology-notebook-project-context-menu"/);
      assert.match(biologyNotebookView, /id="biology-notebook-add-project-btn"[\s\S]*Add a project/);
      assert.match(biologyNotebookView, /id="biology-notebook-project-form"/);
      assert.match(biologyNotebookManifest, /onProjectsChanged: rendererServices\.project\.handleProjectsChanged/);
    });

    test('universal agent chat rail is shell-scoped and registry gated', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const generatedRegistry = readLocalSource('src', 'renderer', 'modules', 'app-registry.generated.js');
      const rendererShellSource = readRendererShellSource();
      const moduleRuntimeSource = readRendererModuleRuntimeSource();
      const domBindingsSource = readLocalSource('src', 'renderer', 'modules', 'agent-chat', 'dom-bindings.js');
      const coreCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'base', 'core.css'), 'utf8');

      assert.match(html, /id="universal-agent-chat-rail"/);
      assert.match(html, /id="agent-chat-rail-toggle-btn"/);
      assert.match(html, /id="agent-rail-chat-history"/);
      assert.match(html, /id="agent-rail-quick-prompts"/);
      assert.match(html, /Ask Hikari about this workspace\./);
      assert.match(html, /Summarize context/);
      assert.doesNotMatch(html, /Ask Hikari about this paper\./);
      assert.doesNotMatch(html, /Generate a step-by-step experimental protocol from this paper/);
      assert.match(html, /id="paper-selection-ask-btn"/);
      assert.doesNotMatch(html, /id="agent-rail-status"/);
      assert.doesNotMatch(html, /universal-agent-chat-rail__kicker/);
      assert.doesNotMatch(html, /id="agent-rail-clear-btn"/);
      assert.doesNotMatch(html, /id="agent-clear-btn"/);
      assert.doesNotMatch(html, /id="agent-rail-project-select"/);
      assert.equal((registry.apps || []).filter((app) => app.agentChatRail === true).map((app) => app.id).join(','), 'biology-notebook,assay,papers');
      assert.match(generatedRegistry, /"id": "biology-notebook"[\s\S]*"agentChatRail": true/);
      assert.match(generatedRegistry, /"id": "assay"[\s\S]*"agentChatRail": true/);
      assert.match(generatedRegistry, /"id": "papers"[\s\S]*"agentChatRail": true/);
      assert.match(rendererShellSource, /app\?\.agentChatRail === true/);
      assert.match(rendererShellSource, /agentChatRail\.hidden = !enabled/);
      assert.match(rendererShellSource, /has-agent-chat-rail-expanded/);
      assert.match(rendererShellSource, /hikari:open-agent-chat-rail/);
      assert.match(rendererShellSource, /moduleRuntime\.renderAgentChatRail\?\.\(\)/);
      assert.match(moduleRuntimeSource, /idPrefix:\s*'agent-rail'/);
      assert.match(moduleRuntimeSource, /loadPersistentSessions:\s*false/);
      assert.match(moduleRuntimeSource, /createScopedAgentChatState/);
      assert.match(moduleRuntimeSource, /getActivePaperId/);
      assert.match(moduleRuntimeSource, /getAgentChatContext/);
      assert.match(moduleRuntimeSource, /onAskSelectedText:[\s\S]*openPaperAgentChatWithSelection/);
      assert.match(moduleRuntimeSource, /onActiveNotebookPageChanged:[\s\S]*modules\?\.agentChatRail\?\.render\?\.\(\)/);
      assert.match(moduleRuntimeSource, /onActiveAssayChanged:[\s\S]*modules\?\.agentChatRail\?\.render\?\.\(\)/);
      assert.match(moduleRuntimeSource, /primeHiddenContext/);
      assert.match(domBindingsSource, /const id = \(suffix\) => `\$\{idPrefix\}-\$\{suffix\}`;/);
      assert.match(domBindingsSource, /quickPrompts:\s*byId\(id\('quick-prompts'\)\)/);
      assert.match(coreCss, /--agent-chat-rail-collapsed-width/);
      assert.match(coreCss, /--agent-composer-min-height:\s*54px/);
      assert.match(coreCss, /\.agent-rail-quick-prompt/);
      assert.match(coreCss, /body\.has-agent-chat-rail\.has-agent-chat-rail-expanded \.workspace-shell/);
    });

    test('renderer routes personal inventory aliases to merged sample workspace', () => {
      const source = readRendererShellSource();
      const moduleRuntimeSource = readRendererModuleRuntimeSource();
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
      assert.match(source, /function normalizeViewId\(VIEWS, viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/);
      assert.ok(sampleEntry);
      assert.ok(sampleEntry.aliases.includes('inventory'));
      assert.equal(sampleEntry.searchInputId, 'sample-search');
      assert.match(source, /const searchScopeTargets = buildSearchScopeMap\(\{\s*apps: APP_REGISTRY,/);
      assert.match(source, /const showSampleInventoryWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
      assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
      assert.match(moduleRuntimeSource, /key:\s*'sampleRegistry'[\s\S]*viewKey:\s*'SAMPLE_REGISTRY'[\s\S]*modules\.personalInventory\.renderSections\(\);[\s\S]*modules\.sampleRegistry\.render\(\);/);
      assert.doesNotMatch(moduleRuntimeSource, /\[views\.SAMPLE_REGISTRY,\s*\(\)\s*=>/);
    });

    test('renderer defines sequence viewer aliases and showView render hook', () => {
      const source = readRendererShellSource();
      const moduleRuntimeSource = readRendererModuleRuntimeSource();
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sequenceEntry = registry.apps.find((app) => app.id === 'sequence-viewer');
      assert.ok(sequenceEntry);
      assert.ok(sequenceEntry.aliases.includes('sequence'));
      assert.ok(sequenceEntry.aliases.includes('seqviewer'));
      assert.doesNotMatch(source, /SEQUENCE_VIEWER_DETAIL_VIEW_ID/);
      assert.doesNotMatch(source, /sequenceViewerDetailViewId/);
      assert.match(source, /navigationViewAliases:\s*moduleRuntime\.navigationViewAliases/);
      assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
      assert.doesNotMatch(moduleRuntimeSource, /if \(viewId === views\.SEQUENCE_VIEWER \|\| viewId === sequenceViewerDetailViewId\)/);
      assert.match(moduleRuntimeSource, /const SEQUENCE_VIEWER_DETAIL_VIEW_ID = 'sequence-viewer-detail-view';/);
      assert.match(moduleRuntimeSource, /navigationAliases:\s*\[[\s\S]*viewId:\s*SEQUENCE_VIEWER_DETAIL_VIEW_ID,[\s\S]*navigationViewKey:\s*'SEQUENCE_VIEWER'/);
      assert.match(moduleRuntimeSource, /key:\s*'sequenceViewer'[\s\S]*init:\s*initSequenceViewerWithRoutes[\s\S]*viewKey:\s*'SEQUENCE_VIEWER'[\s\S]*viewIds:\s*\[[\s\S]*SEQUENCE_VIEWER_DETAIL_VIEW_ID/);
      assert.match(moduleRuntimeSource, /homeViewId:\s*views\.SEQUENCE_VIEWER[\s\S]*detailViewId:\s*SEQUENCE_VIEWER_DETAIL_VIEW_ID[\s\S]*onNavigateHome:\s*\(\)\s*=>\s*\{\s*showView\(views\.SEQUENCE_VIEWER\);/);
      assert.match(moduleRuntimeSource, /onNavigateDetail:\s*\(\)\s*=>\s*\{\s*showView\(SEQUENCE_VIEWER_DETAIL_VIEW_ID\);/);
      assert.match(moduleRuntimeSource, /getStoragePath:\s*\(\)\s*=>\s*String\(state\.settings\?\.storagePath \|\| ''\)\.trim\(\)/);
      assert.doesNotMatch(moduleRuntimeSource, /storagePath:\s*String\(state\.settings\?\.storagePath \|\| ''\)\.trim\(\)/);
      assert.match(moduleRuntimeSource, /render:\s*\(\{ modules \},\s*\{ viewId \}\s*=\s*\{\}\)\s*=>\s*\{\s*modules\.sequenceViewer\?\.\s*render\?\.\(\{\s*activeViewId:\s*viewId\s*\}\);/);
    });

    test('sequence viewer uses bottom feature track without table dependency', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const viewerSource = readSource('src/renderer/modules/sequence-viewer/public-api.js');
      assert.match(html, /id="sequence-viewer-feature-rail-host"/);
      assert.match(html, /id="sequence-viewer-feature-detail"/);
      assert.equal(html.includes('sequence-viewer-feature-table-body'), false);
      assert.equal(viewerSource.includes('featureTableBody'), false);
    });

    test('sequence viewer splits home and detail pages and removes home top caption/meta', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const homeStart = html.indexOf('<section id="sequence-viewer-view" class="view">');
      const detailStart = html.indexOf('<section id="sequence-viewer-detail-view" class="view">');
      assert.equal(homeStart >= 0, true);
      assert.equal(detailStart > homeStart, true);

      const homeBlock = html.slice(homeStart, detailStart);
      const detailBlock = html.slice(detailStart);

      assert.match(homeBlock, /id="sequence-viewer-home-workspace"/);
      assert.match(homeBlock, /id="sequence-viewer-protein-builder-workspace"/);
      assert.match(homeBlock, /id="sequence-viewer-home-paste-btn"/);
      assert.match(homeBlock, /id="sequence-viewer-home-open-btn"/);
      assert.match(homeBlock, /id="sequence-viewer-home-protein-builder-btn"/);
      assert.match(homeBlock, /class="sequence-viewer-rail-actions-section left-rail-template__section"/);
      assert.equal(homeBlock.includes('id="sequence-viewer-home-import-btn"'), false);
      assert.match(homeBlock, /id="sequence-viewer-library-filter-saved"/);
      assert.match(homeBlock, /id="sequence-viewer-library-filter-temporary"/);
      assert.match(homeBlock, /id="sequence-viewer-library-new-folder-btn"/);
      assert.match(homeBlock, /id="sequence-viewer-library-list"/);
      assert.match(homeBlock, /id="sequence-viewer-preview-host"/);
      assert.equal(homeBlock.includes('<h2>Sequence Viewer</h2>'), false);
      assert.equal(homeBlock.includes('id="sequence-viewer-preview-meta"'), false);
      assert.equal(homeBlock.includes('id="sequence-viewer-detail-workspace"'), false);

      assert.match(detailBlock, /id="sequence-viewer-detail-workspace"/);
      assert.equal(detailBlock.includes('id="sequence-viewer-back-btn"'), false);
      assert.equal(detailBlock.includes('Back to Library'), false);
      assert.match(detailBlock, /class="sequence-viewer-detail-sidebar[\s\S]*class="sequence-viewer-rail-actions-section left-rail-template__section"[\s\S]*id="sequence-viewer-detail-new-btn"[\s\S]*id="sequence-viewer-detail-open-btn"[\s\S]*id="sequence-viewer-detail-protein-builder-btn"[\s\S]*<h4>Sequence Library<\/h4>/);
      assert.match(detailBlock, /id="sequence-viewer-detail-protein-builder-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-detail-library-new-folder-btn"/);
      assert.equal(detailBlock.includes('id="sequence-viewer-save-btn"'), false);
      assert.equal(detailBlock.includes('id="sequence-viewer-save-name"'), false);
      assert.match(detailBlock, /id="sequence-viewer-detail-library-context-menu"[\s\S]*data-sequence-library-action="rename"/);
      assert.match(homeBlock, /id="sequence-viewer-library-context-menu"[\s\S]*data-sequence-library-action="rename"/);
      assert.match(detailBlock, /id="sequence-viewer-annotate-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-recognize-backbone-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-orf-toggle"/);
      assert.match(detailBlock, /id="sequence-viewer-restriction-neb-toggle"/);
      assert.match(detailBlock, /id="sequence-viewer-restriction-thermo-toggle"/);
    });

    test('molarity calculator uses responsive cards with automatic result states', () => {
      const html = readLocalSource('ui', 'html', 'views', 'tool-box-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'tool-box-view.css');
      const source = readLocalSource('src', 'renderer', 'modules', 'tool-box', 'molarity-ui.js');

      assert.match(html, /class="molarity-view-header"[\s\S]*class="molarity-auto-unit-badge"[\s\S]*class="molarity-card-grid"/);
      assert.equal((html.match(/class="molarity-block"/g) || []).length, 4);
      assert.match(html, /class="molarity-step"[^>]*>01<[\s\S]*class="molarity-step"[^>]*>04</);
      assert.equal((html.match(/class="form-grid molarity-form"/g) || []).length, 4);
      assert.equal((html.match(/class="calc-output molarity-output" aria-live="polite"/g) || []).length, 4);
      assert.doesNotMatch(html, /(?:mass|volume|conc|dilution)-calc-output-unit/);
      assert.match(css, /\.molarity-card-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(520px,\s*1fr\)\)/s);
      assert.match(css, /\.molarity-output\[data-state="calculated"\]/);
      assert.match(css, /\.molarity-output\[data-state="warning"\]/);
      assert.match(css, /input\[type="number"\]::\-webkit-inner-spin-button/);
      assert.match(css, /content:\s*"Result:"/);
      assert.doesNotMatch(css, /\.molarity-output[^{]*\{[^}]*border-left/s);
      assert.match(source, /function renderMolarityResult\(element, result\)[\s\S]*element\.dataset\.state\s*=\s*state;/);
      assert.match(source, /result\.resultText\s*\?\s*'calculated'\s*:\s*'empty'/);
      assert.match(source, /element\.textContent\s*=\s*result\.resultText\s*\|\|\s*'';/);
      assert.doesNotMatch(source, /element\.textContent\s*=\s*result\.resultText\s*\|\|\s*result\.formulaText/);
    });

    test('tool box no longer owns Sequence Viewer cloning or protein-builder code', () => {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const source = readSource('src/renderer/modules/tool-box.js');
      assert.equal(html.includes('tool-protein-assembly-view'), false);
      assert.equal(html.includes('Protein Assembler'), false);
      assert.equal(source.includes('initProteinAssemblyTool'), false);
      assert.equal(source.includes('cloning-assembly'), false);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'tool-box', 'cloning-assembly.js')), false);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'tool-box', 'protein-assembly.js')), false);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'cloning-assembly.js')), true);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'assembly-model.js')), true);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'shared', 'sequence-viewer')), false);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'algorithms', 'sequence-backbone-recognition.js')), true);
      assert.equal(fs.existsSync(path.join(__dirname, 'src', 'renderer', 'modules', 'sequence-viewer', 'data', 'commercial-restriction-enzymes.js')), true);
    });

    test('sequence viewer map preview renderer omits metadata text overlays', () => {
      const source = readSource('src/renderer/modules/sequence-viewer/public-api.js');
      assert.equal(source.includes('sequence-viewer-preview-meta'), false);
      assert.equal(source.includes('toLocaleString()} bp</text>'), false);
      assert.equal(source.includes("normalizeTopology(record?.topology || 'linear'))}</text>"), false);
    });

    test('sequence viewer input panels force-hide when hidden attribute is set', () => {
      const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'sequence-viewer-view.css'), 'utf8');
      assert.match(css, /\.sequence-viewer-input-panel\[hidden\]\s*\{\s*display:\s*none !important;/);
    });

    test('sequence viewer detail layout follows the app height and keeps the sequence host scrollable', () => {
      const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'sequence-viewer-view.css'), 'utf8');
      assert.match(css, /#sequence-viewer-detail-view\.view\.is-active\s*\{[^}]*display:\s*grid;[^}]*height:\s*100%;/s);
      assert.match(css, /\.sequence-viewer-detail-workspace\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*gap:\s*0;[^}]*height:\s*100%;/s);
      assert.match(css, /#sequence-viewer-protein-builder-confirmation:not\(\[hidden\]\)\s*\{[^}]*grid-row:\s*1;[^}]*margin-bottom:\s*12px;/s);
      assert.match(css, /#sequence-viewer-detail-view\s+\.sequence-viewer-detail-layout\.left-rail-template\s*\{[^}]*grid-row:\s*2;[^}]*align-items:\s*stretch;[^}]*height:\s*100%;/s);
      assert.match(css, /\.sequence-viewer-detail-main\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;/s);
      assert.match(css, /#sequence-viewer-detail-view\s+\.sequence-viewer-detail-layout\.left-rail-template\s*>\s*\.sequence-viewer-detail-main\.left-rail-template__main\s*\{[^}]*align-self:\s*stretch;[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
      assert.match(css, /#sequence-viewer-detail-view\s+\.sequence-viewer-detail-layout\.left-rail-template\s*>\s*\.sequence-viewer-detail-sidebar\.left-rail-template__rail\s*\{[^}]*align-self:\s*stretch;[^}]*height:\s*100%;/s);
      assert.match(css, /\.sequence-viewer-results\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;/s);
      assert.match(css, /\.sequence-viewer-sequence-region\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;/s);
      assert.match(css, /\.sequence-viewer-sequence-host\s*\{[^}]*flex:\s*1 1 auto;[^}]*height:\s*auto;[^}]*overflow:\s*auto;/s);
      assert.match(css, /\.sequence-viewer-sequence-host\s*>\s*\.sequence-viewer-dual-line:last-child\s*\{\s*margin-bottom:\s*0;/s);
    });

    test('papers PDF text layer keeps native browser selection stable during drag', () => {
      const css = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'papers-view.css'), 'utf8');
      const pageRecordsSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-page-records.js');
      const renderingSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-rendering.js');
      const selectionMenuSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-selection-menu-controller.js');
      const eventsSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-events-controller.js');
      const selectionSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-text-selection.js');
      assert.match(pageRecordsSource, /className\s*=\s*'papers-viewer-text-layer textLayer'/);
      assert.match(pageRecordsSource, /textSelectionCleanup/);
      assert.match(renderingSource, /bindPdfTextLayerSelection/);
      assert.match(selectionSource, /endOfContent/);
      assert.match(selectionSource, /range\.compareBoundaryPoints/);
      assert.match(selectionSource, /endDiv\.style\.userSelect\s*=\s*'text'/);
      assert.match(selectionMenuSource, /selectionPointerDown/);
      assert.match(eventsSource, /doc\.addEventListener\('selectionchange', ctx\.schedulePendingSelectionUpdate\)/);
      assert.match(css, /\.papers-viewer-text-layer\s*\{[\s\S]*overflow:\s*clip;/);
      assert.match(css, /\.papers-viewer-text-layer\s*\{[\s\S]*--text-scale-factor:/);
      assert.match(css, /\.papers-viewer-text-layer br::selection\s*\{[\s\S]*background:\s*transparent;/);
      assert.match(css, /\.papers-viewer-text-layer \.endOfContent\s*\{[\s\S]*inset:\s*100% 0 0;/);
      assert.match(css, /\.papers-viewer-text-layer\.selecting \.endOfContent\s*\{[\s\S]*top:\s*0;/);
      assert.doesNotMatch(css, /\.papers-viewer-text-layer span\s*\{[\s\S]*font-family:\s*var\(--font-app\)/);
    });

    test('papers PDF first-load sizing stays inside the app shell', () => {
      const coreCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'base', 'core.css'), 'utf8');
      const papersCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'views', 'papers-view.css'), 'utf8');
      const domSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-dom-controller.js');
      const navigationSource = readLocalSource('src', 'renderer', 'modules', 'papers', 'pdf-viewer', 'pdf-viewer-page-navigation-controller.js');
      assert.match(coreCss, /html\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
      assert.match(coreCss, /body\s*\{[\s\S]*height:\s*100%;[\s\S]*overflow:\s*hidden;/);
      assert.match(papersCss, /\.papers-viewer-workspace\s*\{[\s\S]*overflow:\s*hidden;/);
      assert.match(domSource, /function getElementLayoutWidth\(element\)/);
      assert.match(navigationSource, /const layoutWidth = \[\s*stage,\s*workspace,\s*shell\s*\]/);
      assert.match(navigationSource, /Math\.max\(layoutWidth - horizontalPadding, 320\)/);
    });

    test('forge config prunes dev deps and ignores build artifacts', () => {
      assert.equal(Boolean(forgeConfig.packagerConfig.asar), true);
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /src\/main\/agent/
      );
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /src\/main\/storage/
      );
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /src\/main\/lib/
      );
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /vendor\/sqljs/
      );
      assert.match(
        forgeConfig.packagerConfig.asar?.unpackDir || '',
        /node_modules\/@modelcontextprotocol\/sdk/
      );
      assert.equal(forgeConfig.packagerConfig.prune, true);
      assert.ok(Array.isArray(forgeConfig.packagerConfig.ignore));
      const ignoreAsText = forgeConfig.packagerConfig.ignore.map((item) => item.toString()).join('\n');
      assert.match(ignoreAsText, /\\\/out\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/output\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\\\/tmp\(\$\|\\\/\)/);
      assert.match(ignoreAsText, /\.DS_Store/);
      assert.match(ignoreAsText, /hikari-data\(\?:\\\.ena\)\?\\\.json/);
    });

    test('main sql.js helpers resolve the bundled vendor asset from package-safe paths', () => {
      const { resolveSqlJsWasmJsPath } = require(path.join(__dirname, 'src', 'main', 'lib', 'sqljs-path.js'));
      const resolved = resolveSqlJsWasmJsPath(path.join(__dirname, 'src', 'main', 'storage'));
      assert.equal(resolved.endsWith(path.join('vendor', 'sqljs', 'sql-wasm.js')), true);
      assert.equal(fs.existsSync(resolved), true);
    });

    test('main window keeps split preload CommonJS modules available', () => {
      const source = fs.readFileSync(path.join(__dirname, 'src', 'main', 'windows', 'create-main-window.js'), 'utf8');
      assert.match(source, /contextIsolation:\s*true/);
      assert.match(source, /nodeIntegration:\s*false/);
      assert.match(source, /sandbox:\s*false/);
      assert.match(source, /preload:\s*preloadPath/);
    });

    test('telegram bridge keeps only supported renderer IPC channel', () => {
      const telegramBotSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'telegramBot.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.equal(telegramBotSource.includes('telegram-message'), false);
      assert.equal(preloadSource.includes('onTelegramCommand'), true);
    });

    test('main composes dedicated IPC registrars with generic tool runtime support', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const agentRegistrarPath = (...parts) => path.join(__dirname, 'src', 'main', 'ipc', 'register-agent-ipc', ...parts);
      const mainSource = readMainProcessSource();
      const mainAgentServicesSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'core', 'services', 'create-agent-services.js'), 'utf8');
      const dataRegistrarSource = [
        fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc', 'register-sequence-library-ipc.js'), 'utf8')
      ].join('\n');
      const agentRegistrarSource = fs.readFileSync(agentRegistrarPath('index.js'), 'utf8');
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
      const toolLoadingSource = fs.readFileSync(agentPath('tools', 'agent-tool-loading.js'), 'utf8');
      const toolExecutionSource = fs.readFileSync(agentPath('tools', 'agent-tool-execution.js'), 'utf8');
      const runtimeSupportSource = fs.readFileSync(agentPath('runtime', 'agent-runtime-support.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');

      assert.match(mainSource, /createMainAgentServices/);
      assert.match(mainSource, /registerDataIpc/);
      assert.match(mainSource, /registerAgentIpc/);
      assert.match(mainSource, /registerSystemIpc/);
      assert.match(mainAgentServicesSource, /createAgentToolCallRuntime/);
      assert.match(mainAgentServicesSource, /agent-tool-loading\.js/);
      assert.match(mainAgentServicesSource, /agent-tool-execution\.js/);
      assert.match(mainAgentServicesSource, /createAgentRuntimeSupport/);
      assert.match(mainAgentServicesSource, /llmProviderBridge/);
      assert.match(mainAgentServicesSource, /sharedAgentLlmDeps/);
      assert.match(mainAgentServicesSource, /registerAgentToolExecutors/);
      assert.match(dataRegistrarSource, /function registerDataIpc\(deps = \{\}\)/);
      assert.match(agentRegistrarSource, /function registerAgentIpc\(deps = \{\}\)/);
      assert.match(systemRegistrarSource, /function registerSystemIpc\(deps = \{\}\)/);
      assert.match(toolLoadingSource, /function normalizeToolInvocationArgs\(rawArgs\)/);
      assert.match(toolExecutionSource, /function createAgentToolCallRuntime\(deps = \{\}\)/);
      assert.match(runtimeSupportSource, /function createAgentRuntimeSupport\(deps = \{\}\)/);
      assert.match(llmBridgeSource, /function createAgentLlmProviderBridge\(deps = \{\}\)/);
      assert.doesNotMatch(llmBridgeSource, /function startToolSession\(/);
    });

    test('agent shared text helpers no longer clip long prompts by default', () => {
      const agentDir = path.join(__dirname, 'src', 'main', 'agent');
      const agentPath = (...parts) => path.join(agentDir, ...parts);
      const llmUtilsSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'lib', 'llm', 'runtime-helpers.js'), 'utf8');
      const llmBridgeSource = fs.readFileSync(agentPath('shared', 'agent-llm-provider-bridge.js'), 'utf8');
      const chatLogSource = fs.readFileSync(agentPath('context', 'agent-chat-log.js'), 'utf8');
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
      assert.doesNotMatch(llmUtilsSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(llmBridgeSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(chatLogSource, /text\.length > maxLength \? text\.slice\(0,\s*maxLength\) : text;/);
      assert.doesNotMatch(systemRegistrarSource, /promptRaw\.length > 120000/);
    });

    test('settings expose Codex login and Desktop MCP setup controls through preload and system IPC', () => {
      const mainSource = readMainProcessSource();
      const preloadSource = readPreloadSource();
      const systemRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-system-ipc.js'), 'utf8');
      const settingsSource = fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'settings', 'index.js'), 'utf8');
      const settingsHtml = fs.readFileSync(path.join(__dirname, 'ui', 'html', 'views', 'setting-view.html'), 'utf8');

      assert.match(mainSource, /launchCodexCliLogin/);
      assert.match(mainSource, /clearCodexCliStoredLogin/);
      assert.match(preloadSource, /loginCodexLlm:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(LLM\.CODEX_LOGIN\)/);
      assert.match(preloadSource, /clearCodexLlmLogin:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(LLM\.CODEX_CLEAR_LOGIN\)/);
      assert.match(preloadSource, /getCodexDesktopMcpSetupPrompt:\s*\(payload\)\s*=>\s*\(/);
      assert.match(preloadSource, /writeTextToClipboard:\s*\(value\)\s*=>\s*writeTextToClipboard/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_LOGIN/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_CLEAR_LOGIN/);
      assert.match(systemRegistrarSource, /ipcMain\.handle\(LLM\.CODEX_DESKTOP_MCP_PROMPT/);
      assert.match(settingsSource, /window\.hikariApi\?\.loginCodexLlm/);
      assert.match(settingsSource, /window\.hikariApi\?\.clearCodexLlmLogin/);
      assert.match(settingsSource, /window\.hikariApi\?\.getCodexDesktopMcpSetupPrompt/);
      assert.match(settingsSource, /window\.hikariApi\?\.writeTextToClipboard/);
      assert.match(settingsHtml, /id="setting-codex-status"/);
      assert.match(settingsHtml, /id="start-codex-login-btn"/);
      assert.match(settingsHtml, /id="clear-codex-login-btn"/);
      assert.match(settingsHtml, /id="copy-codex-desktop-mcp-prompt-btn"/);
      assert.match(settingsHtml, /id="setting-codex-desktop-mcp-status"/);
    });

    test('main and preload expose sequence library IPC bridge through the data registrar', () => {
      const dataRegistrarSource = fs.readFileSync(
        path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc', 'register-sequence-library-ipc.js'),
        'utf8'
      );
      const preloadSource = readPreloadSource();
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.LIST/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.GET/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.UPSERT/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.PROMOTE/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.DELETE/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.UPSERT_FOLDER/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.DELETE_FOLDER/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.MOVE_ENTRY/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.SEARCH_FEATURES/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.ANNOTATE/);
      assert.match(dataRegistrarSource, /handle\(SEQUENCE_LIBRARY\.RECOGNIZE_BACKBONE/);
      assert.match(preloadSource, /sequenceLibraryList:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.LIST, payload\)/);
      assert.match(preloadSource, /sequenceLibraryGet:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.GET, payload\)/);
      assert.match(preloadSource, /sequenceLibraryUpsert:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.UPSERT, payload\)/);
      assert.match(preloadSource, /sequenceLibraryUpsertFolder:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.UPSERT_FOLDER, payload\)/);
      assert.match(preloadSource, /sequenceLibraryDeleteFolder:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.DELETE_FOLDER, payload\)/);
      assert.match(preloadSource, /sequenceLibraryMoveEntry:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.MOVE_ENTRY, payload\)/);
      assert.match(preloadSource, /sequenceLibrarySearchFeatures:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.SEARCH_FEATURES, payload\)/);
      assert.match(preloadSource, /sequenceLibraryAnnotate:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.ANNOTATE, payload\)/);
      assert.match(preloadSource, /sequenceLibraryRecognizeBackbone:\s*\(payload\)\s*=>\s*ipcRenderer\.invoke\(SEQUENCE_LIBRARY\.RECOGNIZE_BACKBONE, payload\)/);
    });

    test('main and preload expose storage root import IPC bridge through the data registrar', () => {
      const dataRegistrarSource = fs.readFileSync(path.join(__dirname, 'src', 'main', 'ipc', 'register-data-ipc.js'), 'utf8');
      const preloadSource = readPreloadSource();
      assert.match(dataRegistrarSource, /ipcMain\.handle\(STORAGE\.IMPORT_ROOT/);
      assert.match(dataRegistrarSource, /importStorageRoot\(\{ storagePath \}\)/);
      assert.match(preloadSource, /importStorageRoot:\s*\(storagePath\)\s*=>\s*ipcRenderer\.invoke\(STORAGE\.IMPORT_ROOT, \{ storagePath \}\)/);
    });
  }
};
