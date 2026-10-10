const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Stealth User-Agent Spoofing
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

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

// -------------------------------------------------------------
// 1. SEARCH SUGGESTIONS API
// -------------------------------------------------------------
app.get('/api/suggest', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

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

// -------------------------------------------------------------
// 2. METASEARCH API (Bing, Wikipedia, DuckDuckGo)
// -------------------------------------------------------------
app.get('/api/search', async (req, res) => {
  const query = req.query.q;
  const engine = req.query.engine || 'all';

  if (!query) {
    return res.status(400).json({ error: 'Query q diperlukan' });
  }

  try {
    let results = [];

    // Wikipedia
    if (engine === 'wikipedia' || engine === 'all') {
      const wikiResults = await fetchWikipedia(query, 'id');
      results.push(...wikiResults);
    }

    // Bing Web Search
    if (engine === 'duckduckgo' || engine === 'all' || engine === 'web') {
      const webResults = await fetchBingWeb(query);
      results.push(...webResults);
    }

    // Deduplicate by URL
    const uniqueResults = [];
    const seenUrls = new Set();
    for (const item of results) {
      if (item.url && !seenUrls.has(item.url)) {
        seenUrls.add(item.url);
        uniqueResults.push(item);
      }
    }

    res.json({
      query,
      engine,
      count: uniqueResults.length,
      results: uniqueResults
    });
  } catch (error) {
    console.error('Search API error:', error.message);
    res.status(500).json({ error: 'Gagal melakukan pencarian', details: error.message });
  }
});

// Fetch Wikipedia
async function fetchWikipedia(query, lang = 'id') {
  try {
    const wikiDomain = `${lang}.wikipedia.org`;
    const wikiUrl = `https://${wikiDomain}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    const res = await axios.get(wikiUrl, { headers: DEFAULT_HEADERS, timeout: 5000 });
    const list = res.data?.query?.search || [];

    return list.slice(0, 6).map(item => {
      const cleanSnippet = item.snippet.replace(/<[^>]+>/g, '');
      return {
        title: item.title,
        url: `https://${wikiDomain}/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
        snippet: cleanSnippet || 'Ensiklopedia Wikipedia Bebas.',
        source: 'Wikipedia (ID)',
        badge: 'wiki'
      };
    });
  } catch (err) {
    return [];
  }
}

// Fetch Web Search via Bing Proxy Engine
async function fetchBingWeb(query) {
  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    const res = await axios.get(searchUrl, { headers: DEFAULT_HEADERS, timeout: 6000 });
    const $ = cheerio.load(res.data);
    const results = [];

    $('.b_algo').each((i, el) => {
      if (results.length >= 10) return;
      const titleEl = $(el).find('h2 a');
      const title = titleEl.text().trim();
      const rawUrl = titleEl.attr('href');
      const cleanUrl = decodeBingUrl(rawUrl);
      const snippet = $(el).find('.b_caption p').text().trim() || $(el).find('.b_algoDesc').text().trim();

      if (title && cleanUrl && cleanUrl.startsWith('http')) {
        results.push({
          title,
          url: cleanUrl,
          snippet: snippet || 'Hasil web terenkripsi.',
          source: 'Web Search',
          badge: 'web'
        });
      }
    });

    return results;
  } catch (err) {
    return [];
  }
}

// -------------------------------------------------------------
// 3. STEALTH PROXY WEB READER API
// -------------------------------------------------------------
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL target tidak ditemukan');
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: DEFAULT_HEADERS,
      timeout: 8000,
      maxRedirects: 5,
      responseType: 'text'
    });

    const contentType = response.headers['content-type'] || 'text/html';
    
    if (!contentType.includes('text/html')) {
      res.setHeader('Content-Type', contentType);
      return res.send(response.data);
    }

    const $ = cheerio.load(response.data);

    // Strip tracking scripts and annoying ads
    $('script').remove();
    $('iframe').remove();
    $('noscript').remove();

    // Rewrite relative links to proxy links
    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const fullUrl = new URL(href, targetUrl).href;
          $(el).attr('href', `/api/proxy?url=${encodeURIComponent(fullUrl)}`);
          $(el).attr('target', '_self');
        } catch (e) {}
      }
    });

    // Fix image sources
    $('img').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          const fullSrc = new URL(src, targetUrl).href;
          $(el).attr('src', fullSrc);
        } catch (e) {}
      }
    });

    // Stealth Top Bar
    const stealthBanner = `
      <div id="samaran-stealth-bar" style="
        position: fixed; top: 0; left: 0; right: 0; z-index: 999999;
        background: rgba(15, 23, 42, 0.95); backdrop-filter: blur(12px);
        color: #f8fafc; font-family: system-ui, -apple-system, sans-serif;
        padding: 10px 20px; display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 14px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      ">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="background: #10b981; color: #000; padding: 3px 8px; border-radius: 4px; font-weight: bold; font-size: 11px;">
            🛡️ PROXIED & SECURED
          </span>
          <span style="font-weight: 600; color: #94a3b8; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 450px;">
            ${targetUrl}
          </span>
        </div>
        <div style="display: flex; gap: 10px;">
          <button onclick="window.history.back()" style="background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.2); padding: 5px 12px; border-radius: 6px; cursor: pointer;">
            ← Kembali
          </button>
          <a href="${targetUrl}" target="_blank" style="background: #3b82f6; color: #fff; padding: 5px 12px; border-radius: 6px; text-decoration: none; font-size: 13px;">
            Buka Asli ↗
          </a>
        </div>
      </div>
      <div style="height: 50px;"></div>
    `;

    $('body').prepend(stealthBanner);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send($.html());
  } catch (err) {
    res.status(500).send(`
      <div style="font-family: sans-serif; padding: 40px; text-align: center; color: #ef4444; background: #0f172a; min-height: 100vh;">
        <h2>⚠️ Gagal Memuat Halaman via Proxy</h2>
        <p style="color: #94a3b8;">Halaman target (${targetUrl}) memblokir koneksi proxy atau sedang offline.</p>
        <p style="font-family: monospace; font-size: 12px; color: #64748b;">${err.message}</p>
        <button onclick="window.history.back()" style="margin-top: 20px; background: #3b82f6; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer;">
          Kembali ke Pencarian
        </button>
      </div>
    `);
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🔒 ShadowSearch Pro / Stealth Proxy Server Running!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
