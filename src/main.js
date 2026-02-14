import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

import { extractEmailsFromMailtoHrefs, extractEmailsFromStrings, extractPeopleFromCards, extractPeopleFromJsonLdStrings } from './lib/extract.js';
import { buildFallbackCandidates, rankTeamPageCandidates } from './lib/navigation.js';
import { getHomepageVariants, stripWww, toStartUrl } from './lib/url.js';

function mergePeopleByNameTitle(people) {
  const map = new Map();
  for (const p of people || []) {
    if (!p?.name) continue;
    const key = `${p.name}`.trim().toLowerCase() + '|' + `${p.title || ''}`.trim().toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...p });
      continue;
    }
    // Prefer a known email if the previous entry didn't have one.
    if (!prev.email && p.email) prev.email = p.email;
    // Keep both source hints.
    if (prev.source && p.source && prev.source !== p.source) prev.source = `${prev.source},${p.source}`;
  }
  return Array.from(map.values());
}

function shouldIncludeByRole(title, includeKeywords) {
  if (!includeKeywords?.length) return true;
  if (!title) return false;
  const t = String(title).toLowerCase();
  return includeKeywords.some((k) => t.includes(k));
}

await Actor.init();

const input = (await Actor.getInput()) ?? {};
if (input.debugLog) log.setLevel(log.LEVELS.DEBUG);

const startUrls = (input.startUrls || []).map(toStartUrl).filter(Boolean);
if (startUrls.length === 0) throw new Error('Input "startUrls" is required.');

const maxCompanies = Math.min(Number(input.maxCompanies) || startUrls.length, startUrls.length);
const maxTeamPageCandidates = Number(input.maxTeamPageCandidates) || 3;
const maxConcurrency = Number(input.maxConcurrency) || 5;
const roleIncludeKeywords = (input.roleIncludeKeywords || [])
  .map((s) => String(s || '').trim().toLowerCase())
  .filter(Boolean);

const proxyConfiguration = await Actor.createProxyConfiguration(input.proxyConfiguration);
const requestQueue = await Actor.openRequestQueue();

for (const rawUrl of startUrls.slice(0, maxCompanies)) {
  const u = new URL(rawUrl);
  const companyUrl = `${u.origin}/`;
  const companyDomain = stripWww(u.hostname);
  const homeVariants = getHomepageVariants(rawUrl);

  await requestQueue.addRequest({
    url: homeVariants[0],
    uniqueKey: `${companyDomain}::HOME::${homeVariants[0]}`,
    userData: { label: 'HOME', companyUrl, companyDomain, homeVariants, homeVariantIndex: 0 }
  });
}

const pushedPeopleKeys = new Set();
const pushedEmailKeys = new Set();
const satisfiedCompanies = new Set();

const crawler = new PlaywrightCrawler({
  requestQueue,
  proxyConfiguration,
  maxConcurrency,
  navigationTimeoutSecs: 60,
  requestHandlerTimeoutSecs: 120,
  launchContext: {
    launchOptions: {
      headless: true
    }
  },
  async requestHandler({ request, page }) {
    const label = request.userData?.label || 'UNKNOWN';
    const companyDomain = request.userData?.companyDomain || null;
    const companyUrl = request.userData?.companyUrl || null;

    if (label === 'HOME') {
      const loadedUrl = request.loadedUrl || request.url;
      let effectiveCompanyUrl = companyUrl || loadedUrl;
      let effectiveCompanyDomain = companyDomain;
      try {
        const u = new URL(loadedUrl);
        effectiveCompanyUrl = `${u.origin}/`;
        effectiveCompanyDomain = stripWww(u.hostname);
      } catch {
        // ignore
      }

      const anchors = await page.$$eval('a[href]', (as) =>
        as
          .map((a) => ({
            href: a.href,
            text: a.innerText || a.textContent || ''
          }))
          .filter((a) => a.href),
      );

      const ranked = rankTeamPageCandidates({
        anchors,
        baseUrl: effectiveCompanyUrl,
        maxCandidates: maxTeamPageCandidates
      });

      const fallback = buildFallbackCandidates({
        baseUrl: effectiveCompanyUrl,
        maxCandidates: maxTeamPageCandidates
      });

      const candidates = [];
      const seen = new Set();
      for (const c of [...ranked, ...fallback]) {
        if (!c?.url) continue;
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        candidates.push(c);
        if (candidates.length >= maxTeamPageCandidates) break;
      }

      if (candidates.length === 0) {
        await Actor.pushData({
          companyDomain: effectiveCompanyDomain,
          companyUrl: effectiveCompanyUrl,
          sourceUrl: loadedUrl,
          name: null,
          title: null,
          email: null,
          emailsOnPage: [],
          extractedAt: new Date().toISOString(),
          notes: 'No team/about/leadership link candidates found on homepage.'
        });
        return;
      }

      for (const c of candidates) {
        await requestQueue.addRequest({
          url: c.url,
          uniqueKey: `${effectiveCompanyDomain || ''}::TEAM::${c.url}`,
          userData: {
            label: 'TEAM',
            companyDomain: effectiveCompanyDomain,
            companyUrl: effectiveCompanyUrl,
            discoveredFrom: loadedUrl,
            discoveryScore: c.score,
            discoveryText: c.text
          }
        });
      }

      log.info(
        `Queued ${candidates.length} team page candidate(s) for ${effectiveCompanyDomain || loadedUrl}`,
      );
      return;
    }

    if (label === 'TEAM') {
      if (companyDomain && satisfiedCompanies.has(companyDomain)) {
        log.debug(`Skipping team candidate for ${companyDomain} (already satisfied): ${request.url}`);
        return;
      }

      const sourceUrl = request.loadedUrl || request.url;
      const extractedAt = new Date().toISOString();

      const [html, bodyText, mailtoHrefs, jsonLdStrings] = await Promise.all([
        page.content(),
        page.evaluate(() => document.body?.innerText || ''),
        page.$$eval('a[href^="mailto:"]', (as) => as.map((a) => a.getAttribute('href') || '')),
        page.$$eval('script[type="application/ld+json"]', (scripts) =>
          scripts.map((s) => s.textContent || '').filter(Boolean),
        )
      ]);

      const emails = Array.from(
        new Set([
          ...extractEmailsFromMailtoHrefs(mailtoHrefs),
          ...extractEmailsFromStrings([html, bodyText])
        ]),
      )
        .filter(Boolean)
        .slice(0, 50);

      const people = mergePeopleByNameTitle([
        ...extractPeopleFromJsonLdStrings(jsonLdStrings),
        ...(await extractPeopleFromCards(page))
      ]).filter((p) => shouldIncludeByRole(p.title, roleIncludeKeywords));

      if (people.length > 0) {
        if (companyDomain) satisfiedCompanies.add(companyDomain);
        for (const p of people) {
          const key = `${companyDomain || ''}|${p.name}|${p.title || ''}|${p.email || ''}`.toLowerCase();
          if (pushedPeopleKeys.has(key)) continue;
          pushedPeopleKeys.add(key);

          await Actor.pushData({
            companyDomain,
            companyUrl,
            sourceUrl,
            name: p.name,
            title: p.title,
            email: p.email,
            emailsOnPage: emails,
            extractedAt,
            notes: [
              request.userData?.discoveredFrom ? `discoveredFrom=${request.userData.discoveredFrom}` : null,
              request.userData?.discoveryScore != null ? `discoveryScore=${request.userData.discoveryScore}` : null,
              request.userData?.discoveryText ? `discoveryText=${request.userData.discoveryText}` : null,
              p.source ? `personSource=${p.source}` : null
            ]
              .filter(Boolean)
              .join('; ')
          });
        }
        return;
      }

      // No people detected. Still output page-level emails as leads.
      if (emails.length > 0 && roleIncludeKeywords.length === 0) {
        if (companyDomain) satisfiedCompanies.add(companyDomain);
        for (const e of emails) {
          const key = `${companyDomain || ''}|${e}`.toLowerCase();
          if (pushedEmailKeys.has(key)) continue;
          pushedEmailKeys.add(key);

          await Actor.pushData({
            companyDomain,
            companyUrl,
            sourceUrl,
            name: null,
            title: null,
            email: e,
            emailsOnPage: emails,
            extractedAt,
            notes: 'No people detected; emitting page-level emails.'
          });
        }
        return;
      }

      await Actor.pushData({
        companyDomain,
        companyUrl,
        sourceUrl,
        name: null,
        title: null,
        email: null,
        emailsOnPage: emails,
        extractedAt,
        notes: 'No people/emails detected on this candidate page.'
      });
      return;
    }

    log.warning(`Unknown request label: ${label}`);
  },
  async failedRequestHandler({ request, error }) {
    const label = request.userData?.label || 'UNKNOWN';

    if (label === 'HOME') {
      const variants = request.userData?.homeVariants;
      const idx = Number(request.userData?.homeVariantIndex) || 0;
      const nextIdx = idx + 1;

      if (Array.isArray(variants) && nextIdx < variants.length) {
        const nextUrl = variants[nextIdx];
        await requestQueue.addRequest({
          url: nextUrl,
          uniqueKey: `${request.userData?.companyDomain || ''}::HOME::${nextUrl}`,
          forefront: true,
          userData: { ...request.userData, homeVariantIndex: nextIdx }
        });
        log.warning(`HOME failed; retrying variant ${nextIdx + 1}/${variants.length}: ${nextUrl}`);
        return;
      }
    }

    await Actor.pushData({
      companyDomain: request.userData?.companyDomain || null,
      companyUrl: request.userData?.companyUrl || null,
      sourceUrl: request.url,
      name: null,
      title: null,
      email: null,
      emailsOnPage: [],
      extractedAt: new Date().toISOString(),
      notes: `Request failed (${label}): ${error?.message || String(error)}`
    });
  }
});

await crawler.run();
await Actor.exit();
