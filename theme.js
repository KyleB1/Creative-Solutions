// theme.js — shared dark/light mode toggle for Creative Web Solutions
(function () {
  const STORAGE_KEY = 'siteTheme';

  function readTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) || 'light';
    } catch (error) {
      return 'light';
    }
  }

  function writeTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      // Ignore storage failures so theme toggle still works in restricted contexts.
    }
  }
 
  function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    writeTheme(theme);
  }
 
  function initTheme() {
    const saved = readTheme();
    applyTheme(saved);
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.addEventListener('click', function () {
        const next = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
        applyTheme(next);
      });
    }
  }
 
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();