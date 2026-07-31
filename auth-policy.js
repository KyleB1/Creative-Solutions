const DEFAULT_SUPPORT_ROLES = Object.freeze({
  'support@creativewebsolutions.com': 'Support Agent',
  'helpdesk@creativewebsolutions.com': 'Help Desk Agent',
  'admin@creativewebsolutions.com': 'System Administrator',
  'kyle.creativesolutions@gmail.com': 'System Administrator'
});

const PASSWORD_POLICY_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const PASSWORD_POLICY_MESSAGE = 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validatePassword(password) {
  return PASSWORD_POLICY_PATTERN.test(String(password || ''));
}

function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || ''));
}

function parseSupportRoles(value) {
  const source = String(value || '').trim();
  if (!source) {
    return { ...DEFAULT_SUPPORT_ROLES };
  }

  const parsed = {};
  for (const entry of source.split(',')) {
    const [emailPart, rolePart] = entry.split(':');
    const email = normalizeEmail(emailPart);
    const role = String(rolePart || '').trim();
    if (!email || !role) {
      continue;
    }
    parsed[email] = role;
  }

  return Object.keys(parsed).length > 0
    ? parsed
    : { ...DEFAULT_SUPPORT_ROLES };
}

module.exports = {
  DEFAULT_SUPPORT_ROLES,
  PASSWORD_POLICY_PATTERN,
  PASSWORD_POLICY_MESSAGE,
  EMAIL_PATTERN,
  normalizeEmail,
  validatePassword,
  isValidEmail,
  parseSupportRoles
};