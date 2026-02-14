import { isSameSite, stripWww } from './url.js';

const POSITIVE_PATTERNS = [
  { pattern: 'meet the team', weight: 30 },
  { pattern: 'our team', weight: 28 },
  { pattern: 'team', weight: 22 },
  { pattern: 'leadership team', weight: 28 },
  { pattern: 'leadership', weight: 22 },
  { pattern: 'executive team', weight: 24 },
  { pattern: 'executives', weight: 18 },
  { pattern: 'management', weight: 18 },
  { pattern: 'people', weight: 14 },
  { pattern: 'partners', weight: 12 },
  { pattern: 'staff', weight: 16 },
  { pattern: 'founders', weight: 18 },
  { pattern: 'about us', weight: 14 },
  { pattern: 'about', weight: 10 },
  { pattern: 'who we are', weight: 12 }
];

const NEGATIVE_PATTERNS = [
  { pattern: 'privacy', weight: -40 },
  { pattern: 'terms', weight: -40 },
  { pattern: 'cookie', weight: -40 },
  { pattern: 'legal', weight: -20 },
  { pattern: 'sitemap', weight: -20 },
  { pattern: 'jobs', weight: -20 },
  { pattern: 'careers', weight: -20 },
  { pattern: 'press', weight: -10 },
  { pattern: 'news', weight: -10 },
  { pattern: 'blog', weight: -10 },
  { pattern: 'login', weight: -30 },
  { pattern: 'sign in', weight: -30 },
  { pattern: 'signup', weight: -30 },
  { pattern: 'register', weight: -30 }
];

export function getFallbackTeamPaths() {
  return [
    '/team',
    '/our-team',
    '/meet-the-team',
    '/leadership',
    '/leadership-team',
    '/executive-team',
    '/management',
    '/people',
    '/about',
    '/about-us',
    '/who-we-are',
    '/company',
    '/company/team',
    '/about/team',
    '/about-us/team'
  ];
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreAgainstPatterns(s) {
  let score = 0;
  for (const { pattern, weight } of POSITIVE_PATTERNS) {
    if (s.includes(pattern)) score += weight;
  }
  for (const { pattern, weight } of NEGATIVE_PATTERNS) {
    if (s.includes(pattern)) score += weight;
  }
  return score;
}

function isSkippableHref(href) {
  const h = String(href || '').trim().toLowerCase();
  if (!h) return true;
  if (h.startsWith('mailto:')) return true;
  if (h.startsWith('tel:')) return true;
  if (h.startsWith('javascript:')) return true;
  return false;
}

export function rankTeamPageCandidates({ anchors, baseUrl, maxCandidates }) {
  const base = new URL(baseUrl);
  const rootDomain = stripWww(base.hostname);

  const candidates = [];
  for (const a of anchors || []) {
    const href = a?.href;
    if (isSkippableHref(href)) continue;

    let url;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    // Avoid same-page anchors.
    try {
      const u = new URL(url);
      u.hash = '';
      url = u.toString();
    } catch {
      // ignore
    }

    const text = normalize(a?.text || '');
    const hrefNorm = normalize(url);

    let score = 0;
    score += scoreAgainstPatterns(text);
    score += scoreAgainstPatterns(hrefNorm);

    if (isSameSite(url, rootDomain)) score += 5;
    else score -= 20;

    // Prefer simpler URLs.
    try {
      const u = new URL(url);
      if (!u.search) score += 2;
      if (u.pathname.split('/').filter(Boolean).length <= 2) score += 1;
    } catch {
      // ignore
    }

    if (score <= 0) continue;
    candidates.push({ url, score, text });
  }

  // Sort by score desc, then shorter URL.
  candidates.sort((a, b) => b.score - a.score || a.url.length - b.url.length);

  const seen = new Set();
  const out = [];
  const limit = Math.max(1, Math.min(Number(maxCandidates) || 3, 10));

  for (const c of candidates) {
    if (seen.has(c.url)) continue;
    seen.add(c.url);
    out.push(c);
    if (out.length >= limit) break;
  }

  return out;
}

export function buildFallbackCandidates({ baseUrl, maxCandidates }) {
  const base = new URL(baseUrl);
  const limit = Math.max(1, Math.min(Number(maxCandidates) || 3, 10));

  return getFallbackTeamPaths()
    .slice(0, limit)
    .map((p) => ({ url: new URL(p, base.origin).toString(), score: 1, text: `fallback:${p}` }));
}

