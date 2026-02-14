FROM apify/actor-node-playwright-chrome:20

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit

COPY . ./

CMD ["node", "src/main.js"]
