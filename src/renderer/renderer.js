
import { startHikariCore } from './core/start-hikari-core.js';
import { installIconButtonCaptions } from './app/icon-button-captions.js';
import { installSearchFieldLens } from './lib/search-field-lens.js';

installIconButtonCaptions();
installSearchFieldLens();
startHikariCore();
