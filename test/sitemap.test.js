import assert from 'node:assert/strict';
import test from 'node:test';

import { extractLocUrlsFromSitemapXml, extractSitemapUrlsFromRobotsTxt } from '../src/lib/sitemap.js';

test('extractSitemapUrlsFromRobotsTxt finds sitemap URLs and resolves relative paths', () => {
  const robots = `
User-agent: *
Disallow: /admin
Sitemap: https://example.com/sitemap.xml
Sitemap: /sitemap-pages.xml
`;

  const urls = extractSitemapUrlsFromRobotsTxt(robots, { baseOrigin: 'https://example.com' });
  assert.deepEqual(urls, ['https://example.com/sitemap.xml', 'https://example.com/sitemap-pages.xml']);
});

test('extractLocUrlsFromSitemapXml parses <loc> URLs including CDATA and entities', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc><![CDATA[https://example.com/about-us]]></loc></url>
  <url><loc>https://example.com/team?x=1&amp;y=2</loc></url>
</urlset>`;

  const locs = extractLocUrlsFromSitemapXml(xml, { limit: 10 });
  assert.deepEqual(locs, ['https://example.com/about-us', 'https://example.com/team?x=1&y=2']);
});

