/**
 * Utility function for basic localization.
 * @param {string} textEn - The English version of the text.
 * @param {string} lang - The language code (e.g. "ar").
 * @returns {string} The localized text.
 */
export const localize = (textEn, lang) => {
    if (lang !== "ar") return textEn;
    // For brevity, this returns the English text.
    // In a real implementation, you could load and return the Arabic translation.
    return textEn;
  };
  