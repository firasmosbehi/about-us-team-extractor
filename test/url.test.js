import assert from 'node:assert/strict';
import test from 'node:test';

import { isSameSite, stripWww, toStartUrl } from '../src/lib/url.js';

test('stripWww removes www prefix', () => {
  assert.equal(stripWww('www.Example.com'), 'example.com');
  assert.equal(stripWww('example.com'), 'example.com');
});

test('toStartUrl adds https:// when protocol is missing', () => {
  assert.equal(toStartUrl('example.com'), 'https://example.com/');
});

test('toStartUrl strips hash', () => {
  assert.equal(toStartUrl('https://example.com/#team'), 'https://example.com/');
});

test('isSameSite matches subdomains', () => {
  assert.equal(isSameSite('https://careers.example.com/jobs', 'example.com'), true);
  assert.equal(isSameSite('https://evil.com', 'example.com'), false);
});

