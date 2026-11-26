// Turns a provider error (Supabase auth, Plaid, the iPhone sync file, the
// network) into one sentence that says what happened and what to do. The raw
// code or message never reaches the screen; callers may log it.
// Pure and safe to import from client components.

export type ErrorSource = "auth" | "plaid" | "iphone" | "network" | "unknown";

const AUTH: Record<string, string> = {
  invalid_credentials: "That email and password do not match. Check both and try again.",
  email_not_confirmed: "Confirm your email first: open the link we sent, then sign in.",
  user_already_exists: "An account with this email already exists. Sign in instead.",
  email_exists: "An account with this email already exists. Sign in instead.",
  weak_password:
    "Choose a stronger password: at least 10 characters with upper and lower case letters and a digit.",
  same_password: "Choose a password you have not used here before.",
  email_address_invalid: "That email address does not look right. Check it and try again.",
  validation_failed: "Something in the form is missing or not valid. Check each field and try again.",
  signup_disabled: "New sign-ups are turned off for this app.",
  over_request_rate_limit: "Too many attempts. Wait a minute, then try again.",
  over_email_send_rate_limit: "Too many emails sent. Wait a few minutes, then try again.",
  session_expired: "Your session ended. Sign in again.",
  session_not_found: "Your session ended. Sign in again.",
  refresh_token_not_found: "Your session ended. Sign in again.",
  mfa_verification_failed: "That code did not match. Enter the newest 6-digit code from your app.",
  mfa_challenge_expired: "That code expired. Enter the newest 6-digit code from your app.",
  mfa_factor_not_found: "Your authenticator setup was not found. Start setup again.",
  mfa_verification_rejected: "That code did not match. Enter the newest 6-digit code from your app.",
  mfa_enroll_not_enabled: "Two-factor sign-in is not turned on for this app. Ask the admin to enable TOTP.",
  mfa_totp_enroll_not_enabled:
    "Two-factor sign-in is not turned on for this app. Ask the admin to enable TOTP.",
  mfa_factor_name_conflict: "An authenticator is already being set up. Reload the page and try again.",
  too_many_enrolled_mfa_factors: "Too many authenticators are set up. Remove one, then try again.",
  insufficient_aal: "Finish two-factor sign-in first.",
};

const PLAID: Record<string, string> = {
  ITEM_LOGIN_REQUIRED: "Your bank needs you to sign in again. Choose Reconnect to fix it.",
  PENDING_EXPIRATION: "Your bank connection expires soon. Choose Reconnect to keep it working.",
  PENDING_DISCONNECT: "Your bank connection will stop soon. Choose Reconnect to keep it working.",
  INVALID_CREDENTIALS:
    "The bank did not accept that sign-in. Try again with your bank username and password.",
  INVALID_MFA: "The bank did not accept that code. Try connecting again.",
  ITEM_LOCKED: "Your bank locked the account after too many tries. Unlock it at the bank, then reconnect.",
  USER_SETUP_REQUIRED: "Your bank needs you to finish a step on its website first, then reconnect.",
  NO_ACCOUNTS: "The bank shared no accounts. Connect again and pick at least one account.",
  INSTITUTION_DOWN: "Your bank is not responding right now. We will try again later; nothing for you to do.",
  INSTITUTION_NOT_RESPONDING:
    "Your bank is not responding right now. We will try again later; nothing for you to do.",
  INSTITUTION_NOT_AVAILABLE: "Your bank is not available right now. Try again in a few hours.",
  INSTITUTION_NOT_SUPPORTED: "This bank cannot be connected yet. Enter its balances on Accounts instead.",
  PRODUCT_NOT_READY: "Your bank is still sending data. Check back in a few minutes.",
  RATE_LIMIT_EXCEEDED: "Too many refreshes in a short time. Wait a few minutes, then try again.",
  ACCESS_NOT_GRANTED: "The bank did not share the data we need. Connect again and allow access.",
  INTERNAL_SERVER_ERROR: "The bank connection service had a problem. Try again in a few minutes.",
  PLANNED_MAINTENANCE: "Your bank is down for maintenance. We will try again later.",
  ITEM_NOT_FOUND: "This connection no longer exists at the bank. Connect the bank again.",
  INVALID_ACCESS_TOKEN: "This connection no longer works. Connect the bank again.",
  USER_EXIT: "You closed the bank window before finishing. Nothing was connected.",
  NOT_CONFIGURED: "Bank connections are not set up in this app. Enter balances on Accounts instead.",
};

// Messages the iPhone sync import records (server/financekit). Matched by substring.
const IPHONE: [RegExp, string][] = [
  [/older pairing/i, "The iPhone is paired to an older code. Unpair it and pair again."],
  [/did not decrypt|truncated/i, "The iPhone data could not be opened. Unpair the iPhone and pair again."],
  [/unexpected shape/i, "The iPhone app is out of date for this version. Update the iPhone app, then sync."],
  [/could not be read/i, "The iPhone data file could not be read. Sync again from the iPhone app."],
];

// Supabase sometimes sends only a message. Matched by substring, lower case.
const AUTH_MESSAGES: [RegExp, string][] = [
  [/invalid login credentials/i, AUTH.invalid_credentials!],
  [/email not confirmed/i, AUTH.email_not_confirmed!],
  [/already registered|already been registered/i, AUTH.user_already_exists!],
  [/password should be|weak password/i, AUTH.weak_password!],
  [/invalid totp code|invalid mfa|code.*(invalid|expired)/i, AUTH.mfa_verification_failed!],
  [/rate limit|too many requests/i, AUTH.over_request_rate_limit!],
];

const NETWORK =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|econnrefused|etimedout/i;

const GENERIC: Record<ErrorSource, string> = {
  auth: "Sign-in did not work. Try again; if it keeps failing, reload the page.",
  plaid: "The bank connection had a problem. Try again in a few minutes.",
  iphone: "The iPhone data could not be imported. Sync again from the iPhone app.",
  network: "Could not reach the app. Check your connection and try again.",
  unknown: "Something went wrong. Try again; your other data is safe.",
};

function field(e: unknown, k: string): string | undefined {
  if (e && typeof e === "object" && k in e) {
    const v = (e as Record<string, unknown>)[k];
    return typeof v === "string" && v ? v : undefined;
  }
  return undefined;
}

/**
 * One plain sentence for any error. `source` picks the fallback wording when
 * the code is unknown. Never returns the provider's own message.
 */
export function explainError(e: unknown, source: ErrorSource = "unknown"): string {
  const code = field(e, "code") ?? field(e, "error_code") ?? field(e, "errorCode");
  const message =
    typeof e === "string" ? e : (field(e, "message") ?? field(e, "error_message") ?? field(e, "error"));

  if (code) {
    if (AUTH[code]) return AUTH[code];
    const upper = code.toUpperCase();
    if (PLAID[upper]) return PLAID[upper];
  }
  if (typeof e === "string" && PLAID[e]) return PLAID[e];
  if (message) {
    if (NETWORK.test(message)) return GENERIC.network;
    if (source === "iphone" || source === "unknown")
      for (const [re, text] of IPHONE) if (re.test(message)) return text;
    if (source === "auth" || source === "unknown")
      for (const [re, text] of AUTH_MESSAGES) if (re.test(message)) return text;
  }
  return GENERIC[source];
}

/** Every code with its own wording, for tests and docs. */
export const KNOWN_CODES = { auth: Object.keys(AUTH), plaid: Object.keys(PLAID) } as const;
