# Image officielle Playwright : Chromium + toutes les dépendances système déjà présentes.
# La version DOIT correspondre à celle de "playwright" dans package.json (1.45.0).
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

WORKDIR /app

# Le navigateur est déjà présent dans l'image → on saute tout re-téléchargement.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
