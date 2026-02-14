import { gunzipSync } from 'node:zlib';

import { isSameSite, stripWww } from './url.js';

const DEFAULT_MAX_ROBOTS_BYTES = 200_000;
const DEFAULT_MAX_SITEMAP_BYTES = 2_000_000;
const DEFAULT_MAX_SITEMAP_DECOMPRESSED_BYTES = 8_000_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const USER_AGENT =
  'Mozilla/5.0 (compatible; AboutUsTeamExtractor/0.1; +https://github.com/firasmosbehi/about-us-team-extractor)';

function decodeXmlEntities(s) {
  return String(s)
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'");
}

async function fetchBufferWithLimit(url, { timeoutMs, maxBytes }) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/plain, application/xml, text/xml, */*',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Node's fetch provides a Web ReadableStream in modern Node versions.
    const reader = res.body?.getReader?.();
    if (!reader) {
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (buf.length > maxBytes) throw new Error(`Response too large (${buf.length} bytes)`);
      return buf;
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        throw new Error(`Response too large (> ${maxBytes} bytes)`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(t);
  }
}

async function fetchTextMaybeGunzip(url, opts) {
  const buf = await fetchBufferWithLimit(url, opts);

  // Some sitemaps are served as .xml.gz without content-encoding. Detect gzip magic bytes.
  const isGzip = url.toLowerCase().endsWith('.gz') || (buf[0] === 0x1f && buf[1] === 0x8b);
  if (!isGzip) return buf.toString('utf8');

  const unzipped = gunzipSync(buf);
  if (unzipped.length > opts.maxDecompressedBytes) {
    throw new Error(`Decompressed response too large (${unzipped.length} bytes)`);
  }
  return unzipped.toString('utf8');
}

export function extractSitemapUrlsFromRobotsTxt(robotsTxt, { baseOrigin }) {
  const out = [];
  const seen = new Set();

  for (const line of String(robotsTxt || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const m = /^sitemap:\s*(\S+)\s*$/i.exec(trimmed);
    if (!m) continue;
    const raw = m[1];
    try {
      const abs = new URL(raw, baseOrigin).toString();
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
    } catch {
      // ignore invalid sitemap URL
    }
  }
  return out;
}

export function extractLocUrlsFromSitemapXml(xml, { limit = 5000 } = {}) {
  const out = [];
  const re = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(String(xml || ''))) !== null) {
    if (out.length >= limit) break;
    let loc = m[1].trim();
    loc = loc.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
    loc = decodeXmlEntities(loc);
    out.push(loc);
  }
  return out;
}

function looksLikeTeamRelatedUrl(url) {
  const u = String(url || '').toLowerCase();
  return /(team|leadership|executive|management|people|about|who-we-are|company|partners|staff)/.test(u);
}

export async function discoverTeamUrlsFromSitemaps({
  companyUrl,
  companyDomain,
  maxSitemapsToFetch = 2,
  maxRobotsBytes = DEFAULT_MAX_ROBOTS_BYTES,
  maxSitemapBytes = DEFAULT_MAX_SITEMAP_BYTES,
  maxSitemapDecompressedBytes = DEFAULT_MAX_SITEMAP_DECOMPRESSED_BYTES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const out = [];
  const seen = new Set();

  const origin = new URL(companyUrl).origin;
  const rootDomain = stripWww(companyDomain || new URL(companyUrl).hostname);

  const addUrl = (url) => {
    if (!url) return;
    const s = String(url).trim();
    if (!s) return;
    if (!looksLikeTeamRelatedUrl(s)) return;
    if (!isSameSite(s, rootDomain)) return;
    if (seen.has(s)) return;
    seen.add(s);
    out.push(s);
  };

  let robotsTxt = '';
  try {
    robotsTxt = await fetchTextMaybeGunzip(`${origin}/robots.txt`, {
      timeoutMs,
      maxBytes: maxRobotsBytes,
      maxDecompressedBytes: maxRobotsBytes,
    });
  } catch {
    // ignore
  }

  const sitemapsFromRobots = extractSitemapUrlsFromRobotsTxt(robotsTxt, { baseOrigin: origin });
  const sitemapSeeds = sitemapsFromRobots.length
    ? sitemapsFromRobots
    : [`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`];

  const sitemapQueue = [];
  for (const s of sitemapSeeds) {
    if (sitemapQueue.length >= maxSitemapsToFetch) break;
    sitemapQueue.push({ url: s, depth: 0 });
  }

  while (sitemapQueue.length > 0) {
    const item = sitemapQueue.shift();
    if (!item) break;

    let xml;
    try {
      xml = await fetchTextMaybeGunzip(item.url, {
        timeoutMs,
        maxBytes: maxSitemapBytes,
        maxDecompressedBytes: maxSitemapDecompressedBytes,
      });
    } catch {
      continue;
    }

    const locs = extractLocUrlsFromSitemapXml(xml, { limit: 50_000 });
    const isIndex = /<sitemapindex[\s>]/i.test(xml);

    if (isIndex && item.depth === 0) {
      // sitemap index -> fetch a limited number of child sitemaps
      for (const loc of locs) {
        if (sitemapQueue.length >= maxSitemapsToFetch) break;
        if (!loc) continue;
        // Avoid media sitemaps.
        const lower = loc.toLowerCase();
        if (/(image|video|news)\.xml(\.gz)?$/.test(lower)) continue;
        sitemapQueue.push({ url: loc, depth: 1 });
      }
      continue;
    }

    for (const loc of locs) addUrl(loc);
  }

  return out;
}
