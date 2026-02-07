// js/utils.js
// Shared helpers (keeps us from duplicating functions across pages)

(function () {
  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Back-compat: existing code calls escapeHtml(...)
  window.escapeHtml = window.escapeHtml || escapeHtml;

  // Optional namespace if you want it later
  window.WTD = window.WTD || {};
  window.WTD.escapeHtml = escapeHtml;
})();
