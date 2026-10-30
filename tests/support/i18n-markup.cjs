// Compare semantic English markup while retaining structural and escaped-data
// assertions. Translation leaves add spans; they do not replace controls.
function stripI18nMarkup(html) {
  let value = String(html);
  for (let previous; previous !== value;) {
    previous = value;
    value = value.replace(/<span\b(?=[^>]*\bdata-i18n(?:-parts)?=)[^>]*>([^<]*)<\/span>/g, (_all, text) => text.replace(/&#39;/g, "'").replace(/&quot;/g, '"'));
  }
  return value;
}
module.exports = { stripI18nMarkup };
