import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

import {
  extractCloudflareEmailsFromHtml,
  extractEmailsFromMailtoHrefs,
  extractEmailsFromStrings,
  extractObfuscatedEmailsFromText,
  extractPeopleFromCards,
  extractPeopleFromJsonLdStrings
} from './lib/extract.js';
import { buildFallbackCandidates, rankAboutPageCandidates, rankTeamPageCandidates } from './lib/navigation.js';
import { collectAnchors, mergeAnchors, tryExpandNavigation } from './lib/browser.js';
import { extractPeopleWithOpenAI } from './lib/llm.js';
import { discoverTeamUrlsFromSitemaps } from './lib/sitemap.js';
import { getHomepageVariants, stripWww, toStartUrl } from './lib/url.js';

const TEAM_SIGNAL_RE = /(team|leadership|executive|management|people|staff|founder|founders|partner|partners|board|directors)/i;
const ABOUT_SIGNAL_RE = /(about|company|who\s+we\s+are|who-we-are|our\s+story|our-story|mission|values|culture)/i;

function isTeamSignalCandidate(candidate) {
  const combined = `${candidate?.text || ''} ${candidate?.url || ''}`.toLowerCase();
  return TEAM_SIGNAL_RE.test(combined);
}

function isAboutSignalCandidate(candidate) {
  const combined = `${candidate?.text || ''} ${candidate?.url || ''}`.toLowerCase();
  return ABOUT_SIGNAL_RE.test(combined);
}

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
    if (!prev.profileUrl && p.profileUrl) prev.profileUrl = p.profileUrl;
    if (!prev.linkedinUrl && p.linkedinUrl) prev.linkedinUrl = p.linkedinUrl;
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
const tryExpandMenus = input.tryExpandMenus ?? true;
const useSitemapFallback = input.useSitemapFallback ?? true;
const useDepth2Discovery = input.useDepth2Discovery ?? true;
const maxDiscoveryPagesPerCompanyRaw = Number(input.maxDiscoveryPagesPerCompany);
const maxDiscoveryPagesPerCompany = Math.max(
  0,
  Math.min(Number.isFinite(maxDiscoveryPagesPerCompanyRaw) ? maxDiscoveryPagesPerCompanyRaw : 2, 10),
);
const useLlm = input.useLlm ?? false;
const openaiApiKey = String(input.openaiApiKey || process.env.OPENAI_API_KEY || '').trim();
const openaiModel = String(input.openaiModel || 'gpt-4o-mini').trim();
const llmMaxChars = Math.max(5000, Math.min(Number(input.llmMaxChars) || 40000, 200000));
const roleIncludeKeywords = (input.roleIncludeKeywords || [])
  .map((s) => String(s || '').trim().toLowerCase())
  .filter(Boolean);

const llmEnabled = Boolean(useLlm && openaiApiKey);
if (useLlm && !openaiApiKey) log.warning('useLlm=true but no OpenAI API key was provided; skipping LLM.');

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

      let anchors = await collectAnchors(page);
      let ranked = rankTeamPageCandidates({
        anchors: anchors,
        baseUrl: effectiveCompanyUrl,
        maxCandidates: maxTeamPageCandidates
      });

      if (tryExpandMenus && ranked.length === 0) {
        const opened = await tryExpandNavigation(page);
        if (opened) {
          const anchorsAfter = await collectAnchors(page);
          anchors = mergeAnchors(anchors, anchorsAfter);
          ranked = rankTeamPageCandidates({
            anchors: anchors,
            baseUrl: effectiveCompanyUrl,
            maxCandidates: maxTeamPageCandidates
          });
        }
      }

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

      if (useSitemapFallback && candidates.length < maxTeamPageCandidates) {
        try {
          const sitemapUrls = await discoverTeamUrlsFromSitemaps({
            companyUrl: effectiveCompanyUrl,
            companyDomain: effectiveCompanyDomain,
            maxSitemapsToFetch: 2
          });

          const sitemapRanked = rankTeamPageCandidates({
            anchors: sitemapUrls.map((url) => ({ href: url, text: 'sitemap' })),
            baseUrl: effectiveCompanyUrl,
            maxCandidates: maxTeamPageCandidates
          });

          for (const c of sitemapRanked) {
            if (!c?.url) continue;
            if (seen.has(c.url)) continue;
            seen.add(c.url);
            candidates.push(c);
            if (candidates.length >= maxTeamPageCandidates) break;
          }
        } catch (e) {
          log.debug(`Sitemap fallback failed for ${effectiveCompanyDomain}: ${e?.message || String(e)}`);
        }
      }

      if (candidates.length === 0) {
        await Actor.pushData({
          companyDomain: effectiveCompanyDomain,
          companyUrl: effectiveCompanyUrl,
          sourceUrl: loadedUrl,
          name: null,
          title: null,
          email: null,
          profileUrl: null,
          linkedinUrl: null,
          emailsOnPage: [],
          extractedAt: new Date().toISOString(),
          notes: 'No team/about/leadership link candidates found on homepage.'
        });
        return;
      }

      const hasTeamSignal = candidates.some(isTeamSignalCandidate);
      const allowDiscovery = Boolean(useDepth2Discovery && maxDiscoveryPagesPerCompany > 0);

      let discoveryQueued = 0;
      const queuedUrls = new Set();

      for (const c of candidates) {
        const wantsDiscover =
          allowDiscovery &&
          discoveryQueued < maxDiscoveryPagesPerCompany &&
          isAboutSignalCandidate(c) &&
          !isTeamSignalCandidate(c);
        const nextLabel = wantsDiscover ? 'DISCOVER' : 'TEAM';

        await requestQueue.addRequest({
          url: c.url,
          uniqueKey: `${effectiveCompanyDomain || ''}::${nextLabel}::${c.url}`,
          userData: {
            label: nextLabel,
            companyDomain: effectiveCompanyDomain,
            companyUrl: effectiveCompanyUrl,
            discoveredFrom: loadedUrl,
            discoveryScore: c.score,
            discoveryText: c.text,
            discoveryDepth: nextLabel === 'DISCOVER' ? 1 : 0
          }
        });
        queuedUrls.add(c.url);
        if (wantsDiscover) discoveryQueued += 1;
      }

      if (allowDiscovery && !hasTeamSignal && discoveryQueued < maxDiscoveryPagesPerCompany) {
        const aboutRanked = rankAboutPageCandidates({
          anchors,
          baseUrl: effectiveCompanyUrl,
          maxCandidates: Math.min(maxDiscoveryPagesPerCompany * 3, 10)
        });

        for (const c of aboutRanked) {
          if (discoveryQueued >= maxDiscoveryPagesPerCompany) break;
          if (!c?.url) continue;
          if (queuedUrls.has(c.url)) continue;
          queuedUrls.add(c.url);
          discoveryQueued += 1;

          await requestQueue.addRequest({
            url: c.url,
            uniqueKey: `${effectiveCompanyDomain || ''}::DISCOVER::${c.url}`,
            userData: {
              label: 'DISCOVER',
              companyDomain: effectiveCompanyDomain,
              companyUrl: effectiveCompanyUrl,
              discoveredFrom: loadedUrl,
              discoveryScore: c.score,
              discoveryText: c.text,
              discoveryDepth: 1
            }
          });
        }
      }

      log.info(
        `Queued ${candidates.length} candidate page(s) for ${effectiveCompanyDomain || loadedUrl} (discover=${discoveryQueued})`,
      );
      return;
    }

    if (label === 'DISCOVER') {
      if (companyDomain && satisfiedCompanies.has(companyDomain)) {
        log.debug(`Skipping discover page for ${companyDomain} (already satisfied): ${request.url}`);
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
          ...extractCloudflareEmailsFromHtml(html),
          ...extractObfuscatedEmailsFromText(bodyText),
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
            profileUrl: p.profileUrl,
            linkedinUrl: p.linkedinUrl,
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
            profileUrl: null,
            linkedinUrl: null,
            emailsOnPage: emails,
            extractedAt,
            notes: 'No people detected on discover page; emitting page-level emails.'
          });
        }
        return;
      }

      // From discover pages, try to locate explicit team/leadership URLs.
      const anchors = await collectAnchors(page);
      const rankedTeam = rankTeamPageCandidates({
        anchors,
        baseUrl: sourceUrl,
        maxCandidates: Math.min(maxTeamPageCandidates * 3, 10)
      }).filter(isTeamSignalCandidate);

      const seen = new Set();
      const toQueue = [];
      for (const c of rankedTeam) {
        if (!c?.url) continue;
        if (seen.has(c.url)) continue;
        seen.add(c.url);
        toQueue.push(c);
        if (toQueue.length >= maxTeamPageCandidates) break;
      }

      for (const c of toQueue) {
        await requestQueue.addRequest({
          url: c.url,
          uniqueKey: `${companyDomain || ''}::TEAM::${c.url}`,
          userData: {
            label: 'TEAM',
            companyDomain,
            companyUrl,
            discoveredFrom: sourceUrl,
            discoveryScore: c.score,
            discoveryText: c.text
          }
        });
      }

      if (toQueue.length === 0) {
        await Actor.pushData({
          companyDomain,
          companyUrl,
          sourceUrl,
          name: null,
          title: null,
          email: null,
          profileUrl: null,
          linkedinUrl: null,
          emailsOnPage: emails,
          extractedAt,
          notes: 'Discover page yielded no people/emails and no team links.'
        });
      }

      return;
    }

    if (label === 'TEAM') {
      if (companyDomain && satisfiedCompanies.has(companyDomain)) {
        log.debug(`Skipping team candidate for ${companyDomain} (already satisfied): ${request.url}`);
        return;
      }

      const sourceUrl = request.loadedUrl || request.url;
      const extractedAt = new Date().toISOString();

      const [html, bodyText, mailtoHrefs, jsonLdStrings, llmHtml] = await Promise.all([
        page.content(),
        page.evaluate(() => document.body?.innerText || ''),
        page.$$eval('a[href^="mailto:"]', (as) => as.map((a) => a.getAttribute('href') || '')),
        page.$$eval('script[type="application/ld+json"]', (scripts) =>
          scripts.map((s) => s.textContent || '').filter(Boolean),
        ),
        llmEnabled
          ? page.evaluate(() => {
              const root = document.querySelector('main') || document.body;
              if (!root) return '';
              const clone = root.cloneNode(true);
              for (const el of clone.querySelectorAll('script,style,noscript')) el.remove();
              return clone.outerHTML || '';
            })
          : Promise.resolve('')
      ]);

      const emails = Array.from(
        new Set([
          ...extractEmailsFromMailtoHrefs(mailtoHrefs),
          ...extractCloudflareEmailsFromHtml(html),
          ...extractObfuscatedEmailsFromText(bodyText),
          ...extractEmailsFromStrings([html, bodyText])
        ]),
      )
        .filter(Boolean)
        .slice(0, 50);

      let people = mergePeopleByNameTitle([
        ...extractPeopleFromJsonLdStrings(jsonLdStrings),
        ...(await extractPeopleFromCards(page))
      ]).filter((p) => shouldIncludeByRole(p.title, roleIncludeKeywords));

      if (people.length === 0 && llmEnabled) {
        try {
          const llmPeople = await extractPeopleWithOpenAI({
            apiKey: openaiApiKey,
            model: openaiModel,
            url: sourceUrl,
            html: llmHtml || html,
            text: bodyText,
            maxChars: llmMaxChars,
            timeoutMs: 60000
          });

          const emailSet = new Set(emails.map((e) => String(e).toLowerCase()));
          const sanitized = llmPeople.map((p) => ({
            ...p,
            // Avoid hallucinated emails: keep only if present on page.
            email: p.email && emailSet.has(String(p.email).toLowerCase()) ? p.email : null
          }));

          people = mergePeopleByNameTitle(sanitized).filter((p) =>
            shouldIncludeByRole(p.title, roleIncludeKeywords),
          );
        } catch (e) {
          log.debug(`LLM extraction failed for ${sourceUrl}: ${e?.message || String(e)}`);
        }
      }

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
            profileUrl: p.profileUrl,
            linkedinUrl: p.linkedinUrl,
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
            profileUrl: null,
            linkedinUrl: null,
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
        profileUrl: null,
        linkedinUrl: null,
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
      profileUrl: null,
      linkedinUrl: null,
      emailsOnPage: [],
      extractedAt: new Date().toISOString(),
      notes: `Request failed (${label}): ${error?.message || String(error)}`
    });
  }
});

await crawler.run();
await Actor.exit();
