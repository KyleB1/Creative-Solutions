// header.js - shared global header for consistent site navigation
(function () {
  function getCustomer() {
    if (window.SiteAuth && typeof window.SiteAuth.getCustomer === 'function') {
      return window.SiteAuth.getCustomer();
    }
    try {
      const customer = JSON.parse(localStorage.getItem('portalCustomer') || 'null');
      return customer && customer.email ? customer : null;
    } catch (error) {
      return null;
    }
  }

  function getSupport() {
    if (window.SiteAuth && typeof window.SiteAuth.getSupport === 'function') {
      return window.SiteAuth.getSupport();
    }
    try {
      const support = JSON.parse(localStorage.getItem('supportStaff') || 'null');
      return support && support.email ? support : null;
    } catch (error) {
      return null;
    }
  }

  function activePage(pathname) {
    const file = (pathname || '').split('/').pop().toLowerCase();
    if (!file || file === 'index.htm') return 'home';
    if (file === 'services.html') return 'services';
    if (file === 'layout-lab.html') return 'layout';
    return '';
  }

  function buildHeader() {
    const page = activePage(window.location.pathname);
    const customer = getCustomer();
    const support = getSupport();

    const header = document.createElement('header');
    header.className = 'global-header';
    header.innerHTML = '' +
      '<div class="global-header__inner">' +
      '  <a class="global-header__brand" href="index.htm">Creative Web Solutions</a>' +
      '  <nav class="global-header__nav" aria-label="Global navigation">' +
      '    <a class="' + (page === 'home' ? 'active' : '') + '" href="index.htm">Home</a>' +
      '    <a class="' + (page === 'services' ? 'active' : '') + '" href="services.html">Services</a>' +
      '    <a class="' + (page === 'layout' ? 'active' : '') + '" href="layout-lab.html">Layout Lab</a>' +
      '    <a href="index.htm#portfolio">Portfolio</a>' +
      '    <a href="index.htm#contact">Contact</a>' +
      '    <a href="index.htm#about">About</a>' +
      '  </nav>' +
      '  <div class="global-header__actions">' +
      '    <button id="globalThemeToggle" class="gh-btn" type="button" aria-pressed="false">Dark Mode</button>' +
      '    <a id="globalCrmBtn" class="gh-btn" href="crm.html">CRM</a>' +
      '    <a id="globalSupportBtn" class="gh-btn" href="support-login.html">Support Login</a>' +
      '    <a id="globalPrimaryBtn" class="gh-btn" href="login.html">Login</a>' +
      '    <a id="globalSignupBtn" class="gh-btn gh-btn--primary" href="signup.html">Sign Up</a>' +
      '  </div>' +
      '</div>';

    const crmBtn = header.querySelector('#globalCrmBtn');
    const supportBtn = header.querySelector('#globalSupportBtn');
    const primaryBtn = header.querySelector('#globalPrimaryBtn');
    const signupBtn = header.querySelector('#globalSignupBtn');
    const themeBtn = header.querySelector('#globalThemeToggle');

    function applyTheme(theme) {
      const nextTheme = theme === 'dark' ? 'dark' : 'light';
      document.body.classList.toggle('dark-mode', nextTheme === 'dark');
      if (themeBtn) {
        themeBtn.textContent = nextTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
        themeBtn.setAttribute('aria-pressed', String(nextTheme === 'dark'));
      }
      localStorage.setItem('siteTheme', nextTheme);
    }

    if (themeBtn) {
      themeBtn.addEventListener('click', function () {
        const current = document.body.classList.contains('dark-mode') ? 'dark' : 'light';
        applyTheme(current === 'dark' ? 'light' : 'dark');
      });
      applyTheme(localStorage.getItem('siteTheme') || 'light');
    }

    if (!support && crmBtn) crmBtn.style.display = 'none';

    if (customer) {
      if (supportBtn) supportBtn.style.display = 'none';
      if (crmBtn) crmBtn.style.display = 'none';
      if (primaryBtn) {
        primaryBtn.textContent = 'My Portal';
        primaryBtn.href = 'customer-portal.html';
      }
      if (signupBtn) signupBtn.style.display = 'none';
    }

    if (support) {
      if (supportBtn) supportBtn.style.display = 'none';
      if (crmBtn) crmBtn.style.display = 'inline-flex';
      if (primaryBtn) {
        primaryBtn.textContent = 'Support Portal';
        primaryBtn.href = 'support-portal.html';
      }
      if (signupBtn) signupBtn.style.display = 'none';
    }

    return header;
  }

  function injectStyles() {
    if (document.getElementById('globalHeaderStyles')) return;
    const style = document.createElement('style');
    style.id = 'globalHeaderStyles';
    style.textContent = '' +
      '.global-header{position:sticky;top:0;z-index:1100;background:rgba(255,255,255,.94);backdrop-filter:blur(10px);border-bottom:1px solid #dbe2ea;}' +
      '.global-header__inner{max-width:1200px;margin:0 auto;padding:.72rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:.7rem;flex-wrap:wrap;}' +
      '.global-header__brand{font-weight:800;letter-spacing:-.02em;color:#111827;text-decoration:none;}' +
      '.global-header__nav{display:flex;gap:.45rem;flex-wrap:wrap;}' +
      '.global-header__nav a{padding:.45rem .72rem;border-radius:999px;text-decoration:none;color:#334155;font-weight:700;font-size:.9rem;}' +
      '.global-header__nav a.active{background:#dbeafe;color:#1d4ed8;}' +
      '.global-header__actions{display:flex;gap:.45rem;flex-wrap:wrap;}' +
      '.gh-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2rem;padding:.45rem .78rem;border-radius:999px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:.88rem;font-weight:700;text-decoration:none;white-space:nowrap;}' +
      '.gh-btn--primary{background:#2563eb;border-color:#2563eb;color:#fff;}' +
      'body.dark-mode .global-header{background:rgba(17,24,39,.94);border-color:#334155;}' +
      'body.dark-mode .global-header__brand,body.dark-mode .global-header__nav a{color:#e2e8f0;}' +
      'body.dark-mode .global-header__nav a.active{background:#1e293b;color:#bfdbfe;}' +
      'body.dark-mode .gh-btn{background:#111827;border-color:#334155;color:#e2e8f0;}' +
      'body.dark-mode .gh-btn--primary{background:#2563eb;border-color:#2563eb;color:#fff;}' +
      '@media (max-width:980px){.global-header__inner{justify-content:center;}.global-header__nav,.global-header__actions{justify-content:center;}}';
    document.head.appendChild(style);
  }

  function init() {
    if (!document.body) return;
    if (document.querySelector('.global-header')) return;
    injectStyles();
    const header = buildHeader();
    document.body.prepend(header);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
