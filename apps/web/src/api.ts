export async function api<T>(path: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: data === undefined ? undefined : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    if (response.status === 400 || response.status === 409 || response.status === 502) {
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      if (typeof body.error === 'string') throw new Error(body.error.slice(0, 500));
    }
    throw new Error(response.status === 401 ? 'Sign in to your account again.' : response.status === 403 ? 'Access denied or invalid invite.' : response.status === 429 ? 'Too many attempts. Wait a few minutes.' : response.status === 503 ? 'Email delivery unavailable. Configure the SMTP server.' : `Could not complete the request (${response.status}).`);
  }
  return response.json() as Promise<T>;
}
