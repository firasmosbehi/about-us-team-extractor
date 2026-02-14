export function stripWww(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

export function toStartUrl(value) {
  if (value == null) return null;

  let raw = null;
  if (typeof value === 'string') raw = value;
  if (typeof value === 'object' && typeof value.url === 'string') raw = value.url;

  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const u = new URL(withProto);
    // Normalize to origin + path (strip hashes); keep query because some sites use it.
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function isSameSite(url, rootDomain) {
  try {
    const host = stripWww(new URL(url).hostname);
    const root = stripWww(rootDomain);
    return host === root || host.endsWith(`.${root}`);
  } catch {
    return false;
  }
}
