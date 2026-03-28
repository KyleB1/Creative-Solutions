// theme.js — shared dark/light mode toggle for Creative Web Solutions
(function () {
  const STORAGE_KEY = 'siteTheme';
 
  function applyTheme(theme) {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    const btn = document.getElementById('themeToggle');
    if (btn) {
      btn.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }
 
  function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEY) || 'light';
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