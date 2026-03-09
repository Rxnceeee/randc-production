export function isValidUsername(username) {
  const regex = /^[a-zA-Z0-9_]{3,20}$/;
  return regex.test(username);
}

export function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

export function isValidPassword(password) {
  return password.length >= 12 && password.length <= 24;
}

export function sanitizeString(value) {
  if (!value) return '';
  return value.trim();
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function sanitizeUsername(username) {
  return username.trim();
}