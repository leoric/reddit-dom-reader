// ==UserScript==
// @name         Reddit: Old-style DOM Reader
// @namespace    https://leoric.local/userscripts
// @version      1.0.5
// @description  Re-renders www.reddit.com in an old-reddit-style layout by reading the already-loaded page's shreddit-* elements. Media stays at new-reddit size.
// @author       leoric
// @match        https://www.reddit.com/*
// @run-at       document-start
// @icon https://reddit.com/favicon.ico
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------- escape hatch ----------
  // Append ?orr=off to any URL to skip this script (the header link does this).
  const params = new URLSearchParams(location.search);
  if (params.get('orr') === 'off') return;

  const PATH = location.pathname;

  // ---------- routing ----------
  const isComments = /^\/r\/[^/]+\/comments\/[a-z0-9]+/i.test(PATH);
  const EXCLUDED_RE =
    /^\/(login|register|settings|message|chat|submit|notifications|premium|gold|coins|avatar|live|broadcast|poll|community-points|appeal|report|policies|contact|dev|prefs|api|search|user|u)(\/|$)/i;
  const isExcluded = EXCLUDED_RE.test(PATH) || /\/(wiki|w)(\/|$)/i.test(PATH);
  if (!isComments && isExcluded) return;

  // ---------- keep reddit's SPA router from swallowing our clicks ----------
  window.addEventListener('click', function (e) {
    const root = document.getElementById('orr-root');
    if (!root) return;
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a || !root.contains(a)) return;
    e.stopImmediatePropagation();
    if (a.target === '_blank') return;
    e.preventDefault();
    location.assign(a.href);
  }, true);

  // ---------- hide the native page ASAP ----------
  const hideStyle = document.createElement('style');
  hideStyle.id = 'orr-hide';
  hideStyle.textContent = `
    body > :not(#orr-root){ display:none !important; }
    html, body {
      overflow: visible !important;
      height: auto !important;
      max-height: none !important;
      min-height: 0 !important;
      position: static !important;
    }
  `;
  document.documentElement.appendChild(hideStyle);

  // ---------- readiness ----------
  function whenBodyReady() {
    return new Promise((resolve) => {
      if (document.body) return resolve();
      const obs = new MutationObserver(() => {
        if (document.body) { obs.disconnect(); resolve(); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
  function domReady() {
    return new Promise((resolve) => {
      if (document.readyState !== 'loading') return resolve();
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    });
  }
  function waitFor(test, timeout) {
    return new Promise((resolve) => {
      const first = test();
      if (first) return resolve(first);
      let to;
      const obs = new MutationObserver(() => {
        const r = test();
        if (r) { obs.disconnect(); clearTimeout(to); resolve(r); }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
      to = setTimeout(() => { obs.disconnect(); resolve(test()); }, timeout || 8000);
    });
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- helpers ----------
  function toWww(href) {
    if (!href) return '';
    try {
      const u = new URL(href, location.origin + '/');
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return '#';
      if (/^(old\.|www\.|np\.)?reddit\.com$/i.test(u.hostname)) {
        return 'https://www.reddit.com' + u.pathname + u.search + u.hash;
      }
      return u.href;
    } catch (_) {
      return '#';
    }
  }
  function formatScore(n) {
    if (n == null || n === '' || isNaN(n)) return '\u2022';
    n = Number(n);
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }
  function parseTs(s) {
    if (!s) return 0;
    s = String(s).trim();
    if (/^\d+$/.test(s)) { const n = Number(s); return n > 1e11 ? n / 1000 : n; }
    // normalise "2025-01-01T12:00:00.123456+0000" for strict parsers (Firefox)
    s = s.replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t / 1000;
  }
  function formatAgo(unix) {
    if (!unix) return '';
    const s = Math.max(1, Math.floor(Date.now() / 1000 - unix));
    const units = [['y', 31536000], ['mo', 2592000], ['d', 86400], ['h', 3600], ['m', 60], ['s', 1]];
    for (const [label, secs] of units) {
      if (s >= secs) return Math.floor(s / secs) + label + ' ago';
    }
    return 'just now';
  }
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  }
  function stripSort(p) {
    return p.replace(/\/(hot|new|top|rising|controversial|best)\/?$/i, '') || '/';
  }
  function txt(node) { return node ? node.textContent.trim() : ''; }
  function parseDoc(html) { return new DOMParser().parseFromString(html || '', 'text/html'); }

  // Clone reddit's rendered usertext and make it safe to re-inject.
  function cleanMd(node) {
    if (!node) return '';
    const c = node.cloneNode(true);
    c.querySelectorAll('script,style,iframe,object,embed,form,link,meta').forEach((n) => n.remove());
    c.querySelectorAll('*').forEach((n) => {
      for (const at of Array.from(n.attributes)) {
        if (/^on/i.test(at.name) || at.name === 'slot') n.removeAttribute(at.name);
      }
    });
    c.querySelectorAll('a[href]').forEach((a) => {
      const h = toWww(a.getAttribute('href'));
      a.setAttribute('href', h);
      if (!/^https:\/\/www\.reddit\.com\//.test(h)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener noreferrer');
      }
    });
    return c.innerHTML;
  }

  // ---------- media (kept at "new reddit" size) ----------
  function sizedIframe(src, w, h) {
    const f = document.createElement('iframe');
    f.src = toWww(src);
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('loading', 'lazy');
    f.setAttribute('referrerpolicy', 'no-referrer');
    f.style.cssText =
      'display:block;border:0;width:100%;max-width:100%;max-height:80vh;height:auto;' +
      'aspect-ratio:' + (w && h ? w + ' / ' + h : '16 / 9') + ';';
    return f;
  }

  function videoFrom(player, post) {
    const box = el('div', {});
    const video = el('video', { controls: 'controls', preload: 'metadata', class: 'orr-video', playsinline: '' });
    const poster = player.getAttribute('preview');
    if (poster) video.setAttribute('poster', poster);

    const hls = player.getAttribute('src') || '';
    let mp4s = [];
    try {
      const j = JSON.parse(player.getAttribute('packaged-media-json') || 'null');
      const perms = (j && j.playbackMp4s && j.playbackMp4s.permutations) || [];
      mp4s = perms
        .map((x) => ({ u: x.source && x.source.url, w: (x.source && x.source.dimensions && x.source.dimensions.width) || 0 }))
        .filter((x) => x.u)
        .sort((a, b) => b.w - a.w);
    } catch (_) { /* ignore */ }

    if (hls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = hls; // Safari: native HLS, with audio
      box.appendChild(video);
      return box;
    }

    const pick = mp4s.find((x) => x.w <= 960) || mp4s[mp4s.length - 1];
    if (pick) {
      video.src = pick.u;
      box.appendChild(video);
      box.appendChild(el('div', { class: 'orr-note' }, 'reddit-hosted video: audio track omitted (this browser has no HLS)'));
      return box;
    }

    const idm = /v\.redd\.it\/([a-z0-9]+)/i.exec(hls + ' ' + (post.getAttribute('content-href') || ''));
    if (idm) {
      const q = [720, 480, 360, 240, 96];
      let i = 0;
      const next = () => { if (i < q.length) video.src = 'https://v.redd.it/' + idm[1] + '/DASH_' + q[i++] + '.mp4'; };
      video.addEventListener('error', next);
      next();
      box.appendChild(video);
      box.appendChild(el('div', { class: 'orr-note' }, 'reddit-hosted video: audio track omitted (this browser has no HLS)'));
      return box;
    }
    return el('a', { href: toWww(post.getAttribute('permalink')), target: '_blank', rel: 'noopener noreferrer' }, '\u25B6 open video');
  }

  function renderMedia(p) {
    const type = p.getAttribute('post-type') || '';
    if (type === 'text') return null;

    const wrap = el('div', { class: 'orr-media' });
    const box = p.querySelector('[slot="post-media-container"]') || p;

    // 1) reddit-hosted video / gif
    const player = box.querySelector('shreddit-player-2, shreddit-player');
    if (player) { wrap.appendChild(videoFrom(player, p)); return wrap; }

    // 2) third-party embeds (youtube etc.)
    const embed = box.querySelector('shreddit-embed');
    let ifr = null;
    if (embed && embed.getAttribute('html')) ifr = parseDoc(embed.getAttribute('html')).querySelector('iframe');
    if (!ifr) ifr = box.querySelector('iframe');
    if (ifr) {
      const src = ifr.getAttribute('src') || ifr.getAttribute('data-src');
      if (src) {
        wrap.appendChild(sizedIframe(src, parseFloat(ifr.getAttribute('width')), parseFloat(ifr.getAttribute('height'))));
        return wrap;
      }
    }

    // 3) single image post: use the full-size original
    const href = p.getAttribute('content-href') || '';
    if (type === 'image' && /\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(href)) {
      wrap.appendChild(el('img', { src: href, loading: 'lazy', class: 'orr-img' }));
      return wrap;
    }

    // 4) gallery / any other images inside the media container
    const seen = new Set();
    const imgs = [];
    box.querySelectorAll('img').forEach((i) => {
      const s = i.getAttribute('src') || i.getAttribute('data-lazy-src') || '';
      if (!s || /^data:/i.test(s) || seen.has(s)) return;
      seen.add(s);
      imgs.push(s);
    });
    if (imgs.length === 1) {
      wrap.appendChild(el('img', { src: imgs[0], loading: 'lazy', class: 'orr-img' }));
      return wrap;
    }
    if (imgs.length > 1) {
      const grid = el('div', { class: 'orr-gallery' });
      imgs.forEach((u) => grid.appendChild(el('img', { src: u, loading: 'lazy', class: 'orr-gallery-img' })));
      wrap.appendChild(grid);
      return wrap;
    }

    // 5) direct image/video links
    if (/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(href)) {
      wrap.appendChild(el('img', { src: href, loading: 'lazy', class: 'orr-img' }));
      return wrap;
    }
    if (/\.gifv(\?|$)/i.test(href)) {
      wrap.appendChild(el('video', { src: href.replace(/\.gifv/i, '.mp4'), class: 'orr-video', autoplay: '', loop: '', muted: '', playsinline: '' }));
      return wrap;
    }
    if (/\.(mp4|webm)(\?|$)/i.test(href)) {
      wrap.appendChild(el('video', { src: href, controls: 'controls', preload: 'metadata', class: 'orr-video', playsinline: '' }));
      return wrap;
    }

    // 6) thumbnail for link posts
    const th = p.querySelector('[slot="thumbnail"] img');
    const ths = th && th.getAttribute('src');
    if (ths && !/^data:/i.test(ths)) {
      wrap.appendChild(el('img', { src: ths, loading: 'lazy', class: 'orr-thumb' }));
      return wrap;
    }
    return null;
  }

  // ---------- post data from a <shreddit-post> ----------
  function readPost(p) {
    const type = p.getAttribute('post-type') || '';
    const permalink = toWww(p.getAttribute('permalink') || '');
    const domain = p.getAttribute('domain') || '';
    const isSelf = type === 'text' || /^self\./i.test(domain);
    const sub = p.getAttribute('subreddit-name') || (p.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//, '');
    return {
      title: p.getAttribute('post-title') || txt(p.querySelector('[slot="title"]')),
      url: isSelf ? permalink : toWww(p.getAttribute('content-href') || p.getAttribute('permalink') || ''),
      permalink,
      isSelf,
      domain,
      author: p.getAttribute('author') || '[deleted]',
      subreddit: sub,
      score: p.getAttribute('score'),
      comments: p.getAttribute('comment-count') || '0',
      created: parseTs(p.getAttribute('created-timestamp')),
      nsfw: p.hasAttribute('nsfw') || p.getAttribute('nsfw') === 'true',
      flair: txt(p.querySelector('[slot="post-flair"]')),
      id: p.getAttribute('id') || p.getAttribute('permalink') || '',
    };
  }

  function topLevelPosts(root) {
    return Array.from(root.querySelectorAll('shreddit-post')).filter(
      (p) => !(p.parentElement && p.parentElement.closest('shreddit-post'))
    );
  }

  // ---------- voting (proxied through reddit's own buttons) ----------
  // We don't talk to reddit's API. Each row keeps a reference to the live
  // <shreddit-post>/<shreddit-comment> behind the hidden page, finds its real
  // upvote/downvote buttons (they live in open shadow roots) and clicks them,
  // so reddit's own code sends the request with its own session/CSRF handling.
  const ENABLE_VOTING = true;

  function voteButtons(host) {
    let up = null, down = null;
    const hostTag = host.tagName;
    const queue = [host];
    while (queue.length && !(up && down)) {
      const node = queue.shift();
      const roots = [node];
      if (node.shadowRoot) roots.push(node.shadowRoot);
      for (const r of roots) {
        for (const ch of Array.from(r.children || [])) {
          if (ch.tagName === hostTag && ch !== host) continue; // nested comment / crosspost
          const label = (ch.getAttribute('aria-label') || '').trim();
          if (ch.tagName === 'BUTTON' || ch.getAttribute('role') === 'button') {
            if (!up && (ch.hasAttribute('upvote') || /^upvote$/i.test(label))) up = ch;
            else if (!down && (ch.hasAttribute('downvote') || /^downvote$/i.test(label))) down = ch;
          }
          queue.push(ch);
        }
      }
    }
    return { up, down };
  }

  function attachVoting(nativeEl, scoreNode, baseScore, suffix) {
    const base = baseScore == null || baseScore === '' ? NaN : Number(baseScore);
    suffix = suffix || '';
    let state0 = null; // our vote when we first saw it (the score attr already includes it)
    let state = 0;
    const upBtn = el('button', { type: 'button', class: 'orr-vote orr-up', title: 'upvote' }, '\u25B2');
    const downBtn = el('button', { type: 'button', class: 'orr-vote orr-down', title: 'downvote' }, '\u25BC');

    function read() {
      const b = voteButtons(nativeEl);
      if (!b.up || !b.down) return null;
      const pressed = (x) => x.getAttribute('aria-pressed') === 'true';
      return { b, state: pressed(b.up) ? 1 : pressed(b.down) ? -1 : 0 };
    }
    function paint() {
      upBtn.classList.toggle('orr-on', state === 1);
      downBtn.classList.toggle('orr-on', state === -1);
      if (!isNaN(base) && state0 !== null) scoreNode.textContent = formatScore(base - state0 + state) + suffix;
    }
    function unavailable() {
      [upBtn, downBtn].forEach((b) => {
        b.classList.add('orr-vote-na');
        b.title = "voting unavailable (couldn't find reddit's vote buttons \u2013 are you logged in?)";
      });
    }
    async function vote(dir) {
      const r = read();
      if (!r) return unavailable();
      if (state0 === null) { state0 = state = r.state; }
      (dir > 0 ? r.b.up : r.b.down).click();
      await sleep(250);
      const r2 = read();
      state = r2 ? r2.state : state === dir ? 0 : dir;
      paint();
    }
    upBtn.addEventListener('click', () => vote(1));
    downBtn.addEventListener('click', () => vote(-1));

    // show an already-cast vote once reddit's buttons have rendered
    setTimeout(() => { const r = read(); if (r) { state0 = state = r.state; paint(); } }, 1000);

    return { up: upBtn, down: downBtn };
  }

  function voteCol(nativeEl, score) {
    const col = el('div', { class: 'orr-votecol' });
    const sc = el('div', { class: 'orr-score' }, formatScore(score));
    if (ENABLE_VOTING && nativeEl) {
      const v = attachVoting(nativeEl, sc, score, '');
      col.appendChild(v.up);
      col.appendChild(sc);
      col.appendChild(v.down);
    } else {
      col.appendChild(sc);
    }
    return col;
  }

  // ---------- header ----------
  function headerBar(withSort) {
    const bar = el('div', { class: 'orr-header' });
    bar.appendChild(el('a', { href: 'https://www.reddit.com/', class: 'orr-brand' }, 'reddit'));

    if (withSort) {
      const base = stripSort(PATH);
      const sorts = ['hot', 'new', 'rising', 'top', 'controversial', 'best'];
      const currentSort = (PATH.match(/\/(hot|new|top|rising|controversial|best)\/?$/i) || [, 'hot'])[1].toLowerCase();
      const tabs = el('div', { class: 'orr-tabs' });
      for (const s of sorts) {
        const href = (base === '/' ? '' : base) + '/' + s;
        tabs.appendChild(el('a', { href, class: 'orr-tab' + (s === currentSort ? ' orr-tab-active' : '') }, s));
      }
      bar.appendChild(tabs);
    } else {
      const m = PATH.match(/^\/r\/([^/]+)/);
      if (m) bar.appendChild(el('a', { href: 'https://www.reddit.com/r/' + m[1], class: 'orr-tab' }, 'back to r/' + m[1]));
    }

    const escapeUrl = new URL(location.href);
    escapeUrl.searchParams.set('orr', 'off');
    bar.appendChild(el('a', { href: escapeUrl.pathname + escapeUrl.search, class: 'orr-escape' }, 'view original reddit.com'));
    return bar;
  }

  // ---------- listing ----------
  function renderPostRow(el0) {
    const p = readPost(el0);
    const row = el('div', { class: 'orr-row' });
    row.appendChild(voteCol(el0, p.score));
    const body = el('div', { class: 'orr-body' });

    if (p.flair) body.appendChild(el('span', { class: 'orr-flair' }, p.flair));
    body.appendChild(el('a', {
      class: 'orr-title',
      href: p.url,
      target: p.isSelf ? '_self' : '_blank',
      rel: 'noopener noreferrer',
    }, p.title));
    if (!p.isSelf && p.domain) body.appendChild(el('span', { class: 'orr-domain' }, ' (' + p.domain + ')'));
    if (p.nsfw) body.appendChild(el('span', { class: 'orr-nsfw' }, 'NSFW'));

    body.appendChild(el('div', { class: 'orr-meta' },
      'submitted ' + formatAgo(p.created) + ' by ',
      el('a', { href: 'https://www.reddit.com/user/' + p.author, class: 'orr-user' }, p.author),
      ' to ',
      el('a', { href: 'https://www.reddit.com/r/' + p.subreddit, class: 'orr-sub' }, 'r/' + p.subreddit),
      '  |  ',
      el('a', { href: p.permalink, class: 'orr-comments' }, p.comments + ' comments')
    ));

    const media = renderMedia(el0);
    if (media) body.appendChild(media);
    row.appendChild(body);
    return row;
  }

  // The feed lazy-loads more posts via <faceplate-partial src="...after=...">.
  // Our hidden native page never scrolls, so we trigger that same-origin
  // partial ourselves from a "next" button and parse the HTML it returns.
  function findNextPartial(root) {
    const all = Array.from(root.querySelectorAll('faceplate-partial[src]'));
    const parts = all.filter((f) => {
      const src = f.getAttribute('src') || '';
      if (/right-rail|sidebar|trending|recommend/i.test(src)) return false;
      return /after=/.test(src) || /\/svc\/shreddit\/[^?]*more-posts/i.test(src);
    });
    if (!parts.length && all.length) {
      console.info('[old-reddit-dom-reader] partials seen but none matched:', all.map((f) => f.getAttribute('src')));
    }
    const last = parts[parts.length - 1];
    return last ? last.getAttribute('src') : null;
  }

  // Pinned / "community highlights" posts are not <shreddit-post> elements;
  // they live in a carousel of cards. We pull the thread link + title out of
  // any element whose tag name looks like a highlight/pinned/sticky container.
  // Title of the card an <a> belongs to. The section header ("Community
  // highlights") also uses slot="title", so we climb from the link and take
  // the first ancestor with its own title text instead of searching the container.
  function pinnedTitle(a, container) {
    const bad = (t) => !t || /^community highlights?$/i.test(t.trim());
    const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
    const own = clean(a.getAttribute('aria-label')) || clean(a.getAttribute('title'));
    if (!bad(own)) return own;
    for (let n = a; n; n = n.parentElement) {
      if (n === container && container.querySelectorAll('a[href*="/comments/"]').length > 1) break;
      const attr = clean(n.getAttribute && n.getAttribute('post-title'));
      if (!bad(attr)) return attr;
      const h = n.querySelector && n.querySelector('h1,h2,h3,h4,[slot="title"]');
      const t = clean(txt(h)) || clean(txt(n));
      if (!bad(t)) return t;
      if (n === container) break;
    }
    return '';
  }

  function collectPinned(root) {
    const out = [];
    const seenKeys = new Set();
    const tags = new Set();
    const containers = Array.from(root.querySelectorAll('*')).filter((n) => {
      const t = n.tagName.toLowerCase();
      if (/highlight|pinned|sticky|stickied/.test(t)) { tags.add(t); return true; }
      return false;
    });
    for (const c of containers) {
      c.querySelectorAll('a[href*="/comments/"]').forEach((a) => {
        let u;
        try { u = new URL(a.getAttribute('href'), location.origin + '/'); } catch (_) { return; }
        const key = u.pathname.replace(/\/?$/, '/');
        if (seenKeys.has(key)) return;
        const title = pinnedTitle(a, c);
        if (!title) return;
        seenKeys.add(key);
        out.push({ key, title: title.replace(/\s+/g, ' ').trim(), href: 'https://www.reddit.com' + u.pathname + u.search });
      });
    }
    console.info('[old-reddit-dom-reader] pinned: ' + out.length + ' found; highlight-ish tags:', Array.from(tags));
    return out;
  }

  function renderPinnedRow(pi) {
    const row = el('div', { class: 'orr-row orr-pinned' });
    row.appendChild(el('div', { class: 'orr-votecol' }, el('div', { class: 'orr-score' }, '\uD83D\uDCCC')));
    const body = el('div', { class: 'orr-body' });
    body.appendChild(el('span', { class: 'orr-flair orr-flair-pinned' }, 'pinned'));
    body.appendChild(el('a', { class: 'orr-title', href: pi.href, target: '_self' }, pi.title));
    row.appendChild(body);
    return row;
  }

  function renderListing(root) {
    root.appendChild(headerBar(true));
    const list = el('div', { class: 'orr-list' });
    root.appendChild(list);

    const seen = new Set();
    // posts fetched via 'load more' are inert (DOMParser). Moving them into a hidden
    // container in the live document upgrades them, so their vote buttons work.
    const holder = el('div', { id: 'orr-live' });
    document.body.appendChild(holder);
    function addPosts(src, live) {
      let n = 0;
      for (const p of topLevelPosts(src)) {
        const key = p.getAttribute('id') || p.getAttribute('permalink');
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        if (live && ENABLE_VOTING) holder.appendChild(p);
        list.appendChild(renderPostRow(p));
        n++;
      }
      return n;
    }

    const pinned = collectPinned(document);
    pinned.forEach((pi) => { seen.add(pi.key); list.appendChild(renderPinnedRow(pi)); });
    const firstCount = addPosts(document);
    if (!firstCount && !pinned.length) throw new Error('no shreddit-post elements found');

    let nextSrc = findNextPartial(document);
    let loading = false;
    const nav = el('div', { class: 'orr-nav' });
    root.appendChild(nav);

    async function loadMore() {
      if (loading || !nextSrc) return;
      loading = true;
      nav.textContent = 'loading\u2026';
      try {
        const res = await fetch(new URL(nextSrc, location.origin + '/').href, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(String(res.status));
        const frag = parseDoc(await res.text());
        const added = addPosts(frag, true);
        nextSrc = added ? findNextPartial(frag) : null;
      } catch (err) {
        console.error('[old-reddit-dom-reader] load more failed', err);
        nextSrc = null;
      }
      loading = false;
      drawNav();
    }

    function drawNav() {
      nav.textContent = '';
      if (!nextSrc) return;
      // a <button>, not an <a>: the window-level click interceptor only handles links
      nav.appendChild(el('button', {
        type: 'button',
        class: 'orr-next',
        onclick: () => loadMore(),
      }, 'load more \u203a'));
    }
    drawNav();

    // infinite scroll: load the next page when the nav nears the viewport
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      }, { rootMargin: '1200px' }).observe(nav);
    }

    // the SSR'd page only has a few posts, so pre-fill up to ~25 right away
    (async function prefill() {
      for (let i = 0; i < 4 && nextSrc && list.children.length < 25; i++) {
        await loadMore();
      }
    })();
  }

  // ---------- comments page ----------
  function buildComment(c) {
    const author = c.getAttribute('author') || '[deleted]';
    const scoreRaw = c.getAttribute('score');
    const tsEl = c.querySelector('time[datetime], faceplate-timeago[ts]');
    const created = tsEl ? parseTs(tsEl.getAttribute('datetime') || tsEl.getAttribute('ts')) : 0;
    const bodyEl = c.querySelector(':scope > [slot="comment"]') || c.querySelector('[slot="comment"]');

    const wrap = el('div', { class: 'orr-comment' });
    const hasScore = !(scoreRaw == null || scoreRaw === '');
    const scoreSpan = el('span', { class: 'orr-score' }, hasScore ? formatScore(scoreRaw) + ' points' : '');
    const votes = ENABLE_VOTING ? attachVoting(c, scoreSpan, scoreRaw, ' points') : null;
    const head = el('div', {
      class: 'orr-comment-head',
      onclick: (e) => { if (e.target.closest('a,button')) return; wrap.classList.toggle('orr-collapsed'); },
    },
      el('span', { class: 'orr-collapse-toggle' }, '[\u2013] '),
      votes ? votes.up : null,
      votes ? votes.down : null,
      ' ',
      el('a', { href: 'https://www.reddit.com/user/' + author, class: 'orr-user' }, author),
      ' ',
      scoreSpan,
      ' ',
      el('span', { class: 'orr-time' }, formatAgo(created))
    );
    wrap.appendChild(head);
    wrap.appendChild(el('div', { class: 'orr-comment-body', html: bodyEl ? cleanMd(bodyEl) : '<p>[removed]</p>' }));
    const kids = el('div', { class: 'orr-comment-children' });
    wrap.appendChild(kids);
    return { wrap, kids };
  }

  function renderCommentsPage(root) {
    const idm = /comments\/([a-z0-9]+)/i.exec(PATH);
    const postEl =
      (idm && document.querySelector('shreddit-post[permalink*="/comments/' + idm[1] + '"]')) ||
      document.querySelector('shreddit-post');
    if (!postEl) throw new Error('no shreddit-post element found');
    const p = readPost(postEl);
    root.appendChild(headerBar(false));

    const postBox = el('div', { class: 'orr-postbox' });
    postBox.appendChild(voteCol(postEl, p.score));
    const pbody = el('div', { class: 'orr-body' });
    if (p.flair) pbody.appendChild(el('span', { class: 'orr-flair' }, p.flair));
    pbody.appendChild(el('a', {
      class: 'orr-title orr-title-big',
      href: p.url,
      target: p.isSelf ? '_self' : '_blank',
      rel: 'noopener noreferrer',
    }, p.title));
    if (!p.isSelf && p.domain) pbody.appendChild(el('span', { class: 'orr-domain' }, ' (' + p.domain + ')'));
    if (p.nsfw) pbody.appendChild(el('span', { class: 'orr-nsfw' }, 'NSFW'));
    pbody.appendChild(el('div', { class: 'orr-meta' },
      'submitted ' + formatAgo(p.created) + ' by ',
      el('a', { href: 'https://www.reddit.com/user/' + p.author, class: 'orr-user' }, p.author),
      ' to ',
      el('a', { href: 'https://www.reddit.com/r/' + p.subreddit, class: 'orr-sub' }, 'r/' + p.subreddit)
    ));
    const media = renderMedia(postEl);
    if (media) pbody.appendChild(media);
    const selftext = postEl.querySelector('[slot="text-body"]');
    if (selftext && txt(selftext)) pbody.appendChild(el('div', { class: 'orr-selftext', html: cleanMd(selftext) }));
    postBox.appendChild(pbody);
    root.appendChild(postBox);

    root.appendChild(el('div', { class: 'orr-comments-count' }, p.comments + ' comments'));

    // Comments arrive in document order with a `depth` attribute, so we rebuild
    // the tree from depth instead of relying on how the DOM happens to nest.
    const list = el('div', { class: 'orr-comments-list' });
    const comments = Array.from(document.querySelectorAll('shreddit-comment'));
    const levels = [list];
    for (const c of comments) {
      let d = Number(c.getAttribute('depth')) || 0;
      d = Math.min(d, levels.length - 1);
      const { wrap, kids } = buildComment(c);
      levels[d].appendChild(wrap);
      levels.length = d + 1;
      levels.push(kids);
    }
    root.appendChild(list);

    if (comments.length < Number(p.comments)) {
      const more = new URL(location.href);
      more.searchParams.set('orr', 'off');
      root.appendChild(el('div', { class: 'orr-more orr-more-bottom' },
        'Showing ' + comments.length + ' of ' + p.comments + ' comments \u2013 ',
        el('a', { href: more.pathname + more.search }, 'open the original page for the rest')));
    }
  }

  // ---------- CSS ----------
  function injectCss() {
    const css = `
      #orr-root { all: initial; display:block; font: 13px/1.4 Verdana, Arial, sans-serif; color:#1c1c1c; background:#fff; max-width: 1024px; margin: 0 auto; }
      #orr-root * { box-sizing: border-box; font-family: inherit; }
      #orr-root a { color:#0b6b9c; text-decoration:none; }
      #orr-root a:hover { text-decoration:underline; }
      .orr-header { display:flex; align-items:center; gap:16px; background:#ff4500; padding:8px 12px; }
      .orr-brand { color:#fff !important; font-weight:bold; font-size:18px; letter-spacing:-0.5px; }
      .orr-tabs { display:flex; gap:10px; }
      .orr-tab, .orr-tabs a { color:#fff !important; opacity:0.85; text-transform:capitalize; }
      .orr-tab-active { opacity:1; font-weight:bold; text-decoration:underline; }
      .orr-escape { margin-left:auto; color:#fff !important; opacity:0.75; font-size:11px; }
      .orr-list { border-top:1px solid #edeff1; }
      .orr-row { display:flex; gap:10px; padding:10px 12px; border-bottom:1px solid #edeff1; }
      .orr-row:hover { background:#f8f9fa; }
      .orr-votecol { width:40px; flex:0 0 40px; text-align:center; padding-top:2px; }
      .orr-score { color:#878a8c; font-weight:bold; font-size:12px; }
      .orr-vote { display:block; margin:0 auto; background:none; border:0; padding:1px 6px; color:#c6c6c6; font-size:12px; line-height:1.1; cursor:pointer; }
      .orr-vote:hover { color:#888; }
      .orr-up.orr-on { color:#ff4500; }
      .orr-down.orr-on { color:#7193ff; }
      .orr-vote-na { opacity:0.35; cursor:not-allowed; }
      .orr-comment-head .orr-vote { display:inline-block; padding:0 3px; }
      .orr-body { flex:1; min-width:0; }
      .orr-title { font-size:16px; color:#222 !important; }
      .orr-title-big { font-size:20px; }
      .orr-domain { color:#888; font-size:12px; margin-left:4px; }
      .orr-flair { display:inline-block; background:#eef6ff; color:#369; border-radius:3px; padding:1px 5px; font-size:11px; margin-right:6px; }
      .orr-flair-pinned { background:#e6f4ea; color:#2e7d32; }
      .orr-pinned { background:#fafdf9; }
      .orr-nsfw { color:#e5001c; border:1px solid #e5001c; font-size:10px; padding:0 3px; margin-left:6px; border-radius:2px; }
      .orr-meta { color:#888; font-size:11.5px; margin-top:3px; }
      .orr-meta a { color:#888 !important; }
      .orr-meta a.orr-comments { color:#0b6b9c !important; }
      .orr-media { margin-top:8px; max-width:100%; }
      .orr-img, .orr-video { max-width:100%; max-height:80vh; width:auto; height:auto; border-radius:3px; display:block; }
      .orr-thumb { max-width:200px; border-radius:3px; display:block; }
      .orr-gallery { display:flex; flex-wrap:wrap; gap:6px; }
      .orr-gallery-img { max-width:300px; max-height:300px; border-radius:3px; }
      .orr-note { color:#aaa; font-size:11px; margin-top:2px; }
      .orr-nav { padding:14px; text-align:center; }
      button.orr-next { background:none; border:0; padding:4px 8px; color:#0b6b9c; font-size:13px; cursor:pointer; }
      button.orr-next:hover { text-decoration:underline; }
      .orr-postbox { display:flex; gap:10px; padding:14px 12px; border-bottom:2px solid #ff4500; }
      .orr-selftext { margin-top:10px; padding:10px; background:#f8f9fa; border:1px solid #edeff1; border-radius:4px; max-width:720px; overflow-wrap:anywhere; }
      .orr-selftext p { margin:0 0 10px; }
      .orr-comments-count { padding:10px 12px; color:#555; font-weight:bold; border-bottom:1px solid #edeff1; }
      .orr-comments-list { padding:10px 12px; }
      .orr-comment { border-left:2px solid #edeff1; padding-left:10px; margin-top:10px; }
      .orr-comment-children > .orr-comment { margin-left:6px; }
      .orr-comment-head { cursor:pointer; color:#888; font-size:11.5px; user-select:none; }
      .orr-comment-head .orr-user { color:#336699 !important; font-weight:bold; }
      .orr-comment-body { margin:4px 0 2px; overflow-wrap:anywhere; }
      .orr-comment-body p { margin:0 0 8px; }
      .orr-comment-body blockquote { margin:4px 0 8px 6px; padding-left:8px; border-left:2px solid #c5c1ad; color:#555; }
      .orr-comment-body pre { overflow-x:auto; background:#f6f6f6; padding:6px; }
      .orr-collapsed .orr-comment-body, .orr-collapsed .orr-comment-children { display:none; }
      .orr-more { color:#888; font-size:12px; margin-top:6px; }
      .orr-more-bottom { padding:12px; }
    `;
    document.documentElement.appendChild(el('style', { html: css }));
  }

  // ---------- boot ----------
  (async function boot() {
    try {
      await whenBodyReady();
      await domReady();
      const found = await waitFor(() => document.querySelector('shreddit-post'), 8000);
      if (!found) {
        const tags = Array.from(new Set(
          Array.from(document.querySelectorAll('*')).map((e) => e.tagName.toLowerCase()).filter((t) => t.includes('-'))
        )).slice(0, 60);
        console.warn('[old-reddit-dom-reader] no shreddit-post found. custom elements on page:', tags);
        throw new Error('no shreddit-post element found');
      }
      await sleep(250); // let the rest of the SSR'd feed/comments settle

      injectCss();
      const root = el('div', { id: 'orr-root' });
      document.body.appendChild(root);
      try {
        if (isComments) renderCommentsPage(root);
        else renderListing(root);
      } catch (err) {
        root.remove();
        throw err;
      }
    } catch (err) {
      // fall back to the normal reddit page instead of a blank hidden screen
      console.error('[old-reddit-dom-reader]', err);
      hideStyle.remove();
    }
  })();
})();