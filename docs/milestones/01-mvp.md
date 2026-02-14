# Milestone 1 (MVP): Team Page Discovery + Basic Extraction

## Goal
Given a list of company websites, reliably find the most likely About/Team/Leadership page and output a structured dataset with people + emails.

## In Scope
- Input schema with `startUrls`, `proxyConfiguration`, concurrency and limits
- Homepage link scoring to discover Team/About/Leadership pages
- Fallback to common paths (e.g. `/team`, `/about-us`, `/leadership`)
- Email extraction (regex + `mailto:`)
- Basic people extraction:
  - JSON-LD (`application/ld+json`) `Person` parsing
  - Heuristic “card” parsing from DOM
- Output one dataset row per person (or per email if no people detected)
- CI workflow running `npm test` + `npm run lint`

## Out of Scope (for M1)
- LLM-assisted HTML parsing
- Crawling deeper than 1 hop from homepage (no full site crawl)
- Email verification (SMTP checks, etc.)
- LinkedIn enrichment or any third-party profile matching

## Acceptance Criteria
- Running locally with `npx apify-cli run` produces dataset output for a small list of websites.
- For a typical “Our Team” page with person cards, at least name/title are captured.
- For a page listing plain emails, emails are captured.
