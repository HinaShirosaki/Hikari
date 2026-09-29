function controlValue(control) {
  const type = String(control?.type || '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') {
    return Boolean(control.checked);
  }
  if (control?.tagName === 'SELECT' && control.multiple) {
    return Array.from(control.selectedOptions || []).map((option) => String(option.value || ''));
  }
  if (type === 'file') {
    return Array.from(control.files || []).map((file) => ({
      name: String(file?.name || ''),
      size: Number(file?.size) || 0,
      lastModified: Number(file?.lastModified) || 0
    }));
  }
  return String(control?.value ?? '');
}

// Unsaved-changes detection: modules snapshot a form (or draft object) when it
// is opened or saved, and compare serialized snapshots later. File inputs are
// compared by name/size/mtime since File objects never compare equal.
export function snapshotFormControls(form, options = {}) {
  if (!form) {
    return [];
  }
  const excludedIds = new Set(
    (Array.isArray(options.excludeIds) ? options.excludeIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  );
  return Array.from(form.elements || [])
    .filter((control) => {
      const type = String(control?.type || '').toLowerCase();
      return control
        && !excludedIds.has(String(control.id || ''))
        && !['button', 'submit', 'reset'].includes(type);
    })
    .map((control, index) => ({
      key: String(control.id || control.name || `control-${index}`),
      value: controlValue(control)
    }));
}

// Sets and Maps are sorted so two drafts with the same members serialize the
// same regardless of insertion order. Returns '' if the value cannot serialize.
export function serializeDraftSnapshot(value) {
  try {
    return JSON.stringify(value, (_key, item) => {
      if (item instanceof Set) {
        return Array.from(item).sort();
      }
      if (item instanceof Map) {
        return Array.from(item.entries()).sort(([left], [right]) => String(left).localeCompare(String(right)));
      }
      return item;
    });
  } catch {
    return '';
  }
}
