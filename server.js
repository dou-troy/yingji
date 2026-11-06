/**
 * 映集 - 后端代理服务
 * 职责：
 *  1. 代理第三方数据源请求，规避前端跨域
 *  2. 编排视频/音乐适配器，统一返回结构
 *  3. 真实接口失败时降级到模拟数据
 *  4. 托管前端静态文件（可选，便于本地一键预览）
 */
const express = require("express");
const path = require("path");
const config = require("./config");
const DoubanAdapter = require("./adapters/douban");
const TMDBAdapter = require("./adapters/tmdb");
const MusicAdapter = require("./adapters/music");
const QQMusicAdapter = require("./adapters/qqmusic");
const BilibiliAdapter = require("./adapters/bilibili");
const mock = require("./mock");

const app = express();
app.use(express.json());

// CORS：允许跨域访问 API（预览面板可能通过非 localhost:3000 的地址打开）
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

// 静态托管前端
app.use(express.static(__dirname));

/**
 * 统一检索接口
 * GET /api/search?q=流浪地球
 * 返回：{ query, source, video: [], music: [] }
 */
app.get("/api/search", async (req, res) => {
  const query = (req.query.q || "").trim();
  if (!query) {
    return res.status(400).json({ code: 400, message: "缺少检索关键词 q" });
  }

  const result = { query, source: "mock", video: [], music: [], bilibili: [] };

  // 1. 视频检索：优先豆瓣（国内直连），失败降级 TMDB，再降级模拟
  try {
    if (douban.enabled) {
      const video = await douban.search(query);
      const links = douban.buildPlatformLinks(query);
      result.video = video.map((v) => ({ ...v, platforms: links, source: "douban" }));
      result.source = "douban";
    }
  } catch (err) {
    console.warn("[video] 豆瓣请求失败，尝试 TMDB：", err.message);
    try {
      if (tmdb.enabled) {
        const video = await tmdb.search(query);
        const links = tmdb.buildPlatformLinks(query);
        result.video = video.map((v) => ({ ...v, platforms: links, source: "tmdb" }));
        result.source = "tmdb";
      }
    } catch (err2) {
      console.warn("[video] TMDB 请求失败，降级到模拟数据：", err2.message);
    }
  }

  // 2. 音乐检索：QQ音乐优先，网易云补充，失败降级
  try {
    const neteaseLinks = music.buildPlatformLinks(query);
    const merged = [];

    // QQ音乐（默认优先）：平台链接直接用歌曲详情页（songDetail 可靠可用）
    if (qqmusic.enabled) {
      try {
        const songs = await qqmusic.search(query);
        merged.push(
          ...songs.map((s) => ({
            ...s,
            platforms: [
              { name: "QQ音乐", url: s.url }, // 歌曲详情页直达，稳定可用
              ...neteaseLinks.filter((p) => p.name !== "QQ音乐"),
            ],
            source: "qq",
          }))
        );
      } catch (err) {
        console.warn("[music] QQ音乐请求失败：", err.message);
      }
    }

    // 网易云（补充）
    if (music.enabled) {
      try {
        const songs = await music.search(query);
        merged.push(...songs.map((s) => ({ ...s, platforms: neteaseLinks, source: "netease" })));
      } catch (err) {
        console.warn("[music] 网易云请求失败：", err.message);
      }
    }

    if (merged.length) {
      result.music = merged;
      result.source = result.source === "mock" ? "music" : "mixed";
    }
  } catch (err) {
    console.warn("[music] 音乐接口请求失败，降级到模拟数据：", err.message);
  }

  // 3. B站视频（搜索结果，放开条数限制，取满 20 条）
  try {
    if (bilibili.enabled) {
      result.bilibili = await bilibili.search(query, 20);
    }
  } catch (err) {
    console.warn("[bilibili] B站搜索失败：", err.message);
  }

  // 4. 模拟数据兜底
  const mockResults = mock.search(query);
  const mockVideo = mockResults.filter((r) => r.type !== "音乐");
  const mockMusic = mockResults.filter((r) => r.type === "音乐");
  if (result.video.length === 0) result.video = mockVideo;
  if (result.music.length === 0) result.music = mockMusic;

  // 若真实接口有结果但为空，也保留模拟兜底
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
    const links = douban.buildPlatformLinks(detail.name);
    detail.platforms = links;
    res.json({ ok: true, data: detail });
  } catch (err) {
    console.warn("[detail] 详情获取失败：", err.message);
    res.status(502).json({ code: 502, message: "详情获取失败" });
  }
});

/**
 * B站热门视频流
 * GET /api/hot
 */
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
 * 榜单
 * GET /api/ranking?type=movie|music
 */
app.get("/api/ranking", async (req, res) => {
  const type = (req.query.type || "movie").trim();
  try {
    if (type === "music") {
      const list = await music.ranking(20);
      return res.json({ ok: true, type, data: list });
    }
    // 默认电影 TOP250
    const list = await douban.ranking(11, 20);
    res.json({ ok: true, type, data: list });
  } catch (err) {
    console.warn("[ranking] 榜单获取失败：", err.message);
    res.status(502).json({ code: 502, message: "榜单获取失败" });
  }
});

/**
 * 健康检查 + 数据源状态
 * GET /api/status
 */
app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    sources: {
      video: { enabled: douban.enabled, provider: "douban" },
      music: {
        enabled: music.enabled || qqmusic.enabled,
        provider: [music.enabled ? "netease" : null, qqmusic.enabled ? "qq" : null].filter(Boolean).join("+") || "none",
      },
    },
    platforms: {
      video: config.platforms.video.map((p) => p.name),
      music: config.platforms.music.map((p) => p.name),
    },
  });
});

// 根路径健康检查：部署平台与前端探测用
app.get("/", (req, res) => {
  res.json({ ok: true, name: "映集后端服务", message: "映集 · 影音聚合检索后端运行中" });
});

const port = config.server.port;
app.listen(port, "0.0.0.0", () => {
  console.log(`映集后端服务已启动：http://localhost:${port}`);
  console.log(`视频数据源 豆瓣：${douban.enabled ? "已启用（国内直连）" : "未配置（使用模拟数据）"}`);
  console.log(`音乐数据源 网易云：${music.enabled ? "已启用" : "未配置"}，QQ音乐：${qqmusic.enabled ? "已启用" : "未配置"}`);
});
