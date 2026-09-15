// Boots ImageJ inside the plugin frame.
//
// This only works because Hikari serves this folder over http://127.0.0.1:PORT
// ("serve": true in plugin.json). CheerpJ keeps its filesystem in IndexedDB,
// and a plain local plugin is an opaque origin where IndexedDB throws
// SecurityError — cheerpjInit then never resolves. A loopback origin has real
// storage, so it starts.

const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
}

async function boot() {
  if (location.protocol === 'file:') {
    setStatus(
      'This plugin must be served, not opened from disk. Check that plugin.json has "serve": true.',
      true
    );
    return;
  }
  if (typeof cheerpjInit !== 'function') {
    setStatus('Could not load the CheerpJ runtime. This plugin needs internet access on first run.', true);
    return;
  }

  try {
    await cheerpjInit({
      enableInputMethods: true,
      clipboardMode: 'java',
      enablePreciseClassLoaders: true,
      disableErrorReporting: true,
      javaProperties: [
        'java.protocol.handler.pkgs=com.leaningtech.handlers',
        'user.dir=/files',
        'plugins.dir=/app/ij153/plugins'
      ]
    });
    cheerpjCreateDisplay(-1, -1, document.getElementById('imagej-container'));
    // /app maps to this plugin's server root, so this is ./ij153/ij-1.53m.jar.
    cheerpjRunMain('ij.ImageJ', '/app/ij153/ij-1.53m.jar');
    statusEl.hidden = true;
  } catch (error) {
    setStatus(
      `ImageJ failed to start: ${error?.message || error}. Did you run ./fetch-imagej.sh?`,
      true
    );
  }
}

boot();
