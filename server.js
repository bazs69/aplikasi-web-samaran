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

// Stealth User-Agent Spoofing & No-SafeSearch Headers
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Cookie': 'SRCHHPGUSR=ADLT=OFF; PREF=LD=en-US&ADLT=OFF; NRSLT=20'
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
// 2. UNFILTERED METASEARCH API (SafeSearch OFF)
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

    // Uncensored Bing Web Search
    if (engine === 'duckduckgo' || engine === 'all' || engine === 'web') {
      const webResults = await fetchBingUncensored(query);
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

// -------------------------------------------------------------
// 2B. ANONYMOUS IMAGE SEARCH API
// -------------------------------------------------------------
app.get('/api/images', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&adlt=off&form=HDRSC2`;
    const response = await axios.get(searchUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF; PREF=LD=en-US&ADLT=OFF'
      },
      timeout: 7000
    });

    const $ = cheerio.load(response.data);
    const images = [];

    $('.iusc').each((i, el) => {
      if (images.length >= 16) return;
      try {
        const m = JSON.parse($(el).attr('m') || '{}');
        const imgUrl = m.murl;
        const thumbUrl = m.turl || m.murl;
        const title = m.t || query;
        const pageUrl = m.purl || imgUrl;

        if (imgUrl) {
          images.push({
            title,
            imgUrl,
            thumbUrl: `/api/media-proxy?url=${encodeURIComponent(thumbUrl)}`,
            pageUrl,
            proxyImgUrl: `/api/media-proxy?url=${encodeURIComponent(imgUrl)}`
          });
        }
      } catch (e) {}
    });

    res.json({ query, results: images });
  } catch (err) {
    console.error('Image Search Error:', err.message);
    res.json({ query, results: [] });
  }
});

// -------------------------------------------------------------
// 2C. ANONYMOUS VIDEO SEARCH API
// -------------------------------------------------------------
app.get('/api/videos', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json({ results: [] });

  try {
    const searchUrl = `https://www.bing.com/videos/search?q=${encodeURIComponent(query)}&adlt=off`;
    const response = await axios.get(searchUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF; PREF=LD=en-US&ADLT=OFF'
      },
      timeout: 7000
    });

    const $ = cheerio.load(response.data);
    const videos = [];

    $('.mc_vtvc').each((i, el) => {
      if (videos.length >= 12) return;
      const titleEl = $(el).find('.vrhdata');
      let title = 'Video';
      let targetUrl = '';
      
      try {
        const vrData = JSON.parse(titleEl.attr('vrdata') || '{}');
        title = vrData.vt || $(el).find('.mc_vtvc_title').text().trim();
        targetUrl = vrData.du || $(el).find('a').attr('href');
      } catch (e) {
        title = $(el).find('.mc_vtvc_title').text().trim() || 'Video';
        targetUrl = $(el).find('a').attr('href');
      }

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
    console.error('Video Search Error:', err.message);
    res.json({ query, results: [] });
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

// Uncensored Bing Web Search (SafeSearch=OFF)
async function fetchBingUncensored(query) {
  try {
    const searchUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&adlt=off&setmkt=en-US&setlang=en-US`;
    const res = await axios.get(searchUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Cookie': 'SRCHHPGUSR=ADLT=OFF; PREF=LD=en-US&ADLT=OFF; NRSLT=20'
      },
      timeout: 7000
    });
    const $ = cheerio.load(res.data);
    const results = [];

    $('.b_algo').each((i, el) => {
      if (results.length >= 12) return;
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
// 3. MEDIA STREAM PROXY (Video/Audio)
// -------------------------------------------------------------
app.get('/api/media-proxy', async (req, res) => {
  const mediaUrl = req.query.url;
  if (!mediaUrl) return res.status(400).send('Media URL missing');

  try {
    const reqHeaders = {
      ...DEFAULT_HEADERS,
      'Referer': mediaUrl
    };
    if (req.headers.range) {
      reqHeaders['Range'] = req.headers.range;
    }

    const response = await axios({
      method: 'get',
      url: mediaUrl,
      headers: reqHeaders,
      responseType: 'stream',
      timeout: 20000
    });

    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    }
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['accept-ranges']) {
      res.setHeader('Accept-Ranges', response.headers['accept-ranges']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    console.error('Media Proxy Error:', err.message);
    res.status(500).send('Error streaming media');
  }
});

// -------------------------------------------------------------
// 4. UNLIMITED STEALTH PROXY WEB READER
// -------------------------------------------------------------
app.get('/api/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL target tidak ditemukan');
  }

  try {
    const response = await axios.get(targetUrl, {
      headers: {
        ...DEFAULT_HEADERS,
        'Referer': targetUrl
      },
      timeout: 12000,
      maxRedirects: 5,
      responseType: 'text'
    });

    const contentType = response.headers['content-type'] || 'text/html';
    
    if (!contentType.includes('text/html')) {
      res.setHeader('Content-Type', contentType);
      return res.send(response.data);
    }

    const $ = cheerio.load(response.data);

    // Proxy HTML5 Video/Audio elements
    $('video, audio, source').each((_, el) => {
      const src = $(el).attr('src');
      if (src) {
        try {
          const fullSrc = new URL(src, targetUrl).href;
          $(el).attr('src', `/api/media-proxy?url=${encodeURIComponent(fullSrc)}`);
        } catch (e) {}
      }
    });

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
            🛡️ PROXIED & SECURED (UNCENSORED)
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
  console.log(`🔒 ShadowSearch Pro / Advanced Stealth Server Active!`);
  console.log(`🌐 Open in browser: http://localhost:${PORT}`);
  console.log(`====================================================`);
});
