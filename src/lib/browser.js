function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export async function collectAnchors(page) {
  return page.$$eval('a[href]', (as) => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    return as
      .map((a) => {
        const href = a.href;
        const text = [
          a.innerText,
          a.textContent,
          a.getAttribute('aria-label'),
          a.getAttribute('title'),
        ]
          .map(clean)
          .filter(Boolean)
          .join(' ');

        return { href, text };
      })
      .filter((a) => a.href);
  });
}

async function clickFirstVisible(locator) {
  try {
    const count = await locator.count();
    if (count === 0) return false;
    for (let i = 0; i < Math.min(count, 5); i++) {
      const el = locator.nth(i);
      if (!(await el.isVisible())) continue;
      await el.click({ timeout: 2000 });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function tryExpandNavigation(page) {
  // Heuristic: attempt to open a hamburger/menu to reveal hidden links.
  // Safe by design: best-effort clicks with short timeouts.

  const candidates = [
    'header button[aria-label*="menu" i]',
    'header [role="button"][aria-label*="menu" i]',
    'header button:has-text("Menu")',
    'button[aria-label*="open menu" i]',
    'button[aria-label*="menu" i]',
    '[role="button"][aria-label*="menu" i]',
    'button:has-text("Menu")',
    'button:has-text("Navigation")',
    'button[aria-expanded="false"]',
  ];

  // Try role-based first (more semantically correct).
  const roleBased = [
    /open menu/i,
    /menu/i,
    /navigation/i,
    /more/i,
  ];

  for (const re of roleBased) {
    const clicked = await clickFirstVisible(page.getByRole('button', { name: re }));
    if (clicked) {
      await page.waitForTimeout(600);
      return true;
    }
  }

  for (const sel of candidates) {
    const clicked = await clickFirstVisible(page.locator(sel));
    if (clicked) {
      await page.waitForTimeout(600);
      return true;
    }
  }

  return false;
}

export function mergeAnchors(a, b) {
  const out = [];
  const seen = new Set();

  for (const item of [...(a || []), ...(b || [])]) {
    if (!item?.href) continue;
    const href = String(item.href).trim();
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: normalizeText(item.text) });
  }

  return out;
}

