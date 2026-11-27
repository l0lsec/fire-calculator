// A bank's website, made safe to link to: only http(s), always sent as https.
// Plaid supplies it, but a link is still checked before it reaches a page.
export function bankUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".") || u.username || u.password) return null;
    u.protocol = "https:";
    return u.toString();
  } catch {
    return null;
  }
}
