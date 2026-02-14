import assert from 'node:assert/strict';
import test from 'node:test';

import { rankTeamPageCandidates } from '../src/lib/navigation.js';

test('rankTeamPageCandidates prefers team links over legal links', () => {
  const anchors = [
    { href: 'https://example.com/privacy', text: 'Privacy Policy' },
    { href: 'https://example.com/our-team', text: 'Our Team' },
    { href: 'https://example.com/terms', text: 'Terms' }
  ];

  const ranked = rankTeamPageCandidates({
    anchors,
    baseUrl: 'https://example.com/',
    maxCandidates: 3
  });

  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0].url, 'https://example.com/our-team');
});

