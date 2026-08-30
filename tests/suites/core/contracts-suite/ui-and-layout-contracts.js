module.exports = function registerUiAndLayoutContracts(context = {}) {
  const scope = context.scope || {};
  const __dirname = context.__dirname || process.cwd();

  with (scope) {
    const readLocalSource = (...parts) => {
      const sourcePath = path.join(__dirname, ...parts);
      if (path.extname(sourcePath) !== '.css') {
        return fs.readFileSync(sourcePath, 'utf8');
      }

      const resolveCssImports = (cssPath, activePaths = new Set()) => {
        if (activePaths.has(cssPath)) {
          throw new Error(`Circular CSS import while reading ${cssPath}`);
        }
        const nextActivePaths = new Set(activePaths);
        nextActivePaths.add(cssPath);
        const css = fs.readFileSync(cssPath, 'utf8');
        return css.replace(/@import\s+url\(["']([^"']+)["']\);\s*/g, (statement, specifier) => {
          if (!specifier.startsWith('.')) {
            return statement;
          }
          return resolveCssImports(path.resolve(path.dirname(cssPath), specifier), nextActivePaths);
        });
      };

      return resolveCssImports(sourcePath);
    };
    const readMainProcessSource = () => [
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
      readLocalSource('src', 'main', 'preload', 'api', 'system-api.js')
    ].join('\n');
    const readRendererShellSource = () => [
      readLocalSource('src', 'renderer', 'renderer.js'),
      readLocalSource('src', 'renderer', 'core', 'start-hikari-core.js'),
      readLocalSource('src', 'renderer', 'app', 'navigation-shell.js'),
      readLocalSource('src', 'renderer', 'app', 'navigation-shell', 'app-dock.js'),
      readLocalSource('src', 'renderer', 'app', 'navigation-shell', 'search-suggestions.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-open-handlers.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-search.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-search', 'candidates.js'),
      readLocalSource('src', 'renderer', 'app', 'topbar-search', 'scoring.js')
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

    test('Home gives paper results and notebook notes matching tall cards while keeping quick log short', () => {
      const css = readLocalSource('ui', 'css', 'views', 'home-view.css');
      const html = readLocalSource('ui', 'html', 'views', 'home-view.html');
      assert.match(css, /#home-view \.home-layout\s*\{[\s\S]*?grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\);/);
      assert.match(css, /grid-template-areas:\s*\n\s*"timer timer timer timer notebook notebook notebook notebook paper-finding paper-finding paper-finding paper-finding"\s*\n\s*"contribution contribution contribution contribution notebook notebook notebook notebook paper-finding paper-finding paper-finding paper-finding"\s*\n\s*"quicklog quicklog quicklog quicklog passage passage passage passage incubation incubation incubation incubation";/);
      assert.match(css, /@media \(max-width: 1279px\)[\s\S]*?grid-template-areas:\s*\n\s*"timer contribution"\s*\n\s*"notebook paper-finding"\s*\n\s*"quicklog passage"\s*\n\s*"incubation incubation";/);
      assert.match(css, /#home-view \.home-quicklog-body\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) auto;/);
      assert.doesNotMatch(html, /data-dashboard-quicklog-chip|home-quicklog-chips/);
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
      const sequenceSource = [
        readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'home-controller.js'),
        readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'home', 'library-rendering.js')
      ].join('\n');

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
        { file: 'workflow-management-view.html', rail: 'workflow-editor-sidebar', scroll: 'workflow-editor-sidebar-scroll', action: 'id="workflow-entry-template-btn"' },
        {
          file: 'sequence-viewer-view.html',
          rail: 'sequence-viewer-home-sidebar',
          scroll: 'sequence-viewer-home-sidebar-scroll',
          action: 'id="sequence-viewer-home-paste-btn"',
          pinnedControls: [
            'id="sequence-viewer-library-filter-saved"',
            'id="sequence-viewer-library-filter-temporary"',
            'id="sequence-viewer-library-search-input"'
          ],
          after: 'id="sequence-viewer-library-list"'
        },
        {
          file: 'sequence-viewer-detail-view.html',
          rail: 'sequence-viewer-detail-sidebar',
          scroll: 'sequence-viewer-detail-sidebar-scroll',
          action: 'id="sequence-viewer-detail-new-btn"',
          pinnedControls: [
            'id="sequence-viewer-detail-library-filter-saved"',
            'id="sequence-viewer-detail-library-filter-temporary"'
          ],
          after: 'id="sequence-viewer-detail-library-list"'
        },
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

      for (const { file, rail, scroll, action, pinnedControls = [], after } of rails) {
        const html = readLocalSource('ui', 'html', 'views', file);
        const tokens = [
          `${rail} app-left-rail left-rail-template__rail left-rail-template__rail--pinned`,
          'left-rail-template__pinned',
          ...(action ? [action] : []),
          ...pinnedControls,
          `${scroll} left-rail-template__scroll`,
          ...(after ? [after] : [])
        ];
        orderOf(html, file, tokens);
      }
    });

    test('only Papers and Agent opt into the shared left-rail fold control', () => {
      const sharedController = readLocalSource('src', 'renderer', 'app', 'shared-left-rail.js');
      const sharedCss = readLocalSource('ui', 'css', 'overrides', 'left-rail-template.css');
      const railControlsCss = readLocalSource('ui', 'css', 'overrides', 'cross-view-fixes.css');
      const viewFiles = fs.readdirSync(path.join(__dirname, 'ui', 'html', 'views'))
        .filter((fileName) => fileName.endsWith('.html'));
      const optedInViews = viewFiles
        .filter((fileName) => readLocalSource('ui', 'html', 'views', fileName).includes('data-left-rail-foldable="true"'))
        .sort();

      assert.deepEqual(optedInViews, ['agent-view.html', 'papers-view.html']);
      assert.match(sharedController, /layout\.getAttribute\(FOLDABLE_ATTR\) === 'true'/);
      assert.match(sharedController, /folded \? 'Open left rail' : 'Fold left rail'/);
      assert.match(sharedController, /rail\.inert = folded/);
      assert.match(sharedCss, /\[data-left-rail-foldable="true"\]\.is-left-rail-folded\s*\{[^}]*grid-template-columns:\s*var\(--shared-left-rail-folded-width\) minmax\(0,\s*1fr\) !important;/s);
      assert.match(railControlsCss, /\.app-left-rail-handle\s*\{[^}]*left:\s*var\(--app-left-rail-track-width\);/s);
      assert.match(railControlsCss, /\.app-left-rail-fold-toggle\s*\{[^}]*left:\s*var\(--app-left-rail-track-width\);/s);
      assert.match(railControlsCss, /body\.shared-left-rail-resizing \.app-left-rail-fold-toggle\s*\{[^}]*transition:[^}]*transform 140ms ease;/s);
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

    test('biology notebook protocol fold triangle sits beside its label', () => {
      const html = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');

      assert.match(html, /class="biology-notebook-viewer-section-summary">\s*<span>Protocol<\/span>\s*<span class="biology-notebook-viewer-section-chevron"/);
      assert.match(css, /\.biology-notebook-viewer-section-summary\s*\{[^}]*justify-content:\s*flex-start;[^}]*gap:\s*7px;/s);
    });

    test('biology notebook placeholder editors grow from their rendered token width', () => {
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');
      const source = readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'protocol', 'inline-placeholder-controller.js');

      assert.match(css, /\.inline-placeholder-editor\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*min\(360px,\s*calc\(100vw - 96px\)\);/s);
      assert.match(source, /function setEditorInitialWidth\(editor, token\)[\s\S]*?inlineEditorBaseWidth[\s\S]*?editor\.style\.width/);
      assert.match(source, /function resizeEditorForValue\(editor\)[\s\S]*?editor\.scrollWidth[\s\S]*?Math\.max\(baseWidth, contentWidth\)/);
      assert.match(source, /setEditorInitialWidth\(editor, token\);[\s\S]*?editor\.focus\(\)/);
      assert.match(source, /stepsHost\.addEventListener\('input', onInput\)/);
    });

    test('biology notebook placeholder context menu contains only a plain Add Table action', () => {
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');
      const source = readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'samples', 'sample-link-menu.js');

      assert.match(source, /class="biology-notebook-placeholder-table-action" role="menuitem" data-placeholder-add-table>[\s\S]*?Add Table[\s\S]*?<\/button>/);
      assert.doesNotMatch(source, /Placeholder variable|Search samples|data-sample-link-results|ghost-btn|Add table from this variable/i);
      assert.match(css, /\.biology-notebook-placeholder-table-action\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    });

    test('biology notebook viewer uses compact icon actions with accessible hover captions', () => {
      const html = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');

      assert.match(html, /class="biology-notebook-viewer-actions"[^>]*aria-label="Notebook page actions"/);
      assert.match(html, /id="biology-notebook-edit-protocol-btn"[^>]*class="ghost-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Edit page copy"[^>]*data-hover-caption="Edit page copy"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Edit page copy<\/span>/);
      assert.match(html, /id="biology-notebook-apply-protocol-edit-btn"[^>]*class="primary-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Apply page edit"[^>]*data-hover-caption="Apply page edit"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Apply page edit<\/span>/);
      assert.match(html, /id="biology-notebook-cancel-protocol-edit-btn"[^>]*class="ghost-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Cancel page edit"[^>]*data-hover-caption="Cancel page edit"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Cancel page edit<\/span>/);
      assert.match(html, /id="biology-notebook-export-btn"[^>]*class="ghost-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Export PDF"[^>]*data-hover-caption="Export PDF"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Export PDF<\/span>/);
      assert.match(html, /id="biology-notebook-print-btn"[^>]*class="ghost-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Print"[^>]*data-hover-caption="Print"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Print<\/span>/);
      assert.match(html, /id="save-biology-notebook-btn"[^>]*class="ghost-btn biology-notebook-viewer-icon-btn"[^>]*aria-label="Save notebook page"[^>]*data-hover-caption="Save notebook page"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Save notebook page<\/span>/);
      assert.equal((html.match(/id="save-biology-notebook-btn"/g) || []).length, 1);
      assert.match(css, /\.biology-notebook-viewer-icon-btn\s*\{[^}]*position:\s*relative;[^}]*width:\s*30px;[^}]*height:\s*30px;/s);
      assert.match(css, /\.biology-notebook-viewer-actions \[data-hover-caption\]::after\s*\{[^}]*top:\s*calc\(100% \+ 7px\);[^}]*bottom:\s*auto;/s);
    });

    test('biology notebook bench tools live in a foldable floating icon toolbox', () => {
      const html = readLocalSource('ui', 'html', 'views', 'biology-notebook-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');
      const source = [
        readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'tools', 'tool-sidebar.js'),
        readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'tools', 'toolbox-drag.js'),
        readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'tools', 'buffer-suggestions.js'),
        readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'tools', 'tool-calculations.js'),
        readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'tools', 'calculation-records.js')
      ].join('\n');
      const notebookSource = readLocalSource('src', 'renderer', 'modules', 'biology-notebook', 'notebook', 'event-bindings.js');
      const linkedToolbar = html.match(/<div class="biology-notebook-linked-toolbar">([\s\S]*?)<\/div>/)?.[1] || '';

      assert.match(html, /id="biology-notebook-layout" class="[^"]*is-tool-sidebar-collapsed/);
      assert.match(html, /id="biology-notebook-tool-fold-toggle"[^>]*aria-label="Open bench toolbox"[^>]*aria-controls="biology-notebook-tool-content"[\s\S]*?<svg/);
      assert.match(html, /class="biology-notebook-tool-toolbar"[\s\S]*?id="biology-notebook-tool-tab-buffer"[\s\S]*?id="biology-notebook-tool-tab-reaction"[\s\S]*?id="biology-notebook-add-assay-btn"[^>]*class="ghost-btn biology-notebook-tool-icon-action"[\s\S]*?id="biology-notebook-add-samples-btn"[^>]*class="ghost-btn biology-notebook-tool-icon-action"[\s\S]*?id="biology-notebook-add-table-btn"[^>]*class="ghost-btn biology-notebook-tool-icon-action"[\s\S]*?id="biology-notebook-tool-collapse-btn"/);
      assert.doesNotMatch(html, /biology-notebook-tool-tab-molarity/);
      assert.match(html, /id="biology-notebook-tool-tab-buffer"[^>]*class="biology-notebook-tool-tab"[^>]*aria-selected="false"/);
      assert.doesNotMatch(html, /id="biology-notebook-tool-tab-buffer"[^>]*class="[^"]*is-active/);
      assert.match(html, /id="biology-notebook-tool-panel-buffer"[^>]*data-notebook-tool-panel="buffer"[^>]*hidden/);
      assert.match(html, /id="biology-notebook-tool-tab-buffer"[^>]*data-hover-caption="Buffer preparer"/);
      assert.match(html, /id="biology-notebook-tool-tab-reaction"[^>]*data-hover-caption="Fixed volume reaction"/);
      assert.match(html, /id="biology-notebook-add-assay-btn"[^>]*data-hover-caption="Add assay"/);
      assert.match(html, /id="biology-notebook-add-samples-btn"[^>]*data-hover-caption="Add samples"/);
      assert.match(html, /id="biology-notebook-quick-sample-overlay"[^>]*hidden[\s\S]*?class="biology-notebook-quick-sample-layout"[\s\S]*?id="biology-notebook-quick-sample-container"[\s\S]*?id="biology-notebook-quick-sample-grid"[\s\S]*?id="biology-notebook-quick-sample-name"/);
      assert.match(html, /id="biology-notebook-add-table-btn"[^>]*data-hover-caption="Add table"/);
      assert.match(html, /id="biology-notebook-tool-collapse-btn"[^>]*data-hover-caption="Fold toolbox"/);
      assert.match(html, /id="biology-notebook-tool-workspace"[^>]*hidden[^>]*aria-label="Bench tool workspace"/);
      assert.doesNotMatch(linkedToolbar, /biology-notebook-add-(?:assay|samples|table)-btn/);
      assert.doesNotMatch(html, /id="biology-notebook-tool-mobile-toggle"/);
      assert.match(css, /\.biology-notebook-tool-sidebar\s*\{[^}]*position:\s*absolute;[^}]*z-index:\s*240;[^}]*width:\s*132px;[^}]*height:\s*132px;[^}]*max-height:\s*132px;[^}]*box-shadow:/s);
      assert.match(css, /\.biology-notebook-layout\.is-tool-sidebar-collapsed \.biology-notebook-tool-sidebar\s*\{[^}]*width:\s*42px;[^}]*max-height:\s*42px;/s);
      assert.match(css, /\.biology-notebook-tool-tab,\s*\.biology-notebook-tool-icon-action\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*border:\s*0;/s);
      assert.match(css, /\.biology-notebook-tool-sidebar \.biology-notebook-tool-body,[\s\S]*?\.biology-notebook-tool-sidebar \.biology-notebook-tool-status\s*\{\s*display:\s*none;/);
      assert.match(source, /function mountToolWorkspace\(\)[\s\S]*?toolWorkspace\.appendChild\(element\)/);
      assert.match(source, /let activeTool = '';/);
      assert.match(source, /function clearToolSelection\(\)[\s\S]*?activeTool = '';[\s\S]*?syncToolSelection\(\);[\s\S]*?toolWorkspace\.hidden = true/);
      assert.match(notebookSource, /notebookAddTableBtn\?\.addEventListener\('click',[\s\S]*?toolSidebarController\.clearSelection\(\);[\s\S]*?setTableSizeDialog\(true\)/);
      assert.match(notebookSource, /notebookAddAssayBtn\?\.addEventListener\('click',[\s\S]*?toolSidebarController\.clearSelection\(\);[\s\S]*?linkedWorkActions\.onAddAssayClick\(\)/);
      assert.match(notebookSource, /notebookAddSamplesBtn\?\.addEventListener\('click',[\s\S]*?toolSidebarController\.clearSelection\(\);[\s\S]*?quickSampleController\.open\(\)/);
      assert.match(css, /\.biology-notebook-quick-sample-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.62fr\)\s*minmax\(230px,\s*0\.72fr\);/s);
      assert.match(css, /\.biology-notebook-quick-sample-storage\s*\{[^}]*grid-template-columns:\s*minmax\(188px,\s*0\.48fr\)\s*minmax\(250px,\s*1fr\);/s);
      assert.match(source, /function showToolWorkspace\(\)[\s\S]*?toolWorkspace\.hidden = false/);
      assert.match(source, /addListener\(foldToggle, 'click',[\s\S]*?setSidebarOpen\(true\)[\s\S]*?biology-notebook-tool-tab-/);
      assert.match(source, /addListener\(foldToggle, 'pointerdown', beginToolboxDrag\)/);
      assert.match(source, /addListener\(win, 'pointermove', moveToolbox\)/);
      assert.match(source, /function applyToolboxPosition\([\s\S]*?notebookToolboxMoved = 'true'/);
      assert.match(source, /function positionExpandedToolbox\([\s\S]*?spaceRight[\s\S]*?spaceLeft[\s\S]*?spaceDown[\s\S]*?spaceUp[\s\S]*?toolboxExpandX[\s\S]*?toolboxExpandY/);
      assert.match(source, /function storeToolboxAnchor\([\s\S]*?horizontalEdge[\s\S]*?verticalEdge/);
      assert.match(source, /function resolveToolboxAnchor\([\s\S]*?horizontalEdge === 'right'[\s\S]*?verticalEdge === 'bottom'/);
      assert.match(css, /\.biology-notebook-tool-toolbar\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*36px\);[^}]*grid-template-rows:\s*repeat\(3,\s*36px\);/s);
      assert.match(css, /data-toolbox-expand-x="left"[^}]*biology-notebook-tool-collapse-btn[^}]*\{[^}]*grid-column:\s*3;/s);
      assert.match(css, /data-toolbox-expand-y="up"[^}]*biology-notebook-tool-collapse-btn[^}]*\{[^}]*grid-row:\s*3;/s);
      assert.match(css, /\.biology-notebook-layout\.is-tool-sidebar-collapsed \.biology-notebook-tool-fold-toggle\s*\{[^}]*border:\s*1px solid[^;]+;[^}]*background:\s*var\(--theme-surface-elevated\);[^}]*box-shadow:\s*none;[^}]*cursor:\s*grab;[^}]*touch-action:\s*none;/s);
      assert.match(css, /\.biology-notebook-tool-sidebar \[data-hover-caption\]::after,\s*\.biology-notebook-viewer-actions \[data-hover-caption\]::after\s*\{[^}]*content:\s*attr\(data-hover-caption\);[^}]*position:\s*absolute;[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;/s);
      assert.match(css, /\.biology-notebook-tool-sidebar \[data-hover-caption\]:hover::after,[\s\S]*?\.biology-notebook-viewer-actions \[data-hover-caption\]:focus-visible::after\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s);
      assert.match(css, /data-toolbox-expand-y="down"[^}]*data-hover-caption[^}]*\{[^}]*top:\s*calc\(100% \+ 7px\);[^}]*bottom:\s*auto;/s);
      assert.match(css, /data-toolbox-expand-x="left"[^}]*data-hover-caption[^}]*\{[^}]*right:\s*0;[^}]*left:\s*auto;/s);
      assert.match(source, /event\?\.key === 'Escape'[\s\S]*setSidebarOpen\(false\)/);
    });

    test('biology notebook result tables do not add an outer framed panel', () => {
      const css = readLocalSource('ui', 'css', 'views', 'biology-notebook-view.css');

      assert.match(css, /\.biology-notebook-result-table-wrap\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
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

    test('Samples side editor reserves its grid gap within the container width', () => {
      const css = readLocalSource('ui', 'css', 'views', 'personal-inventory-view.css');

      assert.match(css, /\.well-editor-shell\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*61\.8fr\)\s+minmax\(0,\s*38\.2fr\);[^}]*gap:\s*14px;/s);
      assert.doesNotMatch(css, /\.well-editor-shell\s*\{[^}]*grid-template-columns:\s*61\.8%\s+38\.2%/s);
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

    test('protocol rail keeps its hover, selected fill, and row dividers on one width', () => {
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const tableRule = /\.protocol-list-scroll\s*>\s*\.list-table\s*\{[^}]*width:\s*calc\(100%\s*\+\s*var\(--protocol-list-row-inline-padding\)\s*\+\s*var\(--protocol-list-row-inline-padding\)\);[^}]*margin-inline:\s*calc\(-1\s*\*\s*var\(--protocol-list-row-inline-padding\)\);[^}]*\}/s;
      const rowRule = /\.protocol-list-row\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*padding:\s*14px\s+var\(--protocol-list-row-inline-padding\);[^}]*\}/s;
      const selectedRule = /\.protocol-list-row-selected\s*\{[^}]*margin-inline:\s*0;[^}]*padding-inline:\s*var\(--protocol-list-row-inline-padding\)\s*!important;[^}]*\}/s;

      assert.match(css, tableRule);
      assert.match(css, rowRule);
      assert.match(css, selectedRule);
    });

    test('protocol rail uses one borderless icon menu for its four sort combinations', () => {
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');

      assert.match(html, /id="protocol-sort-menu-btn"[^>]*aria-label="Sort protocols"[\s\S]*<svg[\s\S]*id="protocol-sort-menu"[\s\S]*data-protocol-sort="time:asc"[\s\S]*data-protocol-sort="time:desc"[\s\S]*data-protocol-sort="name:asc"[\s\S]*data-protocol-sort="name:desc"/);
      assert.doesNotMatch(html, /id="protocol-sort-(?:field|order)-btn"/);
      assert.match(css, /\.protocol-sort-menu-btn\.ghost-btn\s*\{[^}]*border:\s*0;/s);
    });

    test('protocol viewer uses three borderless icon actions with accessible labels', () => {
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');

      assert.match(html, /class="form-actions protocol-viewer-actions"[^>]*aria-label="Protocol actions"/);
      assert.match(html, /id="protocol-view-edit-btn"[^>]*class="ghost-btn protocol-viewer-icon-btn"[^>]*aria-label="Edit protocol"[^>]*title="Edit protocol"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Edit protocol<\/span>/);
      assert.match(html, /id="protocol-export-pdf-btn"[^>]*class="ghost-btn protocol-viewer-icon-btn"[^>]*aria-label="Export PDF"[^>]*title="Export PDF"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Export PDF<\/span>/);
      assert.match(html, /id="protocol-print-btn"[^>]*class="ghost-btn protocol-viewer-icon-btn"[^>]*aria-label="Print"[^>]*title="Print"[\s\S]*?<svg[\s\S]*?<span class="sr-only">Print<\/span>/);
      assert.match(css, /\.protocol-viewer-icon-btn\.ghost-btn\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    });

    test('protocol placeholder presets keep the selected bar visibly active', () => {
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const controller = [
        readLocalSource('src', 'renderer', 'modules', 'protocol', 'index.js'),
        readLocalSource('src', 'renderer', 'modules', 'protocol', 'editor-actions.js')
      ].join('\n');

      assert.match(html, /data-protocol-placeholder-preset="plasmid" aria-pressed="false"/);
      assert.match(css, /\.protocol-placeholder-preset\.is-active,[\s\S]*\.protocol-placeholder-preset\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--theme-accent\);/);
      assert.match(controller, /function setActivePlaceholderPreset\(placeholderName = ''\)[\s\S]*classList\.toggle\('is-active', isActive\)[\s\S]*setAttribute\('aria-pressed', String\(isActive\)\)/);
    });

    test('Protocols does not expose the retired share function', () => {
      const html = readLocalSource('ui', 'html', 'views', 'protocol-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'protocol-management-view.css');
      const list = readLocalSource('src', 'renderer', 'modules', 'protocol', 'list.js');
      const controller = [
        readLocalSource('src', 'renderer', 'modules', 'protocol', 'index.js'),
        readLocalSource('src', 'renderer', 'modules', 'protocol', 'editor-actions.js')
      ].join('\n');
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
      const sequenceCss = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      const toolbarRule = sequenceCss.match(/\.sequence-viewer-cloning-design-toolbar\s*\{([^}]*)\}/)?.[1] || '';

      assert.match(sequenceDetailHtml, /class="sequence-viewer-cloning-design-toolbar"[\s\S]*class="sequence-viewer-cloning-design-toolbar-nav"[\s\S]*id="sequence-viewer-cloning-design-back-btn"[\s\S]*class="sequence-viewer-cloning-design-toolbar-main"[\s\S]*id="sequence-viewer-cloning-design-run-btn"/);
      assert.match(toolbarRule, /position:\s*relative/);
      assert.match(toolbarRule, /z-index:\s*1/);
    });

    test('Vector Builder uses a compact Back button with its destination preserved for accessibility', () => {
      const sequenceDetailHtml = readLocalSource('ui', 'html', 'views', 'sequence-viewer-detail-view.html');

      assert.match(sequenceDetailHtml, /id="sequence-viewer-vector-builder-back-btn"[^>]*aria-label="Back to Sequence Viewer"[^>]*>&larr; Back<\/button>/);
      assert.doesNotMatch(sequenceDetailHtml, /id="sequence-viewer-vector-builder-back-btn"[^>]*>Back to Sequence Viewer<\/button>/);
    });

    test('sequence viewer detail toolbar contains controls, not inline status text', () => {
      const sequenceDetailHtml = readLocalSource('ui', 'html', 'views', 'sequence-viewer-detail-view.html');
      const toolbarMatch = sequenceDetailHtml.match(/<div class="form-actions sequence-viewer-detail-toolbar">([\s\S]*?)<\/div>\s*<label class="sequence-viewer-hidden-control"/);
      const toolbar = toolbarMatch?.[1] || '';

      assert.match(toolbar, /id="sequence-viewer-load-btn"[\s\S]*id="sequence-viewer-annotate-btn"[\s\S]*id="sequence-viewer-recognize-backbone-btn"/);
      assert.match(toolbar, /id="sequence-viewer-recognize-backbone-btn"[^>]*>[\s\S]*?<\/button>\s*<div class="sequence-viewer-menu-anchor">\s*<button id="sequence-viewer-alignment-menu-btn"/);
      assert.match(toolbar, /id="sequence-viewer-orf-menu-btn"/);
      assert.doesNotMatch(toolbar, /id="sequence-viewer-status"|sequence-viewer-status-note/);
    });

    test('sequence viewer primary actions pair accessible icons with visible captions', () => {
      const homeHtml = readLocalSource('ui', 'html', 'views', 'sequence-viewer-view.html');
      const detailHtml = readLocalSource('ui', 'html', 'views', 'sequence-viewer-detail-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      const iconButtonCaptions = {
        'sequence-viewer-detail-new-btn': 'New',
        'sequence-viewer-detail-open-btn': 'Open',
        'sequence-viewer-vector-builder-btn': 'Vector Builder',
        'sequence-viewer-annotate-btn': 'Annotate',
        'sequence-viewer-recognize-backbone-btn': 'Recognize',
        'sequence-viewer-alignment-menu-btn': 'Alignment',
        'sequence-viewer-orf-menu-btn': 'ORF',
        'sequence-viewer-cutter-menu-btn': 'Cutters'
      };

      Object.entries(iconButtonCaptions).forEach(([id, caption]) => {
        assert.match(detailHtml, new RegExp(`id="${id}"[^>]*class="[^"]*sequence-viewer-icon-btn[^"]*"[^>]*aria-label="[^"]+"[^>]*>[\\s\\S]*?<svg[\\s\\S]*?<span class="sequence-viewer-button-caption">${caption}<\\/span>`));
      });
      assert.match(homeHtml, /id="sequence-viewer-home-paste-btn"[^>]*sequence-viewer-icon-btn[^>]*aria-label="New sequence"[\s\S]*?<span class="sequence-viewer-button-caption">New<\/span>/);
      assert.match(homeHtml, /id="sequence-viewer-home-open-btn"[^>]*sequence-viewer-icon-btn[^>]*aria-label="Open sequence"[\s\S]*?<span class="sequence-viewer-button-caption">Open<\/span>/);
      assert.match(homeHtml, /id="sequence-viewer-home-vector-builder-btn"[^>]*sequence-viewer-icon-btn[^>]*aria-label="Vector Builder"[\s\S]*?<span class="sequence-viewer-button-caption">Vector Builder<\/span>/);
      assert.match(detailHtml, /class="sequence-viewer-inline-toggle"[^>]*title="Show primer binding sites[^\"]*"[\s\S]*id="sequence-viewer-primers-toggle"[\s\S]*<span>Primers<\/span>/);
      assert.match(css, /\.sequence-viewer-icon-btn\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*auto;[^}]*height:\s*34px;/s);
      assert.match(css, /\.sequence-viewer-button-caption\s*\{[^}]*font-size:\s*0\.78rem;/s);
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
      assert.match(html, /id="workflow-entry-template-btn"[^>]*workflow-entry-template-icon-btn[^>]*aria-label="Template editor"[^>]*>[\s\S]*?<svg[\s\S]*?<span class="sr-only">Template editor<\/span>/);
      assert.doesNotMatch(html, /workflow-entry-view-btn|Workflow Board/);
      assert.match(renderer, /workflowEntryPanel\.hidden\s*=\s*false;/);
      assert.match(renderer, /workflowEntryTemplateBtn\.hidden\s*=\s*!showHome;/);
      assert.match(renderer, /workflowEntryBackBtn\.hidden\s*=\s*showHome;/);
    });

    test('Workflow graph editor omits redundant interaction instructions', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');

      assert.match(html, /<h3>Graph Editor<\/h3>[\s\S]*id="workflow-graph-canvas"/);
      assert.doesNotMatch(html, /Drag blocks to arrange\. Hover the top-left corner of a block to delete it\./);
    });

    test('Workflow graph selection omits redundant group-drag status copy', () => {
      const graphController = [
        readLocalSource('src', 'renderer', 'modules', 'workflow', 'graph-controller.js'),
        readLocalSource('src', 'renderer', 'modules', 'workflow', 'graph', 'rendering.js'),
        readLocalSource('src', 'renderer', 'modules', 'workflow', 'graph', 'pointer-drag.js')
      ].join('\n');

      assert.doesNotMatch(graphController, /block\(s\) selected\. Drag any selected block to move the group\./);
      assert.match(graphController, /Tip: Drag blocks\. Output dot -> input dot to connect\./);
    });

    test('Workflow execution omits redundant template and workflow-count copy', () => {
      const html = readLocalSource('ui', 'html', 'views', 'workflow-management-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'workflow-management-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'workflow', 'dom.js');
      const renderer = [
        readLocalSource('src', 'renderer', 'modules', 'workflow', 'renderer.js'),
        readLocalSource('src', 'renderer', 'modules', 'workflow', 'renderer', 'workflow-table-markup.js')
      ].join('\n');

      assert.doesNotMatch(html, /Template Workflows|workflow-execution-status/);
      assert.doesNotMatch(dom, /workflowExecutionStatus/);
      assert.doesNotMatch(renderer, /specific workflow.*created from this template/);
      assert.doesNotMatch(renderer, /% complete/);
      assert.match(renderer, /Use Add Workflow to create one\./);
      assert.match(renderer, /aria-label="Workflow name"[\s\S]*data-workflow-run-name=/);
      assert.match(html, /id="workflow-add-run-btn"[^>]*workflow-execution-icon-btn[^>]*aria-label="Add workflow"[^>]*>[\s\S]*?<svg[\s\S]*?<span class="sr-only">Add workflow<\/span>/);
      assert.match(html, /id="workflow-delete-run-btn"[^>]*workflow-execution-icon-btn[^>]*aria-label="Delete workflow"[^>]*>[\s\S]*?<svg[\s\S]*?<span class="sr-only">Delete workflow<\/span>/);
      assert.match(css, /\.workflow-execution-actions\s*>\s*\.workflow-execution-icon-btn\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*padding:\s*0;/s);
      assert.match(css, /\.workflow-entry-name-field input\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
      assert.match(css, /\.workflow-entry-name-field input:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--theme-focus\);/s);
    });

    test('Workflow placeholder popover uses the table as its only frame', () => {
      const css = readLocalSource('ui', 'css', 'views', 'workflow-management-view.css');

      assert.match(css, /\.workflow-step-popover:has\(>\s*\.workflow-placeholder-table\)\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
      assert.match(css, /\.workflow-placeholder-table\s*\{[^}]*border:\s*1px solid var\(--theme-border\);/s);
    });

    test('Protein Builder uses the active DNA source instead of manual POI fields', () => {
      const html = readLocalSource('ui', 'html', 'views', 'sequence-viewer-view.html');
      const dom = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'dom.js');
      const context = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'controller-context.js');
      const source = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'protein-builder', 'record-dna.js');

      assert.match(html, /CurrentDNA/);
      assert.doesNotMatch(html, /Build a linear fusion|Linear chain:|protein-builder-vector-target/);
      assert.doesNotMatch(html, /protein-builder-poi-(?:name|sequence)|protein-builder-add-poi-btn|POI Name|Add POI Block/);
      assert.doesNotMatch(dom, /proteinBuilderPoi(?:Name|Sequence)Input|proteinBuilderAddPoiBtn/);
      assert.match(context, /activeDnaSource:\s*ctx\.getCurrentDnaSource\(\)/);
      assert.match(source, /export function resolvePoiSourceFromRecord\(record, selectedFeature = null\)/);
      assert.match(source, /reusedSource: `Reused active DNA from \$\{sourceDescription\}\.`/);
    });

    test('Assay result actions use accessible compact icons', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const chartTextControls = readLocalSource('src', 'renderer', 'modules', 'assay', 'plotly', 'chart-text-controls.js');

      assert.match(html, /id="assay-attach-result-file-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Attach result file"[^>]*data-hover-caption="Attach result file"[\s\S]*?<svg/);
      assert.match(html, /id="assay-save-results-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Save results"[^>]*data-hover-caption="Save results"[\s\S]*?<svg/);
      assert.match(html, /id="assay-transform-open-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Transform plate"[^>]*data-hover-caption="Transform plate"[\s\S]*?<svg/);
      assert.match(html, /id="assay-clear-results-btn"[^>]*assay-results-icon-btn[^>]*aria-label="Clear results"[^>]*data-hover-caption="Clear results"[\s\S]*?<svg/);
      assert.doesNotMatch(html, /id="assay-(?:attach-result-file|save-results|clear-results)-btn"[^>]*>\s*(?:Attach Result File|Save Results|Clear Results)\s*<\//);
      assert.match(css, /\.assay-results-actions\s*>\s*\.assay-results-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
      assert.match(css, /#assay-view button\[data-hover-caption\]::after\s*\{[^}]*content:\s*attr\(data-hover-caption\);[^}]*top:\s*calc\(100% \+ 7px\);[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;/s);
      assert.match(css, /#assay-view button\[data-hover-caption\]:hover::after,\s*#assay-view button\[data-hover-caption\]:focus-visible::after\s*\{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;/s);
      assert.match(chartTextControls, /btn\.setAttribute\('aria-label', tooltip\);\s*btn\.setAttribute\('data-hover-caption', tooltip\);/s);
      assert.doesNotMatch(chartTextControls, /btn\.title\s*=\s*tooltip/);
    });

    test('Assay action status targets collapse only while empty', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');

      [
        'assay-active-assay-info',
        'assay-result-status',
        'assay-transform-summary',
        'assay-analysis-selection-status',
        'assay-analysis-summary'
      ].forEach((id) => assert.match(html, new RegExp(`id="${id}"[^>]*small-note`)));
      assert.match(
        css,
        /#assay-active-assay-info:empty,\s*#assay-result-status:empty,\s*#assay-transform-summary:empty,\s*#assay-analysis-selection-status:empty,\s*#assay-analysis-summary:empty\s*\{[^}]*display:\s*none;/s
      );
      assert.doesNotMatch(css, /#assay-(?:active-assay-info|result-status|transform-summary|analysis-selection-status|analysis-summary)\s*\{[^}]*display:\s*none;/s);
    });

    test('Assay grouping actions use one compact accessible icon toolbar', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const resultsManager = [
        readLocalSource('src', 'renderer', 'modules', 'assay', 'results-manager.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'results', 'analysis-groups.js')
      ].join('\n');
      const analysisView = readLocalSource('src', 'renderer', 'modules', 'assay', 'analysis-view.js');

      assert.match(html, /class="form-actions assay-analysis-group-actions"[^>]*role="group"[^>]*aria-label="Grouping actions"/);
      assert.match(html, /id="assay-analysis-add-row-group-btn"[^>]*assay-analysis-group-icon-btn[^>]*aria-label="Add selected rows as group"[^>]*data-hover-caption="Add selected rows as group"[\s\S]*?<svg/);
      assert.match(html, /id="assay-analysis-add-column-group-btn"[^>]*assay-analysis-group-icon-btn[^>]*aria-label="Add selected columns as group"[^>]*data-hover-caption="Add selected columns as group"[\s\S]*?<svg/);
      assert.match(html, /id="assay-analysis-clear-groups-btn"[^>]*assay-analysis-group-icon-btn[^>]*aria-label="Clear groups"[^>]*data-hover-caption="Clear groups"[\s\S]*?<svg/);
      assert.doesNotMatch(html, /id="assay-analysis-(?:add-row-group|add-column-group|clear-groups)-btn"[^>]*>\s*(?:Add Selected as (?:Row|Column) Group|Clear Groups)\s*<\//);
      assert.match(css, /\.assay-analysis-group-actions\s*>\s*\.assay-analysis-group-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
      assert.doesNotMatch(html, /assay-analysis-group-name|Replicate Group Name/);
      assert.doesNotMatch(html, /assay-analysis-group-visualization/);
      assert.doesNotMatch(css, /assay-analysis-group-(?:visualization|section|chips|chip|dot|color-)/);
      assert.doesNotMatch(dom, /assayAnalysisGroupNameInput|assayAnalysisGroupVisualization/);
      assert.doesNotMatch(resultsManager, /assayAnalysisGroupNameInput|assayAnalysisGroupVisualization|buildAnalysisGroupSection|assay-analysis-group-chip|Drag across result-table cells|Added "\$\{groupName\}"/);
      assert.match(resultsManager, /const groupName = nextGroupName\(dimension\);/);
      assert.doesNotMatch(analysisView, /Analysing the transformed plate/);
    });

    test('Assay Analyze uses the same searchable Existing Assays browser as Setup', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const foldableCss = readLocalSource('ui', 'css', 'components', 'foldable-section.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const browserView = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'browser-view.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');

      // The Analyze rail is one scroller of foldable sections: nothing is pinned.
      assert.match(html, /class="assay-results-rail-scroll left-rail-template__scroll"[\s\S]*?id="assay-results-browser-panel"[^>]*foldable-section[^>]*open[\s\S]*?Existing Assays[\s\S]*?id="assay-results-search"[\s\S]*?id="assay-results-list"[^>]*assay-browser-list[\s\S]*?id="assay-analysis-panel"[\s\S]*?id="assay-chart-format-panel"[\s\S]*?id="assay-chart-style-panel"/);
      assert.match(html, /id="assay-results-assay-select" hidden/);
      assert.doesNotMatch(html, /assay-results-controls-pinned|left-rail-template__pinned"[^>]*data-assay-rail-page/);
      assert.match(css, /\.assay-results-controls-panel > \.assay-results-rail-scroll\.left-rail-template__scroll\s*\{[^}]*overflow-y:\s*auto !important;[^}]*scrollbar-gutter:\s*stable;/s);
      assert.match(html, /<span class="sr-only">Search Assays<\/span>\s*<input id="assay-search"/);
      assert.match(html, /<span class="sr-only">Search Assays<\/span>\s*<input id="assay-results-search"/);
      assert.doesNotMatch(html, /<label>\s*Search Assays\s*<input id="assay-(?:results-)?search"/);
      assert.match(css, /#assay-search,\s*#assay-results-search\s*\{[^}]*height:\s*var\(--left-rail-item-min-height,\s*36px\);[^}]*min-height:\s*var\(--left-rail-item-min-height,\s*36px\);/s);
      // All three headline sections are <details> the user can fold away.
      ['assay-results-browser-panel', 'assay-analysis-panel', 'assay-chart-format-panel'].forEach((id) => {
        assert.match(html, new RegExp(`<details id="${id}"[^>]*foldable-section`), `${id} should use the shared foldable section`);
      });
      assert.match(foldableCss, /\.foldable-section\s*\{[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid[^}]*border-radius:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
      assert.match(foldableCss, /\.foldable-section__summary::before\s*\{[^}]*left:\s*-8px;[^}]*width:\s*3px;[^}]*background:\s*var\(--theme-accent\);[^}]*opacity:\s*0;/s);
      assert.match(foldableCss, /\.foldable-section__summary:focus-visible\s*\{[^}]*outline:\s*none;/s);
      assert.match(foldableCss, /\.foldable-section__summary:focus-visible::before\s*\{[^}]*opacity:\s*1;/s);
      assert.doesNotMatch(css, /\.assay-rail-section|\.assay-rail-subsection/);
      assert.match(dom, /assayResultsList:\s*root\.getElementById\('assay-results-list'\)/);
      assert.match(browserView, /data-assay-results-select=/);
      assert.match(bindings, /assayResultsList\?\.addEventListener\('click',\s*onListClick\)/);

      const workflowIds = [
        'assay-results-list',
        'assay-result-file-input',
        'assay-analysis-add-row-group-btn',
        'assay-analysis-group-by',
        'assay-analysis-kind',
        'assay-chart-format-panel',
        'assay-chart-style-panel'
      ];
      const workflowPositions = workflowIds.map((id) => html.indexOf(`id="${id}"`));
      assert.equal(workflowPositions.every((position) => position >= 0), true);
      assert.equal(workflowPositions.every((position, index) => index === 0 || position > workflowPositions[index - 1]), true);
      // Inside Data Analysis every block is a subsection fold, gel-style, not a flat label stack.
      ['assay-result-data-panel', 'assay-groups-panel', 'assay-analysis-settings-panel']
        .forEach((id) => assert.match(
          html,
          new RegExp(`<details id="${id}"[^>]*foldable-section foldable-section--subsection`),
          `${id} should be a foldable subsection`
        ));
      assert.doesNotMatch(html, /assay-display-label">(?:Result Data|Groups \(optional\))</);
      // The workspace plate panels share the same component instead of a private fold style.
      ['assay-result-table-panel', 'assay-derived-plate-panel'].forEach((id) => assert.match(
        html,
        new RegExp(`<details id="${id}"[^>]*foldable-section`),
        `${id} should use the shared foldable section`
      ));
      assert.doesNotMatch(html, /assay-analyze-results-btn|Analyze Results/);
      assert.doesNotMatch(dom, /assayAnalyzeResultsBtn/);
      assert.doesNotMatch(bindings, /onAnalyzeResults/);
    });

    test('Assay chart formatting is a toolbar plus a tabbed rail page, not a stack of fieldsets', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const foldableCss = readLocalSource('ui', 'css', 'components', 'foldable-section.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const controls = [
        readLocalSource('src', 'renderer', 'modules', 'assay', 'plotly', 'chart-controls.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'plotly', 'chart-controls-markup.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'plotly', 'chart-controls-form.js')
      ].join('\n');
      const toolbar = readLocalSource('src', 'renderer', 'modules', 'assay', 'plotly', 'chart-toolbar.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');

      // The toolbar sits with the figure it changes, above the analysis output.
      assert.match(html, /class="assay-results-output-stage"[\s\S]*?id="assay-chart-toolbar"[\s\S]*?id="assay-analysis-table"/);
      assert.match(dom, /assayChartToolbarMount:\s*root\.getElementById\('assay-chart-toolbar'\)/);

      // Format is a foldable rail section, reachable whether or not a chart exists.
      assert.match(html, /<details id="assay-chart-format-panel"[\s\S]*?Chart Format[\s\S]*?id="assay-chart-style-panel"/);
      assert.match(dom, /assayChartFormatPanel:\s*root\.getElementById\('assay-chart-format-panel'\)/);
      // The panel has no back button of its own; the fold's summary is its header.
      assert.doesNotMatch(controls, /assay-chart-style-back|data-cc="backBtn"/);

      // Five tabs replace the thirteen always-open fieldsets.
      ['data', 'axes', 'series', 'style', 'text'].forEach((tab) => {
        assert.match(controls, new RegExp(`id: '${tab}'`), `expected a ${tab} tab`);
        assert.match(controls, new RegExp(`data-cc-panel="${tab}"`), `expected a ${tab} panel`);
      });
      assert.doesNotMatch(controls, /<details|<fieldset|<legend/);
      assert.match(controls, /data-cc="resetTabBtn"/);

      // Controls that cannot affect the current figure are marked, not left inert.
      assert.match(controls, /data-cc-when="bar"/);
      assert.match(controls, /data-cc-when="line"/);
      assert.match(controls, /data-cc-needs="errorBars"/);

      // The three column pickers that had no UI now have one.
      ['xColumn', 'yColumn', 'seriesColumn'].forEach((key) => {
        assert.match(controls, new RegExp(`data-cc="${key}"`), `expected a ${key} picker`);
      });

      // Chart type and export existed nowhere before.
      assert.match(toolbar, /data-tb-chart-type="bar"/);
      assert.match(toolbar, /data-tb="exportSvg"/);

      assert.match(css, /\.assay-chart-toolbar\s*\{[^}]*display:\s*flex;/s);
      assert.match(css, /\.assay-chart-style-tabs button\[aria-selected="true"\]\s*\{/);
      assert.match(foldableCss, /\.foldable-section\s*\{[^}]*border-bottom:\s*1px solid var\(--app-left-rail-divider,/s);
    });

    test('Assay plate transform creates a formula grid with the result-table layout and is saved', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');
      const assay = [
        readLocalSource('src', 'renderer', 'modules', 'assay', 'index.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'workspace', 'form-and-list.js')
      ].join('\n');
      const analysis = [
        readLocalSource('src', 'renderer', 'modules', 'assay', 'analysis-view.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'analysis-view', 'derived-plate-grid.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'analysis-view', 'chart-surface.js')
      ].join('\n');
      const derived = readLocalSource('src', 'renderer', 'modules', 'assay', 'derived-plate', 'plate-formulas.js');
      const resultsManager = readLocalSource('src', 'renderer', 'modules', 'assay', 'results-manager.js');
      const spreadsheetTables = readLocalSource('src', 'renderer', 'lib', 'spreadsheet-tables.js');
      const referencePicker = readLocalSource('src', 'renderer', 'lib', 'spreadsheet-reference-picker.js');
      const storage = readLocalSource('src', 'renderer', 'modules', 'assay', 'artifact-storage.js');

      // The action creates a second grid beneath Plate Results; there is no separate
      // global-formula or guided-steps dialog.
      assert.match(html, /id="assay-result-data-panel"[\s\S]*?id="assay-transform-open-btn"/);
      assert.match(html, /id="assay-result-table-panel"[\s\S]*?id="assay-derived-plate-panel"[^>]*hidden/);
      assert.match(html, /id="assay-result-table-panel"[\s\S]*?>Plate Results \(Table1\)</);
      assert.match(html, /id="assay-derived-plate-panel"[\s\S]*?>Transformed Plate \(Table2\)<[\s\S]*?id="assay-derived-plate-table"/);
      assert.match(html, /<summary class="foldable-section__summary">\s*<span>Transformed Plate \(Table2\)<\/span>\s*<button[^>]*id="assay-transform-clear-btn"[\s\S]*?<\/button>\s*<\/summary>/);
      assert.match(html, /id="assay-transform-clear-btn"[^>]*assay-transform-remove-icon-btn[^>]*row-action-icon-btn-danger[^>]*aria-label="Remove transformed plate"[^>]*data-hover-caption="Remove transformed plate"[\s\S]*?<svg/);
      assert.match(css, /\.assay-result-table-panel\s*>\s*\.foldable-section__summary\s*>\s*\.assay-transform-remove-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
      assert.doesNotMatch(html, /assay-transformed-plate-intro/);
      assert.doesNotMatch(html, /assay-transform-overlay|assay-transform-mode|assay-transform-formula/);
      assert.match(dom, /assayDerivedPlatePanel:\s*root\.getElementById\('assay-derived-plate-panel'\)/);
      assert.match(bindings, /assayTransformOpenBtn\?\.addEventListener\('click',\s*analysisView\.createTransformPlate\)/);
      assert.match(bindings, /analysisView\.redrawTransformGrid\(\)/);

      // Both tables are built from the same column, data, signature, and height
      // builders. Point-mode clicks qualify their table so formulas can mix sources.
      assert.match(resultsManager, /buildResultGridColumns,/);
      assert.match(analysis, /buildResultGridColumns\(def,\s*\{ formatter: formatTransformCell \}\)/);
      assert.match(analysis, /buildResultGridData\(def,\s*transformFormulas\)/);
      assert.match(analysis, /getTransformFormulas\(\)\[well\]\s*=\s*`=Table1:\$\{well\}`/);
      assert.match(analysis, /tableName\s*=\s*tableRoot === assayResultTable \? 'Table1' : 'Table2'/);
      assert.match(analysis, /createSpreadsheetReferencePicker\(\{/);
      assert.match(spreadsheetTables, /createSpreadsheetReferencePicker\(\{/);
      assert.match(spreadsheetTables, /computeNotebookResultTables\(draftTables\)/);
      assert.match(referencePicker, /applyReferencePick\(\{/);
      assert.match(derived, /Bare references and Table1[\s\S]*Table2 reads computed cells/);
      assert.match(derived, /applyPlateCellFormulas/);

      // Persisted with the assay, restored on load, and carried through a Setup save.
      assert.match(assay, /activeAssay\.transformSpec\s*=\s*spec;/);
      assert.match(assay, /analysisView\.loadTransformSpec\(assay\.transformSpec\)/);
      assert.match(assay, /transformSpec:\s*existing\?\.transformSpec\s*\|\|\s*null/);
      assert.match(assay, /chartStyle:\s*existing\?\.chartStyle\s*\|\|\s*null/);
      assert.match(storage, /transformSpec:\s*assay\.transformSpec\s*\|\|\s*null/);
    });

    test('Assay setup actions stay at the top of the form as accessible compact icons', () => {
      const html = readLocalSource('ui', 'html', 'views', 'assay-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'assay-view.css');
      const dom = readLocalSource('src', 'renderer', 'modules', 'assay', 'dom.js');
      const bindings = readLocalSource('src', 'renderer', 'modules', 'assay', 'ui', 'event-bindings.js');
      const assay = [
        readLocalSource('src', 'renderer', 'modules', 'assay', 'index.js'),
        readLocalSource('src', 'renderer', 'modules', 'assay', 'workspace', 'form-and-list.js')
      ].join('\n');

      assert.match(html, /id="assay-form"[^>]*>[\s\S]*?id="assay-id"[\s\S]*?class="form-actions assay-form-actions"[\s\S]*?class="assay-display-field"/);
      assert.match(html, /id="assay-new-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Create new assay"[^>]*data-hover-caption="Create new assay"[\s\S]*?<svg/);
      assert.match(html, /id="assay-export-template-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Export CSV template"[^>]*data-hover-caption="Export CSV template"[\s\S]*?<svg/);
      assert.match(html, /id="assay-import-template-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Import CSV"[^>]*data-hover-caption="Import CSV"[\s\S]*?<svg/);
      assert.match(html, /id="assay-save-btn"[^>]*type="submit"[^>]*assay-form-save-icon-btn[^>]*aria-label="Save assay"[\s\S]*?<svg[\s\S]*?<span class="assay-form-button-caption">Save<\/span>/);
      assert.match(html, /id="assay-cancel-btn"[^>]*assay-form-icon-btn[^>]*aria-label="Cancel edit"[^>]*data-hover-caption="Cancel edit"[\s\S]*?<svg/);
      assert.doesNotMatch(html, /id="assay-(?:export-template|import-template|cancel)-btn"[^>]*>\s*(?:Export CSV Template|Import CSV|Cancel Edit)\s*<\//);
      assert.match(css, /\.assay-form-actions\s*>\s*\.assay-form-icon-btn\s*\{[^}]*width:\s*34px;[^}]*height:\s*34px;/s);
      assert.match(css, /\.assay-form-actions\s*>\s*\.assay-form-save-icon-btn\.primary-btn\s*\{[^}]*width:\s*auto;[^}]*min-width:\s*72px;/s);
      assert.match(css, /\.assay-form-button-caption\s*\{[^}]*font-size:\s*0\.78rem;/s);
      assert.match(dom, /assaySaveBtn:\s*root\.getElementById\('assay-save-btn'\)/);
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

    // A served plugin's frame loads from http://127.0.0.1:<random port>. With
    // `frame-src 'self' blob:` the browser blocks that outright and the plugin
    // view renders as an empty pane — no error, no console message, nothing to
    // debug from. The permission checks, the sandbox string, and the plugin
    // server were all correct while served plugins simply did not run, so the
    // one line that made them possible is asserted here.
    test('the app CSP admits the loopback origin served plugins run on', () => {
      for (const source of [
        readLocalSource('ui', 'html', 'shell', 'start.html'),
        readLocalSource('index.html')
      ]) {
        // Anchored on the directive itself — the comment above it also says
        // "frame-src", and matching that would assert nothing.
        const frameSrc = (source.match(/frame-src\s+('self'[^;]*);/) || [])[1] || '';
        assert.match(frameSrc, /http:\/\/127\.0\.0\.1:\*/, 'served plugins need loopback http in frame-src');
        assert.match(frameSrc, /'self'/, 'the app still frames its own pages');
        assert.doesNotMatch(frameSrc, /\shttps:(\s|$)/, 'remote plugins are not enabled: that is a separate decision');
      }
    });

    test('gel tools omit manual steps and keep ladder MW in analysis controls', () => {
      const gelView = readLocalSource('src', 'plugins', 'gel', 'vendor', 'gel-view.html');
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
      const agentViewHtml = readLocalSource('ui', 'html', 'views', 'agent-view.html');
      const agentViewCss = readLocalSource('ui', 'css', 'views', 'agent-view.css');
      const agentShellControllerSource = readLocalSource('src', 'renderer', 'modules', 'agent-chat', 'shell-controller.js');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const generatedRegistry = readLocalSource('src', 'renderer', 'modules', 'app-registry.generated.js');
      const rendererShellSource = readRendererShellSource();
      const moduleRuntimeSource = readRendererModuleRuntimeSource();
      const domBindingsSource = readLocalSource('src', 'renderer', 'modules', 'agent-chat', 'dom-bindings.js');
      const coreCss = fs.readFileSync(path.join(__dirname, 'ui', 'css', 'base', 'core.css'), 'utf8');

      assert.match(html, /id="universal-agent-chat-rail"/);
      assert.match(html, /id="agent-chat-rail-toggle-btn"/);
      assert.match(html, /id="agent-rail-chat-history"/);
      assert.match(html, /class="agent-conversation-shell universal-agent-chat-rail__conversation is-empty-chat"/);
      assert.match(agentViewHtml, /class="agent-conversation-shell is-empty-chat"/);
      assert.match(agentViewCss, /\.agent-chat-stage\s*>\s*\.agent-conversation-shell\s*\{[^}]*grid-row:\s*2;/s);
      assert.match(agentShellControllerSource, /classList\?\.toggle\('is-empty-chat', !hasMessages\)/);
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

    test('renderer routes Samples directly to the container workspace', () => {
      const source = readRendererShellSource();
      const moduleRuntimeSource = readRendererModuleRuntimeSource();
      const shellHtml = readLocalSource('ui', 'html', 'shell', 'start.html');
      const registry = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'config', 'app-registry.json'), 'utf8'));
      const sampleEntry = registry.apps.find((app) => app.id === 'sample-inventory');
      assert.match(source, /function normalizeViewId\(VIEWS, viewId\)\s*\{\s*return viewId === VIEWS\.PERSONAL_INVENTORY \? VIEWS\.SAMPLE_REGISTRY : viewId;\s*\}/);
      assert.ok(sampleEntry);
      assert.ok(sampleEntry.aliases.includes('inventory'));
      assert.equal(sampleEntry.searchInputId, '');
      assert.match(source, /const searchScopeTargets = buildSearchScopeMap\(\{\s*apps: APP_REGISTRY,/);
      assert.match(source, /const showContainerWorkspace = nextView === VIEWS\.SAMPLE_REGISTRY;/);
      assert.match(source, /showContainerWorkspace\s*\? view\.id === VIEWS\.PERSONAL_INVENTORY\s*: view\.id === nextView/);
      assert.match(source, /const personalInventoryTarget = \{[\s\S]*viewId: VIEWS\.PERSONAL_INVENTORY,[\s\S]*label: 'Containers'/);
      assert.match(source, /moduleRuntime\.renderView\(nextView\);/);
      assert.match(moduleRuntimeSource, /key:\s*'sampleRegistry'[\s\S]*viewKey:\s*'SAMPLE_REGISTRY'[\s\S]*modules\.personalInventory\.renderSections\(\);/);
      assert.match(moduleRuntimeSource, /key:\s*'personalInventory'[\s\S]*viewKey:\s*'PERSONAL_INVENTORY'[\s\S]*modules\.personalInventory\.renderSections\(\);/);
      assert.match(moduleRuntimeSource, /onSampleRecorded:\s*\(sample\)\s*=>\s*modules\.sampleRegistry\?\.captureRecordedSample\?\.\(sample\)/);
      assert.doesNotMatch(shellHtml, /sample-workspace-samples-btn/);
      assert.doesNotMatch(shellHtml, /sample-workspace-containers-btn/);
      assert.doesNotMatch(source, /sampleWorkspaceSamplesBtn|sampleWorkspaceContainersBtn/);
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

    test('sequence viewer feature bars keep a uniform outline without a bold leading edge', () => {
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      const overviewBar = css.match(/\.sequence-viewer-feature-bar\s*\{([^}]*)\}/)?.[1] || '';
      const lineBar = css.match(/\.sequence-viewer-line-feature-bar\s*\{([^}]*)\}/)?.[1] || '';
      const activeBar = css.match(/\.sequence-viewer-line-feature-active\s*\{([^}]*)\}/)?.[1] || '';

      assert.match(overviewBar, /border:\s*1px solid/);
      assert.match(lineBar, /border-color:/);
      assert.doesNotMatch(overviewBar, /box-shadow:\s*inset/);
      assert.doesNotMatch(lineBar, /box-shadow:\s*inset/);
      assert.doesNotMatch(activeBar, /box-shadow:\s*inset/);
    });

    test('Vector Builder map and sequence panes use clear elevated canvases', () => {
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      const paneRule = css.match(/\.sequence-viewer-vector-builder-map-card,\s*\.sequence-viewer-vector-builder-sequence-card\s*\{([^}]*)\}/)?.[1] || '';

      assert.match(paneRule, /border-color:\s*var\(--theme-border-soft\)/);
      assert.match(paneRule, /background:\s*var\(--theme-surface-elevated\)/);
      assert.doesNotMatch(paneRule, /background:\s*var\(--theme-surface-subtle\)/);
    });

    test('Vector Builder replacement dialog uses search results without redundant guidance or a target selector', () => {
      const html = readLocalSource('ui', 'html', 'views', 'sequence-viewer-detail-view.html');
      const dom = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'dom.js');
      const controller = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'vector-builder', 'controller.js');
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');

      assert.doesNotMatch(html, /sequence-viewer-vector-builder-feature-replace-select|Recorded Feature/);
      assert.doesNotMatch(html, /Search the stored feature database for a replacement\.|Search by feature name or stored sequence\./);
      assert.doesNotMatch(dom, /vectorBuilderFeatureReplaceSelect/);
      assert.doesNotMatch(controller, /vectorBuilderFeatureReplaceSelect|Search the stored feature database for a replacement\.|Search by feature name or stored sequence\.|Found \$\{featureReplaceResults\.length\} stored feature/);
      assert.match(css, /#sequence-viewer-vector-builder-feature-replace-status:empty,\s*#sequence-viewer-vector-builder-feature-replace-results:empty\s*\{[^}]*display:\s*none;/s);
      assert.match(html, /id="sequence-viewer-vector-builder-feature-replace-search"/);
      assert.match(html, /id="sequence-viewer-vector-builder-feature-replace-results"/);
    });

    test('sequence viewer keeps forward and reverse strands closely paired', () => {
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      const constants = readLocalSource('src', 'renderer', 'modules', 'sequence-viewer', 'constants.js');

      assert.match(css, /\.sequence-viewer-strand-pair\s*\{[^}]*gap:\s*2px;/s);
      assert.match(constants, /STRAND_PAIR_ROW_GAP_PX\s*=\s*2;/);
      assert.match(css, /\.sequence-viewer-strand-row-top \.sequence-viewer-seq-highlight[^}]*\{[^}]*border-radius:\s*3px 3px 0 0;/s);
      assert.match(css, /\.sequence-viewer-strand-row-top \.sequence-viewer-seq-highlight[^}]*::after\s*\{[^}]*top:\s*100%;[^}]*height:\s*calc\(2px \+ 0\.14em\);/s);
      assert.match(css, /\.sequence-viewer-strand-row-bottom \.sequence-viewer-seq-highlight[^}]*\{[^}]*border-radius:\s*0 0 3px 3px;/s);
      assert.doesNotMatch(css, /\.sequence-viewer-strand-row-(?:top|bottom) \.sequence-viewer-seq-highlight[^}]*\{[^}]*box-shadow:/s);
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
      assert.match(homeBlock, /id="sequence-viewer-home-vector-builder-btn"/);
      // Protein Builder folds into Vector Builder; it is no longer a home entry point.
      assert.equal(homeBlock.includes('id="sequence-viewer-home-protein-builder-btn"'), false);
      assert.match(homeBlock, /class="sequence-viewer-rail-actions-section left-rail-template__section"/);
      assert.equal(homeBlock.includes('id="sequence-viewer-home-import-btn"'), false);
      assert.match(homeBlock, /id="sequence-viewer-library-filter-saved"/);
      assert.match(homeBlock, /id="sequence-viewer-library-filter-temporary"/);
      assert.match(homeBlock, /id="sequence-viewer-library-list"/);
      assert.match(homeBlock, /id="sequence-viewer-preview-host"/);
      assert.equal(homeBlock.includes('<h2>Sequence Viewer</h2>'), false);
      assert.equal(homeBlock.includes('id="sequence-viewer-preview-meta"'), false);
      assert.equal(homeBlock.includes('id="sequence-viewer-detail-workspace"'), false);

      assert.match(detailBlock, /id="sequence-viewer-detail-workspace"/);
      assert.equal(detailBlock.includes('id="sequence-viewer-back-btn"'), false);
      assert.equal(detailBlock.includes('Back to Library'), false);
      assert.match(detailBlock, /class="sequence-viewer-detail-sidebar[\s\S]*class="sequence-viewer-rail-actions-section left-rail-template__section"[\s\S]*id="sequence-viewer-detail-new-btn"[\s\S]*id="sequence-viewer-detail-open-btn"[\s\S]*id="sequence-viewer-vector-builder-btn"/);
      // The rail's third action stays "Vector Builder" across home and detail so the
      // slot does not appear to rename itself; Protein Builder moved to the toolbar.
      assert.match(homeBlock, /id="sequence-viewer-home-vector-builder-btn"/);
      // Protein Builder folded into Vector Builder: the detail view no longer
      // offers its own entry point.
      assert.equal(detailBlock.includes('id="sequence-viewer-detail-protein-builder-btn"'), false);
      assert.match(detailBlock, /id="sequence-viewer-vector-builder-protein-builder-btn"/);
      assert.equal(detailBlock.includes('id="sequence-viewer-save-btn"'), false);
      assert.equal(detailBlock.includes('id="sequence-viewer-save-name"'), false);
      assert.match(detailBlock, /id="sequence-viewer-detail-library-context-menu"[\s\S]*data-sequence-library-action="rename"/);
      assert.match(homeBlock, /id="sequence-viewer-library-context-menu"[\s\S]*data-sequence-library-action="rename"/);
      assert.match(detailBlock, /id="sequence-viewer-detail-library-context-menu"[\s\S]*data-sequence-library-action="new-folder"/);
      assert.match(homeBlock, /id="sequence-viewer-library-context-menu"[\s\S]*data-sequence-library-action="new-folder"/);
      assert.match(detailBlock, /id="sequence-viewer-annotate-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-recognize-backbone-btn"/);
      assert.match(detailBlock, /id="sequence-viewer-orf-toggle"/);
      assert.match(detailBlock, /id="sequence-viewer-restriction-neb-toggle"/);
      assert.match(detailBlock, /id="sequence-viewer-restriction-thermo-toggle"/);
    });

    test('every tool box tool shares one head and no nested boxes', () => {
      const html = readLocalSource('ui', 'html', 'views', 'tool-box-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'tool-box-view.css');

      const toolViews = html.match(/class="panel tool-subview"/g) || [];
      assert.equal((html.match(/<header class="tool-head">/g) || []).length, toolViews.length);
      assert.equal((html.match(/class="tool-head-note"/g) || []).length, toolViews.length);
      assert.doesNotMatch(html, /class="molarity-view-header"|molarity-kicker|molarity-auto-unit-badge|molarity-step/);
      assert.doesNotMatch(html, /class="stack-form crispr-controls"|colony-counter-controls|class="result-card /);
      assert.match(css, /\.tool-head \{/);
      assert.doesNotMatch(css, /\.crispr-controls \{|\.colony-counter-controls \{/);
    });

    test('molarity calculator uses responsive cards with automatic result states', () => {
      const html = readLocalSource('ui', 'html', 'views', 'tool-box-view.html');
      const css = readLocalSource('ui', 'css', 'views', 'tool-box-view.css');
      const source = readLocalSource('src', 'renderer', 'modules', 'tool-box', 'molarity-ui.js');

      assert.match(html, /class="tool-head"[\s\S]*class="molarity-card-grid"/);
      assert.equal((html.match(/class="molarity-block"/g) || []).length, 4);
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
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
      assert.match(css, /\.sequence-viewer-input-panel\[hidden\]\s*\{\s*display:\s*none !important;/);
    });

    test('sequence viewer detail layout follows the app height and keeps the sequence host scrollable', () => {
      const css = readLocalSource('ui', 'css', 'views', 'sequence-viewer-view.css');
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
      const css = readLocalSource('ui', 'css', 'views', 'papers-view.css');
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
      const papersCss = readLocalSource('ui', 'css', 'views', 'papers-view.css');
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
      assert.match(
        fs.readFileSync(agentPath('tools', 'tool-loading', 'json-args.js'), 'utf8'),
        /function normalizeToolInvocationArgs\(rawArgs\)/
      );
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
      const settingsSource = [
        fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'settings', 'index.js'), 'utf8'),
        fs.readFileSync(path.join(__dirname, 'src', 'renderer', 'modules', 'settings', 'codex-account.js'), 'utf8')
      ].join('\n');
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
