import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractCloudflareEmailsFromHtml,
  extractEmailsFromStrings,
  extractObfuscatedEmailsFromText,
  extractPeopleFromJsonLdStrings
} from '../src/lib/extract.js';

test('extractEmailsFromStrings finds emails in HTML/text', () => {
  const emails = extractEmailsFromStrings([
    '<a href="mailto:Sales@Example.com">Email</a> contact us at support@example.com.',
    'No emails here.'
  ]);

  assert.deepEqual(emails.sort(), ['sales@example.com', 'support@example.com']);
});

test('extractPeopleFromJsonLdStrings finds Person nodes', () => {
  const people = extractPeopleFromJsonLdStrings([
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Acme' },
        { '@type': 'Person', name: 'Jane Doe', jobTitle: 'CEO', email: 'jane@acme.com' }
      ]
    })
  ]);

  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'Jane Doe');
  assert.equal(people[0].title, 'CEO');
  assert.equal(people[0].email, 'jane@acme.com');
});

test('extractCloudflareEmailsFromHtml decodes data-cfemail', () => {
  // Encoded for "test@example.com" (key=0x12)
  // 0x12 XOR each byte: https://gist.github.com/ will confirm; keep as stable fixture.
  const html =
    '<a class="__cf_email__" data-cfemail="126677616652776a737f627e773c717d7f">[email&#160;protected]</a>';
  const emails = extractCloudflareEmailsFromHtml(html);
  assert.deepEqual(emails, ['test@example.com']);
});

test('extractObfuscatedEmailsFromText finds (at)/(dot) emails', () => {
  const text = 'Contact: jane (at) example (dot) com or bob[at]example[dot]co[dot]uk';
  const emails = extractObfuscatedEmailsFromText(text);
  assert.deepEqual(emails.sort(), ['bob@example.co.uk', 'jane@example.com']);
});
