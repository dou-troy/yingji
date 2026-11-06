/**
 * 音乐数据源适配器 —— QQ音乐公开搜索接口（国内直连，无需 key）
 *
 * 数据来源：QQ音乐官网搜索接口
 *   GET https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={kw}&format=json&n=10
 * 返回歌曲元数据：歌名、歌手、专辑、时长、songmid。
 *
 * 封面：用 albummid 构造
 *   https://y.gtimg.cn/music/photo_new/T002R300x300M000{albummid}.jpg
 *
 * 说明：QQ音乐官网自带的搜索接口，仅获取歌曲元数据（信息检索用途），
 * 不涉及任何破解、VIP 解锁或盗版音源。试听通过 buildPlatformLinks
 * 生成各音乐平台官方搜索页直达链接。
 */
const config = require("../config");

class QQMusicAdapter {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get enabled() {
    return !!this.cfg && this.cfg.enabled !== false;
  }

  _cover(albummid) {
    if (!albummid) return null;
    return `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albummid}.jpg`;
  }

  _artists(singer) {
    return (singer || []).map((s) => s.name).filter(Boolean).join(" / ");
  }

  _duration(sec) {
    if (!sec) return "";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  _year(pubtime) {
    // pubtime 为 Unix 秒级时间戳
    if (!pubtime) return "";
    return String(new Date(pubtime * 1000).getFullYear());
  }

  _map(song) {
    return {
      id: `qq-${song.songmid || song.songid}`,
      name: song.songname || "",
      type: "音乐",
      artist: this._artists(song.singer),
      year: this._year(song.pubtime),
      poster: this._cover(song.albummid),
      overview: song.albumname ? `专辑：${song.albumname}` : "",
      url: `https://y.qq.com/n/ryqq/songDetail/${song.songmid}`,
    };
  }

  /**
   * 搜索歌曲，返回统一结构数组。
   */
  async search(keyword) {
    const url = `${this.cfg.baseUrl}?w=${encodeURIComponent(keyword)}&format=json&p=1&n=10&cr=1`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://y.qq.com/",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`QQMusic ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    const list = data && data.data && data.data.song && data.data.song.list;
    if (!Array.isArray(list)) {
      throw new Error("QQ音乐返回格式异常");
    }

    return list.slice(0, 10).map((s) => this._map(s));
  }

  /**
   * 生成「去哪听」的平台直达链接（音乐类平台）。
   */
  buildPlatformLinks(keyword) {
    return config.platforms.music.map((p) => ({
      name: p.name,
      url: p.searchUrl.replace("{kw}", encodeURIComponent(keyword)),
    }));
  }
}

module.exports = QQMusicAdapter;
