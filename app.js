// 映集 · 影音聚合检索
// 首页搜索框 → 搜索后结果区展示：B站视频播放 + 影视 + 音乐

// ===== 后端 API 地址解析（三层回退，解决"其他设备打不开"）=====
// 1. 如果当前页面同源就带着后端（同域名部署），直接用同源
// 2. 否则读 localStorage 里手动配置的公网后端地址
// 3. 都没有则回退到 localhost:3000（仅本机开发用）
const REMOTE_API_KEY = "yingji_api_base";

function resolveApiBase() {
  // 同源优先：如果页面本身就由后端托管，/api 直接可用
  const isSameOriginServing = document.location.origin.includes("localhost") ||
    document.location.origin.includes("127.0.0.1");
  if (isSameOriginServing) return document.location.origin;

  // 手动配置的公网后端地址（部署后填写）
  try {
    const saved = localStorage.getItem(REMOTE_API_KEY);
    if (saved && /^https?:\/\//.test(saved)) return saved.replace(/\/+$/, "");
  } catch (e) {
    /* localStorage 不可用时忽略 */
  }

  // 兜底：本机开发
  return "http://localhost:3000";
}

let API_BASE = resolveApiBase();
const SEARCH_API = () => `${API_BASE}/api/search`;

// 暴露一个全局方法，方便部署后把公网地址写进页面/控制台
window.__setYingjiApi = (url) => {
  try {
    localStorage.setItem(REMOTE_API_KEY, url.replace(/\/+$/, ""));
  } catch (e) {}
  API_BASE = url.replace(/\/+$/, "");
  return API_BASE;
};

const heroSection = document.getElementById("heroSection");
const resultsSection = document.getElementById("resultsSection");
const resultTitle = document.getElementById("resultTitle");
const sourceBadge = document.getElementById("sourceBadge");
const backBtn = document.getElementById("backBtn");
const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const hotTags = document.querySelectorAll(".hot-tag");

const biliBlock = document.getElementById("biliBlock");
const videoWrap = document.getElementById("videoWrap");
const videoPlaceholder = document.getElementById("videoPlaceholder");
const videoEmpty = document.getElementById("videoEmpty");
const biliTitle = document.getElementById("biliTitle");
const biliMeta = document.getElementById("biliMeta");
const biliCount = document.getElementById("biliCount");
const biliList = document.getElementById("biliList");

const videoBlock = document.getElementById("videoBlock");
const musicBlock = document.getElementById("musicBlock");
const videoList = document.getElementById("videoList");
const musicList = document.getElementById("musicList");
const emptyTip = document.getElementById("emptyTip");

// ===== B站播放状态 =====
let biliPlaylist = [];
let biliIndex = -1;

function formatCount(n) {
  if (n >= 100000000) return (n / 100000000).toFixed(1) + "亿";
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  return String(n);
}

// ===== B站播放 =====
function renderBiliPlayer() {
  const v = biliPlaylist[biliIndex];
  videoEmpty.hidden = true;
  videoPlaceholder.hidden = false;

  const old = videoWrap.querySelector("iframe");
  if (old) old.remove();

  const iframe = document.createElement("iframe");
  iframe.src = v.embed;
  iframe.setAttribute("allowfullscreen", "true");
  iframe.setAttribute("allow", "autoplay; fullscreen; picture-in-picture");
  iframe.setAttribute("scrolling", "no");
  iframe.addEventListener("load", () => {
    videoPlaceholder.hidden = true;
  });
  videoWrap.appendChild(iframe);

  biliTitle.textContent = v.name;
  const parts = [];
  if (v.author) parts.push(`UP主：${v.author}`);
  if (v.duration) parts.push(v.duration);
  if (v.play) parts.push(`${formatCount(v.play)} 播放`);
  biliMeta.textContent = parts.join(" · ");

  // 列表高亮
  [...biliList.children].forEach((el, i) => {
    el.classList.toggle("active", i === biliIndex);
  });
}

// 渲染右侧列表 + 初始播放第一条
function renderBili() {
  biliList.innerHTML = "";
  biliCount.textContent = `共 ${biliPlaylist.length} 条 · 点击选择播放`;

  if (!biliPlaylist.length) {
    videoWrap.querySelector("iframe")?.remove();
    videoPlaceholder.hidden = true;
    videoEmpty.hidden = false;
    biliTitle.textContent = "—";
    biliMeta.textContent = "";
    return;
  }

  biliPlaylist.forEach((v, i) => {
    const item = document.createElement("div");
    item.className = "bili-item";

    const thumb = document.createElement("div");
    thumb.className = "bili-item-thumb";
    if (v.poster) thumb.style.backgroundImage = `url("${v.poster}")`;
    item.appendChild(thumb);

    const info = document.createElement("div");
    info.className = "bili-item-info";

    const title = document.createElement("div");
    title.className = "bili-item-title";
    title.textContent = v.name;
    info.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "bili-item-meta";
    const parts = [];
    if (v.author) parts.push(`<span>${v.author}</span>`);
    if (v.duration) parts.push(`<span>${v.duration}</span>`);
    if (v.play) parts.push(`<span>${formatCount(v.play)} 播放</span>`);
    meta.innerHTML = parts.join("");
    info.appendChild(meta);

    item.appendChild(info);
    item.addEventListener("click", () => {
      biliIndex = i;
      renderBiliPlayer();
    });
    biliList.appendChild(item);
  });

  // 默认播放第一条
  biliIndex = 0;
  renderBiliPlayer();
}

// ===== 结果卡片渲染 =====
function buildCard(item) {
  const card = document.createElement("div");
  card.className = "result-card";

  // 海报
  const poster = document.createElement("div");
  poster.className = "result-poster";
  if (item.poster && /^https?:/.test(item.poster)) {
    poster.style.backgroundImage = `url("${item.poster}")`;
  } else {
    poster.classList.add("no-img");
    poster.textContent = (item.name || "?").slice(0, 1);
  }
  card.appendChild(poster);

  // 信息
  const info = document.createElement("div");
  info.className = "result-info";

  const name = document.createElement("div");
  name.className = "result-name";
  name.textContent = item.name;
  info.appendChild(name);

  const meta = document.createElement("div");
  meta.className = "result-meta";
  const metaParts = [];
  if (item.type) metaParts.push(`<span>${item.type}</span>`);
  if (item.year) metaParts.push(`<span>${item.year}</span>`);
  if (item.artist) metaParts.push(`<span>${item.artist}</span>`);
  if (item.overview) metaParts.push(`<span>${item.overview}</span>`);
  if (item.rating) metaParts.push(`<span class="result-rating">★ ${item.rating}</span>`);
  if (item.source) metaParts.push(`<span class="result-source-tag">${sourceLabel(item.source)}</span>`);
  meta.innerHTML = metaParts.join("");
  info.appendChild(meta);

  // 详情链接
  if (item.url && /(douban\.com|music\.163\.com|y\.qq\.com|bilibili\.com)/.test(item.url)) {
    const detail = document.createElement("a");
    detail.className = "result-detail";
    detail.textContent = /music/.test(item.url) ? "试听 ›" : "查看详情 ›";
    detail.href = item.url;
    detail.target = "_blank";
    detail.rel = "noopener noreferrer";
    info.appendChild(detail);
  }

  card.appendChild(info);

  // 平台链接
  if (item.platforms && item.platforms.length) {
    const platforms = document.createElement("div");
    platforms.className = "result-platforms";
    item.platforms.slice(0, 6).forEach((p, idx) => {
      const a = document.createElement("a");
      a.className = "platform-link" + (idx === 0 ? " primary" : "");
      a.textContent = p.name;
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      platforms.appendChild(a);
    });
    card.appendChild(platforms);
  }

  return card;
}

function sourceLabel(s) {
  return s === "douban" ? "豆瓣"
    : s === "qq" ? "QQ音乐"
    : s === "netease" ? "网易云"
    : s === "tmdb" ? "TMDB"
    : s === "mock" ? "演示"
    : "真实";
}

// ===== 结果渲染 =====
function renderResults(data) {
  const { query, source, video = [], music = [], bilibili = [] } = data;

  resultTitle.textContent = `“${query}” 的检索结果`;
  sourceBadge.textContent = sourceBadgeText(source);

  // B站视频
  if (bilibili.length) {
    biliBlock.hidden = false;
    biliPlaylist = bilibili;
    renderBili();
  } else {
    biliBlock.hidden = true;
    biliPlaylist = [];
    biliList.innerHTML = "";
  }

  // 影视
  if (video.length) {
    videoBlock.hidden = false;
    videoList.innerHTML = "";
    video.forEach((item) => videoList.appendChild(buildCard(item)));
  } else {
    videoBlock.hidden = true;
  }

  // 音乐
  if (music.length) {
    musicBlock.hidden = false;
    musicList.innerHTML = "";
    music.forEach((item) => musicList.appendChild(buildCard(item)));
  } else {
    musicBlock.hidden = true;
  }

  // 空态
  const hasAny = bilibili.length || video.length || music.length;
  emptyTip.hidden = hasAny;
}

function sourceBadgeText(source) {
  const map = {
    douban: "数据源：豆瓣（真实）",
    mixed: "数据源：豆瓣 + 音乐平台（真实）",
    netease: "数据源：网易云（真实）",
    qq: "数据源：QQ音乐（真实）",
    tmdb: "数据源：TMDB（真实）",
    mock: "数据源：本地演示",
  };
  return map[source] || "数据源：真实 + 演示";
}

// ===== 视图切换 =====
function showHero() {
  resultsSection.hidden = true;
  heroSection.hidden = false;
}

function showResults() {
  heroSection.hidden = true;
  resultsSection.hidden = false;
}

// ===== 搜索 =====
async function doSearch(keyword) {
  const kw = (keyword || searchInput.value).trim();
  if (!kw) return;
  showResults();
  try {
    const resp = await fetch(`${SEARCH_API()}?q=${encodeURIComponent(kw)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderResults(data);
    window.scrollTo({ top: 0 });
  } catch (err) {
    console.warn("搜索失败：", err.message);
    sourceBadge.textContent = "";
    emptyTip.hidden = false;
    emptyTip.textContent = "搜索失败，请检查后端服务后重试";
    biliBlock.hidden = true;
    videoBlock.hidden = true;
    musicBlock.hidden = true;
  }
}

// ===== 事件绑定 =====
searchBtn.addEventListener("click", () => doSearch());
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doSearch();
});
backBtn.addEventListener("click", showHero);

hotTags.forEach((tag) => {
  tag.addEventListener("click", () => {
    searchInput.value = tag.dataset.kw;
    doSearch(tag.dataset.kw);
  });
});
