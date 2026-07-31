const http = require('http');
const { validatePassword } = require('../auth-policy');

const DEFAULT_PORT = 3000;

function getPort() {
  return process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
}

function getBaseUrl() {
  return `http://localhost:${getPort()}`;
}

function requireSupportPassword(scriptName) {
  const password = String(process.env.SUPPORT_PORTAL_PASSWORD || '').trim();
  if (!password) {
    throw new Error(`SUPPORT_PORTAL_PASSWORD is required to run ${scriptName}`);
  }
  if (!validatePassword(password)) {
    throw new Error(
      `SUPPORT_PORTAL_PASSWORD must be at least 8 chars and include uppercase, lowercase, number, and one of @$!%*?& to run ${scriptName}`
    );
  }
  return password;
}

function request(method, path, body = null, headers = {}, options = {}) {
  const baseUrl = options.baseUrl || getBaseUrl();
  const url = new URL(path, baseUrl);

  return new Promise((resolve) => {
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(headers || {})
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (!data) {
          resolve({ status: res.statusCode, body: null, headers: res.headers });
          return;
        }

        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (_error) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ status: 0, body: { error: err.message }, headers: {} });
    });

    if (body != null) {
      if (typeof body === 'string') {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

function extractCookieHeader(setCookieHeader, cookieName = 'cws_session') {
  const values = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : (setCookieHeader ? [setCookieHeader] : []);

  for (const entry of values) {
    const firstPart = String(entry || '').split(';')[0].trim();
    if (!firstPart) continue;
    const separator = firstPart.indexOf('=');
    if (separator <= 0) continue;

    const name = firstPart.slice(0, separator);
    const value = firstPart.slice(separator + 1);
    if (name === cookieName && value) {
      return `${name}=${value}`;
    }
  }

  return '';
}

module.exports = {
  DEFAULT_PORT,
  getPort,
  getBaseUrl,
  requireSupportPassword,
  request,
  extractCookieHeader
};
