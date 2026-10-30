import { setShellAttribute } from './lib/i18n/shell.js';

import { startHikariCore } from './core/start-hikari-core.js';
import { installIconButtonCaptions } from './app/icon-button-captions.js';
import { installDialogLayout } from './app/dialog-layout.js';
import { installSearchFieldLens } from './lib/search-field-lens.js';
import { installRendererErrorReporting } from './app/error-reporting.js';

installRendererErrorReporting();
installIconButtonCaptions();
installSearchFieldLens({ bindLabel: lens => setShellAttribute(lens, 'aria-label', 'search.title') });
startHikariCore();
installDialogLayout();
