const EMAIL_VALIDATE_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function truncate(s, maxChars) {
  const str = String(s || '');
  if (!maxChars || str.length <= maxChars) return str;
  return str.slice(0, maxChars);
}

export function parsePeopleFromLlmOutput(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  let cleaned = text;
  // Remove code fences if present.
  cleaned = cleaned.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, '').trim();

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let parsed = tryParse(cleaned);

  if (parsed == null) {
    const startArr = cleaned.indexOf('[');
    const endArr = cleaned.lastIndexOf(']');
    if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
      parsed = tryParse(cleaned.slice(startArr, endArr + 1));
    }
  }

  if (parsed == null) {
    const startObj = cleaned.indexOf('{');
    const endObj = cleaned.lastIndexOf('}');
    if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
      parsed = tryParse(cleaned.slice(startObj, endObj + 1));
    }
  }

  let people;
  if (Array.isArray(parsed)) people = parsed;
  else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.people)) people = parsed.people;
  else return [];

  const out = [];
  const seen = new Set();

  for (const p of people) {
    if (!p || typeof p !== 'object') continue;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!name) continue;

    const title = typeof p.title === 'string' ? p.title.trim() : null;
    const emailRaw = typeof p.email === 'string' ? p.email.trim().toLowerCase() : '';
    const email = emailRaw && EMAIL_VALIDATE_REGEX.test(emailRaw) ? emailRaw : null;

    const linkedinUrl = typeof p.linkedinUrl === 'string' ? p.linkedinUrl.trim() : null;
    const twitterUrl = typeof p.twitterUrl === 'string' ? p.twitterUrl.trim() : null;
    const githubUrl = typeof p.githubUrl === 'string' ? p.githubUrl.trim() : null;
    const blueskyUrl = typeof p.blueskyUrl === 'string' ? p.blueskyUrl.trim() : null;
    const profileUrl = typeof p.profileUrl === 'string' ? p.profileUrl.trim() : null;

    const key = `${name.toLowerCase()}|${(title || '').toLowerCase()}|${email || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      name,
      title: title || null,
      email,
      linkedinUrl: linkedinUrl || null,
      twitterUrl: twitterUrl || null,
      githubUrl: githubUrl || null,
      blueskyUrl: blueskyUrl || null,
      profileUrl: profileUrl || null,
      source: 'llm'
    });
  }

  return out;
}

export async function extractPeopleWithOpenAI({
  apiKey,
  model,
  url,
  html,
  text,
  maxChars = 40000,
  timeoutMs = 60000
}) {
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Missing OpenAI API key');

  // Simple HTML cleaner to save tokens
  const cleanHtmlForLlm = (rawHtml) => {
    let s = String(rawHtml || '');
    // Remove scripts, styles, svg, comments
    s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    s = s.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    
    // Remove specific attributes to save space, keep href/src/alt/title/aria-label if possible?
    // Aggressive: remove all attributes except href
    // We can do a simpler pass: remove class="...", style="...", id="..."
    s = s.replace(/\s+(class|style|id|data-[\w-]+|aria-[\w-]+)=["'][^"']*["']/gi, '');
    
    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  };

  const promptHtml = truncate(cleanHtmlForLlm(html), Math.floor(maxChars * 0.7));
  const promptText = truncate(text, Math.floor(maxChars * 0.3));

  const messages = [
    {
      role: 'system',
      content:
        'You extract structured data from web pages. Return only valid JSON, no commentary, no markdown. Focus on finding Team Members, Employees, and Leadership.'
    },
    {
      role: 'user',
      content: [
        `URL: ${url}`,
        '',
        'Task: Extract a JSON array of people listed on this page.',
        'Strict Rules:',
        '1. Only extract real humans (names like "John Doe"). usage: "Support", "Admin", "Sales Team" -> IGNORE.',
        '2. Do not extract testimonials or clients, only internal team members.',
        '',
        'Each array item must be an object with keys:',
        '- name (string, required)',
        '- title (string, optional)',
        '- email (string, optional, explicit only)',
        '- linkedinUrl (string, optional, explicit only)',
        '- twitterUrl (string, optional, explicit only)',
        '- githubUrl (string, optional, explicit only)',
        '- blueskyUrl (string, optional, explicit only)',
        '- profileUrl (string, optional, explicit only)',
        '',
        'Return [] if no people are listed.',
        '',
        'HTML:',
        promptHtml,
        '',
        'VISIBLE_TEXT:',
        promptText
      ].join('\n')
    }
  ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        max_tokens: 1000
      })
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.output_text ??
      data?.output?.[0]?.content?.[0]?.text ??
      '';

    return parsePeopleFromLlmOutput(content);
  } finally {
    clearTimeout(t);
  }
}
