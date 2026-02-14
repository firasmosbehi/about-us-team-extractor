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

export function getHomepageVariants(startUrl) {
  const out = [];
  const seen = new Set();

  const add = (u) => {
    if (!u) return;
    const s = String(u).trim();
    if (!s || seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  try {
    const u = new URL(startUrl);
    const bare = stripWww(u.hostname);
    const hasWww = u.hostname.toLowerCase().startsWith('www.');
    const altHost = hasWww ? bare : `www.${bare}`;
    const altProto = u.protocol === 'https:' ? 'http:' : 'https:';

    // 1) Exact input URL (could include a path)
    add(u.toString());
    // 2) Root homepage on same origin
    add(`${u.protocol}//${u.hostname}/`);

    // 3-4) Toggle www / protocol
    add(`${u.protocol}//${altHost}/`);
    add(`${altProto}//${u.hostname}/`);
    add(`${altProto}//${altHost}/`);
  } catch {
    add(startUrl);
  }

  return out;
}
