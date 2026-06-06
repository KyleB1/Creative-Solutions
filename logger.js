const isProd = process.env.NODE_ENV === 'production';
const debugEnabled = Boolean(process.env.DEBUG);

function safeLog(fn, args) {
  try {
    fn(...args);
  } catch (_e) {
    // swallow logging errors to avoid crashing the app
  }
}

module.exports = {
  info: (...args) => {
    if (!isProd) safeLog(console.log, args);
  },
  debug: (...args) => {
    if (debugEnabled) safeLog(console.log, args);
  },
  warn: (...args) => {
    if (!isProd) safeLog(console.warn, args);
  },
  error: (...args) => {
    safeLog(console.error, args);
  }
};
