/**
 * 音乐数据源适配器 —— 网易云音乐公开接口（国内直连，无需 key）
 *
 * 数据来源：
 *  1. 搜索：https://music.163.com/api/search/get/web?s={kw}&type=1&limit=10
 *     返回歌曲元数据（歌名/歌手/专辑/时长/封面 picId）。
 *  2. 封面：https://music.163.com/api/song/detail/?ids=[...]
 *     批量取真实专辑封面（album.picUrl），一次请求补齐全部封面。
 *
 * 说明：这是网易云官网自带接口，仅获取歌曲元数据（信息检索用途），
 * 不涉及任何破解、VIP 解锁或盗版音源。播放/试听通过 buildPlatformLinks
 * 生成各音乐平台官方搜索页直达链接。
 */
const config = require("../config");

class MusicAdapter {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get enabled() {
    return !!this.cfg && this.cfg.enabled !== false;
  }

  _artists(artists) {
    return (artists || []).map((a) => a.name).filter(Boolean).join(" / ");
  }

  _duration(ms) {
    if (!ms) return "";
    const sec = Math.round(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  _map(song, coverMap) {
    const artist = this._artists(song.artists);
    const album = song.album || {};
    return {
      id: `netease-${song.id}`,
      name: song.name || "",
      type: "音乐",
      artist,
      year: album.publishTime ? String(new Date(album.publishTime).getFullYear()) : "",
      poster: (coverMap && coverMap[song.id]) || null,
      overview: album.name ? `专辑：${album.name}` : "",
      url: `https://music.163.com/#/song?id=${song.id}`,
    };
  }

  /**
   * 批量获取真实专辑封面。一次请求补齐所有歌的封面。
   */
  async _fetchCovers(songIds) {
    if (!songIds.length) return {};
    try {
      const ids = JSON.stringify(songIds);
      const url = `https://music.163.com/api/song/detail/?id=${songIds[0]}&ids=${encodeURIComponent(ids)}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
          Referer: "https://music.163.com/",
          Accept: "application/json",
        },
      });
      if (!resp.ok) return {};
      const data = await resp.json();
      const map = {};
      (data.songs || []).forEach((s) => {
        if (s.album && s.album.picUrl) map[s.id] = s.album.picUrl;
      });
      return map;
    } catch (err) {
      return {};
    }
  }

  /**
   * 搜索歌曲，返回统一结构数组。
   */
  async search(keyword) {
    const url = `${this.cfg.baseUrl}?csrf_token=&s=${encodeURIComponent(keyword)}&type=1&offset=0&total=true&limit=10`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://music.163.com/",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      throw new Error(`Netease ${resp.status}: ${resp.statusText}`);
    }

    const data = await resp.json();
    const songs = data && data.result && data.result.songs;
    if (!Array.isArray(songs)) {
      throw new Error("网易云返回格式异常");
    }

    const top = songs.slice(0, 10);
    const coverMap = await this._fetchCovers(top.map((s) => s.id));
    return top.map((s) => this._map(s, coverMap));
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

  /**
   * 获取网易云热歌榜（playlist id=3778678）。
   */
  async ranking(limit = 20) {
    const url = `https://music.163.com/api/playlist/detail?id=3778678`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://music.163.com/",
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      throw new Error(`Netease ranking ${resp.status}`);
    }
    const data = await resp.json();
    const tracks = (data && data.result && data.result.tracks) || [];
    return tracks.slice(0, limit).map((t) => {
      const album = t.album || {};
      return {
        id: `netease-${t.id}`,
        name: t.name || "",
        type: "音乐",
        artist: this._artists(t.artists),
        year: album.publishTime ? String(new Date(album.publishTime).getFullYear()) : "",
        poster: album.picUrl || (t.artists && t.artists[0] && t.artists[0].img1v1Url) || null,
        overview: album.name ? `专辑：${album.name}` : "",
        url: `https://music.163.com/#/song?id=${t.id}`,
      };
    });
  }
}

module.exports = MusicAdapter;
