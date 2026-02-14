import { chromium } from 'playwright';
import { extractPeopleFromGenericPatterns } from '../src/lib/extract_generic.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const filePath = path.join(__dirname, '../test_fixtures/team_patterns.html');
    
    console.log(`Opening ${filePath}...`);
    await page.goto(`file://${filePath}`);
    
    console.log('Running extraction...');
    const result = await extractPeopleFromGenericPatterns(page);
    
    console.log('Result:', JSON.stringify(result, null, 2));
    
    await browser.close();
})();
