
import { startHikariCore } from './core/start-hikari-core.js';
import { installIconButtonCaptions } from './app/icon-button-captions.js';
import { installDialogLayout } from './app/dialog-layout.js';
import { installSearchFieldLens } from './lib/search-field-lens.js';

installIconButtonCaptions();
installSearchFieldLens();
startHikariCore();
installDialogLayout();
