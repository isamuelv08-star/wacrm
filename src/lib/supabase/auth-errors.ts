// Supabase Auth (GoTrue) returns error.message in English with no
// localization hook of its own, so pages that show it verbatim leak
// raw English text into an otherwise fully-translated Spanish UI
// (e.g. "User already registered" instead of the app's own copy).
// Map the handful of messages users actually hit to translation keys
// under the "AuthErrors" namespace; anything unrecognized falls back
// to the raw message rather than hiding it.
const KNOWN_ERRORS: Record<string, string> = {
  "User already registered": "userAlreadyRegistered",
  "Invalid login credentials": "invalidCredentials",
  "Email not confirmed": "emailNotConfirmed",
};

export function translateAuthError(
  message: string,
  t: (key: string) => string
): string {
  const key = KNOWN_ERRORS[message];
  if (key) return t(key);

  if (/^For security purposes/i.test(message) || /rate limit/i.test(message)) {
    return t("rateLimited");
  }

  return message;
}
