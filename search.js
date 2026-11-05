/*!
 * Navy Wrestling Club: site search
 * Searches only this website. No Google, no outside service.
 * Reads search-index.js, which is rebuilt from the pages whenever their text changes.
 * Loaded on every page with:  <script src="search.js" defer></script>
 */
(function () {
  'use strict';
  if (window.__nwcSearchLoaded) { return; }
  window.__nwcSearchLoaded = true;

  var INDEX_SRC = 'search-index.js';
  var PAGE_SIZE = 8;
  var MAX_TERMS = 8;
  // Same notion of "heading" and "page furniture" that build-search-index.py uses.
  var HEAD_SEL = 'h1,h2,h3,h4,summary,.tier-amt,.tier-title';
  var SKIP_SEL = 'nav,footer,script,style,noscript,svg,iframe,label,option,select,textarea,' +
    'button,template,#donationPopup,.jump-nav,.success-banner,.nwc-search,.nwc-hl-pill';

  var QUICK = [
    ['Donate', 'donate.html'],
    ['Donor Honor Roll', 'donors.html'],
    ['Upcoming Events', 'updates.html#events'],
    ['Coaching Staff', 'about.html#staff'],
    ['Board of Directors', 'about.html#board'],
    ['Train With Us', 'club-info.html#join'],
    ['Contact Us', 'contact.html']
  ];

  var STOP = {};
  ('a an and the of to for in on at is are i we our with by or how do does can my me you your ' +
   'what where when who').split(' ').forEach(function (w) { STOP[w] = 1; });

  var SYN = {
    give: ['donate', 'donation'], giving: ['donate', 'donation'], gift: ['donate', 'donation'],
    gifts: ['donate', 'donation'], contribute: ['donate', 'donation'],
    contribution: ['donate', 'donation'], pledge: ['donate', 'donation'],
    fundraiser: ['fundraising', 'fundraise'], fundraisers: ['fundraising', 'fundraise'],
    schedule: ['event', 'calendar'], calendar: ['event'], dates: ['event', 'calendar'],
    subscribe: ['newsletter'], signup: ['newsletter'], mailing: ['newsletter'], email: ['newsletter'],
    lesson: ['clinic'], lessons: ['clinic'], private: ['clinic'], camp: ['clinic', 'camp'],
    practice: ['train', 'facility'], location: ['facility', 'annapolis'],
    address: ['facility', 'annapolis'], directions: ['facility', 'annapolis'],
    staff: ['coach'], president: ['chairman', 'president'], leadership: ['board', 'chairman']
  };

  /* ---------------------------------------------------------------- text helpers */

  // One character in, one character out, so positions in the normalized text line up
  // with positions in the original text (used for highlighting).
  function foldChar(c) {
    var code = c.charCodeAt(0);
    if ((code >= 97 && code <= 122) || (code >= 48 && code <= 57)) { return c; }
    if (code >= 65 && code <= 90) { return String.fromCharCode(code + 32); }
    if (code > 127 && c.normalize) {
      var b = c.normalize('NFD').charAt(0).toLowerCase();
      if (b >= 'a' && b <= 'z') { return b; }
    }
    return ' ';
  }
  function norm(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) { out += foldChar(s.charAt(i)); }
    return out;
  }
  function squash(s) { return s.replace(/ +/g, ' ').replace(/^ | $/g, ''); }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function parseQuery(q) {
    var raw = norm(q).split(' '), seen = {}, kept = [], i, t;
    for (i = 0; i < raw.length; i++) {
      t = raw[i];
      if (!t || seen[t]) { continue; }
      seen[t] = 1;
      if (t.length === 1 && !/[0-9]/.test(t)) { continue; }   // single letters are noise
      kept.push(t);
    }
    var content = kept.filter(function (w) { return !STOP[w]; });
    return (content.length ? content : kept).slice(0, MAX_TERMS);
  }

  // The word as typed, plus simple plural / -ing / -ed forms and a few synonyms.
  function variants(t) {
    var v = [t];
    function add(x) { if (x.length >= 3 && v.indexOf(x) < 0) { v.push(x); } }
    if (/ies$/.test(t)) { add(t.slice(0, -3) + 'y'); }
    if (/(ches|shes|sses|xes|zes)$/.test(t)) { add(t.slice(0, -2)); }
    if (/s$/.test(t) && !/ss$/.test(t)) { add(t.slice(0, -1)); }
    if (/ing$/.test(t)) { add(t.slice(0, -3)); }
    if (/ed$/.test(t)) { add(t.slice(0, -2)); }
    if (SYN[t]) { SYN[t].forEach(add); }
    return v;
  }
  function varsFor(terms) { return terms.map(variants); }

  // Short words only match at the start of a word; longer ones can match inside a word
  // (so "eleskie" finds "Gingeleskie").
  function ranges(n, vars) {
    var r = [], a, b, v, from, idx;
    for (a = 0; a < vars.length; a++) {
      for (b = 0; b < vars[a].length; b++) {
        v = vars[a][b];
        from = 0;
        while ((idx = n.indexOf(v, from)) >= 0) {
          if (v.length >= 4 || idx === 0 || n.charAt(idx - 1) === ' ') { r.push([idx, idx + v.length]); }
          from = idx + 1;
        }
      }
    }
    r.sort(function (x, y) { return x[0] - y[0] || y[1] - x[1]; });
    var out = [];
    r.forEach(function (x) {
      var last = out[out.length - 1];
      if (last && x[0] <= last[1]) { if (x[1] > last[1]) { last[1] = x[1]; } } else { out.push([x[0], x[1]]); }
    });
    return out;
  }
  function markHtml(text, vars) {
    var rs = ranges(norm(text), vars), html = '', last = 0;
    rs.forEach(function (r) {
      html += esc(text.slice(last, r[0])) + '<mark>' + esc(text.slice(r[0], r[1])) + '</mark>';
      last = r[1];
    });
    return html + esc(text.slice(last));
  }

  /* ---------------------------------------------------------------- the index */

  var DATA = null, items = [], pages = [], vocab = null;
  var loading = false, loadFailed = false, waiters = [];

  function prep(d) {
    pages = d.pages;
    var firstOnPage = {};
    items = d.items.map(function (r, i) {
      var h = r[1], x = r[2], disp = r[6] || '';
      var isFirst = !r[3] && !firstOnPage[r[0]];     // the top section of each real page
      if (isFirst) { firstOnPage[r[0]] = 1; }
      return {
        i: i, p: r[0], h: h, x: x, u: r[3] || '', k: r[4] || '', lo: r[5] ? 1 : 0,
        d: disp, n: r[7] || 1, first: isFirst,
        // padded + squashed copies for matching; aligned copy (nxa) for snippets
        nh: ' ' + squash(norm(disp || h)) + ' ',
        nx: ' ' + squash(norm(x)) + ' ',
        nk: ' ' + squash(norm(r[4] || '')) + ' ',
        np: ' ' + squash(norm(pages[r[0]][0])) + ' ',
        nxa: norm(x)
      };
    });
    DATA = d;
    vocab = null;
  }

  function loadIndex(cb) {
    if (DATA) { if (cb) { cb(true); } return; }
    if (window.NWC_SEARCH_INDEX) { prep(window.NWC_SEARCH_INDEX); if (cb) { cb(true); } return; }
    if (cb) { waiters.push(cb); }
    if (loading) { return; }
    loading = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = INDEX_SRC;
    function done(ok) {
      loading = false;
      if (ok && window.NWC_SEARCH_INDEX) { prep(window.NWC_SEARCH_INDEX); } else { loadFailed = true; }
      var w = waiters; waiters = [];
      w.forEach(function (f) { f(!!DATA); });
    }
    s.onload = function () { done(true); };
    s.onerror = function () { done(false); };
    document.head.appendChild(s);
  }

  function countStarts(hay, v, cap) {
    var c = 0, from = 0, key = ' ' + v, idx;
    while (c < cap && (idx = hay.indexOf(key, from)) >= 0) { c++; from = idx + 1; }
    return c;
  }

  function scoreItem(it, vars, phrase) {
    var total = 0, matched = 0, pageHit = false, k, j, v, s, best, c, bestPage;
    for (k = 0; k < vars.length; k++) {
      best = 0;
      for (j = 0; j < vars[k].length; j++) {
        v = vars[k][j];
        s = 0;
        if (j === 0 && it.nh.indexOf(' ' + v + ' ') >= 0) { s += 16; }      // exact word typed is a whole word of the title
        else if (it.nh.indexOf(' ' + v) >= 0) { s += 12; }                  // a word of the title starts with it
        else if (v.length >= 4 && it.nh.indexOf(v) >= 0) { s += 5; }
        if (it.nk.indexOf(' ' + v) >= 0) { s += 6; }
        if (it.np.indexOf(' ' + v) >= 0) { s += 3; }
        c = countStarts(it.nx, v, 4);
        if (c) { s += 1.5 * c + 1; }
        else if (v.length >= 4 && it.nx.indexOf(v) >= 0) { s += 1; }
        if (j > 0) { s = s * 0.8; }
        if (s > best) { best = s; bestPage = it.np.indexOf(' ' + v) >= 0; }
      }
      if (best > 0) { matched++; total += best; if (bestPage) { pageHit = true; } }
    }
    if (matched) {
      // searching a page's own name (donate, contact, about...) puts that page's top section first
      if (it.first && pageHit) { total += 20; }
      if (phrase) {
        if (it.nh.indexOf(' ' + phrase + ' ') >= 0) { total += 20; }
        else if (it.nh.indexOf(' ' + phrase) >= 0) { total += 12; }
        else if (it.nx.indexOf(' ' + phrase) >= 0) { total += 6; }
      }
    }
    if (it.lo) { total *= 0.55; }
    return { matched: matched, total: total };
  }

  function run(terms, mode) {
    var vars = varsFor(terms), phrase = terms.length > 1 ? terms.join(' ') : '';
    var out = [], i, sc;
    for (i = 0; i < items.length; i++) {
      sc = scoreItem(items[i], vars, phrase);
      if (mode === 'and' ? sc.matched === terms.length : sc.matched > 0) {
        out.push({ it: items[i], m: sc.matched, s: sc.total });
      }
    }
    out.sort(function (a, b) { return b.m - a.m || b.s - a.s || a.it.i - b.it.i; });
    return { list: out, vars: vars };
  }

  /* typo help: swap an unknown word for the closest word that exists on the site */
  function buildVocab() {
    var map = {};
    items.forEach(function (it) {
      (it.nh + it.nx + it.nk).split(' ').forEach(function (w) {
        if (w.length >= 3) { map[w] = (map[w] || 0) + 1; }
      });
    });
    vocab = Object.keys(map).map(function (w) { return [w, map[w]]; });
  }
  function dist(a, b, max) {
    if (Math.abs(a.length - b.length) > max) { return max + 1; }
    var prev2 = null, prev = [], cur, i, j, cost;
    for (j = 0; j <= b.length; j++) { prev[j] = j; }
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      for (j = 1; j <= b.length; j++) {
        cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
          cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
        }
      }
      prev2 = prev; prev = cur;
    }
    return prev[b.length];
  }
  function known(t) {
    for (var i = 0; i < vocab.length; i++) {
      var w = vocab[i][0];
      if (w.indexOf(t) === 0 || (t.length >= 4 && w.indexOf(t) > 0)) { return true; }
    }
    return false;
  }
  function closest(t) {
    var max = t.length <= 4 ? 1 : 2, best = null, bd = 99, bc = 0, i, w, d;
    for (i = 0; i < vocab.length; i++) {
      w = vocab[i][0];
      if (w === t) { continue; }
      d = dist(t, w, max);
      if (d > max) { continue; }
      if (d === 2 && w.charAt(0) !== t.charAt(0)) { continue; }
      if (d < bd || (d === bd && vocab[i][1] > bc)) { best = w; bd = d; bc = vocab[i][1]; }
    }
    return best;
  }
  function correct(terms) {
    if (!vocab) { buildVocab(); }
    var changed = false, out = terms.map(function (t) {
      if (/^[0-9]+$/.test(t) || known(t)) { return t; }
      var c = closest(t);
      if (c) { changed = true; return c; }
      return t;
    });
    return changed ? out : null;
  }

  function search(q) {
    var terms = parseQuery(q);
    if (!terms.length) { return { mode: 'empty', terms: [], list: [], vars: [] }; }
    var r = run(terms, 'and');
    if (r.list.length) { return { mode: 'and', terms: terms, list: r.list, vars: r.vars }; }
    var fixed = correct(terms);
    if (fixed) {
      r = run(fixed, 'and');
      if (r.list.length) { return { mode: 'fixed', terms: fixed, orig: terms, list: r.list, vars: r.vars }; }
    }
    r = run(terms, 'or');
    if (r.list.length) { return { mode: 'or', terms: terms, list: r.list, vars: r.vars }; }
    if (fixed) {
      r = run(fixed, 'or');
      if (r.list.length) { return { mode: 'fixedor', terms: fixed, orig: terms, list: r.list, vars: r.vars }; }
    }
    return { mode: 'none', terms: terms, list: [], vars: r.vars };
  }

  /* ---------------------------------------------------------------- links */

  function isExternal(it) { return !!it.u; }
  function pageKey(path) {
    var base = path.substring(path.lastIndexOf('/') + 1).replace(/\.html$/, '');
    return (base === '' || base === 'index' || base === 'home') ? 'home' : base;
  }
  function hrefFor(it, terms) {
    if (it.u) { return it.u; }
    var url = pages[it.p][1] || './';
    var qs = '?hl=' + encodeURIComponent(terms.join(' '));
    if (it.h) { qs += '&at=' + encodeURIComponent(it.h); }
    if (it.n > 1) { qs += '&n=' + it.n; }
    return url + qs;
  }
  function samePage(href) {
    try {
      var u = new URL(href, location.href);
      return u.origin === location.origin && pageKey(u.pathname) === pageKey(location.pathname);
    } catch (e) { return false; }
  }
  function prettyUrl(u) {
    if (/^https?:/i.test(u)) {
      return u.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, '');
    }
    return u;
  }

  /* ---------------------------------------------------------------- snippets */

  function snippetHtml(it, vars) {
    var x = it.x;
    if (!x) { return ''; }
    var WIN = 150, start = 0, end = x.length, best = -1, a, b, v, idx;
    for (a = 0; a < vars.length; a++) {
      for (b = 0; b < vars[a].length; b++) {
        v = vars[a][b];
        idx = it.nxa.indexOf(' ' + v);
        idx = idx >= 0 ? idx + 1 : (it.nxa.indexOf(v) === 0 ? 0 : -1);
        if (idx < 0 && v.length >= 4) { idx = it.nxa.indexOf(v); }
        if (idx >= 0 && (best < 0 || idx < best)) { best = idx; }
      }
    }
    if (x.length > WIN) {
      if (best < 0) { end = WIN; }
      else {
        start = Math.max(0, best - 45);
        end = Math.min(x.length, start + WIN);
        if (end - start < WIN) { start = Math.max(0, end - WIN); }
      }
      if (start > 0) {
        var sp = x.indexOf(' ', start);
        if (sp > -1 && sp - start < 20) { start = sp + 1; }
      }
      if (end < x.length) {
        var ep = x.lastIndexOf(' ', end);
        if (ep > start + 60) { end = ep; }
      }
    }
    return (start > 0 ? '… ' : '') + markHtml(x.slice(start, end), vars) + (end < x.length ? ' …' : '');
  }

  /* ---------------------------------------------------------------- the pop-up */

  var ICON_SEARCH = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var ICON_OUT = '<svg class="nwc-search-out" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17L17 7M9 7h8v8"/></svg>';

  var overlay, input, list, status, moreBtn, closeBtn, hint;
  var isOpen = false, lastFocus = null, state = null, shown = PAGE_SIZE, active = -1, rafId = 0;

  function build() {
    if (overlay) { return; }
    overlay = document.createElement('div');
    overlay.className = 'nwc-search';
    overlay.id = 'nwc-search';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="nwc-search-backdrop" data-close="1"></div>' +
      '<div class="nwc-search-panel" role="dialog" aria-modal="true" aria-label="Search this website">' +
        '<div class="nwc-search-head">' +
          '<div class="nwc-search-field">' + ICON_SEARCH.replace('<svg', '<svg class="nwc-search-ico"') +
            '<input class="nwc-search-input" id="nwc-search-input" type="search" placeholder="Search this website" ' +
            'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" ' +
            'role="combobox" aria-expanded="false" aria-controls="nwc-search-list" aria-autocomplete="list" ' +
            'aria-label="Search this website" maxlength="120">' +
          '</div>' +
          '<button type="button" class="nwc-search-close" aria-label="Close search">' + ICON_CLOSE + '</button>' +
        '</div>' +
        '<div class="nwc-search-body">' +
          '<p class="nwc-search-status" id="nwc-search-status" role="status" aria-live="polite"></p>' +
          '<ul class="nwc-search-list" id="nwc-search-list" role="listbox" aria-label="Search results"></ul>' +
          '<button type="button" class="nwc-search-more" hidden>Show more results</button>' +
        '</div>' +
        '<div class="nwc-search-foot" aria-hidden="true"><span><kbd>↑</kbd><kbd>↓</kbd> to move</span>' +
          '<span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></div>' +
      '</div>';
    document.body.appendChild(overlay);

    input = overlay.querySelector('.nwc-search-input');
    list = overlay.querySelector('.nwc-search-list');
    status = overlay.querySelector('.nwc-search-status');
    moreBtn = overlay.querySelector('.nwc-search-more');
    closeBtn = overlay.querySelector('.nwc-search-close');
    hint = overlay.querySelector('.nwc-search-foot');

    overlay.addEventListener('click', function (e) {
      if (e.target.getAttribute && e.target.getAttribute('data-close')) { close(); }
    });
    closeBtn.addEventListener('click', function () { close(); });
    moreBtn.addEventListener('click', function () { shown += 20; paint(); input.focus(); });
    input.addEventListener('input', function () {
      if (rafId) { return; }
      var run1 = function () { rafId = 0; update(); };
      rafId = window.requestAnimationFrame ? window.requestAnimationFrame(run1) : setTimeout(run1, 16);
    });
    input.addEventListener('keydown', onInputKey);
    overlay.addEventListener('keydown', onTrap);
    list.addEventListener('click', onResultClick);
    list.addEventListener('mousemove', function (e) {
      var a = e.target.closest ? e.target.closest('.nwc-search-item') : null;
      if (a) { setActive(+a.getAttribute('data-i'), false); }
    });
  }

  function focusables() {
    var f = [input, closeBtn];
    Array.prototype.forEach.call(overlay.querySelectorAll('.nwc-search-chip'), function (c) { f.push(c); });
    if (!moreBtn.hidden) { f.push(moreBtn); }
    return f;
  }
  function onTrap(e) {
    if (e.key !== 'Tab') { return; }
    var f = focusables(), first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function onInputKey(e) {
    var n = list.querySelectorAll('.nwc-search-item').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) { setActive(Math.min(n - 1, active + 1), true); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) { setActive(Math.max(0, active - 1), true); } }
    else if (e.key === 'Home' && n && e.ctrlKey) { e.preventDefault(); setActive(0, true); }
    else if (e.key === 'End' && n && e.ctrlKey) { e.preventDefault(); setActive(n - 1, true); }
    else if (e.key === 'Enter') {
      var el = list.querySelector('.nwc-search-item[data-i="' + active + '"]') || list.querySelector('.nwc-search-item');
      if (el) { e.preventDefault(); el.click(); }
    }
  }
  function setActive(i, scroll) {
    var old = list.querySelector('.nwc-search-item.is-active');
    if (old) { old.classList.remove('is-active'); old.setAttribute('aria-selected', 'false'); }
    active = i;
    var el = list.querySelector('.nwc-search-item[data-i="' + i + '"]');
    if (!el) { input.removeAttribute('aria-activedescendant'); return; }
    el.classList.add('is-active');
    el.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', el.id);
    if (scroll && el.scrollIntoView) { el.scrollIntoView({ block: 'nearest' }); }
  }

  function onResultClick(e) {
    var a = e.target.closest ? e.target.closest('.nwc-search-item') : null;
    if (!a || e.defaultPrevented) { return; }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) { return; }
    var href = a.getAttribute('href');
    if (a.getAttribute('target') === '_blank' || !samePage(href)) { return; }   // normal navigation
    e.preventDefault();
    var u = new URL(href, location.href);
    close(true);
    highlightPage(u.searchParams.get('hl') || '', u.searchParams.get('at') || '', +u.searchParams.get('n') || 1);
  }

  function setStatus(msg) { status.innerHTML = msg || ''; status.hidden = !msg; }

  function quickHtml() {
    var h = '<li class="nwc-search-quick" role="presentation"><span class="nwc-search-quick-label">Quick links</span><span class="nwc-search-chips">';
    QUICK.forEach(function (q) {
      h += '<a class="nwc-search-chip" href="' + esc(q[1]) + '">' + esc(q[0]) + '</a>';
    });
    return h + '</span></li>';
  }

  function update() {
    var q = input.value;
    shown = PAGE_SIZE;
    if (!squash(norm(q))) {
      state = null;
      active = -1;
      list.innerHTML = quickHtml();
      moreBtn.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      setStatus(loadFailed ? 'Search is not available right now. Try the quick links below.' : 'Search donors, coaches, events, giving levels and more.');
      return;
    }
    if (!DATA) {
      if (loadFailed) {
        list.innerHTML = quickHtml();
        setStatus('Search is not available right now. Try the quick links below.');
        return;
      }
      setStatus('Loading…');
      loadIndex(function () { if (isOpen) { update(); } });
      return;
    }
    state = search(q);
    paint();
  }

  function paint() {
    if (!state) { return; }
    var sr = state, n = sr.list.length, html = '', i;
    if (sr.mode === 'none') {
      list.innerHTML = quickHtml();
      moreBtn.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      setStatus('No results for “' + esc(squash(input.value)) + '”. Try a different word, or use a quick link.');
      return;
    }
    var upto = Math.min(n, shown);
    for (i = 0; i < upto; i++) { html += itemHtml(sr.list[i], sr, i); }
    list.innerHTML = html;
    moreBtn.hidden = n <= upto;
    if (!moreBtn.hidden) { moreBtn.textContent = 'Show ' + Math.min(20, n - upto) + ' more (' + (n - upto) + ' left)'; }
    input.setAttribute('aria-expanded', 'true');
    var msg = n + (n === 1 ? ' result' : ' results');
    if (sr.mode === 'fixed' || sr.mode === 'fixedor') { msg += ' for “' + esc(sr.terms.join(' ')) + '” (showing the closest match to what you typed)'; }
    else if (sr.mode === 'or') { msg = 'No page has all of those words. Showing ' + n + (n === 1 ? ' partial match' : ' partial matches'); }
    setStatus(msg);
    setActive(0, false);
  }

  function itemHtml(r, sr, i) {
    var it = r.it, ext = isExternal(it);
    var label = pages[it.p][0];
    if (ext && /\.pdf$/i.test(it.u)) { label = 'PDF'; }
    var title = it.d || it.h || pages[it.p][0];
    var snip = it.x ? snippetHtml(it, sr.vars) : (ext ? esc(prettyUrl(it.u)) : '');
    return '<li role="presentation"><a class="nwc-search-item" role="option" aria-selected="false" id="nwc-r-' + i +
      '" data-i="' + i + '" tabindex="-1" href="' + esc(hrefFor(it, sr.terms)) + '"' +
      (ext ? ' target="_blank" rel="noopener"' : '') + '>' +
      '<span class="nwc-search-meta">' + esc(label) + '</span>' +
      '<span class="nwc-search-title">' + markHtml(title, sr.vars) + (ext ? ICON_OUT : '') + '</span>' +
      (snip ? '<span class="nwc-search-snip">' + snip + '</span>' : '') + '</a></li>';
  }

  function fitViewport() {
    if (!overlay || overlay.hidden) { return; }
    var vv = window.visualViewport;
    if (vv && window.innerWidth <= 640) {
      overlay.style.top = vv.offsetTop + 'px';
      overlay.style.height = vv.height + 'px';
    } else {
      overlay.style.top = '';
      overlay.style.height = '';
    }
  }

  function open(prefill) {
    build();
    if (isOpen) { input.focus(); return; }
    isOpen = true;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    Array.prototype.forEach.call(document.querySelectorAll('.nwc-search-btn'), function (b) { b.setAttribute('aria-expanded', 'true'); });
    if (typeof prefill === 'string') { input.value = prefill; }
    fitViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', fitViewport);
      window.visualViewport.addEventListener('scroll', fitViewport);
    }
    loadIndex(function () { if (isOpen) { update(); } });
    update();
    input.focus();
    if (input.value) { input.select(); }
  }

  function close(skipFocus) {
    if (!isOpen) { return; }
    isOpen = false;
    overlay.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll('.nwc-search-btn'), function (b) { b.setAttribute('aria-expanded', 'false'); });
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', fitViewport);
      window.visualViewport.removeEventListener('scroll', fitViewport);
    }
    if (!skipFocus && lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* ignore */ } }
  }

  /* ---------------------------------------------------------------- highlight on the page you land on */

  var hl = null;   // { marks: [], pill: element }

  function clearHighlights() {
    if (!hl) { return; }
    hl.marks.forEach(function (m) {
      var p = m.parentNode;
      if (!p) { return; }
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    if (hl.pill && hl.pill.parentNode) { hl.pill.parentNode.removeChild(hl.pill); }
    hl = null;
  }

  function textNodes() {
    var out = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.data.length < 2 || !/\S/.test(n.data)) { return NodeFilter.FILTER_REJECT; }
        var p = n.parentElement;
        if (!p || (p.closest && p.closest(SKIP_SEL))) { return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      }
    }), n;
    while ((n = w.nextNode())) { out.push(n); }
    return out;
  }

  function wrapNode(node, rs) {
    var text = node.data, frag = document.createDocumentFragment(), last = 0, made = [];
    rs.forEach(function (r) {
      if (r[0] > last) { frag.appendChild(document.createTextNode(text.slice(last, r[0]))); }
      var m = document.createElement('mark');
      m.className = 'nwc-hl';
      m.textContent = text.slice(r[0], r[1]);
      frag.appendChild(m);
      made.push(m);
      last = r[1];
    });
    if (last < text.length) { frag.appendChild(document.createTextNode(text.slice(last))); }
    node.parentNode.replaceChild(frag, node);
    return made;
  }

  function compact(s) { return norm(s).replace(/ /g, ''); }

  function headingEls() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll(HEAD_SEL), function (el) {
      if (el.closest(SKIP_SEL)) { return; }
      if (el.parentElement && el.parentElement.closest(HEAD_SEL)) { return; }
      out.push({ el: el, key: compact(el.textContent) });
    });
    return out;
  }

  // open <details> and switch hidden tabs so the match can actually be seen
  function reveal(el) {
    var a;
    for (a = el; a && a !== document.body; a = a.parentElement) {
      if (a.tagName === 'DETAILS' && !a.open) { a.open = true; }
    }
    var panel = el.closest ? el.closest('.freq-panel') : null;
    if (panel && panel.id && window.getComputedStyle(panel).display === 'none') {
      var tab = document.querySelector('.freq-tab[onclick*="\'' + panel.id + '\'"]');
      if (tab) { tab.click(); }
    }
  }

  // scroll the match to the middle of the screen; once more after images/fonts settle
  function scrollToEl(target) {
    var moved = false;
    function mark() { moved = true; }
    ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(function (ev) {
      window.addEventListener(ev, mark, { once: true, passive: true });
    });
    setTimeout(function () {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' }); }
      catch (e) { target.scrollIntoView(); }
    }, 60);
    if (document.readyState !== 'complete') {
      window.addEventListener('load', function () {
        if (moved) { return; }
        setTimeout(function () { try { target.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ } }, 120);
      });
    }
  }

  function highlightPage(q, at, n) {
    clearHighlights();
    var terms = parseQuery(q || '');
    if (!terms.length) { return; }
    var vars = varsFor(terms), marks = [];
    textNodes().forEach(function (node) {
      var rs = ranges(norm(node.data), vars);
      if (rs.length) { marks = marks.concat(wrapNode(node, rs)); }
    });
    marks.forEach(reveal);

    // the section the visitor clicked on (when the page has it)
    var heads = headingEls(), hd = null;
    if (at) {
      var key = compact(at), c = heads.filter(function (h) { return h.key === key; });
      if (!c.length) { c = heads.filter(function (h) { return h.key.indexOf(key) === 0 || key.indexOf(h.key) === 0; }); }
      hd = c[(n || 1) - 1] || c[0] || null;
    }

    if (!marks.length) {
      // matched by a keyword rather than visible text: just take them to the section
      if (!hd) { return; }
      reveal(hd.el);
      hd.el.classList.add('nwc-hl-flash');
      setTimeout(function () { hd.el.classList.remove('nwc-hl-flash'); }, 2600);
      scrollToEl(hd.el);
      return;
    }

    var target = null;
    if (hd) {
      var idx = heads.indexOf(hd), nxt = heads[idx + 1] ? heads[idx + 1].el : null;
      for (var i = 0; i < marks.length; i++) {
        var m = marks[i];
        if (hd.el.compareDocumentPosition(m) & 20) {                       // inside or after the heading
          if (!nxt || (nxt.compareDocumentPosition(m) & 2)) { target = m; break; }   // and before the next one
        }
      }
      if (!target) { target = hd.el; reveal(hd.el); }
    } else {
      target = marks[0];
    }
    if (target.classList && target.classList.contains('nwc-hl')) { target.classList.add('nwc-hl-pulse'); }

    var pill = document.createElement('div');
    pill.className = 'nwc-hl-pill';
    pill.setAttribute('role', 'status');
    pill.innerHTML = '<span>Highlighted: “' + esc(terms.join(' ')) + '”</span>' +
      '<button type="button" aria-label="Clear highlights">' + ICON_CLOSE + '</button>';
    pill.querySelector('button').addEventListener('click', clearHighlights);
    document.body.appendChild(pill);
    hl = { marks: marks, pill: pill };
    // the little label fades away on its own; the highlights stay until the page is reloaded or Esc is pressed
    setTimeout(function () {
      pill.classList.add('is-hiding');
      setTimeout(function () { if (pill.parentNode) { pill.parentNode.removeChild(pill); } }, 400);
    }, 9000);
    scrollToEl(target);
  }

  function params() {
    var out = {};
    location.search.replace(/^\?/, '').split('&').forEach(function (kv) {
      if (!kv) { return; }
      var p = kv.split('=');
      try { out[p[0]] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); } catch (e) { out[p[0]] = p[1] || ''; }
    });
    return out;
  }
  function onArrive() {
    var p = params();
    if (!p.hl) { return; }
    highlightPage(p.hl, p.at || '', +p.n || 1);
    try {
      var rest = location.search.replace(/^\?/, '').split('&').filter(function (kv) {
        return kv && !/^(hl|at|n)=/.test(kv);
      }).join('&');
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : '') + location.hash);
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------------------------------------------- wire up */

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('.nwc-search-btn'), function (b) {
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () { open(); });
      ['mouseenter', 'focus', 'touchstart'].forEach(function (ev) {
        b.addEventListener(ev, function () { loadIndex(); }, { once: true, passive: true });
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) { return; }
      var k = e.key, t = e.target, tag = t && t.tagName;
      var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable);
      if ((k === 'k' || k === 'K') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault(); open();
      } else if (k === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing && document.querySelector('.nwc-search-btn')) {
        e.preventDefault(); open();
      } else if (k === 'Escape') {
        if (isOpen) { e.preventDefault(); close(); } else if (hl) { clearHighlights(); }
      }
    });
    onArrive();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', wire); } else { wire(); }

  window.NWCSearch = { open: open, close: close };
})();
