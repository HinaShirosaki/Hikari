import { channelKey, defaultAxes } from './analysis.mjs';
import { initializeFolderAxes } from './axis-settings.mjs';
import { EVENT_FILE_ACCEPT, isEventFileName } from './event-file.mjs';

const $ = id => document.getElementById(id);
const integer = new Intl.NumberFormat();
const demoButtons = ['open-demo', 'rail-demo'];
const openButtons = ['rail-open', 'header-open', 'empty-open', 'open-folder', 'empty-open-folder', ...demoButtons];
const localFileDrag = 'application/x-hikari-fcs-file';
const exampleNames = ['Mixed cells.fcs', 'Unstained.fcs', 'CD19-enriched.fcs'];

async function readExample(name) {
  const response = await fetch(new URL('./examples/CD19 panel/' + name, import.meta.url));
  if (!response.ok) throw new Error('Could not load the bundled example.');
  return new File([await response.arrayBuffer()], name);
}

export function createFileRail({
  analyze, button, importStatus, select, getActiveSample, onOpenSample, onChannelNames,
  canMoveSample, onMoveSample, onFolderAdded, onFolderChange, onCloseSample, onNewLayout
}) {
  const samples = new Map();
  const folders = [];
  const fileInput = $('files-input');
  fileInput.accept = EVENT_FILE_ACCEPT;
  let nextId = 0;
  let nextFolderId = 0;
  let importing = false;
  let dragDepth = 0;
  let importFolder = null;
  let exampleFolder = null;
  let editingScope = null;

  function editChannelNames(scope, name, isFolder) {
    const detectors = new Map([...scope.aliases.keys()].map(key => [key, key]));
    for (const sample of samples.values()) {
      if (sample.scope !== scope) continue;
      for (const { name: detector } of sample.channels) detectors.set(channelKey(detector), detector);
    }
    const list = $('channel-alias-list');
    list.replaceChildren();
    for (const [key, detector] of [...detectors].sort((a, b) => a[1].localeCompare(b[1]))) {
      const row = document.createElement('label');
      const text = document.createElement('span');
      text.textContent = detector;
      text.title = detector;
      const input = document.createElement('input');
      input.type = 'text';
      input.name = key;
      input.maxLength = 100;
      input.value = scope.aliases.get(key) ?? '';
      input.setAttribute('aria-label', 'Alias for ' + detector);
      row.append(text, input);
      list.append(row);
    }
    $('channel-alias-scope').textContent = isFolder
      ? `Applies to every file in ${name}.`
      : `Applies to ${name}.`;
    $('channel-alias-empty').hidden = detectors.size > 0;
    $('save-channel-aliases').disabled = detectors.size === 0;
    editingScope = scope;
    $('channel-alias-dialog').showModal();
    list.querySelector('input')?.focus();
  }

  const aliasDialog = $('channel-alias-dialog');
  $('edit-channel-names').addEventListener('click', () => {
    const sample = getActiveSample();
    if (sample) editChannelNames(sample.scope, sample.folder?.name ?? sample.name, Boolean(sample.folder));
  });
  $('cancel-channel-aliases').addEventListener('click', () => aliasDialog.close());
  aliasDialog.addEventListener('close', () => {
    if (!aliasDialog.open) editingScope = null;
  });
  $('channel-alias-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!editingScope) return;
    const scope = editingScope;
    scope.aliases = new Map([...$('channel-alias-list').querySelectorAll('input')]
      .map(input => [input.name, input.value.trim()]).filter(([, alias]) => alias));
    aliasDialog.close();
    onChannelNames(scope);
  });

  function createFolder(name) {
    const item = document.createElement('li');
    item.className = 'folder-item';
    const row = document.createElement('div');
    row.className = 'folder-row';
    const list = document.createElement('ul');
    list.className = 'folder-list';
    const id = String(++nextFolderId);
    list.id = `fcs-folder-${id}`;
    const folder = { id, name, list, layouts: [], definitions: [], nextGate: 0, aliases: new Map() };
    folders.push(folder);
    const toggle = button('', () => setFolderExpanded(folder, list.hidden), {
      icon: 'folder', label: name, className: 'folder-toggle'
    });
    toggle.title = name;
    const chevron = toggle.firstElementChild.cloneNode(true);
    chevron.classList.add('folder-chevron');
    chevron.firstElementChild.setAttribute('href', '#i-chevron');
    toggle.prepend(chevron);
    const title = document.createElement('span');
    title.className = 'file-name';
    title.textContent = name;
    toggle.append(title);
    toggle.setAttribute('aria-controls', list.id);
    folder.toggle = toggle;
    const add = button('', () => chooseFiles(folder), {
      icon: 'plus', label: 'Add data files to ' + name, className: 'icon-button'
    });
    add.title = add.getAttribute('aria-label');
    const aliases = button('', () => editChannelNames(folder, name, true), {
      icon: 'tag', label: 'Channel names for ' + name, className: 'icon-button'
    });
    aliases.title = aliases.getAttribute('aria-label');
    const layout = button('', () => onNewLayout(folder), {
      icon: 'layout', label: 'New layout in ' + name, className: 'icon-button'
    });
    layout.title = layout.getAttribute('aria-label');
    const empty = document.createElement('li');
    empty.className = 'folder-empty muted';
    empty.textContent = 'No data files';
    list.append(empty);
    folder.empty = empty;
    row.append(toggle, aliases, layout, add);
    item.append(row, list);
    $('file-list').append(item);
    setFolderExpanded(folder, true);
    syncEmptyRail();
    onFolderAdded();

    const accepts = event => [...event.dataTransfer.types].some(type => type === 'Files' || type === localFileDrag);
    item.addEventListener('dragover', event => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes(localFileDrag) ? 'move' : 'copy';
      item.classList.add('is-drop-target');
    });
    item.addEventListener('dragleave', event => {
      if (!(event.relatedTarget instanceof Node) || !item.contains(event.relatedTarget)) {
        item.classList.remove('is-drop-target');
      }
    });
    item.addEventListener('drop', event => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.stopPropagation();
      item.classList.remove('is-drop-target');
      resetFileDrag();
      const sample = samples.get(Number(event.dataTransfer.getData(localFileDrag)));
      if (sample && !sample.folder) {
        if (!canMoveSample(sample, folder)) {
          importStatus('Wait for the gate move to finish before moving a file.', true);
          return;
        }
        for (const [channel, alias] of sample.scope.aliases) {
          if (!folder.aliases.has(channel)) folder.aliases.set(channel, alias);
        }
        initializeFolderAxes(folder, sample);
        sample.folder = folder;
        sample.open.draggable = false;
        addFolderFile(folder, sample.row);
        setFolderExpanded(folder, true);
        onMoveSample(sample, folder);
        onChannelNames(folder);
        onFolderChange(folder);
      } else if (event.dataTransfer.files.length) {
        void openFiles([...event.dataTransfer.files], folder);
      }
    });
    return folder;
  }

  function setFolderExpanded(folder, expanded) {
    folder.list.hidden = !expanded;
    folder.toggle.setAttribute('aria-expanded', String(expanded));
  }

  function addFolderFile(folder, item) {
    folder.list.insertBefore(item, folder.list.querySelector(':scope > .layout-row'));
    folder.empty.hidden = true;
  }

  function addFileRow(sample) {
    const item = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'file-row';
    const open = button('', () => select(sample.id), { icon: 'file', label: 'View ' + sample.name, className: 'file-select' });
    const wrapper = document.createElement('span');
    const name = document.createElement('span');
    const meta = document.createElement('span');
    wrapper.className = 'file-text';
    name.className = 'file-name';
    name.textContent = sample.name;
    open.title = sample.name;
    open.draggable = !sample.folder;
    open.addEventListener('dragstart', event => {
      if (sample.folder) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.setData(localFileDrag, String(sample.id));
      event.dataTransfer.effectAllowed = 'move';
    });
    meta.className = 'file-meta';
    meta.textContent = `${integer.format(sample.count)} events`;
    wrapper.append(name, meta);
    open.append(wrapper);
    const label = 'Close ' + sample.name;
    const close = button('', () => closeFile(sample.id), { icon: 'close', label, className: 'icon-button' });
    close.title = label;
    row.append(open, close);
    const groups = document.createElement('ul');
    groups.className = 'group-list';
    item.append(row, groups);
    sample.row = item;
    sample.open = open;
    sample.groupList = groups;
    open.setAttribute('aria-current', 'false');
    if (sample.folder) {
      addFolderFile(sample.folder, item);
    } else {
      $('file-list').append(item);
    }
    syncEmptyRail();
  }

  function syncEmptyRail() {
    const populated = $('file-list').childElementCount > 0;
    $('rail-empty').hidden = populated;
    $('rail-demo').hidden = !populated;
  }

  async function openFiles(files, folder = null) {
    if (!files.length || importing) return;
    importing = true;
    for (const id of openButtons) $(id).disabled = true;
    if (folder) setFolderExpanded(folder, true);
    const failures = [];
    let opened = 0;
    try {
      for (const source of files) {
        const id = ++nextId;
        const example = typeof source === 'string';
        const name = example ? source : source.name;
        importStatus(`Opening ${name}…`);
        try {
          const file = example ? await readExample(name) : source;
          const metadata = await analyze('open', id, { file });
          const axes = defaultAxes(metadata.channels);
          const marker = example ? metadata.channels.findIndex(channel => channelKey(channel.name) === 'B525') : -1;
          if (marker >= 0) axes.y = { channel: marker, scale: 'asinh', auto: true };
          const sample = {
            id, name, ...metadata, axes, gates: [], selectedGate: null, rendered: null,
            folder, scope: folder ?? { definitions: [], nextGate: 0, aliases: new Map() },
            gatesById: new Map(), gateErrors: new Map()
          };
          if (folder) initializeFolderAxes(folder, sample);
          samples.set(id, sample);
          addFileRow(sample);
          onOpenSample(sample);
          if (!opened || !getActiveSample()) select(id);
          opened++;
        } catch (error) {
          failures.push(`${name}: ${error.message}`);
        }
      }
      importStatus(failures.join('\n'), failures.length > 0);
      if (folder && opened > 1) onFolderChange(folder);
    } finally {
      importing = false;
      for (const id of openButtons) $(id).disabled = false;
    }
  }

  function closeFile(id) {
    const ids = Array.from(samples.keys());
    const index = ids.indexOf(id);
    const sample = samples.get(id);
    if (!sample) return;
    const next = ids[index + 1] ?? ids[index - 1];
    const hadFocus = sample.row.contains(document.activeElement);
    sample.row.remove();
    samples.delete(id);
    if (sample.folder) sample.folder.empty.hidden = sample.folder.list.querySelector('.file-row') !== null;
    void analyze('close', id).catch(() => {});
    if (getActiveSample()?.id === id) select(next, null, null, { keepLayout: true });
    else if (sample.folder && getActiveSample()?.folder === sample.folder) onFolderChange(sample.folder);
    else onCloseSample(sample.id);
    syncEmptyRail();
    if (hadFocus) (samples.get(next)?.open || $('rail-open')).focus();
  }

  function chooseFiles(folder = null) {
    if (importing) return;
    importFolder = folder;
    fileInput.click();
  }

  $('new-folder').addEventListener('click', () => {
    $('folder-form').reset();
    $('folder-dialog').showModal();
    $('folder-name').focus();
  });
  $('cancel-folder').addEventListener('click', () => $('folder-dialog').close());
  $('folder-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('folder-name').value.trim();
    if (!name) return;
    const folder = createFolder(name);
    $('folder-dialog').close();
    folder.toggle.focus();
  });
  for (const id of ['open-folder', 'empty-open-folder']) {
    $(id).addEventListener('click', () => $('folder-input').click());
  }
  $('folder-input').addEventListener('change', event => {
    const files = [...event.target.files].filter(file => isEventFileName(file.name));
    event.target.value = '';
    if (!files.length) {
      importStatus('This folder does not contain any supported data files.', true);
      return;
    }
    const name = files[0].webkitRelativePath.split('/')[0] || 'Data folder';
    void openFiles(files, createFolder(name));
  });

  for (const id of ['rail-open', 'header-open', 'empty-open']) $(id).addEventListener('click', () => chooseFiles());
  for (const id of demoButtons) $(id).addEventListener('click', () => {
    if (importing) return;
    if (!exampleFolder) {
      exampleFolder = createFolder('Example · CD19 panel');
      exampleFolder.aliases.set('B525', 'CD19');
    }
    const opened = [...samples.values()].filter(sample => sample.folder === exampleFolder);
    const missing = exampleNames.filter(name => !opened.some(sample => sample.name === name));
    if (missing.length) void openFiles(missing, exampleFolder);
    else {
      setFolderExpanded(exampleFolder, true);
      select(opened[0].id);
    }
  });
  fileInput.addEventListener('change', event => {
    const files = [...event.target.files];
    event.target.value = '';
    const folder = importFolder;
    importFolder = null;
    void openFiles(files, folder);
  });
  const fileDrag = event => Array.from(event.dataTransfer?.types ?? []).includes('Files');
  function resetFileDrag() {
    dragDepth = 0;
    document.body.classList.remove('is-dragging');
  }
  window.addEventListener('dragenter', event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    dragDepth++;
    if (!importing) document.body.classList.add('is-dragging');
  });
  window.addEventListener('dragover', event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = importing ? 'none' : 'copy';
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dragging');
  });
  window.addEventListener('drop', event => {
    if (!fileDrag(event)) return;
    event.preventDefault();
    resetFileDrag();
    void openFiles(Array.from(event.dataTransfer.files));
  });

  return {
    listFolders() { return [...folders]; },
    revealFolder(folder) { setFolderExpanded(folder, true); },
    getSample(id) { return samples.get(id); },
    listSamples() { return samples.values(); },
    reveal(sample) {
      if (sample?.folder) setFolderExpanded(sample.folder, true);
    }
  };
}
