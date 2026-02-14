import { chromium } from 'playwright';
import { extractPeopleFromCards } from '../src/lib/extract.js';
import { extractPeopleFromGenericPatterns as generic } from '../src/lib/extract_generic.js'; // Import the dedicated one

import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const filePath = path.join(__dirname, '../test_fixtures/social_test.html');
    
    console.log(`Opening ${filePath}...`);
    await page.goto(`file://${filePath}`);
    
    console.log('Running Generic Extraction...');
    const resultGeneric = await generic(page);
    console.log('Generic Result:', JSON.stringify(resultGeneric, null, 2));

    console.log('Running Cards Extraction...');
    const resultCards = await extractPeopleFromCards(page);
    console.log('Cards Result:', JSON.stringify(resultCards, null, 2));

    await browser.close();
})();
