const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// SECURITY HARDENING — Perkuatan Keamanan Server
// ============================================================

// 1. Helmet: Set HTTP security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled so proxied pages load normally
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false
}));

// 2. Rate Limiting — Blokir otomatis jika ada terlalu banyak request (anti-bruteforce/DDoS)
const limiter = rateLimit({
  windowMs: 60 * 1000,  // 1 menit
  max: 60,              // Maks 60 request per menit per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Terlalu banyak permintaan. Coba lagi dalam 1 menit.' }
});

// Strictest limit untuk proxy agar tidak disalahgunakan
const proxyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Proxy rate limit. Coba lagi dalam 1 menit.' }
});

app.use('/api/', limiter);
app.use('/api/proxy', proxyLimiter);
app.use('/api/media-proxy', proxyLimiter);

// 3. No-Referrer header (sembunyikan dari situs tujuan)
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  next();
});

// 4. Block server fingerprinting
app.disable('x-powered-by');

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// STEALTH HEADERS
// ============================================================
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Cookie': 'SRCHHPGUSR=ADLT=OFF; PREF=LD=en-US&ADLT=OFF; NRSLT=20',
  'DNT': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none'
};

// Blocked domains to prevent SSRF attacks
const BLOCKED_DOMAINS = [
  'localhost', '127.0.0.1', '0.0.0.0', '10.', '192.168.', '172.16.',
  '169.254.', '::1', 'metadata.google', 'metadata.internal'
];

function isBlockedUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(d => host.includes(d));
  } catch {
    return true;
  }
}

// Helper: Decode Bing Base64 URLs
function decodeBingUrl(url) {
  if (!url) return '';
  if (url.includes('&u=a1')) {
    try {
      const match = url.match(/&u=a1([^&]+)/);
      if (match && match[1]) {
        return Buffer.from(match[1], 'base64').toString('utf-8');
      }
    } catch (e) {}
  }
  return url;
}

// ============================================================
// AD BLOCKER — Domain Blocklist (100+ Ad Networks)
// ============================================================
const AD_DOMAINS = [
  // Google Ads
  'doubleclick.net','googlesyndication.com','googleadservices.com','googletagservices.com',
  'adwords.google.com','pagead2.googlesyndication.com',
  // Facebook / Meta Ads
  'facebook.net','connect.facebook.net','adnxs.com',
  // Major Ad Networks
  'taboola.com','outbrain.com','revcontent.com','mgid.com','content.ad',
  'zergnet.com','disqus.com','criteo.com','rubiconproject.com','openx.net',
  'pubmatic.com','casalemedia.com','advertising.com','media.net','yieldmo.com',
  'adsymptotic.com','servedby.flashtalking.com','moatads.com','scorecardresearch.com',
  'quantserve.com','comscore.com','adsafeprotected.com','lijit.com','springserve.com',
  'sharethrough.com','sovrn.com','indexww.com','appnexus.com','33across.com',
  'adsrvr.org','bidswitch.net','contextweb.com','adtelligent.com','undertone.com',
  'yimg.com','ymads.com','bluekai.com','addthis.com','sharethis.com',
  // Analytics / Trackers
  'google-analytics.com','googletagmanager.com','analytics.google.com',
  'hotjar.com','segment.com','mixpanel.com','amplitude.com','heap.io',
  'fullstory.com','logrocket.com','mouseflow.com','clicktale.com',
  'omtrdc.net','2mdn.net','chartbeat.com','parsely.com','krux.com',
  // Pop-up / Push Notification
  'onesignal.com','pushwoosh.com','aimtell.com','webpushr.com','vwo.com',
  // CDN-based Ads
  'ads.yahoo.com','ads.twitter.com','ads.linkedin.com','bing.com/aclk',
  // Indonesia-specific Ads
  'iklanku.com','adf.ly','adcash.com','propellerads.com','popcash.net',
  'trafficjunky.com','juicyads.com','exoclick.com','ero-advertising.com',
  'etahub.com','adsterra.com','hilltopads.net','traffic-media.co','clickadu.com'
];

function isAdDomain(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return AD_DOMAINS.some(domain => host === domain || host.endsWith('.' + domain));
  } catch { return false; }
}

// CSS Selectors to remove from proxied pages (common ad containers)
const AD_CSS_SELECTORS = [
  // Generic Ad Classes
  '[class*="-ad-"]','[class*="_ad_"]','[class*="advert"]','[class*="advertisement"]',
  '[class*="ad-container"]','[class*="ad-wrapper"]','[class*="ad-slot"]',
  '[class*="ad-unit"]','[class*="adsbygoogle"]','[class*="adsense"]',
  '[id*="google_ads"]','[id*="div-gpt-ad"]','[id*="ad-container"]',
  '[id*="ad-slot"]','[id*="advertisement"]','[id*="banner-ad"]',
  // Specific Ad Tags
  'ins.adsbygoogle','#carbonads','.carbonad','[data-ad]','[data-ad-unit]',
  // Social share / push notifications
  '.social-share-sticky','#onesignal-bell-container','#push-notifications-widget',
  // Taboola / Outbrain
  '[id*="taboola"]','[class*="taboola"]','[id*="outbrain"]','[class*="outbrain"]',
  // Popup / Overlay Ads
  '[class*="popup-overlay"]','[class*="modal-ad"]','[id*="popup-ad"]',
  '[class*="sticky-ad"]','[class*="fixed-banner"]','[class*="interstitial"]',
  // Video Ads
  '[class*="video-ad"]','[id*="video-ad"]','[class*="preroll"]',
  // Native Ads
  '[class*="native-ad"]','[class*="sponsored-content"]','[class*="promoted"]',
  '.sponsored','[data-sponsored]','[aria-label*="advertisement"]','[aria-label*="Ad"]'
].join(',');

// Injected CSS to hide ad elements that survive JS removal
const AD_BLOCK_CSS = `
  ins.adsbygoogle, .adsbygoogle, [class*="advert"], [class*="advertisement"],
  [id*="google_ads"], [id*="div-gpt-ad"], [class*="taboola"], [class*="outbrain"],
  iframe[src*="doubleclick"], iframe[src*="googlesyndication"],
  iframe[src*="adnxs"], iframe[src*="taboola"], iframe[src*="outbrain"],
  [class*="sticky-ad"], [class*="fixed-ad"], [class*="ad-sticky"],
  #carbonads, .carbonad, [data-ad-unit], [data-ad-slot] {
    display: none !important;
    visibility: hidden !important;
    height: 0 !important;
    width: 0 !important;
    overflow: hidden !important;
    pointer-events: none !important;
  }
`;

// ============================================================
// HELPER: Rewrite ALL links inside proxied page to stay on proxy
// This fixes the "link going to real website" bug
// ============================================================
function rewriteAllLinksToProxy(html, baseUrl) {
  const $ = cheerio.load(html);

  // Rewrite <a href>
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    try {
      const fullUrl = new URL(href, baseUrl).href;
      if (fullUrl.startsWith('http')) {
        $(el).attr('href', `/api/proxy?url=${encodeURIComponent(fullUrl)}`);
        $(el).attr('target', '_self');
        $(el).removeAttr('rel'); // Remove noopener/noreferrer that could break routing
      }
    } catch (e) {}
  });

  // Rewrite <form action> to proxy
  $('form[action]').each((_, el) => {
    const action = $(el).attr('action');
    if (!action) return;
    try {
      const fullAction = new URL(action, baseUrl).href;
      $(el).attr('action', `/api/proxy?url=${encodeURIComponent(fullAction)}`);
    } catch (e) {}
  });

  // Proxy <video> and <audio> src
  $('video source, audio source, video[src], audio[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      try {
        const fullSrc = new URL(src, baseUrl).href;
        $(el).attr('src', `/api/media-proxy?url=${encodeURIComponent(fullSrc)}`);
      } catch (e) {}
    }
  });

  // Fix image sources (direct, no proxy needed for images for speed)
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && !src.startsWith('data:')) {
      try {
        const fullSrc = new URL(src, baseUrl).href;
        $(el).attr('src', fullSrc);
      } catch (e) {}
    }
  });

  // Fix srcset
  $('img[srcset], source[srcset]').each((_, el) => {
    const srcset = $(el).attr('srcset');
    if (srcset) {
      const newSrcset = srcset.replace(/([^\s,]+)(\s[^\s,]+)?/g, (match, url, size) => {
        try {
          const full = new URL(url.trim(), baseUrl).href;
          return full + (size || '');
        } catch {
          return match;
        }
      });
      $(el).attr('srcset', newSrcset);
    }
  });

  // ---- AD BLOCKER STEP 1: Remove ad/tracker scripts by domain ----
  $('script[src], iframe[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src && isAdDomain(src)) {
      $(el).remove();
    }
  });

  // Also remove by known keyword patterns
  $('script').each((_, el) => {
    const src = $(el).attr('src') || '';
    const badPatterns = [
      'analytics','gtag','google-analytics','googletagmanager',
      'doubleclick','googlesyndication','adsbygoogle','adwords',
      'facebook.net','hotjar','taboola','outbrain','adnxs','criteo',
      'quantserve','scorecardresearch','chartbeat','parsely',
      'onesignal','moatads','adtelligent','adsrvr'
    ];
    if (badPatterns.some(p => src.toLowerCase().includes(p))) {
      $(el).remove();
    }
  });

  // ---- AD BLOCKER STEP 2: Remove ad iframes by domain ----
  $('iframe').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src && (isAdDomain(src) || src.includes('doubleclick') || src.includes('googlesyndication') || src.includes('adnxs'))) {
      $(el).remove();
    }
  });

  // ---- AD BLOCKER STEP 3: Remove known ad HTML elements by CSS selectors ----
  try {
    $(AD_CSS_SELECTORS).remove();
  } catch (e) {}

  // ---- AD BLOCKER STEP 4: Inject CSS to hide surviving ad containers ----
  $('head').append(`<style id="shadowsearch-adblock">${AD_BLOCK_CSS}</style>`);

  return $;
}

// ============================================================
// 1. SEARCH SUGGESTIONS API
// ============================================================
app.get('/api/suggest', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length > 200) return res.json([]);

  try {
    const response = await axios.get(
      `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`,
      { headers: DEFAULT_HEADERS, timeout: 3000 }
    );
    const suggestions = Array.isArray(response.data[1]) ? response.data[1] : [];
    res.json(suggestions.slice(0, 8));
  } catch (err) {
    res.json([]);
  }
});

// ============================================================
// 2. METASEARCH API
// ============================================================
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const engine = req.query.engine || 'all';

  if (!query || query.length > 300) {
    return res.status(400).json({ error: 'Query tidak valid' });
  }

  try {
    let results = [];
    if (engine === 'wikipedia' || engine === 'all') {
      results.push(...await fetchWikipedia(query, 'id'));
    }
    if (engine === 'duckduckgo' || engine === 'all' || engine === 'web') {
      results.push(...await fetchBingUncensored(query));
    }

    const uniqueResults = [];
    const seenUrls = new Set();
    for (const item of results) {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueResults.push(item);
      }
    }

    res.json({ query, engine, count: uniqueResults.length, results: uniqueResults });
  } catch (error) {
    res.status(500).json({ error: 'Gagal melakukan pencarian' });
  }
});

// ============================================================
// 2B. IMAGE SEARCH API
// ============================================================
app.get('/api/images', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length > 300) return res.json({ results: [] });

  try {
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&adlt=off`;
    const response = await axios.get(searchUrl, {
      headers: { ...DEFAULT_HEADERS, 'Cookie': 'SRCHHPGUSR=ADLT=OFF' },
      timeout: 7000
    });

    const $ = cheerio.load(response.data);
    const images = [];

    $('.iusc').each((i, el) => {
      if (images.length >= 16) return;
      try {
        const m = JSON.parse($(el).attr('m') || '{}');
        if (m.murl) {
          images.push({
            title: m.t || query,
            imgUrl: m.murl,
            thumbUrl: `/api/media-proxy?url=${encodeURIComponent(m.turl || m.murl)}`,
            pageUrl: m.purl || m.murl,
            proxyImgUrl: `/api/media-proxy?url=${encodeURIComponent(m.murl)}`
          });
        }
      } catch (e) {}
    });

    res.json({ query, results: images });
  } catch (err) {
    res.json({ query, results: [] });
  }
});

// ============================================================
// 2C. VIDEO SEARCH API
// ============================================================
app.get('/api/videos', async (req, res) => {
  const query = req.query.q;
  if (!query || query.length > 300) return res.json({ results: [] });

  try {
    const searchUrl = `https://www.bing.com/videos/search?q=${encodeURIComponent(query)}&adlt=off`;
    const response = await axios.get(searchUrl, {
      headers: { ...DEFAULT_HEADERS, 'Cookie': 'SRCHHPGUSR=ADLT=OFF' },
      timeout: 7000
    });

    const $ = cheerio.load(response.data);
    const videos = [];

    $('.mc_vtvc').each((i, el) => {
      if (videos.length >= 12) return;
      const title = $(el).find('.mc_vtvc_title').text().trim() || 'Video';
      const targetUrl = $(el).find('a').attr('href');
      const thumbImg = $(el).find('img').attr('src') || $(el).find('img').attr('data-src');

      if (targetUrl && targetUrl.startsWith('http')) {
        videos.push({
          title,
          url: targetUrl,
          proxyUrl: `/api/proxy?url=${encodeURIComponent(targetUrl)}`,
          thumbUrl: thumbImg ? `/api/media-proxy?url=${encodeURIComponent(thumbImg)}` : ''
        });
      }
    });

    res.json({ query, results: videos });
  } catch (err) {
    res.json({ query, results: [] });
  }
});

async function fetchWikipedia(query, lang = 'id') {
  try {
    const wikiDomain = `${lang}.wikipedia.org`;
    const res = await axios.get(
      `https://${wikiDomain}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`,
      { headers: DEFAULT_HEADERS, timeout: 5000 }
    );
    return (res.data?.query?.search || []).slice(0, 6).map(item => ({
      title: item.title,
      url: `https://${wikiDomain}/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      snippet: item.snippet.replace(/<[^>]+>/g, '') || 'Wikipedia.',
      source: 'Wikipedia (ID)',
      badge: 'wiki'
    }));
  } catch { return []; }
}

async function fetchBingUncensored(query) {
  try {
    const res = await axios.get(
      `https://www.bing.com/search?q=${encodeURIComponent(query)}&adlt=off&setmkt=en-US`,
      { headers: { ...DEFAULT_HEADERS, 'Cookie': 'SRCHHPGUSR=ADLT=OFF; NRSLT=20' }, timeout: 7000 }
    );
    const $ = cheerio.load(res.data);
    const results = [];

    $('.b_algo').each((i, el) => {
      if (results.length >= 12) return;
      const titleEl = $(el).find('h2 a');
      const title = titleEl.text().trim();
      const cleanUrl = decodeBingUrl(titleEl.attr('href'));
      const snippet = $(el).find('.b_caption p').text().trim() || '';

      if (title && cleanUrl && cleanUrl.startsWith('http')) {
        results.push({ title, url: cleanUrl, snippet: snippet || 'Hasil web.', source: 'Web Search', badge: 'web' });
      }
    });

    return results;
  } catch { return []; }
}

// ============================================================
// 3. MEDIA STREAM PROXY
// ============================================================
app.get('/api/media-proxy', async (req, res) => {
  const mediaUrl = req.query.url;
  if (!mediaUrl) return res.status(400).send('URL missing');
  if (isBlockedUrl(mediaUrl)) return res.status(403).send('Blocked');

  try {
    const reqHeaders = { ...DEFAULT_HEADERS, 'Referer': mediaUrl };
    if (req.headers.range) reqHeaders['Range'] = req.headers.range;

    const response = await axios({
      method: 'get', url: mediaUrl,
      headers: reqHeaders, responseType: 'stream', timeout: 20000
    });

    const ct = response.headers['content-type'];
    if (ct) res.setHeader('Content-Type', ct);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['accept-ranges']) res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send('Stream error');
  }
});

// ============================================================
// 4. STEALTH PROXY WEB READER — FIXED LINK REWRITING
// ============================================================
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('URL tidak ditemukan');
  if (isBlockedUrl(targetUrl)) return res.status(403).send('URL ini tidak diizinkan.');

  try {
    new URL(targetUrl); // Validate URL format
  } catch {
    return res.status(400).send('URL tidak valid');
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: { ...DEFAULT_HEADERS, 'Referer': targetUrl },
      timeout: 12000, maxRedirects: 5, responseType: 'text'
    });

    const contentType = response.headers['content-type'] || 'text/html';

    if (!contentType.includes('text/html')) {
      res.setHeader('Content-Type', contentType);
      return res.send(response.data);
    }

    // === FULL LINK REWRITE via helper ===
    const $ = rewriteAllLinksToProxy(response.data, targetUrl);

    // Inject stealth banner
    const stealthBanner = `
      <div id="shadowsearch-bar" style="
        position:fixed;top:0;left:0;right:0;z-index:999999;
        background:rgba(7,10,18,0.97);backdrop-filter:blur(12px);
        color:#f8fafc;font-family:system-ui,sans-serif;
        padding:8px 16px;display:flex;align-items:center;justify-content:space-between;
        border-bottom:1px solid rgba(6,182,212,0.3);font-size:13px;
        box-shadow:0 4px 20px rgba(0,0,0,0.7);flex-wrap:wrap;gap:8px;
      ">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <span style="background:#10b981;color:#000;padding:2px 7px;border-radius:4px;font-weight:800;font-size:10px;white-space:nowrap;">🛡️ PROXIED</span>
          <span style="color:#94a3b8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${targetUrl}</span>
        </div>
        <div style="display:flex;gap:8px;flex-shrink:0;">
          <button onclick="window.history.back()" style="background:rgba(255,255,255,0.1);color:#fff;border:1px solid rgba(255,255,255,0.2);padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;">← Kembali</button>
          <a href="/" style="background:#3b82f6;color:#fff;padding:5px 12px;border-radius:6px;text-decoration:none;font-size:12px;">🔍 ShadowSearch</a>
        </div>
      </div>
      <div style="height:44px;"></div>
    `;
    $('body').prepend(stealthBanner);

    // Base tag to help resolve relative resources on proxied page
    $('head').prepend(`<base href="${targetUrl}" />`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send($.html());

  } catch (err) {
    res.status(500).send(`
      <html><body style="font-family:sans-serif;padding:40px;text-align:center;color:#ef4444;background:#0f172a;min-height:100vh;">
        <h2>⚠️ Gagal Memuat Halaman via Proxy</h2>
        <p style="color:#94a3b8;">Halaman (${targetUrl}) memblokir proxy atau sedang offline.</p>
        <p style="font-size:12px;color:#64748b;">${err.message}</p>
        <a href="/" style="display:inline-block;margin-top:20px;background:#3b82f6;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">← Kembali ke ShadowSearch</a>
      </body></html>
    `);
  }
});

// ============================================================
// 404 Handler
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint tidak ditemukan' });
});

// ============================================================
// Global Error Handler
// ============================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🔒 ShadowSearch Pro — Secured & Hardened Server`);
  console.log(`🌐 http://localhost:${PORT}`);
  console.log(`====================================================`);
});
