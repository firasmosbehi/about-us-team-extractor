# Smoke Test Sites

This is a small, curated set of websites to quickly sanity-check:
- homepage -> team/about discovery
- email extraction
- basic people parsing

## Suggested Input
```json
{
  "startUrls": [
    { "url": "https://gitlab.com" },
    { "url": "https://buffer.com" },
    { "url": "https://zapier.com" },
    { "url": "https://vercel.com" },
    { "url": "https://www.netlify.com" },
    { "url": "https://www.figma.com" },
    { "url": "https://www.intercom.com" },
    { "url": "https://www.cloudflare.com" },
    { "url": "https://www.shopify.com" },
    { "url": "https://www.heroku.com" }
  ],
  "maxCompanies": 10,
  "maxTeamPageCandidates": 3,
  "maxConcurrency": 2
}
```

## Notes
- Sites change frequently. If a site no longer exposes a “Team/Leadership” page, replace it with another.
- Keep concurrency low when running manual smoke tests.

## Common Failure Reasons (So Far)
- Team/leadership content is behind client-side routing and not present without extra interaction.
- The “Team” link is hidden in a hamburger menu that requires clicks/scrolling.
- The site uses a separate domain for “About” content (should still work for subdomains, but not always for different domains).
- People are listed, but card markup is non-semantic (no JSON-LD, minimal classes), so heuristic parsing misses names/titles.
