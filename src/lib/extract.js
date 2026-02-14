const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .replace(/^mailto:/i, '')
    .replace(/[),.;:]+$/, '')
    .toLowerCase();
}

export function extractEmailsFromStrings(strings) {
  const out = new Set();
  for (const s of strings || []) {
    if (!s) continue;
    const matches = String(s).match(EMAIL_REGEX) || [];
    for (const m of matches) {
      const e = normalizeEmail(m);
      if (e) out.add(e);
    }
  }
  return Array.from(out).sort();
}

export function extractEmailsFromMailtoHrefs(hrefs) {
  const out = new Set();
  for (const href of hrefs || []) {
    const h = String(href || '').trim();
    if (!h.toLowerCase().startsWith('mailto:')) continue;
    const emailPart = h.slice('mailto:'.length).split('?')[0];
    const decoded = decodeURIComponent(emailPart);
    const e = normalizeEmail(decoded);
    if (e) out.add(e);
  }
  return Array.from(out).sort();
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function isPersonType(typeValue) {
  for (const t of asArray(typeValue)) {
    if (typeof t === 'string' && t.toLowerCase() === 'person') return true;
  }
  return false;
}

function getNameFromPerson(person) {
  if (typeof person?.name === 'string' && person.name.trim()) return person.name.trim();

  const given = typeof person?.givenName === 'string' ? person.givenName.trim() : '';
  const family = typeof person?.familyName === 'string' ? person.familyName.trim() : '';
  const full = `${given} ${family}`.trim();
  return full || null;
}

function walkJsonLd(node, results) {
  if (node == null) return;

  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, results);
    return;
  }

  if (typeof node !== 'object') return;

  if (isPersonType(node['@type'])) {
    const name = getNameFromPerson(node);
    const title = typeof node.jobTitle === 'string' ? node.jobTitle.trim() : null;
    const email = typeof node.email === 'string' ? normalizeEmail(node.email) : null;

    if (name) {
      results.push({
        name,
        title: title || null,
        email: email || null,
        source: 'jsonld'
      });
    }
  }

  for (const v of Object.values(node)) walkJsonLd(v, results);
}

export function extractPeopleFromJsonLdStrings(jsonLdStrings) {
  const results = [];
  for (const raw of jsonLdStrings || []) {
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      walkJsonLd(parsed, results);
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }
  return dedupePeople(results);
}

export function dedupePeople(people) {
  const seen = new Set();
  const out = [];
  for (const p of people || []) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    const title = typeof p?.title === 'string' ? p.title.trim() : '';
    const email = typeof p?.email === 'string' ? normalizeEmail(p.email) : '';
    if (!name) continue;

    const key = `${name.toLowerCase()}|${title.toLowerCase()}|${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      title: title || null,
      email: email || null,
      source: p.source || null
    });
  }
  return out;
}

export async function extractPeopleFromCards(page) {
  try {
    const results = await page.evaluate(() => {
      const ROLE_HINTS = [
        'ceo',
        'chief',
        'founder',
        'co-founder',
        'cofounder',
        'cto',
        'cfo',
        'coo',
        'vp',
        'vice president',
        'director',
        'head',
        'manager',
        'partner',
        'principal',
        'president',
        'owner',
        'lead',
        'marketing',
        'sales',
        'engineering',
        'product',
        'operations',
        'finance',
        'hr',
        'people'
      ];

      const BLOCKLIST = ['privacy', 'terms', 'cookie', 'legal', 'careers', 'jobs'];

      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

      const looksLikeName = (s) => {
        const v = clean(s);
        if (!v) return false;
        if (v.length < 3 || v.length > 80) return false;
        if (v.includes('@')) return false;
        if (/\\d/.test(v)) return false;

        const lower = v.toLowerCase();
        if (BLOCKLIST.some((b) => lower.includes(b))) return false;
        if (lower.includes('team') || lower.includes('leadership')) return false;

        const parts = v.split(' ').filter(Boolean);
        if (parts.length < 2 || parts.length > 5) return false;

        // Heuristic: at least one word starts with an uppercase letter (or is all-caps like "CEO" but those should be titles).
        return parts.some((p) => /^[A-Z]/.test(p) || p === p.toUpperCase());
      };

      const looksLikeTitle = (s) => {
        const v = clean(s);
        if (!v) return false;
        if (v.length < 2 || v.length > 120) return false;
        if (v.includes('@')) return false;

        const lower = v.toLowerCase();
        if (BLOCKLIST.some((b) => lower.includes(b))) return false;

        return ROLE_HINTS.some((h) => lower.includes(h));
      };

      const parseMailto = (href) => {
        const h = String(href || '').trim();
        if (!h.toLowerCase().startsWith('mailto:')) return null;
        const emailPart = h.slice('mailto:'.length).split('?')[0];
        try {
          return decodeURIComponent(emailPart).trim().toLowerCase();
        } catch {
          return emailPart.trim().toLowerCase();
        }
      };

      const selectors = [
        '[class*="team"] [class*="member"]',
        '[class*="team"] [class*="person"]',
        '[class*="team"] [class*="profile"]',
        '[class*="team"] [class*="card"]',
        '[class*="leadership"] [class*="member"]',
        '[class*="leadership"] [class*="person"]',
        '[class*="member"]',
        '[class*="person"]',
        '[class*="profile"]',
        '[class*="bio"]'
      ];

      const seenEls = new Set();
      const out = [];

      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel));
        for (const el of els) {
          if (out.length >= 200) break;
          if (!el || seenEls.has(el)) continue;
          seenEls.add(el);

          const text = clean(el.innerText);
          if (!text) continue;

          // Prefer small-ish blocks (cards), skip long bios.
          if (text.length > 800) continue;

          const lines = text
            .split('\\n')
            .map(clean)
            .filter(Boolean)
            .slice(0, 12);
          if (lines.length < 2) continue;

          let name = null;
          const heading = el.querySelector('h1,h2,h3,h4,h5,strong,b');
          if (heading && looksLikeName(heading.textContent)) name = clean(heading.textContent);

          if (!name) {
            for (const line of lines) {
              if (looksLikeName(line)) {
                name = line;
                break;
              }
            }
          }

          if (!name) continue;

          let title = null;
          const roleEl = el.querySelector('[class*="title"],[class*="role"],[class*="position"],[class*="job"]');
          if (roleEl && looksLikeTitle(roleEl.textContent)) title = clean(roleEl.textContent);

          if (!title) {
            const startIdx = Math.max(0, lines.indexOf(name));
            for (const line of lines.slice(startIdx + 1)) {
              if (looksLikeTitle(line)) {
                title = line;
                break;
              }
            }
          }

          const mailto = el.querySelector('a[href^="mailto:"]');
          const email = mailto ? parseMailto(mailto.getAttribute('href')) : null;

          out.push({ name, title: title || null, email: email || null, source: 'cards' });
        }
      }

      return out;
    });

    return dedupePeople(results);
  } catch {
    return [];
  }
}
