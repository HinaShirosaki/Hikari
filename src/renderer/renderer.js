
import { startHikariCore } from './core/start-hikari-core.js';
import { installIconButtonCaptions } from './app/icon-button-captions.js';
import { installDialogLayout } from './app/dialog-layout.js';
import { installSearchFieldLens } from './lib/search-field-lens.js';
import { installRendererErrorReporting } from './app/error-reporting.js';

installRendererErrorReporting();
installIconButtonCaptions();
installSearchFieldLens();
startHikariCore();
installDialogLayout();
