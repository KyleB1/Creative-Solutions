(function initSupportLoginPage() {
  const themeToggle = document.getElementById('themeToggle');
  const supportLoginForm = document.getElementById('supportLoginForm');
  const loginError = document.getElementById('loginError');
  const apiStatusBanner = document.getElementById('apiStatusBanner');
  const retryStatusBtn = document.getElementById('retryStatusBtn');
  const backendUrlText = document.getElementById('backendUrlText');
  const onlineCountEl = document.getElementById('onlineCount');
  const offlineCountEl = document.getElementById('offlineCount');

  if (
    !window.SiteAuth
    || !themeToggle
    || !supportLoginForm
    || !loginError
    || !apiStatusBanner
    || !retryStatusBtn
    || !backendUrlText
    || !onlineCountEl
    || !offlineCountEl
  ) {
    return;
  }

  const submitButton = supportLoginForm.querySelector('button[type="submit"]');
  const storedTheme = localStorage.getItem('siteTheme') || 'light';
  const startCommands = [
    'start-local.cmd',
    'node server.js'
  ];

  const applyTheme = (theme) => {
    document.body.classList.toggle('dark-mode', theme === 'dark');
    themeToggle.textContent = theme === 'dark' ? 'Light Mode' : 'Dark Mode';
    themeToggle.setAttribute('aria-pressed', theme === 'dark');
    localStorage.setItem('siteTheme', theme);
  };

  const getAuthorizedSupportEmails = () => SiteAuth.getAuthorizedSupportEmails();

  const getSupportOnlineAgents = () => {
    const stored = JSON.parse(localStorage.getItem('supportOnlineAgents') || '[]');
    if (!Array.isArray(stored)) {
      return [];
    }

    const authorizedSupportEmails = getAuthorizedSupportEmails();
    return [...new Set(stored
      .map((email) => SiteAuth.normalizeEmail(email))
      .filter((email) => authorizedSupportEmails.includes(email)))
    ];
  };

  const saveSupportOnlineAgents = (emails) => {
    localStorage.setItem('supportOnlineAgents', JSON.stringify(
      [...new Set(emails.map((email) => String(email).toLowerCase()))]
    ));
  };

  const getSupportDestination = (role) => SiteAuth.getSupportLandingUrl(role);

  const addOnlineAgent = (email) => {
    const roster = getSupportOnlineAgents();
    const normalized = String(email).toLowerCase();
    if (!roster.includes(normalized)) {
      roster.push(normalized);
      saveSupportOnlineAgents(roster);
    }
  };

  const updateAgentCounts = () => {
    const online = getSupportOnlineAgents().length;
    const totalAgents = getAuthorizedSupportEmails().length;
    onlineCountEl.textContent = online;
    offlineCountEl.textContent = Math.max(totalAgents - online, 0);
  };

  const setBannerState = (state, message) => {
    apiStatusBanner.classList.remove('info', 'ok', 'warning', 'error');
    apiStatusBanner.classList.add(state);
    apiStatusBanner.textContent = message;
  };

  const getAuthMetaUrl = () => SiteAuth.buildApiUrl('/api/auth/meta');

  const getBackendUrl = () => {
    const metaUrl = getAuthMetaUrl();
    return String(metaUrl).replace(/\/api\/auth\/meta$/, '') || metaUrl;
  };

  const getHealthUrl = () => `${getBackendUrl()}/health`;

  const ensureLocalStartHint = () => {
    let hint = document.getElementById('supportLocalServerHint');
    if (hint) {
      return hint;
    }

    hint = document.createElement('div');
    hint.id = 'supportLocalServerHint';
    hint.className = 'cws-backend-offline-hint inline';
    hint.style.display = 'none';
    hint.innerHTML = [
      '<strong class="cws-backend-offline-hint-title">Local backend appears offline.</strong>',
      '<div class="auth-meta cws-backend-offline-hint-note">Run this in the project folder and retry:</div>',
      '<pre id="supportLocalServerCmd" class="cws-backend-offline-hint-copy">start-local.cmd</pre>',
      '<div class="cws-backend-offline-hint-actions">',
      '  <button id="copySupportLocalServerCmdBtn" type="button" class="ghost-btn">Copy command</button>',
      '  <a id="openSupportHealthLink" class="ghost-btn" target="_blank" rel="noopener noreferrer">Open /health</a>',
      '</div>'
    ].join('');

    const bannerRow = apiStatusBanner.parentElement;
    bannerRow.insertAdjacentElement('afterend', hint);

    const copyBtn = hint.querySelector('#copySupportLocalServerCmdBtn');
    const commandBlock = hint.querySelector('#supportLocalServerCmd');
    const healthLink = hint.querySelector('#openSupportHealthLink');
    healthLink.setAttribute('href', getHealthUrl());

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
    const commandBlock = hint.querySelector('#supportLocalServerCmd');
    const healthLink = hint.querySelector('#openSupportHealthLink');
    if (commandBlock) {
      commandBlock.textContent = startCommands[0];
    }
    if (healthLink) {
      healthLink.setAttribute('href', getHealthUrl());
    }
    hint.style.display = 'block';
  };

  const hideLocalStartHint = () => {
    const hint = document.getElementById('supportLocalServerHint');
    if (hint) {
      hint.style.display = 'none';
    }
  };

  const updateBackendHint = () => {
    const metaUrl = getAuthMetaUrl();
    const backendUrl = getBackendUrl();
    backendUrlText.textContent = backendUrl;
    return {
      metaUrl,
      localBackendHint: ''
    };
  };

  const checkApiConnectivity = async (attempt = 1) => {
    const { metaUrl, localBackendHint } = updateBackendHint();
    setBannerState('info', `Checking login server availability at ${metaUrl} ...`);
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
      const meta = status && status.meta ? status.meta : null;
      updateAgentCounts();

      if (!meta || !meta.supportLoginConfigured) {
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = 'Sign In';
        }
        hideLocalStartHint();
        setBannerState('warning', `Support login is not configured yet at ${metaUrl}, but you can still try signing in after setting the password.`);
        return;
      }

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Sign In';
      }
      hideLocalStartHint();
      setBannerState('ok', `Login server is online at ${metaUrl} and support login is configured. You can sign in now.`);
    } catch (_error) {
      if (attempt < 2) {
        setTimeout(() => {
          checkApiConnectivity(attempt + 1);
        }, 1000);
        return;
      }

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = 'Sign In';
      }
      showLocalStartHint();
      setBannerState('error', `The login status check could not reach ${metaUrl}, but you can still try signing in below.${localBackendHint}`);
    } finally {
      if (attempt >= 2) {
        retryStatusBtn.disabled = false;
        retryStatusBtn.textContent = 'Retry';
      }
    }
  };

  retryStatusBtn.addEventListener('click', () => {
    checkApiConnectivity();
  });

  supportLoginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = SiteAuth.normalizeEmail(document.getElementById('supportEmail').value);
    const password = document.getElementById('supportPassword').value.trim();

    if (!password) {
      loginError.textContent = 'Please enter your password.';
      return;
    }

    try {
      loginError.textContent = '';
      const supportUser = await SiteAuth.loginSupport({ email, password });
      if (supportUser && supportUser.email) {
        addOnlineAgent(supportUser.email);
      }
      window.location.href = getSupportDestination((supportUser && supportUser.supportRole) || 'Support Agent');
    } catch (error) {
      loginError.textContent = error.message || 'Unable to access the support portal.';
    }
  });

  themeToggle.addEventListener('click', () => {
    const nextTheme = document.body.classList.contains('dark-mode') ? 'light' : 'dark';
    applyTheme(nextTheme);
  });

  applyTheme(storedTheme);

  if (!SiteAuth.isSupportLoggedIn() && SiteAuth.isCustomerLoggedIn()) {
    window.location.href = SiteAuth.toAppUrl('customer-portal.html');
    return;
  }

  updateAgentCounts();

  (async () => {
    await checkApiConnectivity();
    await SiteAuth.init();
    updateAgentCounts();
    const activeSupport = SiteAuth.getSupport();
    if (activeSupport) {
      window.location.href = getSupportDestination(activeSupport.role);
    }
  })();
})();
