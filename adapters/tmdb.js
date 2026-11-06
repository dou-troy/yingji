/**
 * 视频数据源适配器 —— TMDB
 * 负责把 TMDB 的原始响应转换为前端统一的数据结构。
 */
const config = require("../config");

// 统一结果结构：
// { id, name, type: '电影'|'电视剧', year, poster, rating, overview,
//   platforms: [{ name, url }] }
class TMDBAdapter {
  constructor(cfg) {
    this.cfg = cfg;
  }

  get enabled() {
    return this.cfg.enabled && !!this.cfg.apiKey;
  }

  async _get(path, params = {}) {
    const url = new URL(this.cfg.baseUrl + path);
    url.searchParams.set("api_key", this.cfg.apiKey);
    url.searchParams.set("language", this.cfg.language);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      throw new Error(`TMDB ${resp.status}: ${resp.statusText}`);
    }
    return resp.json();
  }

  _poster(path) {
    if (!path) return null;
    return `${this.cfg.imageBaseUrl}/w300${path}`;
  }

  _type(mediaType) {
    return mediaType === "movie" ? "电影" : "电视剧";
  }

  _map(item, mediaType) {
    return {
      id: `${mediaType}-${item.id}`,
      name: item.title || item.name || "",
      type: this._type(mediaType),
      year: (item.release_date || item.first_air_date || "").slice(0, 4),
      poster: this._poster(item.poster_path),
      rating: item.vote_average ? item.vote_average.toFixed(1) : null,
      overview: item.overview || "",
    };
  }

  /**
   * 搜索电影/剧集，返回统一结构数组。
   */
  async search(keyword) {
    // 同时搜电影和剧集，合并结果
    const [movies, tvs] = await Promise.all([
      this._get("/search/movie", { query: keyword, include_adult: "false" }),
      this._get("/search/tv", { query: keyword, include_adult: "false" }),
    ]);

    const results = [
      ...movies.results.slice(0, 8).map((m) => this._map(m, "movie")),
      ...tvs.results.slice(0, 8).map((t) => this._map(t, "tv")),
    ];

    return results;
  }

  /**
   * 生成「去哪看」的平台直达链接（视频类平台）。
   */
  buildPlatformLinks(keyword) {
    return config.platforms.video.map((p) => ({
      name: p.name,
      url: p.searchUrl.replace("{kw}", encodeURIComponent(keyword)),
    }));
  }
}

module.exports = TMDBAdapter;
