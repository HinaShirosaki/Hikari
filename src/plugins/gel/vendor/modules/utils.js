export function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function safeText(text) {
  return String(text || '').replace(/[&<>"']/g, (char) => {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entityMap[char] || char;
  });
}

export function cssEscape(value) {
  return String(value).replace(/(["\\])/g, '\\$1');
}
