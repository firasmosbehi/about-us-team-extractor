# About Us Team Extractor (Apify Actor)

Find a company website’s “About”, “Team”, or “Leadership” page and extract:
- Names
- Job titles
- Emails (page-level + `mailto:` on cards when available)

## What It Does
Given a list of company websites, the Actor:
1. Loads the homepage
2. Finds the most likely “Team/About/Leadership” link
3. Loads that page
4. Extracts structured people entries and email addresses

## Who It's For
- Recruiters: find candidates listed on company sites (often more up to date than LinkedIn profiles).
- Agencies / business owners: find decision-makers (Founder/CEO/VP/Head of ...) on the company’s own pages and avoid generic inboxes.

## Why Company Sites
- Data is first-party (published by the company).
- No LinkedIn scraping complexity or Sales Navigator costs.
- Many firms (agencies, consultancies, law firms, medical practices) list staff publicly.

## Input
See `.actor/INPUT_SCHEMA.json`.

Minimal example:
```json
{
  "startUrls": [{ "url": "https://example.com" }],
  "maxCompanies": 50,
  "maxTeamPageCandidates": 3,
  "maxConcurrency": 5
}
```

## Output
Dataset items are one row per person (or per email if no people were detected):
- `companyDomain`
- `companyUrl`
- `sourceUrl`
- `name`
- `title`
- `email`
- `emailsOnPage`
- `extractedAt`
- `notes`

## Local Development
```bash
npm install
npx apify-cli run
```

When running locally via `apify run`, put input into `storage/key_value_stores/default/INPUT.json`.

## Pricing Notes (Apify Store)
Pricing depends on how hard your target websites are and how much value you provide:
- Starter: $15 to $20 / month for light usage
- Usage-based: $5 per 1,000 pages (or similar)

If you add LLM-assisted parsing and role filtering, you can justify higher pricing.

## Roadmap
- Better team page discovery (multi-candidate + sitemap fallback)
- More robust “person card” extraction
- Optional LLM-assisted parsing for universal layouts
