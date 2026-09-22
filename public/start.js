/* Starts the application once every script has been loaded. */
try { const th = localStorage.getItem(THEME_KEY); if (th) document.documentElement.dataset.theme = th; } catch (_e) { /* ignore */ }
boot();
