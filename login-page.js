(function initLoginPage() {
  const loginForm = document.querySelector('form.auth-form');
  const themeToggle = document.getElementById('themeToggle');
  const loginError = document.getElementById('loginError');
  const apiStatusBanner = document.getElementById('apiStatusBanner');
  const retryStatusBtn = document.getElementById('retryStatusBtn');

  if (!loginForm || !themeToggle || !loginError || !apiStatusBanner || !retryStatusBtn || !window.SiteAuth) {
    return;
  }

  const submitButton = loginForm.querySelector('button[type="submit"]');
  const storedTheme = localStorage.getItem('siteTheme') || 'light';
  const authMetaUrl = SiteAuth.buildApiUrl('/api/auth/meta');
  const startCommands = [
    'start-local.cmd',
    'node server.js'
  ];

  const buildHealthUrl = () => String(authMetaUrl).replace(/\/api\/auth\/meta$/, '/health');

  const ensureLocalStartHint = () => {
    let hint = document.getElementById('localServerHint');
    if (hint) {
      return hint;
    }

    hint = document.createElement('div');
    hint.id = 'localServerHint';
    hint.className = 'cws-backend-offline-hint inline';
    hint.style.display = 'none';
    hint.innerHTML = [
      '<strong class="cws-backend-offline-hint-title">Local backend looks offline.</strong>',
      '<div class="auth-meta cws-backend-offline-hint-note">Run this in the project folder:</div>',
      '<pre id="localServerHintCmd" class="cws-backend-offline-hint-copy">start-local.cmd</pre>',
      '<div class="cws-backend-offline-hint-actions">',
      '  <button id="copyLocalServerCmdBtn" type="button" class="ghost-btn">Copy command</button>',
      '  <a id="openHealthLink" class="ghost-btn" target="_blank" rel="noopener noreferrer">Open /health</a>',
      '</div>'
    ].join('');

    const bannerRow = apiStatusBanner.parentElement;
    bannerRow.insertAdjacentElement('afterend', hint);

    const copyBtn = hint.querySelector('#copyLocalServerCmdBtn');
    const commandBlock = hint.querySelector('#localServerHintCmd');
    const healthLink = hint.querySelector('#openHealthLink');
    healthLink.setAttribute('href', buildHealthUrl());

    copyBtn.addEventListener('click', async () => {
      const command = commandBlock ? commandBlock.textContent.trim() : startCommands[0];
      try {
        await navigator.clipboard.writeText(command);
        copyBtn.textContent = 'Copied';
      } catch (_error) {
        copyBtn.textContent = 'Copy failed';
      }
      setTimeout(() => {
        copyBtn.textContent = 'Copy command';
      }, 1400);
    });

    return hint;
  };

  const showLocalStartHint = () => {
    const hint = ensureLocalStartHint();
    const commandBlock = hint.querySelector('#localServerHintCmd');
    const healthLink = hint.querySelector('#openHealthLink');
    if (commandBlock) {
      commandBlock.textContent = startCommands[0];
    }
    if (healthLink) {
      healthLink.setAttribute('href', buildHealthUrl());
    }
    hint.style.display = 'block';
  };

  const hideLocalStartHint = () => {
    const hint = document.getElementById('localServerHint');
    if (hint) {
      hint.style.display = 'none';
    }
  };

  const applyTheme = (theme) => {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    themeToggle.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    localStorage.setItem('siteTheme', theme);
  };

  const setBannerState = (state, message) => {
    apiStatusBanner.classList.remove('info', 'ok', 'warning', 'error');
    apiStatusBanner.classList.add(state);
    apiStatusBanner.textContent = message;
  };

  const checkApiConnectivity = async (attempt = 1) => {
    setBannerState('info', `Checking login server availability at ${authMetaUrl} ...`);
    retryStatusBtn.disabled = true;
    retryStatusBtn.textContent = 'Checking...';

    const timeoutMs = 15000;
    const timeoutPromise = new Promise((_, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error('timeout'));
      }, timeoutMs);
    });

    try {
      const status = await Promise.race([
        SiteAuth.getAuthStatus(),
        timeoutPromise
      ]);

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Log In';
      }

      const meta = status && status.meta ? status.meta : null;
      if (meta && meta.hasCustomerAccounts === false) {
        hideLocalStartHint();
        setBannerState('info', `Login server is online at ${authMetaUrl}. No customer accounts are registered yet, so create an account first.`);
        return;
      }

      hideLocalStartHint();
      setBannerState('ok', `Login server is online at ${authMetaUrl}. You can sign in now.`);
    } catch (_error) {
      if (attempt < 2) {
        setTimeout(() => {
          checkApiConnectivity(attempt + 1);
        }, 1000);
        return;
      }

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Log In';
      }
      showLocalStartHint();
      setBannerState('error', `The login status check could not reach ${authMetaUrl}, but you can still try signing in below.`);
    } finally {
      if (attempt >= 2) {
        retryStatusBtn.disabled = false;
        retryStatusBtn.textContent = 'Retry';
      }
    }
  };

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    loginError.textContent = '';

    try {
      await SiteAuth.loginCustomer({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      });
      window.location.href = SiteAuth.toAppUrl('customer-portal.html');
    } catch (error) {
      loginError.textContent = error.message || 'Unable to log in right now.';
    }
  });

  retryStatusBtn.addEventListener('click', () => {
    checkApiConnectivity();
  });

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  applyTheme(storedTheme);

  (async () => {
    await checkApiConnectivity();
    await SiteAuth.init();
    const activeSupport = SiteAuth.getSupport();
    if (activeSupport) {
      window.location.href = SiteAuth.getSupportLandingUrl(activeSupport);
      return;
    }
    await SiteAuth.redirectIfCustomer('customer-portal.html');
  })();
})();
