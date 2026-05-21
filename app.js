/**
 * IG Analyzer — app.js
 * All logic: file parsing, data analysis, rendering
 */

(function () {
  'use strict';

  // ── CONFIG ─────────────────────────────────────────────────────
  const PAGE_SIZE = 60;

  const TAB_CONFIG = [
    {
      key:   'dontFollowBack',
      label: "Don't Follow Back",
      desc:  "You follow them — they don't follow you back",
      color: '#ff3d78',
      icon:  '💔',
    },
    {
      key:   'notFollowingBack',
      label: "Not Following Back",
      desc:  "They follow you — you don't follow them",
      color: '#ffb340',
      icon:  '👁',
    },
    {
      key:   'mutual',
      label: "Mutual",
      desc:  "You follow each other",
      color: '#3dffa0',
      icon:  '🤝',
    },
    {
      key:   'closeFriends',
      label: "Close Friends",
      desc:  "Your close friends list",
      color: '#e879f9',
      icon:  '⭐',
    },
    {
      key:   'blocked',
      label: "Blocked",
      desc:  "Accounts you have blocked",
      color: '#ff4545',
      icon:  '🚫',
    },
    {
      key:   'pendingRequests',
      label: "Pending Sent",
      desc:  "Follow requests you sent, not yet accepted",
      color: '#a855f7',
      icon:  '⏳',
    },
    {
      key:   'receivedRequests',
      label: "Pending Received",
      desc:  "Follow requests awaiting your approval",
      color: '#00d4ff',
      icon:  '📨',
    },
    {
      key:   'recentlyUnfollowed',
      label: "Unfollowed",
      desc:  "Accounts you recently unfollowed",
      color: '#8899aa',
      icon:  '👋',
    },
    {
      key:   'hideStoryFrom',
      label: "Hidden Story",
      desc:  "People hidden from your stories",
      color: '#ff7043',
      icon:  '🙈',
    },
    {
      key:   'removedSuggestions',
      label: "Removed Suggestions",
      desc:  "Suggestions you dismissed",
      color: '#607d8b',
      icon:  '❌',
    },
  ];

  const STAT_CONFIG = [
    { key: 'followers',        label: 'Followers',          color: '#3dffa0' },
    { key: 'following',        label: 'Following',          color: '#4f8bff' },
    { key: 'dontFollowBack',   label: "Don't Follow Back",  color: '#ff3d78' },
    { key: 'notFollowingBack', label: "Not Following Back", color: '#ffb340' },
    { key: 'mutual',           label: 'Mutual',             color: '#00d4ff' },
    { key: 'blocked',          label: 'Blocked',            color: '#ff4545' },
  ];

  // ── STATE ──────────────────────────────────────────────────────
  const store = {
    raw: {
      followers:          [],
      following:          [],
      closeFriends:       [],
      blocked:            [],
      pendingRequests:    [],
      receivedRequests:   [],
      recentlyUnfollowed: [],
      recentFollowRequests: [],
      hideStoryFrom:      [],
      removedSuggestions: [],
    },
    lists: {},
    currentTab:  '',
    currentPage: 1,
    searchQuery: '',
  };

  // ── UTILITY ────────────────────────────────────────────────────

  /**
   * Given any Instagram JSON structure, extract a flat array of
   * { username, href, timestamp } objects.
   *
   * Handles two export formats:
   *  1. Old format: items with `string_list_data` array and/or `title`
   *     (used by followers_1.json and following.json)
   *  2. New format: items with `label_values` array containing {label, value} pairs
   *     (used by blocked, close_friends, pending_requests, etc.)
   */
  function extractUsers(data) {
    const result = [];
    if (!data) return result;

    // Unwrap top-level object if needed (e.g. { relationships_following: [...] })
    const arr = Array.isArray(data)
      ? data
      : Object.values(data)[0];

    if (!Array.isArray(arr)) return result;

    for (const item of arr) {
      // ── NEW FORMAT: label_values ────────────────────────────────
      if (Array.isArray(item.label_values) && item.label_values.length > 0) {
        const lv = item.label_values;
        const getVal = label => {
          const entry = lv.find(e => e.label === label);
          return entry ? (entry.value || '') : '';
        };
        const username = getVal('Username');
        if (!username) continue;
        const url = getVal('URL');
        result.push({
          username,
          href:      url || `https://www.instagram.com/${username}`,
          timestamp: item.timestamp || 0,
        });
        continue;
      }

      // ── OLD FORMAT: string_list_data ───────────────────────────
      const sld = Array.isArray(item.string_list_data) ? item.string_list_data : [];
      if (sld.length > 0) {
        for (const s of sld) {
          const username = s.value || item.title || extractUsernameFromHref(s.href) || '';
          if (username) {
            result.push({
              username,
              href:      s.href || `https://www.instagram.com/${username}`,
              timestamp: s.timestamp || 0,
            });
          }
        }
      } else if (item.title) {
        // following.json uses `title` with no string_list_data values
        result.push({
          username:  item.title,
          href:      `https://www.instagram.com/_u/${item.title}`,
          timestamp: 0,
        });
      }
    }

    return result;
  }

  function extractUsernameFromHref(href) {
    if (!href) return '';
    return href.split('/').filter(Boolean).pop() || '';
  }

  function formatDate(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      year:  'numeric',
    });
  }

  function initials(username) {
    return username.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || '??';
  }

  // ── FILE HANDLING ──────────────────────────────────────────────

  const FILE_MAP = [
    { match: n => n.includes('follower'),                              slot: 'followers',          storeKey: 'followers' },
    { match: n => n.includes('following') && !n.includes('recent'),   slot: 'following',          storeKey: 'following' },
    { match: n => n.includes('close'),                                 slot: 'close_friends',      storeKey: 'closeFriends' },
    { match: n => n.includes('blocked'),                               slot: 'blocked',            storeKey: 'blocked' },
    { match: n => n.includes('pending'),                               slot: 'pending',            storeKey: 'pendingRequests' },
    { match: n => n.includes('received') || n.includes('requests_you'), slot: 'received',         storeKey: 'receivedRequests' },
    { match: n => n.includes('unfollowed'),                            slot: 'unfollowed',         storeKey: 'recentlyUnfollowed' },
    { match: n => n.includes('recent_follow'),                         slot: 'recent_requests',    storeKey: 'recentFollowRequests' },
    { match: n => n.includes('hide'),                                  slot: 'hide_story',         storeKey: 'hideStoryFrom' },
    { match: n => n.includes('removed') || n.includes('suggestion'),   slot: 'removed',            storeKey: 'removedSuggestions' },
  ];

  function mapAndStoreFile(filename, json) {
    const n = filename.toLowerCase();
    const entry = FILE_MAP.find(e => e.match(n));
    if (!entry) return;
    store.raw[entry.storeKey] = extractUsers(json);
    markSlotLoaded(entry.slot);
  }

  function markSlotLoaded(slot) {
    const el = document.querySelector(`[data-slot="${slot}"]`);
    if (el) el.classList.add('loaded');
    checkCanAnalyze();
  }

  function checkCanAnalyze() {
    const canAnalyze =
      store.raw.followers.length > 0 ||
      store.raw.following.length > 0;
    const btn = document.getElementById('analyze-btn');
    if (btn) btn.style.display = canAnalyze ? 'inline-block' : 'none';
  }

  // ── ANALYSIS ──────────────────────────────────────────────────

  function buildLists() {
    const { raw } = store;
    const followerSet = new Set(raw.followers.map(u => u.username));
    const followingSet = new Set(raw.following.map(u => u.username));

    store.lists = {
      dontFollowBack:    raw.following.filter(u => !followerSet.has(u.username)),
      notFollowingBack:  raw.followers.filter(u => !followingSet.has(u.username)),
      mutual:            raw.following.filter(u => followerSet.has(u.username)),
      closeFriends:      raw.closeFriends,
      blocked:           raw.blocked,
      pendingRequests:   raw.pendingRequests,
      receivedRequests:  raw.receivedRequests,
      recentlyUnfollowed: raw.recentlyUnfollowed,
      hideStoryFrom:     raw.hideStoryFrom,
      removedSuggestions: raw.removedSuggestions,
    };
  }

  // ── RENDER: STATS ──────────────────────────────────────────────

  function renderStats() {
    const counts = {
      followers:        store.raw.followers.length,
      following:        store.raw.following.length,
      dontFollowBack:   store.lists.dontFollowBack.length,
      notFollowingBack: store.lists.notFollowingBack.length,
      mutual:           store.lists.mutual.length,
      blocked:          store.lists.blocked.length,
    };

    const row = document.getElementById('stats-row');
    row.innerHTML = STAT_CONFIG.map(s => `
      <div class="stat-card" style="--card-color: ${s.color}">
        <div class="stat-num">${counts[s.key]}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    `).join('');

    // Header meta
    document.getElementById('meta-followers-num').textContent = counts.followers;
    document.getElementById('meta-following-num').textContent  = counts.following;
    document.getElementById('header-meta').style.display = 'flex';
  }

  // ── RENDER: TABS ───────────────────────────────────────────────

  function renderTabs() {
    const nav = document.getElementById('tabs-nav');
    nav.innerHTML = TAB_CONFIG.map(t => `
      <button
        class="tab-btn"
        id="tab-${t.key}"
        role="tab"
        aria-selected="false"
        style="--tab-color: ${t.color}"
        onclick="window.App.setTab('${t.key}')"
      >
        ${t.icon} ${t.label}
        <span class="tab-count">${(store.lists[t.key] || []).length}</span>
      </button>
    `).join('');
  }

  // ── RENDER: LIST ───────────────────────────────────────────────

  function getFilteredList() {
    const base = store.lists[store.currentTab] || [];
    const q = store.searchQuery.trim().toLowerCase();
    return q ? base.filter(u => u.username.toLowerCase().includes(q)) : base;
  }

  function renderList() {
    const items      = getFilteredList();
    const total      = items.length;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const start      = (store.currentPage - 1) * PAGE_SIZE;
    const page       = items.slice(start, start + PAGE_SIZE);

    const cfg = TAB_CONFIG.find(t => t.key === store.currentTab) || {};

    // Title + desc + count
    document.getElementById('list-title').textContent  = cfg.icon + ' ' + (cfg.label || '');
    document.getElementById('list-desc').textContent   = cfg.desc  || '';
    document.getElementById('list-count').textContent  = `${total} accounts`;

    // Set CSS variable on list section for accent colour
    const listSection = document.querySelector('.list-section');
    if (listSection) listSection.style.setProperty('--card-accent', cfg.color || 'var(--cyan)');

    // Cards
    const grid = document.getElementById('user-grid');
    if (page.length === 0) {
      grid.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">◎</span>
          <p>${store.searchQuery ? 'No results for "' + store.searchQuery + '"' : 'No accounts in this list'}</p>
        </div>`;
    } else {
      grid.innerHTML = page.map((u, i) => `
        <div class="user-card" style="animation-delay: ${i * 12}ms; --card-accent: ${cfg.color || 'var(--cyan)'}">
          <div class="user-avatar">
            <span>${initials(u.username)}</span>
          </div>
          <div class="user-info">
            <div class="user-name">@${u.username}</div>
            ${u.timestamp ? `<div class="user-date">${formatDate(u.timestamp)}</div>` : ''}
          </div>
          <a href="${u.href}" target="_blank" rel="noopener noreferrer" class="user-link" title="Open on Instagram">↗</a>
        </div>
      `).join('');
    }

    renderPagination(totalPages);
  }

  function renderPagination(totalPages) {
    const pag = document.getElementById('pagination');
    if (totalPages <= 1) { pag.innerHTML = ''; return; }

    const cp = store.currentPage;
    let html = '';

    // Info
    html += `<span class="page-info">Page ${cp} of ${totalPages}</span>`;

    // Prev
    html += `<button class="page-btn" onclick="window.App.goPage(${cp - 1})" ${cp === 1 ? 'disabled' : ''}>← Prev</button>`;

    // Page numbers with ellipsis
    const range = 2;
    let lastPrinted = 0;
    for (let p = 1; p <= totalPages; p++) {
      const inRange = p === 1 || p === totalPages || (p >= cp - range && p <= cp + range);
      if (inRange) {
        if (lastPrinted && p - lastPrinted > 1) {
          html += `<span class="page-ellipsis">…</span>`;
        }
        html += `<button class="page-btn ${p === cp ? 'active' : ''}" onclick="window.App.goPage(${p})">${p}</button>`;
        lastPrinted = p;
      }
    }

    // Next
    html += `<button class="page-btn" onclick="window.App.goPage(${cp + 1})" ${cp === totalPages ? 'disabled' : ''}>Next →</button>`;

    pag.innerHTML = html;
  }

  // ── PUBLIC API ─────────────────────────────────────────────────

  function analyze() {
    buildLists();
    renderStats();
    renderTabs();

    document.getElementById('upload-section').style.display = 'none';
    document.getElementById('dashboard').style.display      = 'block';

    setTab('dontFollowBack');
  }

  function setTab(key) {
    store.currentTab  = key;
    store.currentPage = 1;
    store.searchQuery = '';
    document.getElementById('search-input').value = '';

    // Update tab active state
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.setAttribute('aria-selected', 'false');
    });
    const activeBtn = document.getElementById('tab-' + key);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.setAttribute('aria-selected', 'true');
      activeBtn.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
    }

    renderList();
  }

  function goPage(p) {
    store.currentPage = p;
    renderList();
    document.querySelector('.list-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleSearch() {
    store.searchQuery = document.getElementById('search-input').value;
    store.currentPage = 1;
    renderList();
  }

  function exportCSV() {
    const items = getFilteredList();
    if (!items.length) return;

    const cfg = TAB_CONFIG.find(t => t.key === store.currentTab) || {};
    const rows = [['username', 'url', 'date']];
    items.forEach(u => {
      rows.push([
        u.username,
        u.href,
        u.timestamp ? formatDate(u.timestamp) : '',
      ]);
    });

    const csv  = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `instagram_${(cfg.label || store.currentTab).replace(/\s+/g, '_').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── INIT ───────────────────────────────────────────────────────

  function init() {
    // File input button
    document.getElementById('select-files-btn').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    // File input change
    document.getElementById('file-input').addEventListener('change', e => {
      Array.from(e.target.files).forEach(readFileObject);
    });

    // Drag and drop
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('dragover', e => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      Array.from(e.dataTransfer.files).forEach(readFileObject);
    });
  }

  function readFileObject(file) {
    if (!file.name.endsWith('.json')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const json = JSON.parse(ev.target.result);
        mapAndStoreFile(file.name, json);
      } catch (err) {
        console.warn('Failed to parse:', file.name, err);
      }
    };
    reader.readAsText(file);
  }

  // ── EXPOSE ─────────────────────────────────────────────────────
  window.App = { analyze, setTab, goPage, handleSearch, exportCSV };

  // ── BOOT ───────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

})();