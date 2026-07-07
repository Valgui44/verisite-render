/**
 * VeriSite.fr — Micro-service de rendu headless (V2 du scanner)
 * -----------------------------------------------------------------
 * Charge une URL dans un vrai navigateur Chromium (donc AVEC exécution du
 * JavaScript), SANS interagir avec le bandeau cookies, et renvoie :
 *   - html     : le DOM final après chargement
 *   - cookies  : les cookies réellement déposés (y compris ceux posés en JS,
 *                comme _ga, _fbp, _hjSession...) — état AVANT tout consentement
 *   - requests : toutes les requêtes réseau émises (pour détecter les traceurs
 *                injectés dynamiquement, ex. via Google Tag Manager)
 *
 * C'est exactement ce que le RGPDChecker ne pouvait PAS voir en V1 (curl sans JS).
 *
 * Sécurité : protégé par un bearer token (variable d'env RENDER_TOKEN).
 * Déploiement : voir README.md (Render / Fly.io / Railway / VPS OVH).
 */
'use strict';

const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '2mb' }));

const TOKEN = process.env.RENDER_TOKEN || '';
const PORT = process.env.PORT || 3000;
const NAV_TIMEOUT = parseInt(process.env.NAV_TIMEOUT_MS || '20000', 10);
const SETTLE_MS = parseInt(process.env.SETTLE_MS || '1500', 10);

// On garde une instance de navigateur chaude entre les requêtes (perf).
let browserPromise = null;
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  let b = await browserPromise;
  if (!b.isConnected()) {
    browserPromise = chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    b = await browserPromise;
  }
  return b;
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'verisite-render', version: '1.0.0' }));

app.post('/render', async (req, res) => {
  // --- Auth ---
  if (TOKEN) {
    const auth = req.headers['authorization'] || '';
    if (auth !== 'Bearer ' + TOKEN) {
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }
  }

  const url = (req.body && req.body.url) || '';
  if (!/^https?:\/\/[^ ]+$/i.test(url)) {
    return res.status(400).json({ ok: false, error: 'invalid_url' });
  }

  let context = null;
  try {
    const browser = await getBrowser();
    context = await browser.newContext({
      userAgent: 'VeriSite.fr Compliance Scanner/2.0 (+https://verisite.fr)',
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      locale: 'fr-FR',
    });
    const page = await context.newPage();

    // Journaliser TOUTES les requêtes réseau (avant consentement).
    const requests = [];
    page.on('request', (r) => {
      try {
        requests.push({ url: r.url(), type: r.resourceType() });
      } catch (e) { /* ignore */ }
    });

    // On charge la page et on ATTEND que le réseau se calme, mais on NE CLIQUE PAS
    // sur le bandeau : on veut précisément ce qui se déclenche sans consentement.
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT }).catch(() => {});
    // Marge pour les scripts asynchrones (tags différés, GTM...).
    await page.waitForTimeout(SETTLE_MS);

    const html = await page.content().catch(() => '');
    const rawCookies = await context.cookies().catch(() => []);
    const finalUrl = page.url();

    await context.close();
    context = null;

    return res.json({
      ok: true,
      finalUrl,
      html,
      cookies: rawCookies.map((c) => ({
        name: c.name,
        domain: c.domain,
        httpOnly: !!c.httpOnly,
        secure: !!c.secure,
        session: c.expires === -1,
      })),
      requests,
    });
  } catch (e) {
    if (context) { try { await context.close(); } catch (_) { /* ignore */ } }
    return res.status(500).json({ ok: false, error: String((e && e.message) || e) });
  }
});

app.listen(PORT, () => {
  console.log('[verisite-render] écoute sur le port ' + PORT + (TOKEN ? ' (token requis)' : ' (SANS token — définis RENDER_TOKEN en prod)'));
});
