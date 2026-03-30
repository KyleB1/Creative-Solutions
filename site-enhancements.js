// site-enhancements.js - global UX upgrades for all pages
(function () {
  const DRAFT_PREFIX = 'cws:draft:';

  function injectStyles() {
    if (document.getElementById('siteEnhancementStyles')) return;

    const style = document.createElement('style');
    style.id = 'siteEnhancementStyles';
    style.textContent = '' +
      '.sr-only{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;white-space:nowrap!important;border:0!important;}' +
      '.skip-link{position:fixed;left:1rem;top:-3rem;z-index:99999;background:#111827;color:#fff;padding:.65rem .9rem;border-radius:.65rem;text-decoration:none;font-weight:700;transition:top .2s ease;}' +
      '.skip-link:focus{top:1rem;}' +
      '.site-toast-wrap{position:fixed;right:1rem;bottom:1rem;z-index:9999;display:grid;gap:.5rem;}' +
      '.site-toast{padding:.75rem .95rem;border-radius:.75rem;background:#111827;color:#fff;font-size:.9rem;box-shadow:0 10px 30px rgba(15,23,42,.35);opacity:.98;transform:translateY(4px);animation:toastIn .22s ease forwards;}' +
      '.site-back-top{position:fixed;right:1rem;bottom:1rem;z-index:9998;display:none;border:none;border-radius:999px;padding:.65rem .85rem;font-weight:700;cursor:pointer;background:#2563eb;color:#fff;box-shadow:0 8px 25px rgba(37,99,235,.35);}' +
      '.site-back-top.show{display:inline-flex;align-items:center;gap:.35rem;}' +
      '.reveal-up{opacity:0;transform:translateY(16px);transition:opacity .45s ease,transform .45s ease;}' +
      '.reveal-up.is-visible{opacity:1;transform:translateY(0);}' +
      '@keyframes toastIn{from{opacity:0;transform:translateY(10px)}to{opacity:.98;transform:translateY(0)}}' +
      'body.dark-mode .site-toast{background:#0f172a;color:#e2e8f0;}' +
      'body.dark-mode .skip-link{background:#1e293b;color:#e2e8f0;}' +
      '@media (prefers-reduced-motion: reduce){.reveal-up,.reveal-up.is-visible{opacity:1;transform:none;transition:none;}}';

    document.head.appendChild(style);
  }

  function ensureSkipLink() {
    if (document.querySelector('.skip-link')) return;
    const main = document.querySelector('main') || document.querySelector('[role="main"]');
    if (!main) return;

    if (!main.id) main.id = 'mainContent';

    const skip = document.createElement('a');
    skip.className = 'skip-link';
    skip.href = '#' + main.id;
    skip.textContent = 'Skip to main content';
    document.body.prepend(skip);
  }

  function ensureToastWrap() {
    let wrap = document.querySelector('.site-toast-wrap');
    if (wrap) return wrap;

    wrap = document.createElement('div');
    wrap.className = 'site-toast-wrap';
    document.body.appendChild(wrap);
    return wrap;
  }

  function showToast(message) {
    const wrap = ensureToastWrap();
    const toast = document.createElement('div');
    toast.className = 'site-toast';
    toast.textContent = String(message || 'Done');
    wrap.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2600);
  }

  function installBackToTop() {
    if (document.querySelector('.site-back-top')) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'site-back-top';
    btn.setAttribute('aria-label', 'Back to top');
    btn.textContent = 'Top';

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    function onScroll() {
      const shouldShow = window.scrollY > 360;
      btn.classList.toggle('show', shouldShow);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    document.body.appendChild(btn);
  }

  function enhanceLinks() {
    const links = document.querySelectorAll('a[href]');
    links.forEach(function (link) {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('http')) {
        link.setAttribute('rel', 'noopener noreferrer');
      }
    });
  }

  function enhanceImages() {
    document.querySelectorAll('img').forEach(function (img, index) {
      if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
      if (!img.hasAttribute('decoding')) img.setAttribute('decoding', 'async');
      if (!img.getAttribute('alt')) {
        img.setAttribute('alt', 'Website image ' + String(index + 1));
      }
    });
  }

  function smoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (event) {
        const href = anchor.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;

        event.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function draftKey(form) {
    const formId = form.id || form.getAttribute('name') || 'form';
    const page = window.location.pathname.split('/').pop() || 'page';
    return DRAFT_PREFIX + page + ':' + formId;
  }

  function restoreFormDrafts() {
    const forms = document.querySelectorAll('form');
    forms.forEach(function (form) {
      const key = draftKey(form);
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(key) || 'null');
      } catch (error) {
        saved = null;
      }

      const fields = form.querySelectorAll('input, textarea, select');
      fields.forEach(function (field) {
        const name = field.name || field.id;
        if (!name) return;

        const type = (field.getAttribute('type') || '').toLowerCase();
        if (type === 'password' || type === 'hidden') return;

        if (saved && Object.prototype.hasOwnProperty.call(saved, name) && !field.value) {
          field.value = saved[name];
        }

        field.addEventListener('input', function () {
          let snapshot = {};
          try {
            snapshot = JSON.parse(localStorage.getItem(key) || '{}') || {};
          } catch (error) {
            snapshot = {};
          }
          snapshot[name] = field.value;
          localStorage.setItem(key, JSON.stringify(snapshot));
        });
      });

      form.addEventListener('submit', function () {
        localStorage.removeItem(key);
      });
    });
  }

  function enhanceValidation() {
    const forms = document.querySelectorAll('form');
    forms.forEach(function (form) {
      form.setAttribute('novalidate', 'novalidate');
      form.addEventListener('submit', function (event) {
        const requiredFields = form.querySelectorAll('[required]');
        let firstInvalid = null;

        requiredFields.forEach(function (field) {
          const value = String(field.value || '').trim();
          const type = (field.getAttribute('type') || '').toLowerCase();
          let valid = Boolean(value);

          if (valid && type === 'email') {
            valid = /.+@.+\..+/.test(value);
          }

          if (!valid) {
            field.setAttribute('aria-invalid', 'true');
            field.style.borderColor = 'rgba(220, 38, 38, 0.6)';
            if (!firstInvalid) firstInvalid = field;
          } else {
            field.removeAttribute('aria-invalid');
            field.style.borderColor = '';
          }
        });

        if (firstInvalid) {
          event.preventDefault();
          firstInvalid.focus();
          showToast('Please complete required fields.');
        }
      });
    });
  }

  function installRevealAnimations() {
    const selector = '.panel, .service-card, .portfolio-card, .hero-card, .project-card, .invoice-card, .message-card, .contact-form, .crm-card, .pipeline, .contacts';
    const elements = Array.from(document.querySelectorAll(selector));
    if (elements.length === 0) return;

    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    elements.forEach(function (el, index) {
      el.classList.add('reveal-up');
      el.style.transitionDelay = String(Math.min(index * 35, 260)) + 'ms';
    });

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    elements.forEach(function (el) {
      observer.observe(el);
    });
  }

  function installKeyboardShortcuts() {
    document.addEventListener('keydown', function (event) {
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        const searchLike = document.querySelector('input[type="search"], input[placeholder*="Search"], input[placeholder*="search"]');
        if (searchLike) {
          event.preventDefault();
          searchLike.focus();
          searchLike.select();
          showToast('Search focused');
        }
      }
    });
  }

  function init() {
    if (!document.body) return;
    injectStyles();
    ensureSkipLink();
    installBackToTop();
    enhanceLinks();
    enhanceImages();
    smoothAnchors();
    restoreFormDrafts();
    enhanceValidation();
    installRevealAnimations();
    installKeyboardShortcuts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
