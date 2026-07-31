const { getPort } = require('./tests/test-utils');

const PORT = getPort();
const BASE_URL = `http://localhost:${PORT}`;

function assertStatus(result, expected, step) {
  if (result.status !== expected) {
    throw new Error(`${step}: expected ${expected}, got ${result.status}; body=${JSON.stringify(result.body)}`);
  }
}

(async () => {
  console.log(`=== CSRF PROTECTION TESTS (Port ${PORT}) ===`);
  const browserLikeHeaders = {
    origin: BASE_URL,
    'sec-fetch-site': 'same-origin'
  };

  console.log('1. Browser-like POST without CSRF cookie/header is rejected');
  const missingTokenResponse = await fetch(`${BASE_URL}/api/contact`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...browserLikeHeaders
    },
    body: JSON.stringify({
      name: 'CSRF Check',
      email: `csrf.missing.${Date.now()}@example.com`,
      message: 'Missing token should fail'
    })
  });
  const missingTokenResult = { status: missingTokenResponse.status, body: await missingTokenResponse.json().catch(() => null) };
    assertStatus(missingTokenResult, 403, 'Missing CSRF token rejection');

    console.log('2. GET /api/auth/meta issues CSRF cookie');
    const metaResponse = await fetch(`${BASE_URL}/api/auth/meta`, {
      method: 'GET',
      headers: browserLikeHeaders
    });
    const metaResult = { status: metaResponse.status };
    assertStatus(metaResult, 200, 'Meta endpoint response');

    const setCookie = String(metaResponse.headers.get('set-cookie') || '');
    const cookiePart = setCookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('cws_csrf=')) || '';
    const csrfToken = cookiePart ? decodeURIComponent(cookiePart.slice('cws_csrf='.length)) : '';
    if (!csrfToken) {
      throw new Error('Expected cws_csrf cookie after GET /api/auth/meta, but none was found.');
    }
    const csrfCookie = `cws_csrf=${encodeURIComponent(csrfToken)}`;

    console.log('3. Browser-like POST with cookie but without header is rejected');
    const missingHeaderResponse = await fetch(`${BASE_URL}/api/contact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        ...browserLikeHeaders
      },
      body: JSON.stringify({
        name: 'CSRF Check',
        email: `csrf.cookie-only.${Date.now()}@example.com`,
        message: 'Cookie without header should fail'
      })
    });
    const missingHeaderResult = { status: missingHeaderResponse.status, body: await missingHeaderResponse.json().catch(() => null) };
    assertStatus(missingHeaderResult, 403, 'Missing X-CSRF-Token rejection');

    console.log('4. Browser-like POST with cookie and X-CSRF-Token is accepted');
    const acceptedResponse = await fetch(`${BASE_URL}/api/contact`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: csrfCookie,
        'x-csrf-token': csrfToken,
        ...browserLikeHeaders
      },
      body: JSON.stringify({
        name: 'CSRF Check',
        email: `csrf.ok.${Date.now()}@example.com`,
        message: 'Valid token should pass'
      })
    });
    const acceptedResult = { status: acceptedResponse.status, body: await acceptedResponse.json().catch(() => null) };
    assertStatus(acceptedResult, 201, 'Valid CSRF acceptance');

    console.log('=== CSRF TESTS PASSED ===');
})().catch((error) => {
  console.error('=== CSRF TESTS FAILED ===');
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
