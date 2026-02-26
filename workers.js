export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const json = (obj, status = 200, extra = {}) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Cache-Control": "no-store",
          ...extra,
        },
      });

    // UA
    const UA =
      request.headers.get("User-Agent") ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36";

    const cfNoCache = { cf: { cacheTtl: 0, cacheEverything: false } };

    // ---------------------
    // helpers
    // ---------------------
    function isYouTube(u) {
      const s = String(u || "");
      return s.includes("youtube.com") || s.includes("youtu.be");
    }
    function isYouTubeRss(u) {
      const s = String(u || "");
      return s.includes("youtube.com/feeds/videos.xml");
    }

    function browserLikeHeadersFor(targetUrl) {
      const t = String(targetUrl || "");
      const headers = {
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9,ru;q=0.8,uk;q=0.7",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
      };

      if (isYouTubeRss(t)) {
        headers["Accept"] =
          "application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.8";
        headers["Referer"] = "https://www.youtube.com/";
        headers["Origin"] = "https://www.youtube.com";
      } else if (isYouTube(t)) {
        headers["Accept"] =
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
        headers["Referer"] = "https://www.youtube.com/";
        headers["Origin"] = "https://www.youtube.com";
      } else {
        headers["Accept"] = "*/*";
      }

      return headers;
    }

    async function fetchBrowserLike(targetUrl, acceptOverride) {
      const headers = browserLikeHeadersFor(targetUrl);
      if (acceptOverride) headers["Accept"] = acceptOverride;

      return fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers,
        ...cfNoCache,
      });
    }

    async function fetchText(targetUrl, acceptOverride) {
      const r = await fetchBrowserLike(targetUrl, acceptOverride);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      const text = await r.text();
      return { r, ct, text };
    }

    // ============================================================
    // PUBLIC: STATUS KICK (NO CACHE + DEBUG)
    // GET /status/kick?u=username[&debug=1]
    // ============================================================
    if (url.pathname === "/status/kick" && request.method === "GET") {
      const u = (url.searchParams.get("u") || "").trim();
      const debug = url.searchParams.get("debug") === "1";
      if (!u) return json({ error: "Missing u" }, 400);

      const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(
        u
      )}?v=${Date.now()}`;

      try {
        const r = await fetchBrowserLike(apiUrl, "application/json");
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        const text = await r.text();

        if (!ct.includes("application/json")) {
          return json(
            {
              online: false,
              blocked: true,
              httpStatus: r.status,
              contentType: ct,
              ...(debug ? { sample: text.slice(0, 250) } : {}),
            },
            200
          );
        }

        const data = JSON.parse(text);
        const hasLivestream = data?.livestream != null;
        const isLiveFlag = data?.livestream?.is_live;
        const online = hasLivestream && (isLiveFlag === true || isLiveFlag == null);

        return json(
          {
            online,
            ...(debug
              ? {
                  httpStatus: r.status,
                  contentType: ct,
                  hasLivestream,
                  isLiveFlag: isLiveFlag ?? null,
                  viewerCount: data?.livestream?.viewer_count ?? null,
                  startedAt: data?.livestream?.start_time ?? null,
                  title: data?.livestream?.session_title ?? null,
                }
              : {}),
          },
          200
        );
      } catch (e) {
        return json(
          {
            online: false,
            error: "kick_fetch_failed",
            ...(debug ? { message: String(e?.message || e) } : {}),
          },
          200
        );
      }
    }

    // ============================================================
    // PUBLIC: STATUS YOUTUBE (Official YouTube Data API v3)
    // GET /status/youtube?u=<youtubeUrl>&debug=1
    //
    // Требует env.YT_API_KEY (secret)
    // ============================================================
    if (url.pathname === "/status/youtube" && request.method === "GET") {
      const inputUrl = (url.searchParams.get("u") || "").trim();
      const debug = url.searchParams.get("debug") === "1";
      if (!inputUrl) return json({ error: "Missing u" }, 400);

      if (!env?.YT_API_KEY) {
        return json(
          { online: false, error: "missing_YT_API_KEY_secret" },
          500
        );
      }

      function extractChannelIdFromUrl(u) {
        const s = String(u || "").trim();
        const m = s.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
        return m ? m[1] : null;
      }

      function extractHandleFromUrl(u) {
        const s = String(u || "").trim();
        // @handle
        let m = s.match(/youtube\.com\/@([^/?#]+)/i);
        if (m) return m[1];
        // youtu.be / watch links are not handles -> return null
        // c/ and user/ behave like names; we can still use them as query
        m = s.match(/youtube\.com\/c\/([^/?#]+)/i);
        if (m) return m[1];
        m = s.match(/youtube\.com\/user\/([^/?#]+)/i);
        if (m) return m[1];
        return null;
      }

      async function ytFetchJson(apiUrl) {
        const r = await fetch(apiUrl, {
          method: "GET",
          headers: {
            "User-Agent": UA,
            Accept: "application/json",
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
          ...cfNoCache,
        });
        const text = await r.text();
        let data = null;
        try {
          data = JSON.parse(text);
        } catch {}
        return { r, text, data };
      }

      let channelId = extractChannelIdFromUrl(inputUrl);
      const resolveInfo = { step: null, urls: [] };

      try {
        // 1) if no direct UC..., resolve by searching channel by handle/name
        if (!channelId) {
          const q = extractHandleFromUrl(inputUrl);
          if (!q) {
            return json(
              { online: false, channelId: null, error: "channel_not_resolved" },
              200
            );
          }

          resolveInfo.step = "search_channel_by_query";
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(
            q
          )}&key=${encodeURIComponent(env.YT_API_KEY)}`;

          resolveInfo.urls.push(searchUrl);

          const { r, data } = await ytFetchJson(searchUrl);

          if (!r.ok) {
            return json(
              {
                online: false,
                channelId: null,
                error: "yt_api_search_failed",
                ...(debug
                  ? { httpStatus: r.status, apiError: data?.error || null }
                  : {}),
              },
              200
            );
          }

          channelId = data?.items?.[0]?.snippet?.channelId || null;

          if (!channelId) {
            return json(
              {
                online: false,
                channelId: null,
                error: "channel_not_found",
                ...(debug ? { resolveInfo, sample: data } : {}),
              },
              200
            );
          }
        }

        // 2) Check live now via search eventType=live
        resolveInfo.step = "search_live_by_channelId";
        const liveUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(
          channelId
        )}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(
          env.YT_API_KEY
        )}`;

        resolveInfo.urls.push(liveUrl);

        const { r: r2, data: d2 } = await ytFetchJson(liveUrl);

        if (!r2.ok) {
          return json(
            {
              online: false,
              channelId,
              error: "yt_api_live_check_failed",
              ...(debug
                ? { httpStatus: r2.status, apiError: d2?.error || null }
                : {}),
            },
            200
          );
        }

        const liveItem = d2?.items?.[0] || null;
        const videoId = liveItem?.id?.videoId || null;
        const online = !!videoId;

        return json(
          {
            online,
            channelId,
            videoUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : null,
            ...(debug ? { resolveInfo } : {}),
          },
          200
        );
      } catch (e) {
        return json(
          {
            online: false,
            channelId: channelId || null,
            error: "yt_api_exception",
            ...(debug ? { message: String(e?.message || e), resolveInfo } : {}),
          },
          200
        );
      }
    }

    // ============================================================
    // PUBLIC: STATUS TIKTOK (heuristic)
    // GET /status/tiktok?u=<tiktokUrl>&debug=1
    // ============================================================
    if (url.pathname === "/status/tiktok" && request.method === "GET") {
      const input = (url.searchParams.get("u") || "").trim();
      const debug = url.searchParams.get("debug") === "1";
      if (!input) return json({ error: "Missing u" }, 400);

      function parseTiktokUsername(u) {
        try {
          const parsed = new URL(u);
          const m = parsed.pathname.match(/@([^/]+)/);
          if (m) return m[1];
        } catch {}
        const m = String(u).match(/tiktok\.com\/@([^/?#]+)/i);
        if (m) return m[1];
        return String(u).replace(/^@+/, "");
      }

      const username = parseTiktokUsername(input);
      if (!username) return json({ online: false, error: "bad_username" }, 200);

      // Основной способ — внутренний API TikTok, как в TikTokLive:
      // https://www.tiktok.com/api/live/detail/?aid=1988&uniqueId=<username>
      const apiUrl = `https://www.tiktok.com/api/live/detail/?aid=1988&uniqueId=${encodeURIComponent(
        username
      )}`;

      try {
        const { r, ct, text } = await fetchText(apiUrl, "application/json");

        let data = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }

        // По аналогии с TikTokLive: liveRoom.status !== 4 => онлайн
        const liveRoom = data?.data?.liveRoom || null;
        const status = typeof liveRoom?.status === "number" ? liveRoom.status : null;
        const online = status !== null && status !== 4;

        return json(
          {
            online,
            ...(debug
              ? {
                  httpStatus: r.status,
                  contentType: ct,
                  rawStatus: status,
                  hasLiveRoom: !!liveRoom,
                }
              : {}),
          },
          200
        );
      } catch (e) {
        // fallback: считаем оффлайн, но не ломаемся
        return json(
          {
            online: false,
            error: "tiktok_fetch_failed",
            ...(debug ? { message: String(e?.message || e) } : {}),
          },
          200
        );
      }
    }

    // ============================================================
    // PROXY (PUBLIC) — без кэша, с умными headers
    // GET /proxy?url=https://...
    // ============================================================
    if (url.pathname === "/proxy" && request.method === "GET") {
      const target = url.searchParams.get("url");
      if (!target) {
        return new Response("Use /proxy?url=https://example.com", {
          status: 400,
          headers: { ...corsHeaders, "Cache-Control": "no-store" },
        });
      }

      let response;
      try {
        response = await fetch(target, {
          method: "GET",
          redirect: "follow",
          headers: browserLikeHeadersFor(target),
          ...cfNoCache,
        });
      } catch (e) {
        return new Response("Proxy fetch failed", {
          status: 502,
          headers: { ...corsHeaders, "Cache-Control": "no-store" },
        });
      }

      const newHeaders = new Headers(response.headers);
      newHeaders.set("Access-Control-Allow-Origin", "*");
      newHeaders.set("Cache-Control", "no-store");

      return new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    // ============================================================
    // GET STREAMERS (PUBLIC)
    // ============================================================
    if (url.pathname === "/streamers" && request.method === "GET") {
      const { results } = await env.DB
        .prepare("SELECT * FROM streamers ORDER BY id DESC")
        .all();

      return new Response(JSON.stringify(results || []), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders,
          "Cache-Control": "no-store",
        },
      });
    }

    // ============================================================
    // AUTH CHECK (ADMIN)
    // ============================================================
    const authHeader = request.headers.get("Authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (token !== env.ADMIN_TOKEN) {
      return json({ error: "Forbidden" }, 403);
    }

    // ============================================================
    // ADMIN PING
    // ============================================================
    if (url.pathname === "/admin/ping" && request.method === "GET") {
      return json({ ok: true }, 200);
    }

    // ============================================================
    // CREATE STREAMER
    // ============================================================
    if (url.pathname === "/streamers" && request.method === "POST") {
      const body = await request.json();

      await env.DB.prepare(
        `INSERT INTO streamers (realName, steamUrl, twitch, youtube, battleMetrics, kick, tiktok)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          body.realName,
          body.steamUrl,
          body.twitch || null,
          body.youtube || null,
          body.battleMetrics || null,
          body.kick || null,
          body.tiktok || null
        )
        .run();

      return json({ success: true }, 200);
    }

    // ============================================================
    // UPDATE STREAMER
    // ============================================================
    if (url.pathname === "/streamers" && request.method === "PUT") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);

      const body = await request.json();

      await env.DB.prepare(
        `UPDATE streamers
         SET realName = ?, steamUrl = ?, twitch = ?, youtube = ?, battleMetrics = ?, kick = ?, tiktok = ?
         WHERE id = ?`
      )
        .bind(
          body.realName,
          body.steamUrl,
          body.twitch || null,
          body.youtube || null,
          body.battleMetrics || null,
          body.kick || null,
          body.tiktok || null,
          id
        )
        .run();

      return json({ success: true }, 200);
    }

    // ============================================================
    // DELETE STREAMER
    // ============================================================
    if (url.pathname === "/streamers" && request.method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);

      await env.DB.prepare("DELETE FROM streamers WHERE id = ?").bind(id).run();
      return json({ success: true }, 200);
    }

    return new Response("Not found", {
      status: 404,
      headers: { ...corsHeaders, "Cache-Control": "no-store" },
    });
  },
};

