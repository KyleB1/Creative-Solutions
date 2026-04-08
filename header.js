
// header.js - shared global header for consistent site navigation
(function () {
  function getCustomer() {
    return window.SiteAuth && typeof window.SiteAuth.getCustomer === 'function'
      ? window.SiteAuth.getCustomer()
      : null;
  }

  function getSupport() {
    return window.SiteAuth && typeof window.SiteAuth.getSupport === 'function'
      ? window.SiteAuth.getSupport()
      : null;
  }

  function activePage(pathname) {
    const file = (pathname || '').split('/').pop().toLowerCase();
    if (!file || file === 'index.htm' || file === 'index.html') return 'home';
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
        const isAdmin = window.SiteAuth && typeof window.SiteAuth.isSystemAdministrator === 'function'
          ? window.SiteAuth.isSystemAdministrator(support)
          : support.role === 'System Administrator';
        primaryBtn.textContent = isAdmin ? 'Admin Console' : 'Support Portal';
        primaryBtn.href = isAdmin
          ? (window.SiteAuth && window.SiteAuth.toAppUrl ? window.SiteAuth.toAppUrl('system-admin.html') : 'system-admin.html')
          : (window.SiteAuth && window.SiteAuth.toAppUrl ? window.SiteAuth.toAppUrl('support-portal.html') : 'support-portal.html');
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
      '.global-header{position:sticky;top:0;z-index:1100;background:rgba(255,255,255,.9);backdrop-filter:blur(12px);border-bottom:1px solid rgba(15,111,255,.14);}' +
      '.global-header__inner{max-width:1200px;margin:0 auto;padding:.74rem 1rem;display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap;}' +
      '.global-header__brand{font-family:"Sora","Segoe UI",sans-serif;font-weight:800;letter-spacing:-.03em;color:#0f172a;text-decoration:none;position:relative;padding-left:1rem;}' +
      '.global-header__brand:before{content:"";position:absolute;left:0;top:50%;width:.56rem;height:.56rem;border-radius:999px;background:linear-gradient(140deg,#0f6fff,#ff7a18);transform:translateY(-50%);}' +
      '.global-header__nav{display:flex;gap:.42rem;flex-wrap:wrap;}' +
      '.global-header__nav a{padding:.45rem .78rem;border-radius:999px;text-decoration:none;color:#1f3557;font-weight:700;font-size:.89rem;}' +
      '.global-header__nav a.active{background:#dbeafe;color:#0f4fd8;}' +
      '.global-header__actions{display:flex;gap:.45rem;flex-wrap:wrap;}' +
      '.gh-btn{display:inline-flex;align-items:center;justify-content:center;min-height:2rem;padding:.45rem .82rem;border-radius:999px;border:1px solid rgba(15,111,255,.2);background:#fff;color:#1f3557;font-size:.86rem;font-weight:700;text-decoration:none;white-space:nowrap;transition:transform .2s ease,box-shadow .2s ease,background .2s ease;}' +
      '.gh-btn:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(15,23,42,.12);}' +
      '.gh-btn--primary{background:#0f6fff;border-color:#0f6fff;color:#fff;}' +
      '.gh-btn--primary:hover{background:#0b60e0;border-color:#0b60e0;}' +
      'body.dark-mode .global-header{background:rgba(8,16,32,.9);border-color:rgba(99,164,255,.24);}' +
      'body.dark-mode .global-header__brand,body.dark-mode .global-header__nav a{color:#e7efff;}' +
      'body.dark-mode .global-header__brand:before{background:linear-gradient(140deg,#63a4ff,#ff9b4a);}' +
      'body.dark-mode .global-header__nav a.active{background:#1a2f4d;color:#bfdbfe;}' +
      'body.dark-mode .gh-btn{background:#0f1b2f;border-color:#2f4566;color:#e7efff;}' +
      'body.dark-mode .gh-btn--primary{background:#2563eb;border-color:#2563eb;color:#fff;}' +
      '@media (max-width:980px){.global-header__inner{justify-content:center;}.global-header__nav,.global-header__actions{justify-content:center;}}';
    document.head.appendChild(style);
  }

  async function init() {
    if (!document.body) return;
    if (document.querySelector('.global-header')) return;
    if (window.SiteAuth && typeof window.SiteAuth.init === 'function') {
      await window.SiteAuth.init();
    }
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

