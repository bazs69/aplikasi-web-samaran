/**
 * ShadowSearch Pro — Main Client Logic
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
  const btnClearHistory = document.getElementById('btn-clear-history');

  // State
  let currentEngine = 'all';
  let suggestTimeout = null;
  let vaultPin = localStorage.getItem('shadow_vault_pin') || null;
  let isVaultUnlocked = false;

  // -----------------------------------------------------------
  // 1. ENGINE SELECTOR CHIPS
  // -----------------------------------------------------------
  engineChips.forEach(chip => {
    chip.addEventListener('click', () => {
      engineChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentEngine = chip.dataset.engine;
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
  // 2. SEARCH INPUT & LIVE AUTO-SUGGESTIONS
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
  // 3. EXECUTE METASEARCH
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

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&engine=${currentEngine}`);
      const data = await res.json();

      loadingSpinner.classList.add('hidden');

      if (!data.results || data.results.length === 0) {
        resultsCount.textContent = 'Tidak ada hasil ditemukan';
        resultsContainer.innerHTML = `
          <div style="text-align: center; color: #94a3b8; padding: 30px;">
            <p>Tidak ada hasil pencarian untuk "${escapeHtml(query)}".</p>
            <p style="font-size: 12px; margin-top: 6px;">Coba gunakan kata kunci lain atau ubah mesin pencari.</p>
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
      resultsCount.textContent = 'Gagal memuat hasil';
      resultsContainer.innerHTML = `
        <div style="text-align: center; color: #ef4444; padding: 20px;">
          <p>⚠️ Terjadi kesalahan saat memuat hasil pencarian.</p>
          <p style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Periksa koneksi jaringan Anda.</p>
        </div>
      `;
    }
  }

  // -----------------------------------------------------------
  // 4. VAULT PIN SECURITY & HISTORY LOG
  // -----------------------------------------------------------
  btnVault.addEventListener('click', () => {
    openVaultModal();
  });

  btnHistory.addEventListener('click', () => {
    if (vaultPin && !isVaultUnlocked) {
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

    if (!vaultPin) {
      // Set new PIN
      vaultPin = entered;
      localStorage.setItem('shadow_vault_pin', vaultPin);
      isVaultUnlocked = true;
      document.getElementById('vault-status-label').textContent = 'Vault (Terbuka)';
      vaultModal.classList.add('hidden');
      alert('✅ PIN Vault berhasil dibuat dan diaktifkan!');
    } else if (entered === vaultPin) {
      // PIN Correct
      isVaultUnlocked = true;
      document.getElementById('vault-status-label').textContent = 'Vault (Terbuka)';
      vaultModal.classList.add('hidden');
      renderHistory();
      historyModal.classList.remove('hidden');
    } else {
      // Wrong PIN
      pinErrorMsg.classList.remove('hidden');
      pinInput.value = '';
    }
  }

  function saveToHistory(query) {
    let history = getHistoryArray();
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    
    // Add to front, limit to 50 items
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
    if (confirm('Apakah Anda yakin ingin menghapus seluruh riwayat pencarian lokal?')) {
      localStorage.removeItem('shadow_history_data');
      renderHistory();
    }
  });

  // Close modals
  document.querySelectorAll('.btn-close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
      vaultModal.classList.add('hidden');
      historyModal.classList.add('hidden');
    });
  });

  // -----------------------------------------------------------
  // 5. PANIC DISGUISE MODE (ESC KEY & TOGGLE)
  // -----------------------------------------------------------
  function activatePanic() {
    panicOverlay.classList.remove('hidden');
  }

  function deactivatePanic() {
    panicOverlay.classList.add('hidden');
  }

  btnPanic.addEventListener('click', activatePanic);
  btnExitPanic.addEventListener('click', deactivatePanic);

  // Global ESC Key Listener for Emergency Disguise
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!panicOverlay.classList.contains('hidden')) {
        deactivatePanic();
      } else {
        activatePanic();
      }
    }
  });

  // Helper
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
});
