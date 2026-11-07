/**
 * 映集 - 后端代理服务
 * 职责：
 *  1. 代理第三方数据源请求，规避前端跨域
 *  2. 并发编排影视 / 音乐 / B站适配器，统一返回结构
 *  3. 真实接口失败时降级到模拟数据
 *  4. 托管前端静态文件
 */
const express = require("express");
const config = require("./config");
const DoubanAdapter = require("./adapters/douban");
const TMDBAdapter = require("./adapters/tmdb");
const MusicAdapter = require("./adapters/music");
const QQMusicAdapter = require("./adapters/qqmusic");
const BilibiliAdapter = require("./adapters/bilibili");
const mock = require("./mock");

const app = express();
app.use(express.json());

// CORS：允许跨域访问 API（预览面板可能通过非同源地址打开）
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const douban = new DoubanAdapter(config.douban);
const tmdb = new TMDBAdapter(config.tmdb);
const music = new MusicAdapter(config.music);
const qqmusic = new QQMusicAdapter(config.qqmusic);
const bilibili = new BilibiliAdapter(config.bilibili);

/* ============================================================
 * 检索缓存：同一关键词 5 分钟内复用
 * 作用：① 二次搜索秒开 ② 减少第三方请求，降低风控概率
 * ========================================================== */
const CACHE_TTL = 5 * 60 * 1000;
const CACHE_MAX = 120;
const searchCache = new Map();
let cacheHits = 0;

function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  if (searchCache.size >= CACHE_MAX) {
    const drop = Math.max(1, Math.floor(CACHE_MAX / 4));
    let n = 0;
    for (const k of searchCache.keys()) {
      searchCache.delete(k);
      if (++n >= drop) break;
    }
  }
  searchCache.set(key, { time: Date.now(), data });
}

/* ============================================================
 * 各数据源独立抓取：彼此不阻塞，任何一路失败都返回空片段
 * ========================================================== */

/** 影视：豆瓣优先，失败降级 TMDB */
async function fetchVideo(query) {
  if (douban.enabled) {
    try {
      const list = await douban.search(query);
      const links = douban.buildPlatformLinks(query);
      return {
        video: list.map((v) => ({ ...v, platforms: links, source: "douban" })),
        provider: "douban",
      };
    } catch (err) {
      console.warn("[video] 豆瓣请求失败，尝试 TMDB：", err.message);
    }
  }
  if (tmdb.enabled) {
    try {
      const list = await tmdb.search(query);
      const links = tmdb.buildPlatformLinks(query);
      return {
        video: list.map((v) => ({ ...v, platforms: links, source: "tmdb" })),
        provider: "tmdb",
      };
    } catch (err) {
      console.warn("[video] TMDB 请求失败：", err.message);
    }
  }
  return { video: [], provider: "" };
}

/** 音乐：QQ音乐（优先）+ 网易云（补充），两者并发 */
async function fetchMusic(query) {
  const neteaseLinks = music.buildPlatformLinks(query);
  const jobs = [];

  if (qqmusic.enabled) {
    jobs.push(
      qqmusic
        .search(query)
        .then((songs) =>
          songs.map((s) => ({
            ...s,
            platforms: [
              { name: "QQ音乐", url: s.url }, // 歌曲详情页直达，稳定可用
              ...neteaseLinks.filter((p) => p.name !== "QQ音乐"),
            ],
            source: "qq",
          }))
        )
        .catch((err) => {
          console.warn("[music] QQ音乐请求失败：", err.message);
          return [];
        })
    );
  }

  if (music.enabled) {
    jobs.push(
      music
        .search(query)
        .then((songs) => songs.map((s) => ({ ...s, platforms: neteaseLinks, source: "netease" })))
        .catch((err) => {
          console.warn("[music] 网易云请求失败：", err.message);
          return [];
        })
    );
  }

  if (!jobs.length) return { music: [], provider: "" };
  const groups = await Promise.all(jobs); // 内部已 catch，不会 reject
  // QQ音乐结果排在前（保持"默认优先"的产品约定）
  return { music: groups.flat(), provider: groups.some((g) => g.length) ? "music" : "" };
}

/** B站视频搜索（20 条） */
async function fetchBilibili(query) {
  if (!bilibili.enabled) return { bilibili: [] };
  try {
    return { bilibili: await bilibili.search(query, 20) };
  } catch (err) {
    console.warn("[bilibili] B站搜索失败：", err.message);
    return { bilibili: [] };
  }
}

/**
 * 统一检索接口
 * GET /api/search?q=流浪地球
 * 返回：{ query, source, video: [], music: [], bilibili: [], cached }
 */
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ code: 400, message: "缺少检索关键词 q" });
  }

  // 缓存命中直接返回
  const cached = cacheGet(query);
  if (cached) {
    cacheHits += 1;
    res.setHeader("X-Yingji-Cache", "HIT");
    return res.json({ ...cached, cached: true });
  }

  const startedAt = Date.now();

  // 三路并发：总耗时 ≈ 最慢的一路，而非各路之和
  const [vRes, mRes, bRes] = await Promise.allSettled([
    fetchVideo(query),
    fetchMusic(query),
    fetchBilibili(query),
  ]);

  const v = vRes.status === "fulfilled" ? vRes.value : { video: [], provider: "" };
  const m = mRes.status === "fulfilled" ? mRes.value : { music: [], provider: "" };
  const b = bRes.status === "fulfilled" ? bRes.value : { bilibili: [] };
  if (vRes.status === "rejected") console.warn("[video] 未捕获异常：", vRes.reason?.message);
  if (mRes.status === "rejected") console.warn("[music] 未捕获异常：", mRes.reason?.message);
  if (bRes.status === "rejected") console.warn("[bilibili] 未捕获异常：", bRes.reason?.message);

  const hasVideo = !!v.provider;
  const hasMusic = m.music.length > 0;
  const source = hasVideo && hasMusic
    ? "mixed"
    : hasVideo
      ? v.provider
      : hasMusic
        ? "music"
        : "mock";

  const result = {
    query,
    source,
    video: v.video,
    music: m.music,
    bilibili: b.bilibili,
    elapsed: Date.now() - startedAt,
  };

  // 真实接口无结果时用模拟数据兜底，保证页面不空
  const mockResults = mock.search(query);
  if (!result.video.length) result.video = mockResults.filter((r) => r.type !== "音乐");
  if (!result.music.length) result.music = mockResults.filter((r) => r.type === "音乐");

  cacheSet(query, result);
  res.setHeader("X-Yingji-Cache", "MISS");
  console.log(`[search] "${query}" 影视${result.video.length}/音乐${result.music.length}/B站${result.bilibili.length} · ${result.elapsed}ms`);
  res.json(result);
});

/**
 * 影视详情
 * GET /api/detail?id=douban-26266893 （或纯数字 id 26266893）
 */
app.get("/api/detail", async (req, res) => {
  const rawId = (req.query.id || "").trim().replace("douban-", "");
  if (!rawId) {
    return res.status(400).json({ code: 400, message: "缺少影视 id" });
  }
  try {
    const detail = await douban.detail(rawId);
    detail.platforms = douban.buildPlatformLinks(detail.name);
    res.json({ ok: true, data: detail });
  } catch (err) {
    console.warn("[detail] 详情获取失败：", err.message);
    res.status(502).json({ code: 502, message: "详情获取失败" });
  }
});

/** B站热门视频流 GET /api/hot */
app.get("/api/hot", async (req, res) => {
  try {
    const list = await bilibili.hot(20);
    res.json({ ok: true, data: list });
  } catch (err) {
    console.warn("[hot] 热门视频获取失败：", err.message);
    res.status(502).json({ code: 502, message: "热门视频获取失败" });
  }
});

/**
 * B站视频流解析（小程序内嵌播放曾用，网页版走官方 iframe，保留备用）
 * GET /api/bilibili/play?bvid=BV1xx411c7mD
 */
app.get("/api/bilibili/play", async (req, res) => {
  const bvid = (req.query.bvid || "").trim();
  if (!bvid) return res.status(400).json({ code: 400, message: "缺少 bvid 参数" });
  try {
    const data = await bilibili.play(bvid);
    res.json({ ok: true, data });
  } catch (err) {
    console.warn("[bilibili/play] 视频流解析失败：", err.message);
    res.status(502).json({ code: 502, message: err.message || "视频流解析失败" });
  }
});

/** 榜单 GET /api/ranking?type=movie|music */
app.get("/api/ranking", async (req, res) => {
  const type = (req.query.type || "movie").trim();
  try {
    if (type === "music") {
      const list = await music.ranking(20);
      return res.json({ ok: true, type, data: list });
    }
    const list = await douban.ranking(11, 20);
    res.json({ ok: true, type, data: list });
  } catch (err) {
    console.warn("[ranking] 榜单获取失败：", err.message);
    res.status(502).json({ code: 502, message: "榜单获取失败" });
  }
});

/** 健康检查 + 数据源状态 GET /api/status */
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    sources: {
      video: { enabled: douban.enabled, provider: "douban" },
      music: {
        enabled: music.enabled || qqmusic.enabled,
        provider: [music.enabled ? "netease" : null, qqmusic.enabled ? "qq" : null]
          .filter(Boolean)
          .join("+") || "none",
      },
      bilibili: { enabled: bilibili.enabled, provider: "bilibili" },
    },
    platforms: {
      video: config.platforms.video.map((p) => p.name),
      music: config.platforms.music.map((p) => p.name),
    },
    cache: { entries: searchCache.size, hits: cacheHits, ttlMs: CACHE_TTL },
  });
});

// 静态托管前端（放在 API 路由之后，保证 /api/* 不被静态中间件吞掉）
// HTML 不缓存，资源短缓存 5 分钟 —— 避免发版后用户拿到旧的 app.js
app.use(express.static(__dirname, {
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache");
    } else {
      res.setHeader("Cache-Control", "public, max-age=300");
    }
  },
}));

// 根路径健康检查：部署平台探测用（静态中间件会先命中 index.html）
app.get("/", (req, res) => {
  res.json({ ok: true, name: "映集后端服务", message: "映集 · 影音聚合检索后端运行中" });
});

const port = config.server.port;
app.listen(port, "0.0.0.0", () => {
  console.log(`映集后端服务已启动：http://localhost:${port}`);
  console.log(`影视 豆瓣:${douban.enabled ? "启用" : "未配置"} / TMDB:${tmdb.enabled ? "启用" : "未配置"}`);
  console.log(`音乐 QQ音乐:${qqmusic.enabled ? "启用" : "未配置"} / 网易云:${music.enabled ? "启用" : "未配置"}`);
  console.log(`视频 B站:${bilibili.enabled ? "启用" : "未配置"} · 三路并发 + 5min 缓存`);
});
