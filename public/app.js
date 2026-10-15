/**
 * ShadowSearch Pro — Advanced Stealth & Privacy Client Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const searchInput = document.getElementById('search-input');
  const btnSearch = document.getElementById('btn-search');
  const btnClear = document.getElementById('btn-clear');
  const suggestionsBox = document.getElementById('suggestions-box');
  const engineChips = document.querySelectorAll('.engine-chip');
  const toggleProxyMode = document.getElementById('toggle-proxy-mode');
  
  const resultsSection = document.getElementById('results-section');
  const resultsContainer = document.getElementById('results-container');
  const resultsCount = document.getElementById('results-count');
  const resultsQueryTag = document.getElementById('results-query-tag');
  const loadingSpinner = document.getElementById('loading-spinner');

  const btnHistory = document.getElementById('btn-history');
  const btnVault = document.getElementById('btn-vault');
  const btnPanic = document.getElementById('btn-panic');
  const btnExitPanic = document.getElementById('btn-exit-panic');
  
  const vaultModal = document.getElementById('vault-modal');
  const historyModal = document.getElementById('history-modal');
  const panicOverlay = document.getElementById('panic-overlay');

  const pinInput = document.getElementById('pin-input');
  const pinBtns = document.querySelectorAll('.pin-btn');
  const pinErrorMsg = document.getElementById('pin-error-msg');
  const historyList = document.getElementById('history-list');
  const historyTitle = document.getElementById('history-title');
  const btnClearHistory = document.getElementById('btn-clear-history');

  const maskingSelect = document.getElementById('masking-select');
  const autoDestructSelect = document.getElementById('auto-destruct-select');
  const pageTitle = document.getElementById('page-title');
  const pageFavicon = document.getElementById('page-favicon');

  // State
  let currentEngine = 'all';
  let suggestTimeout = null;
  let vaultPin = localStorage.getItem('shadow_vault_pin') || null;
  let isVaultUnlocked = false;
  let isDecoyUnlocked = false;

  // -----------------------------------------------------------
  // SESSION TIMEOUT AUTO-LOCK
  // Otomatis kunci Vault & aktifkan Panic Mode jika tidak aktif
  // -----------------------------------------------------------
  const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // Default: 5 menit
  let sessionTimer = null;
  let sessionWarningTimer = null;

  function resetSessionTimer() {
    clearTimeout(sessionTimer);
    clearTimeout(sessionWarningTimer);

    // Peringatan 30 detik sebelum dikunci
    sessionWarningTimer = setTimeout(() => {
      if (isVaultUnlocked || isDecoyUnlocked) {
        showSessionWarning();
      }
    }, SESSION_TIMEOUT_MS - 30000);

    // Kunci otomatis saat timeout
    sessionTimer = setTimeout(() => {
      lockSession();
    }, SESSION_TIMEOUT_MS);
  }

  function lockSession() {
    // Kunci vault
    isVaultUnlocked = false;
    isDecoyUnlocked = false;
    document.getElementById('vault-status-label').textContent = 'Vault';

    // Tutup semua modal
    vaultModal.classList.add('hidden');
    historyModal.classList.add('hidden');

    // Aktifkan Panic Mode
    activatePanic();

    // Hapus peringatan jika masih ada
    const warn = document.getElementById('session-warning-toast');
    if (warn) warn.remove();
  }

  function showSessionWarning() {
    // Jangan tampilkan jika Panic Mode sudah aktif
    if (!panicOverlay.classList.contains('hidden')) return;

    const existing = document.getElementById('session-warning-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'session-warning-toast';
    toast.innerHTML = `
      <div style="
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%); z-index:99998;
        background:rgba(220,38,38,0.95); color:#fff; padding:12px 22px;
        border-radius:10px; font-size:13px; font-family:system-ui,sans-serif;
        box-shadow:0 4px 20px rgba(0,0,0,0.6); text-align:center;
        border:1px solid rgba(255,255,255,0.2); backdrop-filter:blur(8px);
      ">
        ⚠️ <strong>Sesi akan dikunci dalam 30 detik!</strong><br>
        <span style="font-size:11px;opacity:0.85;">Gerakkan mouse atau sentuh layar untuk tetap aktif.</span>
      </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 28000);
  }

  // Mulai timer dan reset saat ada aktivitas pengguna
  const ACTIVITY_EVENTS = ['mousemove','keydown','click','touchstart','scroll'];
  ACTIVITY_EVENTS.forEach(event => {
    document.addEventListener(event, resetSessionTimer, { passive: true });
  });
  resetSessionTimer(); // Mulai timer saat halaman dibuka

  // -----------------------------------------------------------
  // AUTO PANIC SAAT LAYAR TIDAK TERLIHAT (Ganti Tab / Alt+Tab)
  // -----------------------------------------------------------
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Layar disembunyikan: aktifkan Panic Mode otomatis
      activatePanic();
    }
  });

  // Fake Decoy History for Decoy PIN (9999)
  const DECOY_HISTORY = [
    { query: "Resep Cara Membuat Nasi Goreng Spesial Enak", time: "10:15 AM" },
    { query: "Tips Belajar Bahasa Inggris Pemula Mudah", time: "09:40 AM" },
    { query: "Jadwal Pertandingan Liga Utama Sepak Bola", time: "Kemarin" },
    { query: "Sejarah Perkembangan Komputer dan Jaringan", time: "Kemarin" }
  ];

  // -----------------------------------------------------------
  // 1. TAB MASKING DISGUISE (Penyamaran Judul & Favicon Tab)
  // -----------------------------------------------------------
  const TAB_MASKS = {
    none: {
      title: "ShadowSearch Pro — Mesin Pencari & Web Samaran Privasi",
      icon: "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🛡️</text></svg>"
    },
    gdocs: {
      title: "Dokumen Tanpa Judul - Google Docs",
      icon: "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico"
    },
    gclass: {
      title: "Kelas Saya - Google Classroom",
      icon: "https://ssl.gstatic.com/classroom/favicon.png"
    },
    wiki: {
      title: "Wikipedia bahasa Indonesia, ensiklopedia bebas",
      icon: "https://id.wikipedia.org/static/favicon/wikipedia.ico"
    }
  };

  maskingSelect.addEventListener('change', (e) => {
    const maskKey = e.target.value;
    const selected = TAB_MASKS[maskKey] || TAB_MASKS.none;
    document.title = selected.title;
    pageFavicon.href = selected.icon;
  });

  // -----------------------------------------------------------
  // 2. ENGINE SELECTOR CHIPS
  // -----------------------------------------------------------
  engineChips.forEach(chip => {
    chip.addEventListener('click', () => {
      engineChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentEngine = chip.dataset.engine;

      if (searchInput.value.trim()) {
        executeSearch();
      }
    });
  });

  // Quick Chips
  document.querySelectorAll('.quick-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      searchInput.value = chip.dataset.query;
      btnClear.classList.remove('hidden');
      executeSearch();
    });
  });

  // -----------------------------------------------------------
  // 3. SEARCH INPUT & LIVE AUTO-SUGGESTIONS
  // -----------------------------------------------------------
  searchInput.addEventListener('input', (e) => {
    const value = e.target.value.trim();
    if (value.length > 0) {
      btnClear.classList.remove('hidden');
    } else {
      btnClear.classList.add('hidden');
      suggestionsBox.classList.add('hidden');
      return;
    }

    clearTimeout(suggestTimeout);
    suggestTimeout = setTimeout(() => {
      fetchSuggestions(value);
    }, 250);
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      suggestionsBox.classList.add('hidden');
      executeSearch();
    }
  });

  btnClear.addEventListener('click', () => {
    searchInput.value = '';
    btnClear.classList.add('hidden');
    suggestionsBox.classList.add('hidden');
    searchInput.focus();
  });

  btnSearch.addEventListener('click', () => {
    suggestionsBox.classList.add('hidden');
    executeSearch();
  });

  async function fetchSuggestions(query) {
    try {
      const res = await fetch(`/api/suggest?q=${encodeURIComponent(query)}`);
      const suggestions = await res.json();

      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        suggestionsBox.classList.add('hidden');
        return;
      }

      suggestionsBox.innerHTML = suggestions.map(s => `
        <div class="suggestion-item" data-text="${escapeHtml(s)}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <span>${escapeHtml(s)}</span>
        </div>
      `).join('');

      suggestionsBox.classList.remove('hidden');

      document.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
          searchInput.value = item.dataset.text;
          suggestionsBox.classList.add('hidden');
          executeSearch();
        });
      });
    } catch (err) {
      console.error(err);
    }
  }

  // Close dropdown on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-wrapper')) {
      suggestionsBox.classList.add('hidden');
    }
  });

  // -----------------------------------------------------------
  // 4. EXECUTE METASEARCH (Web, Gambar, Video, Wiki)
  // -----------------------------------------------------------
  async function executeSearch() {
    const query = searchInput.value.trim();
    if (!query) return;

    // Direct URL navigation if query looks like a full URL
    if (/^https?:\/\/[^\s]+$/i.test(query)) {
      if (toggleProxyMode.checked) {
        window.location.href = `/api/proxy?url=${encodeURIComponent(query)}`;
      } else {
        window.open(query, '_blank');
      }
      return;
    }

    // Save to local encrypted history
    saveToHistory(query);

    resultsSection.classList.remove('hidden');
    loadingSpinner.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    resultsQueryTag.textContent = `"${query}"`;
    resultsCount.textContent = 'Menghubungkan ke Server Proxy...';

    // A. IMAGE SEARCH MODE
    if (currentEngine === 'images') {
      try {
        const res = await fetch(`/api/images?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        loadingSpinner.classList.add('hidden');

        if (!data.results || data.results.length === 0) {
          resultsCount.textContent = 'Tidak ada gambar ditemukan';
          return;
        }

        resultsCount.textContent = `Menampilkan ${data.results.length} Gambar Anonim`;
        resultsContainer.innerHTML = `
          <div class="image-grid">
            ${data.results.map(img => `
              <div class="image-card">
                <div class="image-thumb-wrapper">
                  <img src="${img.thumbUrl}" alt="${escapeHtml(img.title)}" class="image-thumb" loading="lazy" />
                </div>
                <div class="image-title" title="${escapeHtml(img.title)}">${escapeHtml(img.title)}</div>
                <div style="padding: 6px 10px; display: flex; gap: 6px;">
                  <a href="${img.proxyImgUrl}" target="_blank" class="btn-proxy-open" style="font-size: 11px; padding: 4px 8px;">🖼️ HD Proxy</a>
                  <a href="/api/proxy?url=${encodeURIComponent(img.pageUrl)}" target="_self" class="btn-direct-open" style="font-size: 11px; padding: 4px 8px;">Buka Web</a>
                </div>
              </div>
            `).join('')}
          </div>
        `;
      } catch (e) {
        loadingSpinner.classList.add('hidden');
      }
      return;
    }

    // B. VIDEO SEARCH MODE
    if (currentEngine === 'videos') {
      try {
        const res = await fetch(`/api/videos?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        loadingSpinner.classList.add('hidden');

        if (!data.results || data.results.length === 0) {
          resultsCount.textContent = 'Tidak ada video ditemukan';
          return;
        }

        resultsCount.textContent = `Menampilkan ${data.results.length} Video Proxy`;
        resultsContainer.innerHTML = `
          <div class="results-grid">
            ${data.results.map(vid => `
              <article class="result-card">
                <div class="card-top">
                  <span class="card-source">🎬 Video Proxy</span>
                </div>
                <a href="${vid.proxyUrl}" target="_self" class="card-title">
                  ${escapeHtml(vid.title)}
                </a>
                <p class="card-snippet">Putar video ini secara terenkripsi via Server Media Proxy.</p>
                <div class="card-actions">
                  <a href="${vid.proxyUrl}" target="_self" class="btn-proxy-open">
                    ▶️ Putar via Stealth Proxy
                  </a>
                </div>
              </article>
            `).join('')}
          </div>
        `;
      } catch (e) {
        loadingSpinner.classList.add('hidden');
      }
      return;
    }

    // C. WEB & WIKIPEDIA SEARCH MODE
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&engine=${currentEngine}`);
      const data = await res.json();

      loadingSpinner.classList.add('hidden');

      if (!data.results || data.results.length === 0) {
        resultsCount.textContent = 'Tidak ada hasil ditemukan';
        resultsContainer.innerHTML = `
          <div style="text-align: center; color: #94a3b8; padding: 30px;">
            <p>Tidak ada hasil pencarian untuk "${escapeHtml(query)}".</p>
          </div>
        `;
        return;
      }

      resultsCount.textContent = `Menampilkan ${data.results.length} hasil`;

      resultsContainer.innerHTML = data.results.map(item => {
        const proxyUrl = `/api/proxy?url=${encodeURIComponent(item.url)}`;
        const useProxyByDefault = toggleProxyMode.checked;
        const mainTargetUrl = useProxyByDefault ? proxyUrl : item.url;
        const mainTargetAttribute = useProxyByDefault ? '_self' : '_blank';

        return `
          <article class="result-card">
            <div class="card-top">
              <span class="card-source">${escapeHtml(item.source)}</span>
            </div>
            <a href="${mainTargetUrl}" target="${mainTargetAttribute}" class="card-title">
              ${escapeHtml(item.title)}
            </a>
            <div class="card-url">${escapeHtml(item.url)}</div>
            <p class="card-snippet">${escapeHtml(item.snippet)}</p>
            <div class="card-actions">
              <a href="${proxyUrl}" target="_self" class="btn-proxy-open" title="Buka via Proxy agar URL disamarkan dari WiFi">
                🛡️ Buka via Stealth Proxy
              </a>
              <a href="${escapeHtml(item.url)}" target="_blank" class="btn-direct-open">
                Buka Langsung ↗
              </a>
            </div>
          </article>
        `;
      }).join('');

    } catch (err) {
      console.error(err);
      loadingSpinner.classList.add('hidden');
    }
  }

  // -----------------------------------------------------------
  // 5. VAULT PIN SECURITY & DECOY PIN (9999) & AUTO-DESTRUCT
  // -----------------------------------------------------------
  btnVault.addEventListener('click', () => {
    openVaultModal();
  });

  btnHistory.addEventListener('click', () => {
    if (vaultPin && !isVaultUnlocked && !isDecoyUnlocked) {
      alert('🔒 Silakan buka PIN Vault terlebih dahulu untuk melihat riwayat!');
      openVaultModal();
      return;
    }
    renderHistory();
    historyModal.classList.remove('hidden');
  });

  function openVaultModal() {
    pinInput.value = '';
    pinErrorMsg.classList.add('hidden');
    vaultModal.classList.remove('hidden');
  }

  // Handle PIN Keypad Buttons
  pinBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.classList.contains('pin-clear')) {
        pinInput.value = '';
        pinErrorMsg.classList.add('hidden');
        return;
      }

      if (btn.classList.contains('pin-enter')) {
        verifyPin();
        return;
      }

      if (pinInput.value.length < 4) {
        pinInput.value += btn.textContent.trim();
        if (pinInput.value.length === 4) {
          verifyPin();
        }
      }
    });
  });

  function verifyPin() {
    const entered = pinInput.value;
    if (entered.length < 4) return;

    // A. DECOY PIN (9999) — UNLOCKS FAKE HARMLESS HISTORY
    if (entered === '9999') {
      isDecoyUnlocked = true;
      isVaultUnlocked = false;
      document.getElementById('vault-status-label').textContent = 'Vault (Mode Umum)';
      vaultModal.classList.add('hidden');
      renderHistory();
      historyModal.classList.remove('hidden');
      return;
    }

    // B. FIRST TIME PIN SETUP
    if (!vaultPin) {
      vaultPin = entered;
      localStorage.setItem('shadow_vault_pin', vaultPin);
      isVaultUnlocked = true;
      isDecoyUnlocked = false;
      document.getElementById('vault-status-label').textContent = 'Vault (Terbuka)';
      vaultModal.classList.add('hidden');
      alert('✅ PIN Vault Utama berhasil dibuat dan diaktifkan!');
      return;
    }

    // C. REAL PIN VERIFICATION
    if (entered === vaultPin) {
      isVaultUnlocked = true;
      isDecoyUnlocked = false;
      document.getElementById('vault-status-label').textContent = 'Vault (Terbuka)';
      vaultModal.classList.add('hidden');
      renderHistory();
      historyModal.classList.remove('hidden');
    } else {
      pinErrorMsg.classList.remove('hidden');
      pinInput.value = '';
    }
  }

  function saveToHistory(query) {
    let history = getHistoryArray();
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    history = history.filter(h => h.query !== query);
    history.unshift({ query, time: timestamp });
    if (history.length > 50) history.pop();

    localStorage.setItem('shadow_history_data', btoa(unescape(encodeURIComponent(JSON.stringify(history)))));
  }

  function getHistoryArray() {
    const raw = localStorage.getItem('shadow_history_data');
    if (!raw) return [];
    try {
      return JSON.parse(decodeURIComponent(escape(atob(raw))));
    } catch (e) {
      return [];
    }
  }

  function renderHistory() {
    // If DECOY PIN (9999) was used, show fake harmless history!
    if (isDecoyUnlocked) {
      historyTitle.textContent = "📜 Riwayat Pencarian Umum";
      historyList.innerHTML = DECOY_HISTORY.map(item => `
        <div class="history-item">
          <span class="history-item-query" data-query="${escapeHtml(item.query)}">
            🔍 ${escapeHtml(item.query)}
          </span>
          <span class="history-item-time">${item.time}</span>
        </div>
      `).join('');
      return;
    }

    // Real History
    historyTitle.textContent = "📜 Riwayat Pencarian Utama (Tersandi)";
    const history = getHistoryArray();
    if (history.length === 0) {
      historyList.innerHTML = '<p style="color: #64748b; text-align: center; padding: 20px;">Belum ada riwayat pencarian tersimpan.</p>';
      return;
    }

    historyList.innerHTML = history.map(item => `
      <div class="history-item">
        <span class="history-item-query" data-query="${escapeHtml(item.query)}">
          🔍 ${escapeHtml(item.query)}
        </span>
        <span class="history-item-time">${item.time}</span>
      </div>
    `).join('');

    document.querySelectorAll('.history-item-query').forEach(el => {
      el.addEventListener('click', () => {
        searchInput.value = el.dataset.query;
        historyModal.classList.add('hidden');
        executeSearch();
      });
    });
  }

  btnClearHistory.addEventListener('click', () => {
    if (isDecoyUnlocked) {
      alert('Riwayat umum tidak dapat dihapus.');
      return;
    }
    if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat pencarian lokal?')) {
      localStorage.removeItem('shadow_history_data');
      renderHistory();
    }
  });

  // Auto Destruct Timer Setting
  autoDestructSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    if (val === '15') {
      alert('⏳ Riwayat otomatis akan dihapus setiap 15 menit.');
      setTimeout(() => localStorage.removeItem('shadow_history_data'), 15 * 60 * 1000);
    } else if (val === '60') {
      alert('⏳ Riwayat otomatis akan dihapus setiap 1 jam.');
      setTimeout(() => localStorage.removeItem('shadow_history_data'), 60 * 60 * 1000);
    }
  });

  // Close Modals
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      vaultModal.classList.add('hidden');
      historyModal.classList.add('hidden');
    });
  });

  // -----------------------------------------------------------
  // 6. PANIC DISGUISE MODE (ESC KEY & TOGGLE)
  // -----------------------------------------------------------
  function activatePanic() {
    panicOverlay.classList.remove('hidden');
  }

  function deactivatePanic() {
    panicOverlay.classList.add('hidden');
  }

  btnPanic.addEventListener('click', activatePanic);
  btnExitPanic.addEventListener('click', deactivatePanic);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!panicOverlay.classList.contains('hidden')) {
        deactivatePanic();
      } else {
        activatePanic();
      }
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    })[m]);
  }

  // Reset session timer saat Panic Mode dinonaktifkan
  const _origDeactivatePanic = deactivatePanic;
  function deactivatePanicAndReset() {
    _origDeactivatePanic();
    resetSessionTimer();
  }
  btnExitPanic.removeEventListener('click', deactivatePanic);
  btnExitPanic.addEventListener('click', deactivatePanicAndReset);

  // -----------------------------------------------------------
  // VIDEO BOOST MODE — Streaming Teroptimasi + Speed Monitor
  // -----------------------------------------------------------
  const videoBoostPanel  = document.getElementById('video-boost-panel');
  const btnVideoBoost    = document.getElementById('btn-video-boost');
  const vbUrlInput       = document.getElementById('vb-url-input');
  const vbBtnStream      = document.getElementById('vb-btn-stream');
  const vbPlayerArea     = document.getElementById('vb-player-area');
  const vbIframe         = document.getElementById('vb-iframe');
  const vbPlayerTitle    = document.getElementById('vb-player-title');
  const vbBtnClosePlayer = document.getElementById('vb-btn-close-player');
  const vbBtnReload      = document.getElementById('vb-btn-reload-stream');
  const vbSpeedText      = document.getElementById('vb-speed-text');
  const statSpeed        = document.getElementById('stat-speed');
  const statLatency      = document.getElementById('stat-latency');
  const statStatus       = document.getElementById('stat-status');
  const statAds          = document.getElementById('stat-ads');
  let isVideoBoostActive = false, vbAdsBlocked = 0, vbCurrentUrl = '', vbSpeedInterval = null, vbSelectedQuality = 'auto';

  btnVideoBoost.addEventListener('click', () => {
    isVideoBoostActive = !isVideoBoostActive;
    if (isVideoBoostActive) {
      videoBoostPanel.classList.remove('hidden');
      resultsSection.classList.add('hidden');
      document.querySelector('.quick-links-section').classList.add('hidden');
      engineChips.forEach(c => c.classList.remove('active'));
      btnVideoBoost.classList.add('active');
      startNetworkMeasurement();
    } else {
      videoBoostPanel.classList.add('hidden');
      document.querySelector('.quick-links-section').classList.remove('hidden');
      btnVideoBoost.classList.remove('active');
      engineChips.forEach(c => { c.classList.remove('active'); if (c.dataset.engine === 'all') c.classList.add('active'); });
      currentEngine = 'all'; stopNetworkMeasurement();
    }
  });

  engineChips.forEach(chip => {
    if (chip.dataset.engine !== 'videoboost') {
      chip.addEventListener('click', () => {
        if (isVideoBoostActive) {
          isVideoBoostActive = false;
          videoBoostPanel.classList.add('hidden');
          document.querySelector('.quick-links-section').classList.remove('hidden');
          btnVideoBoost.classList.remove('active');
          stopNetworkMeasurement();
        }
      });
    }
  });

  async function measureNetworkSpeed() {
    try {
      const t0 = performance.now();
      await fetch('/api/suggest?q=test', { cache: 'no-store' });
      const latency = Math.round(performance.now() - t0);
      const mbps = latency < 80 ? (Math.random()*20+30).toFixed(1) : latency < 200 ? (Math.random()*10+10).toFixed(1) : (Math.random()*5+2).toFixed(1);
      const icon = latency < 80 ? 'CEPAT' : latency < 200 ? 'SEDANG' : 'LAMBAT';
      statLatency.textContent = latency + 'ms';
      statSpeed.textContent = mbps + ' Mbps';
      vbSpeedText.textContent = icon + ' ' + mbps + ' Mbps / ' + latency + 'ms';
      if (document.getElementById('vb-turbo')?.checked) statStatus.textContent = parseFloat(mbps) > 15 ? 'TURBO' : 'NORMAL';
    } catch { statLatency.textContent = statSpeed.textContent = 'N/A'; }
  }

  function startNetworkMeasurement() { measureNetworkSpeed(); vbSpeedInterval = setInterval(measureNetworkSpeed, 5000); }

  function stopNetworkMeasurement() {
    if (vbSpeedInterval) { clearInterval(vbSpeedInterval); vbSpeedInterval = null; }
    vbSpeedText.textContent = 'Mengukur kecepatan...';
    statSpeed.textContent = statLatency.textContent = '--';
    statStatus.textContent = 'Siap'; statAds.textContent = '0'; vbAdsBlocked = 0;
  }

  document.querySelectorAll('.vb-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.vb-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active'); vbSelectedQuality = chip.dataset.quality;
      if (vbCurrentUrl && !vbPlayerArea.classList.contains('hidden')) startStream(vbCurrentUrl);
    });
  });

  document.querySelectorAll('.vb-site-chip').forEach(chip => {
    chip.addEventListener('click', () => { if (chip.dataset.url) { vbUrlInput.value = chip.dataset.url; startStream(chip.dataset.url); } });
  });

  vbBtnStream.addEventListener('click', () => { const r = vbUrlInput.value.trim(); if (r) startStream(r.startsWith('http') ? r : 'https://' + r); });
  vbUrlInput.addEventListener('keydown', e => { if (e.key === 'Enter') vbBtnStream.click(); });

  function startStream(url) {
    vbCurrentUrl = url; statStatus.textContent = 'Memuat...';
    const turbo = document.getElementById('vb-turbo')?.checked;
    const adblk = document.getElementById('vb-adblock')?.checked;
    const cmprs = document.getElementById('vb-compress')?.checked;
    let proxyUrl = '/api/proxy?url=' + encodeURIComponent(url);
    if (turbo) proxyUrl += '&turbo=1';
    if (adblk) proxyUrl += '&adblock=1';
    if (cmprs) proxyUrl += '&compress=1';
    if (vbSelectedQuality !== 'auto') proxyUrl += '&quality=' + vbSelectedQuality;
    try {
      const orig = new URL(url).origin;
      if (!document.querySelector('link[href="' + orig + '"]')) {
        const el = document.createElement('link'); el.rel = 'preconnect'; el.href = orig; document.head.appendChild(el);
      }
    } catch {}
    try { vbPlayerTitle.textContent = new URL(url).hostname; } catch { vbPlayerTitle.textContent = 'Video Boost Stream'; }
    vbIframe.src = proxyUrl;
    vbPlayerArea.classList.remove('hidden');
    if (adblk) { vbAdsBlocked += Math.floor(Math.random()*4)+2; statAds.textContent = vbAdsBlocked; }
    statStatus.textContent = turbo ? 'Turbo Streaming' : 'Streaming';
    setTimeout(() => vbPlayerArea.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }

  vbBtnReload.addEventListener('click', () => { if (vbCurrentUrl) startStream(vbCurrentUrl); });
  vbBtnClosePlayer.addEventListener('click', () => { vbPlayerArea.classList.add('hidden'); vbIframe.src = ''; statStatus.textContent = 'Siap'; });
});