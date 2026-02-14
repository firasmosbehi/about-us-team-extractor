# Milestone 3: Depth-2 Discovery + Enrichment + LLM Fallback

## Goal
Increase hit rate and value of output by:
- discovering Team/Leadership pages that aren’t directly linked from the homepage
- enriching people with profile + LinkedIn URLs when available
- optionally using an LLM as a last-resort extractor for “weird” layouts

## In Scope
- Depth-2 discovery:
  - Homepage -> About/Company page -> Team/Leadership page
  - Per-company page budget to prevent crawling explosions
- Enrichment:
  - Extract LinkedIn URLs (card social icons + JSON-LD `sameAs`)
  - Extract internal profile URLs (when cards link to /team/jane-doe, etc.)
- Optional LLM fallback:
  - If heuristic extraction finds no people, call OpenAI (API key required)
  - Parse strict JSON output and merge with existing extraction pipeline
  - Role filtering still applies (`roleIncludeKeywords`)

## Out of Scope (for M3)
- Full-site crawling
- Email verification
- Deep enrichment (phones, socials beyond LinkedIn, etc.)

## Acceptance Criteria
- For sites where the team page is only reachable via an About/Company page, the Actor finds it.
- Output rows include `linkedinUrl` and/or `profileUrl` when present.
- With `useLlm=true` and a valid key, pages with non-standard markup can still yield people rows.
- `npm test`, `npm run lint`, and schema validation pass.
