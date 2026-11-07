/* ============================================================
   映集车机版 · 交互逻辑
   - 数据契约沿用原后端 /api/search：{ video, music, bilibili }
   - 三类结果平级，不做任何「优先」排序或特殊规则
   - 严格 ES5 + XHR，兼容车机老 WebView 内核
   - 不在 Android 里打开时（浏览器预览）自动降级
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
  function safeUrl(u) {
    if (typeof u !== "string") return "";
    var s = trim(u);
    return /^https?:\/\//i.test(s) ? s : "";
  }
  function isArray(a) { return Object.prototype.toString.call(a) === "[object Array]"; }
  function nativeReady() {
    return !!(window.YingjiCar && typeof window.YingjiCar.open === "function");
  }
  function catName(c) { return c === "video" ? "影视" : c === "music" ? "音乐" : "B站视频"; }
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

  var toastTimer = null;
  function toast(msg) {
    if (nativeReady() && window.YingjiCar.toast) {
      window.YingjiCar.toast(msg);
      return;
    }
    var t = $("toast");
    t.textContent = msg;
    t.className = "toast is-on";
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
    } catch (e) {
      toast("复制失败：" + s);
    }
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
  var current = "video";
  var lastQuery = "";
  var hasResult = false;
  var loading = false;
  var req = null;

  function setNet(state, text) {
    var n = $("netState");
    n.className = "net-state" + (state === true ? " is-on" : state === false ? " is-off" : "");
    var span = n.getElementsByTagName("span")[0];
    if (span) span.textContent = text;
  }
  function setTop(title, meta) {
    $("pageTitle").textContent = title;
    $("pageMeta").textContent = meta;
  }
  function setState(s) {
    $("welcome").hidden = s !== "welcome";
    $("loading").hidden = s !== "loading";
    $("errorBox").hidden = s !== "error";
    $("emptyBox").hidden = s !== "empty";
    $("grid").hidden = s !== "grid";
  }

  /* ---------- 快捷搜索（最近记录优先，热词兜底） ---------- */
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
    for (i = 0; i < old.length; i++) if (old[i] !== kw && list.length < 8) list.push(old[i]);
    try { localStorage.setItem(HIS_KEY, JSON.stringify(list)); } catch (e) {}
    renderQuick();
  }
  function renderQuick() {
    var box = $("quick"), frag = document.createDocumentFragment();
    var seen = {}, all = [], i;
    function add(w) { if (w && !seen[w]) { seen[w] = 1; all.push(w); } }
    var his = getHistory(), hot = cfg.hotWords || [];
    for (i = 0; i < his.length; i++) add(his[i]);
    for (i = 0; i < hot.length; i++) add(hot[i]);
    for (i = 0; i < all.length && i < 8; i++) {
      (function (w) {
        var b = el("button", "quick", w);
        b.type = "button";
        b.onclick = function () { doSearch(w); };
        frag.appendChild(b);
      })(all[i]);
    }
    clear(box);
    box.appendChild(frag);
  }

  /* ---------- 结果渲染 ---------- */
  function subText(item, cat) {
    if (cat === "music") {
      return (item.artist || "") + (item.year ? " · " + item.year : "") +
        (item.overview ? " · " + item.overview : "");
    }
    if (cat === "bilibili") {
      return (item.author || "") + (item.duration ? " · " + item.duration : "") +
        (item.play ? " · " + fmtNum(item.play) + "播放" : "");
    }
    return (item.year ? item.year : "") +
      (item.rating ? " · 豆瓣 " + item.rating : "") +
      (item.overview ? " · " + item.overview : "");
  }
  function fillPoster(box, item) {
    clear(box);
    box.appendChild(document.createTextNode((item.name || "?").slice(0, 1)));
    var u = safeUrl(item.poster);
    if (!u) return;
    var img = document.createElement("img");
    img.alt = "";
    img.onerror = function () { img.className = "is-broken"; };
    img.src = u;
    box.appendChild(img);
  }
  function renderCounts() {
    $("cntVideo").textContent = hasResult ? String(store.video.length) : "—";
    $("cntMusic").textContent = hasResult ? String(store.music.length) : "—";
    $("cntBili").textContent = hasResult ? String(store.bilibili.length) : "—";
  }
  function setTab(cat) {
    current = cat;
    var tabs = $("tabs").getElementsByTagName("button"), i;
    for (i = 0; i < tabs.length; i++) {
      tabs[i].className = tabs[i].getAttribute("data-cat") === cat ? "tab is-active" : "tab";
    }
    renderGrid();
  }
  function renderGrid() {
    var list = store[current] || [];
    var cat = current;
    var grid = $("grid"), frag = document.createDocumentFragment(), i;
    if (!list.length) {
      $("emptyMsg").textContent = "「" + lastQuery + "」在" + catName(cat) + "里暂无结果，点左侧切换其他分类";
      setState("empty");
      return;
    }
    for (i = 0; i < list.length; i++) {
      (function (item) {
        var card = el("div", "card");
        var inner = el("div", "card-inner");
        var p = el("div", "poster");
        fillPoster(p, item);
        inner.appendChild(p);
        var body = el("div", "card-body");
        body.appendChild(el("div", "card-title", item.name || "未命名"));
        body.appendChild(el("div", "card-sub", subText(item, cat) || "—"));
        body.appendChild(el("div", "card-tag", sourceName(cat === "bilibili" ? "bilibili" : item.source)));
        inner.appendChild(body);
        card.appendChild(inner);
        card.onclick = function () { openSheet(item, cat); };
        frag.appendChild(card);
      })(list[i]);
    }
    clear(grid);
    grid.appendChild(frag);
    setState("grid");
    $("content").scrollTop = 0;
  }

  /* ---------- 检索 ---------- */
  function startLoad() {
    loading = true;
    setState("loading");
    setTop("正在检索「" + lastQuery + "」…", "影视 / 音乐 / B站 三路并发，请稍等");
    setNet(null, "正在请求数据…");
  }
  function fail(msg) {
    $("errorMsg").textContent = msg;
    setNet(false, "服务未连接（点服务设置检查）");
    setState("error");
    setTop("检索没成功", "可点「重试」，或检查左下角服务状态与地址");
  }
  function doSearch(kw) {
    var q = trim(kw);
    if (!q) { toast("请输入关键词"); return; }
    if (loading) return;
    lastQuery = q;
    $("q").value = q;
    pushHistory(q);
    startLoad();

    var x = new XMLHttpRequest();
    req = x;
    x.open("GET", getApi() + "/api/search?q=" + encodeURIComponent(q), true);
    x.timeout = TIMEOUT;
    x.onload = function () {
      loading = false;
      if (x.status < 200 || x.status >= 300) {
        fail("服务返回 " + x.status + "，请稍后重试");
        return;
      }
      var res;
      try { res = JSON.parse(x.responseText); }
      catch (e) { fail("数据解析失败，请检查服务地址"); return; }
      store.video = isArray(res.video) ? res.video : [];
      store.music = isArray(res.music) ? res.music : [];
      store.bilibili = isArray(res.bilibili) ? res.bilibili : [];
      hasResult = true;
      renderCounts();
      setTop("「" + q + "」的检索结果",
        "影视 " + store.video.length + " · 音乐 " + store.music.length +
        " · B站 " + store.bilibili.length + " · " +
        (res.cached ? "缓存命中" : "耗时 " + (res.elapsed || 0) + "ms"));
      setNet(true, "服务在线");
      setTab(current);
    };
    x.onerror = function () { loading = false; fail("网络连接失败，请检查车机网络或服务地址"); };
    x.ontimeout = function () { loading = false; fail("请求超时，车机网络可能较慢，点重试再试一次"); };
    x.onabort = function () { loading = false; };
    x.send();
  }
  function goHome() {
    if (req) { try { req.abort(); } catch (e) {} }
    if (!$("playerLayer").hidden || isFull) closePlayer(); // 停掉后台播放，避免继续出声
    loading = false;
    hasResult = false;
    store = { video: [], music: [], bilibili: [] };
    $("q").value = "";
    renderCounts();
    renderQuick();
    setState("welcome");
    setTop("找点想看的、想听的", "输入关键词，或点左侧快捷搜索");
  }
  function checkStatus() {
    setNet(null, "正在连接服务…");
    var x = new XMLHttpRequest();
    x.open("GET", getApi() + "/api/status", true);
    x.timeout = 12000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) setNet(true, "服务在线");
      else setNet(false, "服务异常 " + x.status);
    };
    x.onerror = function () { setNet(false, "服务未连接（点服务设置检查）"); };
    x.ontimeout = function () { setNet(false, "服务响应慢 / 超时"); };
    x.send();
  }

  /* ---------- B站内嵌播放器 ----------
     与网页版一致：使用 B站官方 player.bilibili.com iframe，不改后端数据契约。
     全屏采用「CSS 铺满 + 原生 requestFullscreen 双保险」，
     老车机内核不支持 Fullscreen API 时，CSS 全屏依然可用。 */
  var playerItem = null, playerIframe = null, isFull = false, loadTimer = null;

  function playerBvid(item) {
    var s = String((item && item.url) || "") + " " + String((item && item.embed) || "");
    var m = /BV[0-9A-Za-z]{10,12}/.exec(s);
    return m ? m[0] : "";
  }
  function playerEmbed(item) {
    var raw = safeUrl(item && item.embed);
    // 只信任 B站官方播放器地址，其余一律自己按 bvid 构造，避免外部字段注入
    if (raw && /^https:\/\/player\.bilibili\.com\/player\.html\?/i.test(raw)) {
      return raw.replace(/([?&])autoplay=1/, "$1autoplay=0");
    }
    var id = playerBvid(item);
    return id ? "https://player.bilibili.com/player.html?bvid=" + id + "&autoplay=0&high_quality=1" : "";
  }
  function dropIframe() {
    clearTimeout(loadTimer);
    if (playerIframe && playerIframe.parentNode) playerIframe.parentNode.removeChild(playerIframe);
    playerIframe = null;
  }
  function openPlayer(item) {
    var src = playerEmbed(item);
    if (!src) { toast("这条视频没有可用的内嵌播放地址"); return false; }
    closeSheet();
    dropIframe();
    playerItem = item;
    $("playerTitle").textContent = item.name || "B站视频";
    $("playerMeta").textContent = subText(item, "bilibili") || "";
    $("playerHint").textContent = "播放器加载中…";
    $("playerHint").hidden = false;

    var f = document.createElement("iframe");
    f.title = (item.name || "B站视频") + " · 哔哩哔哩播放器";
    f.setAttribute("allowfullscreen", "true");
    f.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
    f.setAttribute("scrolling", "no");
    f.onload = function () { if (playerIframe === f) $("playerHint").hidden = true; };
    f.src = src;
    $("playerBox").appendChild(f);
    playerIframe = f;
    $("playerLayer").hidden = false;
    loadTimer = setTimeout(function () {
      if (playerIframe === f && !$("playerHint").hidden) {
        $("playerHint").textContent = "播放器加载较慢，可点「在 B站打开」，或检查车机网络";
      }
    }, 10000);
    return true;
  }
  function enterFull() {
    isFull = true;
    $("playerLayer").className = "player-layer is-full";
    $("fullBtn").textContent = "⛶ 退出全屏";
    try {
      var n = $("playerLayer");
      if (n.requestFullscreen) n.requestFullscreen();
      else if (n.webkitRequestFullscreen) n.webkitRequestFullscreen();
      else if (n.webkitRequestFullScreen) n.webkitRequestFullScreen();
    } catch (e) {}
    if (nativeReady() && window.YingjiCar.fullscreen) window.YingjiCar.fullscreen(true);
  }
  function exitFull() {
    isFull = false;
    $("playerLayer").className = "player-layer";
    $("fullBtn").textContent = "⛶ 全屏播放";
    try {
      if (document.exitFullscreen) document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      else if (document.webkitCancelFullScreen) document.webkitCancelFullScreen();
    } catch (e) {}
    if (nativeReady() && window.YingjiCar.fullscreen) window.YingjiCar.fullscreen(false);
  }
  function toggleFull() { if (isFull) exitFull(); else enterFull(); }
  function closePlayer() {
    if (isFull) exitFull();
    dropIframe();
    $("playerLayer").hidden = true;
    playerItem = null;
  }

  /* ---------- 大按钮操作面板 ---------- */
  function addAct(box, label, url, main, kind, payload) {
    if (!safeUrl(url)) return;
    var b = el("button", "sheet-act" + (main ? " is-main" : ""), label);
    b.type = "button";
    b.onclick = function () {
      if (kind === "copy") copyUrl(url);
      else if (kind === "play" || kind === "playfull") {
        if (openPlayer(payload) && kind === "playfull") enterFull();
      } else openUrl(url);
      closeSheet();
    };
    box.appendChild(b);
  }
  function openSheet(item, cat) {
    fillPoster($("sheetPoster"), item);
    $("sheetTitle").textContent = item.name || "未命名";
    $("sheetMeta").textContent = subText(item, cat) || "";
    $("sheetNote").textContent = cat === "bilibili"
      ? "沿用网页版的 B站内嵌播放器，点「内嵌播放」即可在 App 内观看，可一键全屏；视频请驻车后观看。"
      : cat === "music"
        ? "歌曲将在 QQ音乐 / 网易云或浏览器中打开。"
        : "可打开豆瓣词条，或直接去各视频平台搜索观看。";

    var box = $("sheetActions");
    clear(box);
    var mainUrl = safeUrl(item.url);
    if (cat === "bilibili") {
      var playUrl = playerEmbed(item) || mainUrl;
      addAct(box, "▶ 内嵌播放", playUrl, true, "play", item);
      addAct(box, "⛶ 全屏播放", playUrl, false, "playfull", item);
      addAct(box, "在 B站打开", mainUrl, false, "open");
      addAct(box, "复制链接", mainUrl, false, "copy");
    } else {
      addAct(box, cat === "music" ? "打开歌曲页" : "打开豆瓣词条", mainUrl, true, "open");
      var ps = isArray(item.platforms) ? item.platforms : [];
      var used = {}, i;
      used[mainUrl] = 1;
      for (i = 0; i < ps.length; i++) {
        var pu = safeUrl(ps[i] && ps[i].url);
        if (!pu || used[pu]) continue;
        used[pu] = 1;
        addAct(box, "去" + (ps[i].name || "平台"), pu, false, "open");
      }
      addAct(box, "复制链接", mainUrl, false, "copy");
    }
    $("sheet").hidden = false;
  }
  function closeSheet() { $("sheet").hidden = true; }

  function openSetting() {
    $("apiNow").textContent = getApi();
    $("apiInput").value = getApi();
    $("settingSheet").hidden = false;
  }
  function closeSetting() { $("settingSheet").hidden = true; }

  /* ---------- 返回键（由原生 onBackPressed 调用） ---------- */
  window.__yjBack = function () {
    if (!$("playerLayer").hidden) {
      if (isFull) exitFull();      // 全屏 → 先退回窗口
      else closePlayer();          // 窗口 → 关闭播放器
      return;
    }
    if (!$("sheet").hidden) { closeSheet(); return; }
    if (!$("settingSheet").hidden) { closeSetting(); return; }
    if (hasResult) { goHome(); return; }
    if (nativeReady() && window.YingjiCar.finish) window.YingjiCar.finish();
    else toast("已在首页");
  };

  /* ---------- 事件绑定 ---------- */
  $("goBtn").onclick = function () { doSearch($("q").value); };
  $("q").onkeydown = function (e) {
    if ((e.keyCode || e.which) === 13) doSearch($("q").value);
  };
  $("retryBtn").onclick = function () { doSearch(lastQuery || $("q").value); };
  $("homeBtn").onclick = goHome;
  $("settingBtn").onclick = openSetting;
  $("sheetClose").onclick = closeSheet;
  $("fullBtn").onclick = toggleFull;
  $("playerCloseBtn").onclick = closePlayer;
  $("playerOpenBtn").onclick = function () { if (playerItem) openUrl(playerItem.url); };
  $("playerCopyBtn").onclick = function () { if (playerItem) copyUrl(playerItem.url); };
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
  $("sheet").onclick = function (e) { if (e.target === $("sheet")) closeSheet(); };
  $("settingSheet").onclick = function (e) { if (e.target === $("settingSheet")) closeSetting(); };

  (function bindTabs() {
    var tabs = $("tabs").getElementsByTagName("button"), i;
    for (i = 0; i < tabs.length; i++) {
      (function (b) {
        b.onclick = function () {
          if (!hasResult) { toast("先搜索一个关键词"); return; }
          setTab(b.getAttribute("data-cat"));
        };
      })(tabs[i]);
    }
  })();

  /* ---------- 初始化 ---------- */
  renderQuick();
  renderCounts();
  setState("welcome");
  checkStatus();
})();
