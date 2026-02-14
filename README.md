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

## Roadmap
- Better team page discovery (multi-candidate + sitemap fallback)
- More robust “person card” extraction
- Optional LLM-assisted parsing for universal layouts
