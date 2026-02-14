# Milestone 2: Discovery + Extraction Hardening

## Goal
Increase the Actor’s hit rate on real-world websites by improving navigation discovery and email extraction.

## In Scope
- Navigation hardening:
  - Try opening hamburger/“Menu” navigation to reveal hidden links on the homepage
  - Add robots.txt + sitemap.xml fallback to discover team/about/leadership URLs even when not linked
- Email hardening:
  - Decode Cloudflare email protection (`data-cfemail` and `/cdn-cgi/l/email-protection#...`)
  - Detect common “name (at) domain (dot) com” obfuscations
- Tests for the new parsing utilities

## Out of Scope (for M2)
- LLM-assisted parsing
- Full-site crawling
- Email verification
- Deep enrichment (LinkedIn, phone numbers, etc.)

## Acceptance Criteria
- For sites where “Team” is only inside a hamburger menu, candidates are discovered without manual clicks.
- For sites using Cloudflare email protection or basic obfuscation, emails are extracted.
- `npm test` and `npm run lint` pass.
