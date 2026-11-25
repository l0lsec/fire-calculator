// Bearer auth for internal routes (cron and queue consumers inside the Worker).
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export function internalAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") && constantTimeEqual(header.slice(7), secret);
}
