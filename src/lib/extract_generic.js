import { dedupePeople } from './extract.js';

export async function extractPeopleFromGenericPatterns(page) {
  try {
    const results = await page.evaluate(() => {
      // --- Helpers (duplicated from extractPeopleFromCards to ensure availability in browser context) ---
      const ROLE_HINTS = [
        'ceo', 'chief', 'founder', 'co-founder', 'cofounder', 'cto', 'cfo', 'coo', 'vp',
        'vice president', 'director', 'head', 'manager', 'partner', 'principal', 'president',
        'owner', 'lead', 'marketing', 'sales', 'engineering', 'product', 'operations',
        'finance', 'hr', 'people', 'advisor', 'chairman', 'board', 'member'
      ];
      const BLOCKLIST = ['privacy', 'terms', 'cookie', 'legal', 'careers', 'jobs'];

      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

      const looksLikeName = (s) => {
        const v = clean(s);
        if (!v) return false;
        if (v.length < 3 || v.length > 50) return false; // Strict length for generic extraction
        if (v.includes('@')) return false;
        if (/\d/.test(v)) return false;

        const lower = v.toLowerCase();
        if (BLOCKLIST.some((b) => lower.includes(b))) return false;
        if (lower.includes('team') || lower.includes('leadership')) return false;

        const parts = v.split(' ').filter(Boolean);
        if (parts.length < 2 || parts.length > 4) return false; // Strict word count

        // Must look like a name (capitalized)
        return parts.every((p) => /^[A-Z]/.test(p));
      };

      const looksLikeTitle = (s) => {
        const v = clean(s);
        if (!v) return false;
        if (v.length < 2 || v.length > 80) return false;
        if (v.includes('@')) return false;

        const lower = v.toLowerCase();
        if (BLOCKLIST.some((b) => lower.includes(b))) return false;

        return ROLE_HINTS.some((h) => lower.includes(h));
      };
      
      const parseMailto = (href) => {
          const h = String(href || '').trim();
          if (!h.toLowerCase().startsWith('mailto:')) return null;
          const emailPart = h.slice('mailto:'.length).split('?')[0];
          try {
            return decodeURIComponent(emailPart).trim().toLowerCase();
          } catch {
            return emailPart.trim().toLowerCase();
          }
      };

      // --- Core Logic ---

      // 1. Identify all "Title" candidates in the DOM
      const titleCandidates = [];
      // Ignore H1, H2 for titles as they are usually section headers
      const titleSelectors = 'div, span, p, h3, h4, h5, h6, li, td, b, strong, em, i, small';
      const allElements = Array.from(document.querySelectorAll(titleSelectors));
      
      for (const el of allElements) {
          // Skip elements that are likely containers for multiple things
          // Heuristic: if it has more than 1 tag child, it's probably a container
          if (el.children.length > 1) continue;

          // If it has 1 child, check if that child is a block element that might contain the text
          // (Simple skip for now to avoid duplication: if parent and child both match, we only want one)
          // We'll iterate all elements, so child will be visited. 
          // We prefer the most specific node (leaf).
          if (el.children.length === 1) {
             const child = el.firstElementChild;
             // If child is also in our list (e.g. b inside p), prefer the child?
             // Or allow both and rely on deduping?
             // Let's rely on deduping but avoid processing the parent if the text is identical
             if (child.innerText === el.innerText) continue; 
          }

          const text = clean(el.innerText);
          if (looksLikeTitle(text)) {
              titleCandidates.push({ el, text });
          }
      }

      const candidates = [];

      // 2. For each Title, look for a nearby Name
      for (const { el: titleEl, text: titleText } of titleCandidates) {
          // HEURISTIC: The name usually appears "before" the title in DOM order, 
          // or is a sibling, or is in a parent container.

          // Search siblings and parent's siblings up to 3 levels
          let foundName = null;
          let container = titleEl.parentElement;
          let depth = 0;
          
          while (container && depth < 3) {
             // Look for name in this container
             // We only want to look at "leaf-ish" nodes in the container to avoid grabbing the whole container text
             const potentialNameEls = Array.from(container.querySelectorAll(titleSelectors)); 
             
             for (const node of potentialNameEls) {
                 if (node === titleEl || node.contains(titleEl) || titleEl.contains(node)) continue;
                 // Skip non-leaves
                 if (node.children.length > 0) continue; 

                 const t = clean(node.innerText);
                 if (looksLikeName(t)) {
                     // Additional check: Don't allow the name to be the title text (unlikely but possible)
                     if (t === titleText) continue;
                     
                     // Found a name!
                     foundName = t;
                     break; 
                 }
             }
             

             
             if (foundName) break;
             container = container.parentElement;
             depth++;
          }
          
          if (foundName) {
              // Extract Email from this container if possible
               const containerLinks = Array.from(container.querySelectorAll('a[href]'));
               
               const mailtoLink = containerLinks.find(a => a.getAttribute('href')?.startsWith('mailto:'));
               const email = mailtoLink ? parseMailto(mailtoLink.getAttribute('href')) : null;

               // Extract Socials
               // Simple internal helper since we can't import easily in evaluate
               const findSocials = (links) => {
                   const res = { linkedin: null, twitter: null, github: null, bluesky: null };
                   for (const a of links) {
                       const h = a.getAttribute('href');
                       const l = String(h).toLowerCase();
                       if (l.includes('linkedin.com/')) {
                           if (!res.linkedin || l.includes('/in/')) res.linkedin = h;
                       }
                       if ((l.includes('twitter.com/') || l.includes('x.com/')) && !res.twitter && !l.includes('/share')) res.twitter = h;
                       if (l.includes('github.com/') && !res.github) res.github = h;
                       if (l.includes('bsky.app/') && !res.bluesky) res.bluesky = h;
                   }
                   return res;
               };
               
               const socials = findSocials(containerLinks);

               candidates.push({
                   name: foundName,
                   title: titleText,
                   email,
                   linkedinUrl: socials.linkedin,
                   twitterUrl: socials.twitter,
                   githubUrl: socials.github,
                   blueskyUrl: socials.bluesky,
                   // simplified for now
                   source: 'generic-pattern'
               });
          }
      }

      return candidates;
    });
    
    return dedupePeople(results);
  } catch (e) {
      console.error(e);
      return [];
  }
}
