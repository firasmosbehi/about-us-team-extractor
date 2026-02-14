import assert from 'node:assert/strict';
import test from 'node:test';

import { extractEmailsFromStrings, extractPeopleFromJsonLdStrings } from '../src/lib/extract.js';

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

