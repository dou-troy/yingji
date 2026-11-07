/**
 * 视频数据源适配器 —— 哔哩哔哩公开搜索接口（国内直连，无需 key）
 *
 * 数据来源：B站官网搜索接口
 *   GET https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword={kw}&page=1
 * 返回视频元数据：标题、作者、BV号、封面、时长、播放量。
 *
 * 播放器嵌入：B站官方 iframe 播放器
 *   https://player.bilibili.com/player.html?bvid={bvid}&autoplay=0
 *
 * 说明：仅获取 B站公开搜索的视频元数据 + 官方内嵌播放器，
 * 不涉及任何破解、VIP 解锁或盗版。封面 pic 字段可能以 // 开头，需补 https:。
 */
const config = require("../config");

class BilibiliAdapter {
  constructor(cfg) {
    this.cfg = cfg || {};
  }

  get enabled() {
    return this.cfg.enabled !== false;
  }

  _cleanTitle(title) {
    return (title || "").replace(/<em class="keyword">/g, "").replace(/<\/em>/g, "");
  }

  _cover(pic) {
    if (!pic) return null;
    return pic.startsWith("//") ? `https:${pic}` : pic;
  }

  _map(v) {
    return {
      id: `bili-${v.bvid}`,
      bvid: v.bvid,
      name: this._cleanTitle(v.title),
      type: "B站视频",
      author: v.author || "",
      poster: this._cover(v.pic),
      duration: v.duration || "",
      play: v.play || 0,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      embed: `https://player.bilibili.com/player.html?bvid=${v.bvid}&autoplay=0&high_quality=1`,
    };
  }

  /**
   * 搜索 B站视频，返回统一结构数组。
   */
  async search(keyword, limit = 3) {
    const url = `${this.cfg.baseUrl}?search_type=video&keyword=${encodeURIComponent(keyword)}&page=1`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://www.bilibili.com/",
        Accept: "application/json",
        // B站风控要求携带匿名设备标识 buvid3（通用访客指纹，非账号信息）
        Cookie: "buvid3=8B4F6A1C-2D3E-4F5A-9B8C-1D2E3F4A5B6C12345infoc; b_nut=1700000000",
      },
    });

    if (!resp.ok) {
      throw new Error(`Bilibili ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`Bilibili 接口错误：${data.message || data.code}`);
    }

    const list = (data.data && data.data.result) || [];
    return list.slice(0, limit).map((v) => this._map(v));
  }

  /**
   * 解析可播放的视频流地址（供小程序 <video> 组件使用）
   * 链路：bvid → view 接口拿 cid → playurl 接口拿 dash/durl 流地址。
   * 仅解析 B站官方公开视频流，不涉及 VIP/付费/版权外内容。
   */
  async play(bvid) {
    const headers = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://www.bilibili.com/",
      Accept: "application/json",
      Cookie: "buvid3=8B4F6A1C-2D3E-4F5A-9B8C-1D2E3F4A5B6C12345infoc; b_nut=1700000000",
    };

    // 1. 拿 cid
    const viewUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const viewResp = await fetch(viewUrl, { headers });
    if (!viewResp.ok) throw new Error(`Bilibili view ${viewResp.status}`);
    const viewData = await viewResp.json();
    if (viewData.code !== 0) throw new Error(`获取视频信息失败：${viewData.message || viewData.code}`);
    const cid = viewData.data && viewData.data.cid;
    if (!cid) throw new Error("未获取到视频 cid");

    // 2. 拿播放流地址（fnval=1 返回 durl mp4 流，音画合一，小程序 <video> 可直接播放）
    const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=64&fnval=1`;
    const playResp = await fetch(playUrl, { headers });
    if (!playResp.ok) throw new Error(`Bilibili playurl ${playResp.status}`);
    const playData = await playResp.json();
    if (playData.code !== 0) throw new Error(`获取播放地址失败：${playData.message || playData.code}`);

    const d = playData.data || {};
    // durl 流（mp4 分片，含音轨），优先取
    if (d.durl && d.durl.length) {
      return {
        url: d.durl[0].url,
        title: viewData.data.title || "",
        quality: d.quality || 0,
        poster: this._cover(viewData.data.pic),
      };
    }
    // 兜底：dash 流（音画分离，兼容性差，仅作最后手段）
    if (d.dash && Array.isArray(d.dash.video) && d.dash.video.length) {
      const video = d.dash.video[d.dash.video.length - 1];
      return {
        url: video.baseUrl || video.base_url,
        title: viewData.data.title || "",
        quality: video.id || 0,
        poster: this._cover(viewData.data.pic),
      };
    }
    throw new Error("未获取到可播放的视频流");
  }

  /**
   * 热门视频流（B站全站排行榜，默认播放内容）
   */
  async hot(limit = 20) {
    const url = "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all";
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://www.bilibili.com/",
        Accept: "application/json",
        Cookie: "buvid3=8B4F6A1C-2D3E-4F5A-9B8C-1D2E3F4A5B6C12345infoc; b_nut=1700000000",
      },
    });

    if (!resp.ok) {
      throw new Error(`Bilibili hot ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new Error(`Bilibili 接口错误：${data.message || data.code}`);
    }

    const list = (data.data && data.data.list) || [];
    return list.slice(0, limit).map((v) => ({
      id: `bili-${v.bvid}`,
      bvid: v.bvid,
      name: v.title || "",
      type: "B站视频",
      author: (v.owner && v.owner.name) || "",
      poster: this._cover(v.pic),
      duration: v.duration ? this._formatDuration(v.duration) : "",
      play: (v.stat && v.stat.view) || 0,
      url: `https://www.bilibili.com/video/${v.bvid}`,
      embed: `https://player.bilibili.com/player.html?bvid=${v.bvid}&autoplay=1&high_quality=1`,
    }));
  }

  _formatDuration(sec) {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }
}

module.exports = BilibiliAdapter;
