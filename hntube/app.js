/* Kazak — a YouTube-style front end over the videos Hacker News keeps recommending.
   Plain ES2020, no dependencies. Data comes from data/videos.js (generated). */
(function () {
  "use strict";

  const DATA = window.HNTUBE_DATA;
  const main = document.getElementById("main");
  const PAGE_SIZE = 48;
  const HN_ITEM = "https://news.ycombinator.com/item?id=";

  if (!DATA || !Array.isArray(DATA.videos) || DATA.videos.length === 0) {
    main.innerHTML = '<p class="empty">No video data found. Run <code>scripts/harvest_hn.py</code> then <code>scripts/build_data.py</code> to generate <code>data/videos.js</code>.</p>';
    return;
  }

  const VIDEOS = DATA.videos;
  const IS_AI = DATA.topic === "ai";
  const SITE = IS_AI ? "Kazak AI" : "Kazak";
  const BY_ID = new Map(VIDEOS.map((v) => [v.id, v]));
  const BY_CHANNEL = new Map();
  for (const v of VIDEOS) {
    const key = channelKey(v.channel);
    if (!BY_CHANNEL.has(key)) BY_CHANNEL.set(key, { name: v.channel, url: v.channelUrl, videos: [] });
    BY_CHANNEL.get(key).videos.push(v);
  }
  const CHANNELS = [...BY_CHANNEL.values()].sort(
    (a, b) => b.videos.length - a.videos.length || sum(b.videos, "mentions") - sum(a.videos, "mentions")
  );
  const SEARCH_INDEX = VIDEOS.map((v) => ({
    v,
    text: [v.title, v.channel, ...v.submissions.map((s) => s.title)].join(" \n ").toLowerCase(),
  }));

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function sum(arr, key) { return arr.reduce((n, x) => n + (x[key] || 0), 0); }
  function channelKey(name) { return (name || "").trim().toLowerCase(); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  function compact(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "k";
    return String(n);
  }
  const fmtMonth = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
  const fmtDay = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  function month(ts) { return fmtMonth.format(new Date(ts * 1000)); }
  function day(ts) { return fmtDay.format(new Date(ts * 1000)); }
  function yearOf(ts) { return new Date(ts * 1000).getUTCFullYear(); }
  function span(v) {
    const a = v.years[0], b = v.years[v.years.length - 1];
    return a === b ? String(a) : a + "–" + b;
  }
  function initial(name) {
    const m = (name || "?").trim().match(/[\p{L}\p{N}]/u);
    return m ? m[0] : "?";
  }
  function channelHref(name) { return "#/channel/" + encodeURIComponent(name); }
  function el(html) {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---------- sorting / filtering ----------
  const SORTS = {
    rec: { label: "Most recommended", fn: (a, b) => b.mentions - a.mentions || b.points - a.points || a.firstSeen - b.firstSeen },
    points: { label: "Most HN points", fn: (a, b) => b.points - a.points || b.mentions - a.mentions },
    years: { label: "Most years", fn: (a, b) => b.years.length - a.years.length || (b.lastSeen - b.firstSeen) - (a.lastSeen - a.firstSeen) || b.mentions - a.mentions },
    classic: { label: "Oldest classics", fn: (a, b) => a.firstSeen - b.firstSeen || b.mentions - a.mentions },
    recent: { label: "Recently resurfaced", fn: (a, b) => b.lastSeen - a.lastSeen || b.mentions - a.mentions },
  };
  const DECADES = [
    { key: "all", label: "Any era", test: () => true },
    { key: "2000s", label: "First seen 2000s", test: (v) => yearOf(v.firstSeen) < 2010 },
    { key: "2010s", label: "First seen 2010s", test: (v) => yearOf(v.firstSeen) >= 2010 && yearOf(v.firstSeen) < 2020 },
    { key: "2020s", label: "First seen 2020s", test: (v) => yearOf(v.firstSeen) >= 2020 },
  ];

  function search(query) {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out = [];
    for (const { v, text } of SEARCH_INDEX) {
      if (tokens.every((t) => text.includes(t))) {
        const inTitle = tokens.filter((t) => v.title.toLowerCase().includes(t)).length;
        out.push({ v, score: inTitle * 1000 + v.mentions });
      }
    }
    return out.sort((a, b) => b.score - a.score).map((x) => x.v);
  }

  // ---------- components ----------
  function card(v) {
    return `
      <article class="card">
        <a class="thumb" href="#/watch/${esc(v.id)}" aria-label="${esc(v.title)}">
          <img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" width="480" height="360" />
          <span class="thumb__badge" title="Times linked on Hacker News">×${v.mentions} on HN</span>
        </a>
        <div class="card__body">
          <a class="avatar" href="${channelHref(v.channel)}" aria-hidden="true" tabindex="-1">${esc(initial(v.channel))}</a>
          <div class="card__text">
            <h3 class="card__title"><a href="#/watch/${esc(v.id)}">${esc(v.title)}</a></h3>
            <div class="card__meta"><a href="${channelHref(v.channel)}">${esc(v.channel)}</a></div>
            <div class="card__meta"><span>${plural(v.mentions, "HN mention")}</span><span>${esc(span(v))}</span></div>
          </div>
        </div>
      </article>`;
  }

  function mini(v) {
    return `
      <a class="mini" href="#/watch/${esc(v.id)}">
        <span class="thumb"><img src="${esc(v.thumbnail)}" alt="" loading="lazy" decoding="async" /><span class="thumb__badge">×${v.mentions}</span></span>
        <span>
          <span class="mini__title">${esc(v.title)}</span>
          <span class="mini__meta">${esc(v.channel)}</span>
          <span class="mini__meta"><span>${plural(v.mentions, "mention")}</span><span>${esc(span(v))}</span></span>
        </span>
      </a>`;
  }

  /** Renders a grid with incremental loading. */
  function grid(container, list) {
    if (!list.length) {
      container.innerHTML = '<p class="empty">Nothing matches.</p>';
      return;
    }
    const g = el('<div class="grid"></div>');
    container.appendChild(g);
    let shown = 0;
    const more = el('<button class="btn loadmore" type="button">Show more</button>');
    const sentinel = el('<div class="sentinel" aria-hidden="true"></div>');
    function next() {
      const slice = list.slice(shown, shown + PAGE_SIZE);
      g.insertAdjacentHTML("beforeend", slice.map(card).join(""));
      shown += slice.length;
      if (shown >= list.length) { more.remove(); sentinel.remove(); observer.disconnect(); }
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) next();
    }, { rootMargin: "800px 0px" });
    more.addEventListener("click", next);
    container.appendChild(sentinel);
    container.appendChild(more);
    next();
    if (shown < list.length) observer.observe(sentinel);
  }

  function chips(sortKey, decadeKey) {
    const sortChips = Object.entries(SORTS).map(([k, s]) =>
      `<a class="chip ${k === sortKey ? "is-active" : ""}" href="#/?sort=${k}&era=${decadeKey}">${s.label}</a>`).join("");
    const eraChips = DECADES.map((d) =>
      `<a class="chip ${d.key === decadeKey ? "is-active" : ""}" href="#/?sort=${sortKey}&era=${d.key}">${d.label}</a>`).join("");
    return `<div class="chips" role="navigation" aria-label="Sort and filter"><span class="chips__label">Sort</span>${sortChips}<span class="chips__label" style="margin-left:12px">Era</span>${eraChips}</div>`;
  }

  // ---------- pages ----------
  function renderHome(params) {
    const sortKey = SORTS[params.get("sort")] ? params.get("sort") : "rec";
    const decade = DECADES.find((d) => d.key === params.get("era")) || DECADES[0];
    const list = VIDEOS.filter(decade.test).sort(SORTS[sortKey].fn);
    main.innerHTML = chips(sortKey, decade.key);
    grid(main, list);
    setTitle(sortKey === "rec" && decade.key === "all" ? null : SORTS[sortKey].label);
    setNav(sortKey === "rec" ? "home" : sortKey);
  }

  function renderSearch(q) {
    const list = search(q);
    main.innerHTML = `<div class="page-head"><h1>Results for “${esc(q)}”</h1><p>${plural(list.length, "video")} match titles, channels or HN headlines.</p></div>`;
    grid(main, list);
    setTitle("Search: " + q);
    setNav(null);
    document.getElementById("search-input").value = q;
  }

  function renderChannel(name) {
    const ch = BY_CHANNEL.get(channelKey(name));
    if (!ch) {
      main.innerHTML = `<div class="page-head"><h1>Channel not found</h1><p>No channel called “${esc(name)}” in this catalogue.</p></div>`;
      setTitle("Channel not found");
      return;
    }
    const list = ch.videos.slice().sort(SORTS.rec.fn);
    const link = ch.url ? `<a class="btn" href="${esc(ch.url)}" target="_blank" rel="noopener noreferrer">View on YouTube</a>` : "";
    main.innerHTML = `
      <div class="channel-head">
        <span class="avatar" aria-hidden="true">${esc(initial(ch.name))}</span>
        <div>
          <h1>${esc(ch.name)}</h1>
          <p>${plural(list.length, "video")} in the catalogue • ${plural(sum(list, "mentions"), "HN mention")} • ${compact(sum(list, "points"))} HN points</p>
          <p style="margin-top:8px">${link}</p>
        </div>
      </div>`;
    grid(main, list);
    setTitle(ch.name);
    setNav("channel:" + channelKey(ch.name));
  }

  function hnList(items, renderItem, limit) {
    if (!items.length) return '<p class="hn-list sub">None.</p>';
    const sorted = items.slice().sort((a, b) => b.date - a.date);
    const head = sorted.slice(0, limit).map(renderItem).join("");
    const rest = sorted.slice(limit).map(renderItem).join("");
    const more = rest
      ? `<details class="more-link"><summary>Show ${sorted.length - limit} more</summary><ul class="hn-list">${rest}</ul></details>`
      : "";
    return `<ul class="hn-list">${head}</ul>${more}`;
  }

  function renderWatch(id) {
    const v = BY_ID.get(id);
    if (!v) {
      main.innerHTML = `<div class="page-head"><h1>Video not in the catalogue</h1><p>“${esc(id)}” is not one of the videos Hacker News has repeatedly recommended, or it is no longer available on YouTube.</p><p><a class="btn" href="#/">Back to home</a></p></div>`;
      setTitle("Not found");
      return;
    }
    const chVideos = (BY_CHANNEL.get(channelKey(v.channel)) || { videos: [] }).videos.filter((x) => x.id !== v.id).sort(SORTS.rec.fn);
    const others = VIDEOS.filter((x) => x.id !== v.id && !chVideos.includes(x)).sort(SORTS.rec.fn);
    const upnext = chVideos.slice(0, 4).concat(others).slice(0, 14);
    const top = v.topStory;

    const submission = (s) => `
      <li>
        <span class="date">${esc(day(s.date))}</span>
        <span>
          <div class="title"><a href="${HN_ITEM}${esc(s.id)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a></div>
          <div class="sub"><span class="hn-points">${plural(s.points, "point")}</span><span>${plural(s.comments, "comment")}</span><span>by ${esc(s.author)}</span></div>
        </span>
      </li>`;
    const mention = (c) => `
      <li>
        <span class="date">${esc(day(c.date))}</span>
        <span>
          <div class="title"><a href="${HN_ITEM}${esc(c.id)}" target="_blank" rel="noopener noreferrer">Comment by ${esc(c.author)}</a></div>
          <div class="sub">in “<a href="${HN_ITEM}${esc(c.storyId)}" target="_blank" rel="noopener noreferrer">${esc(c.storyTitle || "untitled thread")}</a>”</div>
        </span>
      </li>`;

    main.innerHTML = `
      <div class="watch">
        <section>
          <div class="player">
            <iframe src="https://www.youtube-nocookie.com/embed/${esc(v.id)}?autoplay=1&rel=0" title="${esc(v.title)}"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
          </div>
          <h1 class="watch__title">${esc(v.title)}</h1>
          <div class="watch__row">
            <a class="watch__channel" href="${channelHref(v.channel)}">
              <span class="avatar" aria-hidden="true">${esc(initial(v.channel))}</span>
              <span><div class="name">${esc(v.channel)}</div><div class="sub">${plural((BY_CHANNEL.get(channelKey(v.channel)) || { videos: [] }).videos.length, "video")} in the catalogue</div></span>
            </a>
            <div class="watch__actions">
              ${top ? `<a class="btn btn--primary" href="${HN_ITEM}${esc(top.id)}" target="_blank" rel="noopener noreferrer">Top HN thread (${compact(top.points)} pts)</a>` : ""}
              <a class="btn" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener noreferrer">Open on YouTube</a>
            </div>
          </div>
          <div class="stats" aria-label="Hacker News statistics">
            <div class="stat"><div class="stat__value">${v.mentions}</div><div class="stat__label">times linked on HN</div></div>
            <div class="stat"><div class="stat__value">${v.storyCount}</div><div class="stat__label">front-page submissions</div></div>
            <div class="stat"><div class="stat__value">${v.commentCount}</div><div class="stat__label">comment recommendations</div></div>
            <div class="stat"><div class="stat__value">${v.years.length}</div><div class="stat__label">distinct years (${esc(span(v))})</div></div>
            <div class="stat"><div class="stat__value">${compact(v.points)}</div><div class="stat__label">HN points in total</div></div>
            <div class="stat"><div class="stat__value">${v.users}</div><div class="stat__label">different HN users</div></div>
          </div>
          <div class="desc">
            <h2>Why it is here</h2>
            <p>Linked from Hacker News ${v.mentions} times between ${esc(month(v.firstSeen))} and ${esc(month(v.lastSeen))}, by ${plural(v.users, "different user")} across ${plural(v.years.length, "different year")}.</p>
            <h3>Submissions (${v.submissions.length})</h3>
            ${hnList(v.submissions, submission, 10)}
            <h3>Recommended in comments (${v.commentCount})</h3>
            ${v.commentCount > v.commentMentions.length ? `<p class="sub" style="margin:0 0 6px;font-size:13px;color:var(--text-muted)">Showing the ${v.commentMentions.length} most recent.</p>` : ""}
            ${hnList(v.commentMentions, mention, 10)}
          </div>
        </section>
        <aside class="upnext" aria-label="Up next">
          <h2>Up next</h2>
          ${upnext.map(mini).join("")}
        </aside>
      </div>`;
    setTitle(v.title);
    setNav(null);
  }

  function renderAbout() {
    const src = DATA.source || {};
    const crit = DATA.criteria || {};
    const built = DATA.builtAt ? day(DATA.builtAt) : "unknown";
    main.innerHTML = `
      <div class="prose">
        <h1>How this catalogue is built</h1>
        <p>${IS_AI
          ? "Kazak AI is a YouTube-style front end restricted to one thing: videos about artificial intelligence that Hacker News has recommended again and again over the years."
          : "Kazak is a YouTube-style front end restricted to one thing: videos that Hacker News has recommended again and again over the years."} Nothing here was hand-picked. Every video earned its place by being linked repeatedly, by different people, in different years.</p>
        <h2>Source data</h2>
        <p>The whole public history of Hacker News was crawled through the <a href="https://hn.algolia.com/api" target="_blank" rel="noopener noreferrer">HN Algolia search API</a>: every story whose URL points at YouTube and every comment containing a YouTube link, from ${esc(src.from ? month(src.from) : "the start")} to ${esc(src.to ? month(src.to) : "now")}. The crawl is sliced by date so that Algolia's 1,000-hit cap never truncates a window.</p>
        <table>
          <tr><th>Stories linking a YouTube video</th><td>${esc((src.stories || 0).toLocaleString("en"))}</td></tr>
          <tr><th>Comments linking a YouTube video</th><td>${esc((src.comments || 0).toLocaleString("en"))}</td></tr>
          <tr><th>Distinct videos seen</th><td>${esc((src.distinctVideos || 0).toLocaleString("en"))}</td></tr>
          <tr><th>Videos meeting the bar</th><td>${esc((src.qualifying || 0).toLocaleString("en"))}</td></tr>
          ${IS_AI
            ? `<tr><th>Still available and about AI</th><td>${esc((src.onTopic || 0).toLocaleString("en"))}</td></tr>`
            : `<tr><th>Still available on YouTube</th><td>${esc((src.available || 0).toLocaleString("en"))}</td></tr>`}
          <tr><th>Data built</th><td>${esc(built)}</td></tr>
        </table>
        <h2>The bar</h2>
        <p>A video is included only if all three hold:</p>
        <ul>
          <li>linked from Hacker News at least <strong>${esc(crit.minMentions)}</strong> times (submissions and comments combined, each HN item counted once);</li>
          <li>in at least <strong>${esc(crit.minYears)}</strong> different calendar years;</li>
          <li>by at least <strong>${esc(crit.minUsers)}</strong> different HN users.</li>
        </ul>
        <p>Each candidate is then checked against YouTube's oEmbed endpoint. Videos that are deleted, private or otherwise unavailable are dropped, and the title and channel shown here come from YouTube, not from HN headlines.</p>
        ${IS_AI ? `<h2>What counts as AI</h2>
        <p>A video is kept when its YouTube title, or one of the Hacker News headlines it was submitted under, names an AI subject: artificial intelligence, machine learning, neural networks, language models, reinforcement learning, AI labs and researchers such as DeepMind, OpenAI or Karpathy, and similar terms. Acronyms such as AI, LLM and GPT are matched as whole words only. A few channels that publish nothing but AI are kept whole. The resulting list was reviewed by hand, and the false positives that keywords let through were removed.</p>
        <p>The bar is lower than on the <a href="../">general catalogue</a>, because most AI videos are recent and have had fewer years to be recommended again.</p>` : ""}
        <h2>What the numbers mean</h2>
        <ul>
          <li><strong>Times linked on HN</strong>: distinct submissions plus distinct comments containing the video.</li>
          <li><strong>HN points</strong>: the sum of points over every submission of the video.</li>
          <li><strong>Distinct years</strong>: calendar years with at least one submission or comment.</li>
        </ul>
        <h2>Limitations</h2>
        <ul>
          <li>Only youtube.com, youtu.be and youtube-nocookie.com links are recognised; a video that reached HN only as a mirror or a Vimeo upload is invisible here.</li>
          <li>Durations and view counts are not shown: YouTube does not expose them without an API key, and this site runs without one.</li>
          <li>Counts reflect what the Algolia index returned at build time. Deleted or dead HN items are not in the index.</li>
        </ul>
        <h2>Rebuilding</h2>
        <p>Run <code>python3 scripts/harvest_hn.py &lt;cache-dir&gt;</code> to crawl (resumable), then <code>python3 scripts/build_data.py &lt;cache-dir&gt; &lt;oembed-cache-dir&gt;</code> to regenerate <code>data/videos.js</code>.</p>
      </div>`;
    setTitle("How it works");
    setNav("about");
  }

  // ---------- chrome ----------
  function setTitle(t) { document.title = (t ? t + " — " : "") + SITE; }
  function setNav(key) {
    document.querySelectorAll(".nav-item").forEach((a) => a.classList.toggle("is-active", a.dataset.nav === key));
  }
  function renderSidebar() {
    const box = document.getElementById("sidebar-channels");
    box.innerHTML = CHANNELS.slice(0, 12).map((c) => `
      <a class="nav-item" href="${channelHref(c.name)}" data-nav="channel:${esc(channelKey(c.name))}" title="${esc(c.name)}">
        <span class="avatar" aria-hidden="true">${esc(initial(c.name))}</span><span>${esc(c.name)}</span>
      </a>`).join("");
    const sw = document.getElementById("topic-switch");
    if (sw) {
      sw.href = IS_AI ? "../" : "ai/";
      sw.querySelector("span").textContent = IS_AI ? "All topics" : "AI only";
    }
    document.getElementById("sidebar-foot").textContent =
      `${VIDEOS.length.toLocaleString("en")} videos from ${CHANNELS.length.toLocaleString("en")} channels. Data built ${DATA.builtAt ? day(DATA.builtAt) : ""}.`;
  }

  function route() {
    const hash = location.hash || "#/";
    const m = hash.match(/^#\/([^/?]*)\/?([^?]*)(\?.*)?$/);
    const page = m ? m[1] : "";
    const arg = m ? decodeURIComponent(m[2]) : "";
    const params = new URLSearchParams(m && m[3] ? m[3].slice(1) : "");
    window.scrollTo(0, 0);
    if (page === "watch") renderWatch(arg);
    else if (page === "channel") renderChannel(arg);
    else if (page === "search") renderSearch(arg);
    else if (page === "about") renderAbout();
    else renderHome(params);
    if (window.innerWidth <= 800) document.body.classList.add("nav-collapsed");
  }

  // Search form.
  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("search-input").value.trim();
    location.hash = q ? "#/search/" + encodeURIComponent(q) : "#/";
  });
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing) { e.preventDefault(); document.getElementById("search-input").focus(); }
    if (e.key === "Escape" && document.activeElement.id === "search-input") document.activeElement.blur();
  });

  // Sidebar toggle.
  const menuBtn = document.getElementById("menu-toggle");
  menuBtn.addEventListener("click", () => {
    const collapsed = document.body.classList.toggle("nav-collapsed");
    menuBtn.setAttribute("aria-expanded", String(!collapsed));
  });
  if (window.innerWidth <= 800) { document.body.classList.add("nav-collapsed"); menuBtn.setAttribute("aria-expanded", "false"); }

  // Theme toggle (persisted per browser).
  const root = document.documentElement;
  try { const saved = localStorage.getItem("kazak-theme"); if (saved) root.dataset.theme = saved; } catch (_) { /* storage unavailable */ }
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("kazak-theme", root.dataset.theme); } catch (_) { /* ignore */ }
  });

  renderSidebar();
  window.addEventListener("hashchange", route);
  route();
})();
