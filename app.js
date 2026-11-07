/* ============================================================
   映集 · 影音聚合检索（前端逻辑）
   - 前后端同源，API 用相对路径，任何设备打开都正确
   - 三态主题、加载骨架、超时重试、结果页常驻搜索、区块导航
   ========================================================== */
(function () {
  "use strict";

  /* ---------- API 地址 ---------- */
  const REMOTE_API_KEY = "yingji_api_base";
  function resolveApiBase() {
    try {
      const saved = localStorage.getItem(REMOTE_API_KEY);
      if (saved && /^https?:\/\//i.test(saved)) return saved.replace(/\/+$/, "");
    } catch (e) { /* localStorage 不可用时忽略 */ }
    return ""; // 默认同源
  }
  let API_BASE = resolveApiBase();
  const SEARCH_API = () => `${API_BASE}/api/search`;
  window.__setYingjiApi = function (url) {
    const clean = String(url || "").replace(/\/+$/, "");
    try { localStorage.setItem(REMOTE_API_KEY, clean); } catch (e) {}
    API_BASE = clean;
    return API_BASE;
  };

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const heroSection = $("heroSection"), resultsSection = $("resultsSection");
  const resultTitle = $("resultTitle"), resultsSummary = $("resultsSummary");
  const backBtn = $("backBtn"), brandLink = $("brandLink"), topNav = $("topNav");
  const searchInput = $("searchInput"), resultInput = $("resultInput");
  const searchBtn = $("searchBtn"), resultSearchBtn = $("resultSearchBtn");
  const clearBtn = $("clearBtn"), resultClearBtn = $("resultClearBtn");
  const skeleton = $("skeleton"), skeletonText = $("skeletonText");
  const errorState = $("errorState"), errorMsg = $("errorMsg"), retryBtn = $("retryBtn");
  const resultContent = $("resultContent"), emptyTip = $("emptyTip");
  const biliBlock = $("biliBlock"), biliCount = $("biliCount"), biliList = $("biliList");
  const videoWrap = $("videoWrap"), videoPlaceholder = $("videoPlaceholder");
  const biliTitle = $("biliTitle"), biliMeta = $("biliMeta"), biliOpen = $("biliOpen");
  const videoBlock = $("videoBlock"), videoCount = $("videoCount"), videoList = $("videoList");
  const musicBlock = $("musicBlock"), musicCount = $("musicCount"), musicList = $("musicList");
  const themeBtn = $("themeBtn"), themeIcon = $("themeIcon"), themeLabel = $("themeLabel");
  const toastEl = $("toast"), historyList = $("searchHistory");
  const carBtn = $("carBtn"), carLabel = $("carLabel");
  const recentRow = $("recentRow"), recentTags = $("recentTags");
  const carHeroNote = $("carHeroNote"), driveNote = $("driveNote");

  /* ---------- 主题：跟随系统 / 浅色 / 深色 ---------- */
  const THEME_KEY = "yingji_theme";
  const THEME_ORDER = ["auto", "light", "dark"];
  const THEME_META = {
    auto:  { icon: "◐", label: "跟随", tip: "当前：跟随系统（点击切换为浅色）" },
    light: { icon: "☀", label: "浅色", tip: "当前：浅色（点击切换为深色）" },
    dark:  { icon: "☾", label: "深色", tip: "当前：深色（点击恢复跟随系统）" },
  };
  function readTheme() {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return THEME_ORDER.indexOf(v) >= 0 ? v : "auto";
    } catch (e) { return "auto"; }
  }
  function applyTheme(mode, silent) {
    document.documentElement.setAttribute("data-theme", mode);
    const meta = THEME_META[mode];
    themeIcon.textContent = meta.icon;
    themeLabel.textContent = meta.label;
    themeBtn.title = meta.tip;
    themeBtn.setAttribute("aria-label", meta.tip);
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    if (!silent) showToast(`已切换为「${meta.label}」主题`);
  }
  applyTheme(readTheme(), true);
  themeBtn.addEventListener("click", () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(readTheme()) + 1) % THEME_ORDER.length];
    applyTheme(next);
  });

  /* ---------- 工具 ---------- */
  let toastTimer = null;
  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("is-visible"), 2200);
  }
  function safeUrl(u) {
    if (typeof u !== "string") return "";
    const s = u.trim();
    return /^https?:\/\//i.test(s) ? s : ""; // 过滤 javascript: / data: 等
  }
  // replaceChildren 在部分老车机 WebView 上不存在，统一走兼容写法
  function setChildren(node, frag) {
    while (node.firstChild) node.removeChild(node.firstChild);
    if (frag) node.appendChild(frag);
  }
  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function formatCount(n) {
    if (!n) return "0";
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }
  function sourceLabel(s) {
    return ({ douban: "豆瓣", qq: "QQ音乐", netease: "网易云", tmdb: "TMDB", mock: "演示" })[s] || "真实";
  }
  function sourceBadgeText(source) {
    return ({
      douban: "数据源：豆瓣（真实）",
      mixed: "数据源：豆瓣 + 音乐平台（真实）",
      music: "数据源：QQ音乐 + 网易云（真实）",
      netease: "数据源：网易云（真实）",
      qq: "数据源：QQ音乐（真实）",
      tmdb: "数据源：TMDB（真实）",
      mock: "数据源：本地演示",
    })[source] || "数据源：真实 + 演示";
  }

  /* ---------- 搜索历史（datalist + 车机可点按钮） ---------- */
  const HISTORY_KEY = "yingji_history";
  function getHistory() {
    try {
      const v = JSON.parse(localStorage.getItem(HISTORY_KEY));
      return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
    } catch (e) { return []; }
  }
  function renderHistory(list) {
    const frag = document.createDocumentFragment();
    list.forEach((kw) => {
      const opt = document.createElement("option");
      opt.value = kw;
      frag.appendChild(opt);
    });
    setChildren(historyList, frag);
  }
  // 车机上软键盘输入很痛苦，把最近搜索做成可一键点选的大按钮
  function renderRecent() {
    const list = getHistory().slice(0, 6);
    const frag = document.createDocumentFragment();
    list.forEach((kw) => {
      const b = el("button", "recent-tag", kw);
      b.type = "button";
      b.addEventListener("click", () => doSearch(kw));
      frag.appendChild(b);
    });
    setChildren(recentTags, frag);
    recentRow.hidden = !isCarOn() || !list.length;
  }
  function pushHistory(kw) {
    const list = [kw].concat(getHistory().filter((x) => x !== kw)).slice(0, 8);
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch (e) {}
    renderHistory(list);
    renderRecent();
  }
  renderHistory(getHistory());

  /* ---------- 车机模式 ---------- */
  const CAR_KEY = "yingji_car";
  function isCarOn() { return document.documentElement.getAttribute("data-car") === "on"; }
  function applyCar(on, silent) {
    if (on) document.documentElement.setAttribute("data-car", "on");
    else document.documentElement.removeAttribute("data-car");
    carBtn.classList.toggle("is-on", on);
    carLabel.textContent = on ? "车机开" : "车机";
    carBtn.title = on ? "车机模式已开启（点击关闭）" : "切换车机模式（大按钮 / 音乐优先 / 驻车播放）";
    carHeroNote.hidden = !on;
    driveNote.hidden = !on;
    renderRecent();
    try { localStorage.setItem(CAR_KEY, on ? "1" : "0"); } catch (e) {}
    if (silent) return;
    if (on) {
      if (!heroSection.hidden) clearPlayer(); // 停掉后台 iframe，改为驻车后手动点选
      showToast("车机模式：音乐优先，视频请驻车后点选");
    } else {
      showToast("已退出车机模式");
    }
  }
  carBtn.addEventListener("click", () => applyCar(!isCarOn()));
  applyCar(isCarOn(), true);

  /* ---------- 图片（失败时显示首字兜底，不用 background-image） ---------- */
  function makePoster(item, cls) {
    const box = el("div", cls, (item.name || "?").slice(0, 1));
    const url = safeUrl(item.poster);
    if (!url) { box.classList.add("is-fallback"); return box; }
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // 绝对定位覆盖文字：加载失败隐藏图片即露出兜底文字
    img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;";
    img.addEventListener("error", () => { img.classList.add("is-broken"); box.classList.add("is-fallback"); });
    img.src = url;
    box.appendChild(img);
    return box;
  }

  /* ---------- B站播放器 ---------- */
  let biliPlaylist = [], biliIndex = -1;

  const CAR_PLAY_HINT = "请在驻车后点选右侧视频开始播放";
  function clearPlayer() {
    const old = videoWrap.querySelector("iframe");
    if (old) old.remove(); // 返回首页时移除，避免后台继续播放
    videoPlaceholder.hidden = false;
    const p = videoPlaceholder.querySelector("p");
    if (p) p.textContent = isCarOn() ? CAR_PLAY_HINT : "点击右侧列表，选择要播放的视频";
    biliTitle.textContent = "—";
    biliMeta.textContent = "从右侧列表挑一条开始看";
    biliOpen.hidden = true;
  }

  // 只选中、不创建 iframe：车机搜索后的默认态（行驶中不加载视频流）
  function selectBili(index) {
    const v = biliPlaylist[index];
    if (!v) return;
    biliIndex = index;

    const old = videoWrap.querySelector("iframe");
    if (old) old.remove();

    videoPlaceholder.hidden = false;
    const p = videoPlaceholder.querySelector("p");
    if (p) p.textContent = isCarOn() ? CAR_PLAY_HINT : "点击右侧列表，选择要播放的视频";

    biliTitle.textContent = v.name || "—";
    const parts = [];
    if (v.author) parts.push("UP主：" + v.author);
    if (v.duration) parts.push(v.duration);
    if (v.play) parts.push(formatCount(v.play) + " 播放");
    biliMeta.textContent = parts.join(" · ");

    const openUrl = safeUrl(v.url);
    biliOpen.hidden = !openUrl;
    if (openUrl) biliOpen.href = openUrl;

    Array.prototype.forEach.call(biliList.children, (node, i) => {
      node.classList.toggle("is-active", i === index);
      node.setAttribute("aria-selected", i === index ? "true" : "false");
    });
  }

  function playBili(index) {
    const v = biliPlaylist[index];
    if (!v || !safeUrl(v.embed)) return;
    selectBili(index);

    const p = videoPlaceholder.querySelector("p");
    if (p) p.textContent = "播放器加载中…";

    const iframe = document.createElement("iframe");
    iframe.title = `${v.name || "B站视频"} · 哔哩哔哩播放器`;
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    iframe.setAttribute("scrolling", "no");
    iframe.addEventListener("load", () => { videoPlaceholder.hidden = true; });
    iframe.src = v.embed;
    videoWrap.appendChild(iframe);
    // B站 iframe 偶发被网络拦截时不触发 load，给出可操作的提示而不是一直转圈
    setTimeout(() => {
      if (!videoPlaceholder.hidden && biliIndex === index) {
        const pp = videoPlaceholder.querySelector("p");
        if (pp) pp.textContent = "播放器加载较慢，可点下方「在 B站打开」";
      }
    }, 8000);
  }

  function renderBili() {
    const frag = document.createDocumentFragment();
    biliCount.textContent = `共 ${biliPlaylist.length} 条 · 点击列表切换播放`;

    if (!biliPlaylist.length) {
      setChildren(biliList);
      clearPlayer();
      return;
    }

    biliPlaylist.forEach((v, i) => {
      const item = el("div", "bili-item");
      item.setAttribute("role", "option");
      item.setAttribute("tabindex", "0");
      item.setAttribute("aria-selected", "false");

      const thumb = makePoster(v, "bili-item-thumb");
      item.appendChild(thumb);

      const info = el("div", "bili-item-info");
      info.appendChild(el("div", "bili-item-title", v.name || "未命名视频"));
      const meta = el("div", "bili-item-meta");
      if (v.author) meta.appendChild(el("span", "", v.author));
      if (v.duration) meta.appendChild(el("span", "", v.duration));
      if (v.play) meta.appendChild(el("span", "", formatCount(v.play) + " 播放"));
      info.appendChild(meta);
      item.appendChild(info);

      item.addEventListener("click", () => playBili(i));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playBili(i); }
      });
      frag.appendChild(item);
    });
    setChildren(biliList, frag);
    if (isCarOn()) selectBili(0); // 车机：只选中，行驶中不加载视频流
    else playBili(0);             // 其他设备：默认展示第一条（autoplay=0，不会自动出声）
  }

  /* ---------- 结果卡片（全部 DOM API 构建，避免第三方字段注入） ---------- */
  function buildCard(item) {
    const card = el("div", "result-card");
    card.appendChild(makePoster(item, "result-poster"));

    const info = el("div", "result-info");
    info.appendChild(el("div", "result-name", item.name || "未命名"));

    const meta = el("div", "result-meta");
    if (item.type) meta.appendChild(el("span", "", String(item.type)));
    if (item.year) meta.appendChild(el("span", "", String(item.year)));
    if (item.artist) meta.appendChild(el("span", "", String(item.artist)));
    if (item.overview) meta.appendChild(el("span", "", String(item.overview)));
    if (item.rating) meta.appendChild(el("span", "result-rating", "★ " + String(item.rating)));
    if (item.source) meta.appendChild(el("span", "result-source-tag", sourceLabel(item.source)));
    info.appendChild(meta);

    const detailUrl = safeUrl(item.url);
    if (detailUrl && /(douban\.com|music\.163\.com|y\.qq\.com|bilibili\.com)/i.test(detailUrl)) {
      const detail = el("a", "result-detail", /music|y\.qq/i.test(detailUrl) ? "试听 ›" : "查看详情 ›");
      detail.href = detailUrl;
      detail.target = "_blank";
      detail.rel = "noopener noreferrer";
      info.appendChild(detail);
    }
    card.appendChild(info);

    if (Array.isArray(item.platforms) && item.platforms.length) {
      const platforms = el("div", "result-platforms");
      item.platforms.slice(0, 6).forEach((p, idx) => {
        const url = safeUrl(p && p.url);
        if (!url) return;
        const a = el("a", "platform-link" + (idx === 0 ? " primary" : ""), String(p.name || "打开"));
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        platforms.appendChild(a);
      });
      if (platforms.children.length) card.appendChild(platforms);
    }
    return card;
  }

  function renderList(container, list) {
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildCard(item)));
    setChildren(container, frag);
  }

  /* ---------- 检索状态 ---------- */
  const REQUEST_TIMEOUT = 25000;
  const FRONT_TTL = 5 * 60 * 1000;
  const frontCache = new Map();
  let activeController = null, lastKeyword = "";

  function requestTimeout() { return isCarOn() ? 40000 : REQUEST_TIMEOUT; } // 车载网络更慢
  function makeController() {
    if (typeof AbortController === "function") return new AbortController();
    return { signal: undefined, abort: function () {} }; // 老车机内核兜底
  }

  function activeInput() { return heroSection.hidden ? resultInput : searchInput; }

  function showResultsView() {
    heroSection.hidden = true;
    resultsSection.hidden = false;
  }
  function setQueryParam(kw) {
    try {
      const url = new URL(window.location.href);
      if (kw) url.searchParams.set("q", kw);
      else url.searchParams.delete("q");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (e) { /* 受限环境忽略 */ }
  }

  function showHero() {
    if (activeController) { activeController.abort(); activeController = null; }
    setQueryParam("");
    clearPlayer();
    resultsSection.hidden = true;
    heroSection.hidden = false;
    topNav.hidden = true;
    skeleton.hidden = true;
    errorState.hidden = true;
    setButtonsDisabled(false);
    window.scrollTo(0, 0);
    setTimeout(() => searchInput.focus(), 0);
  }
  function setButtonsDisabled(disabled) {
    searchBtn.disabled = disabled;
    resultSearchBtn.disabled = disabled;
  }
  function setLoading(kw) {
    skeleton.hidden = false;
    errorState.hidden = true;
    resultContent.hidden = true;
    resultsSummary.hidden = true;
    topNav.hidden = true;
    resultTitle.textContent = `“${kw}” 检索中…`;
    skeletonText.textContent = "正在同时检索影视、音乐与 B站视频…";
    setButtonsDisabled(true);
  }
  function showError(msg) {
    skeleton.hidden = true;
    resultContent.hidden = true;
    resultsSummary.hidden = true;
    topNav.hidden = true;
    errorState.hidden = false;
    errorMsg.textContent = msg;
    resultTitle.textContent = "检索没成功";
  }
  function renderSummary(data, fromCache) {
    const chips = [];
    if (data.bilibili && data.bilibili.length) chips.push(`B站 ${data.bilibili.length} 条`);
    if (data.video && data.video.length) chips.push(`影视 ${data.video.length} 部`);
    if (data.music && data.music.length) chips.push(`音乐 ${data.music.length} 首`);
    if (typeof data.elapsed === "number") chips.push(`耗时 ${(data.elapsed / 1000).toFixed(1)}s`);
    if (fromCache) chips.push("缓存命中");
    const frag = document.createDocumentFragment();
    const source = el("span", "summary-source", sourceBadgeText(data.source));
    frag.appendChild(source);
    chips.forEach((t) => frag.appendChild(el("span", "", t)));
    setChildren(resultsSummary, frag);
    resultsSummary.hidden = false;
  }
  function updateNav(bili, video, music) {
    const map = { bili: !!bili.length, video: !!video.length, music: !!music.length };
    Array.prototype.forEach.call(topNav.querySelectorAll("a"), (a) => {
      a.hidden = !map[a.dataset.nav];
    });
    topNav.hidden = !(map.bili || map.video || map.music);
  }

  function renderResults(data, fromCache) {
    const video = Array.isArray(data.video) ? data.video : [];
    const music = Array.isArray(data.music) ? data.music : [];
    const bilibili = Array.isArray(data.bilibili) ? data.bilibili : [];

    skeleton.hidden = true;
    errorState.hidden = true;
    resultContent.hidden = false;
    resultTitle.textContent = `“${data.query || ""}” 的检索结果`;
    renderSummary(Object.assign({}, data, { video: video, music: music, bilibili: bilibili }), fromCache);

    if (bilibili.length) {
      biliBlock.hidden = false;
      biliPlaylist = bilibili;
      renderBili();
    } else {
      biliBlock.hidden = true;
      biliPlaylist = [];
      biliIndex = -1;
      setChildren(biliList);
      clearPlayer();
    }

    if (video.length) {
      videoBlock.hidden = false;
      videoCount.textContent = `${video.length} 部`;
      renderList(videoList, video);
    } else videoBlock.hidden = true;

    if (music.length) {
      musicBlock.hidden = false;
      musicCount.textContent = `${music.length} 首`;
      renderList(musicList, music);
    } else musicBlock.hidden = true;

    emptyTip.hidden = !!(bilibili.length || video.length || music.length);
    updateNav(bilibili, video, music);
  }

  async function doSearch(rawKeyword) {
    const kw = String(rawKeyword != null ? rawKeyword : activeInput().value).trim();
    if (!kw) { activeInput().focus(); return; }

    lastKeyword = kw;
    searchInput.value = kw;
    resultInput.value = kw;
    syncClearBtns();
    showResultsView();
    window.scrollTo(0, 0);
    pushHistory(kw);
    setQueryParam(kw); // 地址栏带上关键词，可直接复制分享结果页

    // 前端内存缓存：返回刚才看过的词时秒开
    const hit = frontCache.get(kw);
    if (hit && Date.now() - hit.t < FRONT_TTL) {
      setButtonsDisabled(false);
      renderResults(hit.data, true);
      return;
    }

    setLoading(kw);
    if (activeController) activeController.abort();
    const controller = makeController();
    activeController = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (activeController !== controller) return;
      timedOut = true;
      controller.abort();
      // 老内核没有 AbortController 时 abort() 是空操作，主动收尾避免卡在骨架屏
      if (typeof AbortController !== "function") {
        activeController = null;
        setButtonsDisabled(false);
        showError("请求超时了，可能是服务正在唤醒。点「重新检索」再试一次。");
      }
    }, requestTimeout());

    try {
      const resp = await fetch(`${SEARCH_API()}?q=${encodeURIComponent(kw)}`, { signal: controller.signal });
      if (!resp.ok) throw new Error(`服务返回 ${resp.status}`);
      const data = await resp.json();
      if (activeController !== controller || timedOut) return; // 已被更新的搜索取代 / 已超时
      frontCache.set(kw, { t: Date.now(), data });
      renderResults(data, data.cached === true);
    } catch (err) {
      if (activeController !== controller) return;
      const isAbort = err && err.name === "AbortError";
      showError(isAbort && timedOut
        ? "请求超时了，可能是服务正在唤醒。点「重新检索」再试一次。"
        : `检索失败：${(err && err.message) || "网络异常，请稍后重试"}`);
    } finally {
      clearTimeout(timer);
      if (activeController === controller) {
        activeController = null;
        setButtonsDisabled(false);
      }
    }
  }

  /* ---------- 交互绑定 ---------- */
  function syncClearBtns() {
    clearBtn.hidden = !searchInput.value;
    resultClearBtn.hidden = !resultInput.value;
  }
  searchInput.addEventListener("input", syncClearBtns);
  resultInput.addEventListener("input", syncClearBtns);
  function clearInput(input) { input.value = ""; syncClearBtns(); input.focus(); }
  clearBtn.addEventListener("click", () => clearInput(searchInput));
  resultClearBtn.addEventListener("click", () => clearInput(resultInput));

  searchBtn.addEventListener("click", () => doSearch());
  resultSearchBtn.addEventListener("click", () => doSearch());
  [searchInput, resultInput].forEach((input) => {
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(); });
  });

  document.querySelectorAll(".hot-tag").forEach((tag) => {
    tag.addEventListener("click", () => doSearch(tag.dataset.kw));
  });
  backBtn.addEventListener("click", showHero);
  brandLink.addEventListener("click", (e) => { e.preventDefault(); showHero(); });
  retryBtn.addEventListener("click", () => doSearch(lastKeyword));

  document.addEventListener("keydown", (e) => {
    const tag = (e.target && e.target.tagName) || "";
    const typing = /INPUT|TEXTAREA/.test(tag) || (e.target && e.target.isContentEditable);
    if (e.key === "/" && !typing) {
      e.preventDefault();
      (heroSection.hidden ? resultInput : searchInput).focus();
    } else if (e.key === "Escape" && heroSection.hidden) {
      showHero(); // 结果页按 Esc 返回首页
    }
  });

  syncClearBtns();

  // 支持 ?q=关键词 直接打开检索结果（可分享的搜索链接）
  try {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q && q.trim()) doSearch(q.trim());
  } catch (e) {}
})();
