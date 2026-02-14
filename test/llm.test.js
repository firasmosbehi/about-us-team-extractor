import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePeopleFromLlmOutput } from '../src/lib/llm.js';

test('parsePeopleFromLlmOutput parses JSON array from code fence', () => {
  const raw = `\`\`\`json
[
  { "name": "Jane Doe", "title": "CEO", "email": "jane@acme.com", "linkedinUrl": "https://linkedin.com/in/jane" }
]
\`\`\``;

  const people = parsePeopleFromLlmOutput(raw);
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'Jane Doe');
  assert.equal(people[0].title, 'CEO');
  assert.equal(people[0].email, 'jane@acme.com');
  assert.equal(people[0].linkedinUrl, 'https://linkedin.com/in/jane');
  assert.equal(people[0].source, 'llm');
});

test('parsePeopleFromLlmOutput extracts array embedded in extra text', () => {
  const raw = `Sure. Here is the extracted JSON:
[
  {"name":"A B","title":"Founder","email":"ab@example.com"}
]`;

  const people = parsePeopleFromLlmOutput(raw);
  assert.deepEqual(people.map((p) => p.name), ['A B']);
  assert.equal(people[0].email, 'ab@example.com');
});

test('parsePeopleFromLlmOutput supports { people: [...] } wrapper', () => {
  const raw = JSON.stringify({ people: [{ name: 'X Y', title: 'CTO' }] });
  const people = parsePeopleFromLlmOutput(raw);
  assert.equal(people.length, 1);
  assert.equal(people[0].name, 'X Y');
  assert.equal(people[0].title, 'CTO');
});

