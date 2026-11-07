/* ============================================================
   映集 · 车机版交互
   - 布局与网页版同构：首页 hero → 结果页分区（B站 / 影视 / 音乐）
   - 数据契约沿用后端 /api/search：{ video, music, bilibili }
   - B站沿用官方 player.bilibili.com 内嵌播放，另加全屏按键
   - 三类结果平级，不做音乐优先
   - 严格 ES5 + XHR，兼容车机老 WebView 内核
   ========================================================== */
(function () {
  "use strict";

  var cfg = window.YINGJI_CONFIG || {};
  var API_KEY = "yj_car_api";
  var HIS_KEY = "yj_car_history";
  var DEFAULT_API = cfg.apiBase || "https://web-production-43cac.up.railway.app";
  var TIMEOUT = cfg.requestTimeout || 40000;

  /* ---------- 基础工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function trim(s) { return String(s == null ? "" : s).replace(/^\s+|\s+$/g, ""); }
  function isArray(a) { return Object.prototype.toString.call(a) === "[object Array]"; }
  function safeUrl(u) {
    if (typeof u !== "string") return "";
    var s = trim(u);
    return /^https?:\/\//i.test(s) ? s : "";
  }
  function nativeReady() {
    return !!(window.YingjiCar && typeof window.YingjiCar.open === "function");
  }
  function fmtNum(n) {
    if (!n) return "";
    if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
    if (n >= 10000) return (n / 10000).toFixed(1) + "万";
    return String(n);
  }
  function sourceName(s) {
    var m = { douban: "豆瓣", qq: "QQ音乐", netease: "网易云", tmdb: "TMDB", mock: "演示", bilibili: "B站" };
    return m[s] || "检索";
  }
  function sourceBadgeText(s) {
    var m = { douban: "数据来自豆瓣", qq: "数据来自 QQ音乐", netease: "数据来自网易云", mock: "演示数据", mixed: "多源聚合" };
    return m[s] || "多源聚合";
  }

  var toastTimer = null;
  function toast(msg) {
    if (nativeReady() && window.YingjiCar.toast) { window.YingjiCar.toast(msg); return; }
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast is-visible";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast"; }, 2200);
  }

  function openUrl(u) {
    var s = safeUrl(u);
    if (!s) { toast("链接不可用"); return; }
    if (nativeReady()) window.YingjiCar.open(s);
    else window.open(s, "_blank");
  }
  function copyUrl(u) {
    var s = safeUrl(u);
    if (!s) { toast("链接不可用"); return; }
    if (nativeReady() && window.YingjiCar.copy) {
      window.YingjiCar.copy(s);
      toast("链接已复制");
      return;
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = s;
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast("链接已复制");
    } catch (e) { toast("复制失败：" + s); }
  }

  /* ---------- 服务地址 ---------- */
  function getApi() {
    try {
      var v = localStorage.getItem(API_KEY);
      if (v && /^https?:\/\//i.test(v)) return v.replace(/\/+$/, "");
    } catch (e) {}
    return DEFAULT_API.replace(/\/+$/, "");
  }
  function setApi(v) {
    try {
      if (v) localStorage.setItem(API_KEY, v);
      else localStorage.removeItem(API_KEY);
    } catch (e) {}
  }

  /* ---------- 状态 ---------- */
  var store = { video: [], music: [], bilibili: [] };
  var biliPlaylist = [], biliIndex = -1, isFull = false, loadTimer = null;
  var hasResult = false, loading = false, req = null, lastQuery = "";

  function setNet(state, text) {
    var n = $("netState");
    if (!n) return;
    n.className = "net-state" + (state === true ? " is-on" : state === false ? " is-off" : "");
    var t = $("netText");
    if (t) t.textContent = text;
  }
  function setButtonsDisabled(d) {
    $("goBtn").disabled = d;
    $("resultSearchBtn").disabled = d;
  }
  function showHero() {
    $("heroSection").hidden = false;
    $("resultsSection").hidden = true;
    $("topNav").hidden = true;
    window.scrollTo(0, 0);
  }
  function showResults() {
    $("heroSection").hidden = true;
    $("resultsSection").hidden = false;
    window.scrollTo(0, 0);
  }

  /* ---------- 快捷搜索（最近记录 + 热词） ---------- */
  function getHistory() {
    try {
      var v = JSON.parse(localStorage.getItem(HIS_KEY));
      if (isArray(v)) {
        var out = [], i;
        for (i = 0; i < v.length; i++) if (typeof v[i] === "string") out.push(v[i]);
        return out;
      }
    } catch (e) {}
    return [];
  }
  function pushHistory(kw) {
    var list = [kw], old = getHistory(), i;
    for (i = 0; i < old.length; i++) {
      if (old[i] !== kw && list.length < 8) list.push(old[i]);
    }
    try { localStorage.setItem(HIS_KEY, JSON.stringify(list)); } catch (e) {}
    renderQuick();
  }
  function renderQuick() {
    var box = $("quick");
    if (!box) return;
    clear(box);
    var seen = {}, all = [], i;
    function add(w) { if (w && !seen[w]) { seen[w] = 1; all.push(w); } }
    var his = getHistory(), hot = cfg.hotWords || [];
    for (i = 0; i < his.length; i++) add(his[i]);
    for (i = 0; i < hot.length; i++) add(hot[i]);
    for (i = 0; i < all.length && i < 8; i++) {
      (function (w) {
        var b = el("button", "hot-tag", w);
        b.type = "button";
        b.onclick = function () { doSearch(w); };
        box.appendChild(b);
      })(all[i]);
    }
  }

  /* ---------- 通用渲染 ---------- */
  function makePoster(item, cls) {
    var box = el("div", cls);
    box.appendChild(document.createTextNode(String(item.name || "?").slice(0, 1)));
    var u = safeUrl(item.poster);
    if (!u) { box.className = cls + " is-fallback"; return box; }
    var img = document.createElement("img");
    img.alt = "";
    img.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;";
    img.onerror = function () { img.className = "is-broken"; box.className = cls + " is-fallback"; };
    img.src = u;
    box.appendChild(img);
    return box;
  }

  function addPlatform(box, name, url, primary) {
    var u = safeUrl(url);
    if (!u) return;
    var b = el("button", "platform-link" + (primary ? " primary" : ""), name);
    b.type = "button";
    b.onclick = function () { openUrl(u); };
    box.appendChild(b);
  }

  function buildCard(item) {
    var card = el("div", "result-card");
    card.appendChild(makePoster(item, "result-poster"));

    var info = el("div", "result-info");
    info.appendChild(el("div", "result-name", item.name || "未命名"));

    var meta = el("div", "result-meta");
    if (item.type) meta.appendChild(el("span", "", String(item.type)));
    if (item.year) meta.appendChild(el("span", "", String(item.year)));
    if (item.artist) meta.appendChild(el("span", "", String(item.artist)));
    if (item.rating) meta.appendChild(el("span", "result-rating", "豆瓣 " + item.rating));
    if (item.overview) meta.appendChild(el("span", "", String(item.overview)));
    if (item.source) meta.appendChild(el("span", "result-source-tag", sourceName(item.source)));
    info.appendChild(meta);
    card.appendChild(info);

    var ps = isArray(item.platforms) ? item.platforms : [];
    var mainUrl = safeUrl(item.url);
    var wrap = el("div", "result-platforms");
    var used = {}, i;
    if (mainUrl) {
      used[mainUrl] = 1;
      addPlatform(wrap, /music|y\.qq/i.test(mainUrl) ? "试听 ›" : "查看详情 ›", mainUrl, true);
    }
    for (i = 0; i < ps.length && i < 6; i++) {
      var pu = safeUrl(ps[i] && ps[i].url);
      if (!pu || used[pu]) continue;
      used[pu] = 1;
      addPlatform(wrap, String((ps[i] && ps[i].name) || "打开"), pu, false);
    }
    if (wrap.children.length) card.appendChild(wrap);
    return card;
  }

  function renderList(container, list) {
    clear(container);
    var frag = document.createDocumentFragment(), i;
    for (i = 0; i < list.length; i++) frag.appendChild(buildCard(list[i]));
    container.appendChild(frag);
  }

  function renderSummary(data, fromCache) {
    var box = $("resultsSummary");
    clear(box);
    box.appendChild(el("span", "summary-source", sourceBadgeText(data.source)));
    if (store.bilibili.length) box.appendChild(el("span", "", "B站 " + store.bilibili.length + " 条"));
    if (store.video.length) box.appendChild(el("span", "", "影视 " + store.video.length + " 部"));
    if (store.music.length) box.appendChild(el("span", "", "音乐 " + store.music.length + " 首"));
    if (typeof data.elapsed === "number") {
      box.appendChild(el("span", "", "耗时 " + (data.elapsed / 1000).toFixed(1) + "s"));
    }
    if (fromCache) box.appendChild(el("span", "", "缓存命中"));
    box.hidden = false;
  }

  function updateNav() {
    var map = { bili: !!store.bilibili.length, video: !!store.video.length, music: !!store.music.length };
    var links = $("topNav").getElementsByTagName("a"), i;
    for (i = 0; i < links.length; i++) {
      links[i].hidden = !map[links[i].getAttribute("data-nav")];
    }
    $("topNav").hidden = !(map.bili || map.video || map.music);
  }

  /* ---------- B站内嵌播放器（与网页版一致 + 全屏键） ---------- */
  function playerBvid(item) {
    var s = String((item && item.url) || "") + " " + String((item && item.embed) || "");
    var m = /BV[0-9A-Za-z]{10,12}/.exec(s);
    return m ? m[0] : "";
  }
  function playerEmbed(item) {
    var raw = safeUrl(item && item.embed);
    if (raw && /^https:\/\/player\.bilibili\.com\/player\.html\?/i.test(raw)) {
      return raw.replace(/([?&])autoplay=1/, "$1autoplay=0");
    }
    var id = playerBvid(item);
    return id ? "https://player.bilibili.com/player.html?bvid=" + id + "&autoplay=0&high_quality=1" : "";
  }
  function dropIframe() {
    clearTimeout(loadTimer);
    var wrap = $("videoWrap");
    var old = wrap.getElementsByTagName("iframe");
    while (old.length) wrap.removeChild(old[0]);
  }
  function clearPlayer() {
    if (isFull) exitFull();
    dropIframe();
    $("videoPlaceholder").hidden = false;
    $("biliTitle").textContent = "—";
    $("biliMeta").textContent = "从右侧列表挑一条开始看";
    $("biliOpenBtn").hidden = true;
    biliIndex = -1;
  }
  function selectBili(index) {
    var v = biliPlaylist[index];
    if (!v) return;
    biliIndex = index;
    dropIframe();
    $("videoPlaceholder").hidden = false;
    $("biliTitle").textContent = v.name || "—";

    var parts = [];
    if (v.author) parts.push("UP主：" + v.author);
    if (v.duration) parts.push(v.duration);
    if (v.play) parts.push(fmtNum(v.play) + " 播放");
    $("biliMeta").textContent = parts.join(" · ") || "—";

    var openUrlStr = safeUrl(v.url);
    $("biliOpenBtn").hidden = !openUrlStr;
    if (openUrlStr) $("biliOpenBtn").onclick = function () { openUrl(openUrlStr); };

    var items = $("biliList").children, i;
    for (i = 0; i < items.length; i++) {
      items[i].className = "bili-item" + (i === index ? " is-active" : "");
    }
  }
  function playBili(index) {
    var v = biliPlaylist[index];
    if (!v) return;
    var src = playerEmbed(v);
    if (!src) { toast("这条视频没有可用的内嵌播放地址"); return; }
    selectBili(index);

    var wrap = $("videoWrap");
    var f = document.createElement("iframe");
    f.title = (v.name || "B站视频") + " · 哔哩哔哩播放器";
    f.setAttribute("allowfullscreen", "true");
    f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    f.setAttribute("scrolling", "no");
    f.onload = function () { $("videoPlaceholder").hidden = true; };
    f.src = src;
    wrap.appendChild(f);
    $("videoPlaceholder").hidden = false;
    var p = $("videoPlaceholder").getElementsByTagName("p")[0];
    // 浏览器预览里没有原生外壳，B站播放器常因第三方 Cookie 被拦而加载不出来
    if (p) p.textContent = nativeReady() ? "播放器加载中…" : "浏览器预览通常无法内嵌播放，可点「在 B站打开」";

    loadTimer = setTimeout(function () {
      if (!$("videoPlaceholder").hidden) {
        if (p) p.textContent = nativeReady()
          ? "加载较慢，可点「在 B站打开」，或检查车机网络"
          : "预览环境加载不出播放器，请点「在 B站打开」或安装车机版 App";
      }
    }, 12000);
  }

  function enterFull() {
    if (!$("videoWrap").getElementsByTagName("iframe").length) { toast("先点右侧一条视频，再全屏"); return; }
    isFull = true;
    $("biliPlayer").className = "bili-player is-fullscreen";
    $("fullBtn").textContent = "⛶ 退出全屏";
    try {
      var n = $("biliPlayer");
      if (n.requestFullscreen) n.requestFullscreen();
      else if (n.webkitRequestFullscreen) n.webkitRequestFullscreen();
      else if (n.webkitRequestFullScreen) n.webkitRequestFullScreen();
    } catch (e) {}
    if (nativeReady() && window.YingjiCar.fullscreen) window.YingjiCar.fullscreen(true);
  }
  function exitFull() {
    isFull = false;
    $("biliPlayer").className = "bili-player";
    $("fullBtn").textContent = "⛶ 全屏播放";
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.webkitCancelFullScreen) document.webkitCancelFullScreen();
    } catch (e) {}
    if (nativeReady() && window.YingjiCar.fullscreen) window.YingjiCar.fullscreen(false);
  }
  function toggleFull() { if (isFull) exitFull(); else enterFull(); }

  function renderBili() {
    var list = $("biliList");
    clear(list);
    biliPlaylist = store.bilibili;
    $("biliCount").textContent = store.bilibili.length ? "共 " + store.bilibili.length + " 条 · 点击右侧列表播放" : "";
    if (!store.bilibili.length) { clearPlayer(); return; }

    var frag = document.createDocumentFragment(), i;
    for (i = 0; i < store.bilibili.length; i++) {
      (function (v, idx) {
        var item = el("div", "bili-item");
        item.setAttribute("role", "option");
        item.appendChild(makePoster(v, "bili-item-thumb"));
        var info = el("div", "bili-item-info");
        info.appendChild(el("div", "bili-item-title", v.name || "未命名视频"));
        var meta = el("div", "bili-item-meta");
        if (v.author) meta.appendChild(el("span", "", v.author));
        if (v.duration) meta.appendChild(el("span", "", v.duration));
        if (v.play) meta.appendChild(el("span", "", fmtNum(v.play) + " 播放"));
        info.appendChild(meta);
        item.appendChild(info);
        item.onclick = function () { playBili(idx); };
        frag.appendChild(item);
      })(store.bilibili[i], i);
    }
    list.appendChild(frag);

    // 驻车场景：默认只选中第一条，不自动加载视频流，点列表才播放
    selectBili(0);
  }

  /* ---------- 检索 ---------- */
  function setLoading(kw) {
    $("skeleton").hidden = false;
    $("errorBox").hidden = true;
    $("resultContent").hidden = true;
    $("resultsSummary").hidden = true;
    $("topNav").hidden = true;
    $("resultTitle").textContent = "「" + kw + "」检索中…";
    $("skeletonText").textContent = "正在同时检索影视、音乐与 B站视频…";
    setButtonsDisabled(true);
  }
  function fail(msg) {
    $("skeleton").hidden = true;
    $("resultContent").hidden = true;
    $("resultsSummary").hidden = true;
    $("topNav").hidden = true;
    $("errorBox").hidden = false;
    $("errorMsg").textContent = msg;
    $("resultTitle").textContent = "检索没成功";
    setButtonsDisabled(false);
    setNet(false, "服务未连接");
  }

  function renderAll(data, fromCache) {
    $("skeleton").hidden = true;
    $("errorBox").hidden = true;
    $("resultContent").hidden = false;
    setButtonsDisabled(false);

    $("videoCount").textContent = store.video.length ? "共 " + store.video.length + " 部" : "";
    $("musicCount").textContent = store.music.length ? "共 " + store.music.length + " 首" : "";
    $("biliBlock").hidden = !store.bilibili.length;
    $("videoBlock").hidden = !store.video.length;
    $("musicBlock").hidden = !store.music.length;
    $("emptyTip").hidden = !!(store.bilibili.length || store.video.length || store.music.length);

    renderBili();
    renderList($("videoList"), store.video);
    renderList($("musicList"), store.music);
    renderSummary(data, fromCache);
    updateNav();
  }

  function doSearch(kw) {
    var q = trim(kw);
    if (!q) { toast("请输入关键词"); return; }
    if (loading) return;
    lastQuery = q;
    $("q").value = q;
    $("resultInput").value = q;
    pushHistory(q);
    showResults();
    setLoading(q);
    loading = true;
    setNet(null, "正在请求数据…");

    var x = new XMLHttpRequest();
    req = x;
    x.open("GET", getApi() + "/api/search?q=" + encodeURIComponent(q), true);
    x.timeout = TIMEOUT;
    x.onload = function () {
      loading = false;
      if (x.status < 200 || x.status >= 300) { fail("服务返回 " + x.status + "，请稍后重试"); return; }
      var res;
      try { res = JSON.parse(x.responseText); }
      catch (e) { fail("数据解析失败，请检查服务地址"); return; }

      store.video = isArray(res.video) ? res.video : [];
      store.music = isArray(res.music) ? res.music : [];
      store.bilibili = isArray(res.bilibili) ? res.bilibili : [];
      hasResult = true;
      setNet(true, "服务在线");
      $("resultTitle").textContent = "「" + q + "」的检索结果";
      renderAll(res, !!res.cached);
    };
    x.onerror = function () { loading = false; fail("网络连接失败，请检查车机网络或服务地址"); };
    x.ontimeout = function () { loading = false; fail("请求超时，车机网络可能较慢，点「重新检索」再试一次"); };
    x.onabort = function () { loading = false; };
    x.send();
  }

  function goHome() {
    if (req) { try { req.abort(); } catch (e) {} }
    loading = false;
    hasResult = false;
    store = { video: [], music: [], bilibili: [] };
    biliPlaylist = [];
    clearPlayer();
    setButtonsDisabled(false);
    $("q").value = "";
    $("resultInput").value = "";
    showHero();
  }

  function checkStatus() {
    setNet(null, "连接中…");
    var x = new XMLHttpRequest();
    x.open("GET", getApi() + "/api/status", true);
    x.timeout = 12000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) setNet(true, "服务在线");
      else setNet(false, "服务异常 " + x.status);
    };
    x.onerror = function () { setNet(false, "服务未连接"); };
    x.ontimeout = function () { setNet(false, "服务响应慢"); };
    x.send();
  }

  /* ---------- 服务设置 ---------- */
  function openSetting() {
    $("apiNow").textContent = getApi();
    $("apiInput").value = getApi();
    $("settingSheet").hidden = false;
  }
  function closeSetting() { $("settingSheet").hidden = true; }

  /* ---------- 返回键（原生 onBackPressed 调用） ---------- */
  window.__yjBack = function () {
    if (isFull) { exitFull(); return; }
    var sheet = $("settingSheet");
    if (sheet && !sheet.hidden) { closeSetting(); return; }
    if (!$("resultsSection").hidden) { goHome(); return; }
    if (nativeReady() && window.YingjiCar.finish) window.YingjiCar.finish();
    else toast("已在首页");
  };

  /* ---------- 事件 ---------- */
  $("goBtn").onclick = function () { doSearch($("q").value); };
  $("q").onkeydown = function (e) {
    if ((e.keyCode || e.which) === 13) doSearch($("q").value);
  };
  $("resultSearchBtn").onclick = function () { doSearch($("resultInput").value); };
  $("resultInput").onkeydown = function (e) {
    if ((e.keyCode || e.which) === 13) doSearch($("resultInput").value);
  };
  $("retryBtn").onclick = function () { doSearch(lastQuery || $("q").value); };
  $("backBtn").onclick = goHome;
  $("brandLink").onclick = function (e) { if (e && e.preventDefault) e.preventDefault(); goHome(); };
  $("settingBtn").onclick = openSetting;
  $("fullBtn").onclick = toggleFull;
  $("apiCancel").onclick = closeSetting;
  $("apiSave").onclick = function () {
    var raw = trim($("apiInput").value);
    if (raw && !/^https?:\/\//i.test(raw)) { toast("地址要以 https:// 开头"); return; }
    setApi(raw);
    closeSetting();
    checkStatus();
    toast(raw ? "服务地址已保存" : "已恢复默认地址");
  };
  $("apiReset").onclick = function () {
    setApi("");
    closeSetting();
    checkStatus();
    toast("已恢复默认服务地址");
  };
  $("settingSheet").onclick = function (e) {
    if (e.target === $("settingSheet")) closeSetting();
  };

  (function bindNav() {
    var links = $("topNav").getElementsByTagName("a"), i;
    for (i = 0; i < links.length; i++) {
      (function (a) {
        a.onclick = function (e) {
          if (e && e.preventDefault) e.preventDefault();
          var id = (a.getAttribute("href") || "").replace("#", "");
          var node = $(id);
          if (!node || node.hidden) return;
          var y = node.getBoundingClientRect().top +
            (window.pageYOffset || document.documentElement.scrollTop || 0) - 190;
          window.scrollTo(0, y < 0 ? 0 : y);
        };
      })(links[i]);
    }
  })();

  /* ---------- 初始化 ---------- */
  renderQuick();
  setNet(null, "连接中…");
  checkStatus();

  (function boot() {
    var m = /[?&]q=([^&]*)/.exec(window.location.search || "");
    if (m && m[1]) {
      try { doSearch(decodeURIComponent(m[1].replace(/\+/g, " "))); return; } catch (e) {}
    }
    $("heroSection").hidden = false;
    $("resultsSection").hidden = true;
  })();
})();
