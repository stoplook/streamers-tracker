console.log(
  "SCRIPT VERSION: v6 - STREAMERS + ADMIN CRUD + KICK/TIKTOK",
  "https://streamers-proxy.yasonsworkshop.workers.dev"
);

// =====================
// Settings (Worker)
// =====================
const WORKER_BASE = "https://streamers-proxy.yasonsworkshop.workers.dev";
const WORKER_PROXY = `${WORKER_BASE}/proxy?url=`;
const STREAMERS_API = `${WORKER_BASE}/streamers`;

// =====================
// Admin (token + CRUD)
// =====================
const ADMIN_TOKEN_KEY = "st_admin_token";
let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || "";
let adminEnabled = false;

function authHeaders(extra = {}) {
  return Object.assign(
    { "Content-Type": "application/json" },
    extra,
    adminToken ? { Authorization: "Bearer " + adminToken } : {}
  );
}

async function adminApi(path, opts = {}) {
  const res = await fetch(WORKER_BASE + path, {
    ...opts,
    headers: authHeaders(opts.headers || {}),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error((data && data.error) ? data.error : (text || ("HTTP " + res.status)));
  return data ?? text;
}

function setAdminUiVisible() {
  const adminFab = document.getElementById("admin-fab");
  const newFab = document.getElementById("new-streamer-fab");
  adminFab?.classList?.add("is-visible");
  newFab?.classList?.toggle?.("is-visible", !!adminEnabled);
}

function applyAdminToExistingCards() {
  const cards = Array.from(container?.children || []);
  for (const card of cards) {
    const actions = card.querySelector?.(".admin-card-actions");
    if (actions) actions.style.display = adminEnabled ? "flex" : "none";
  }
}

async function tryEnableAdmin() {
  try {
    await adminApi(`/admin/ping`, { method: "GET" });
    adminEnabled = true;
  } catch {
    adminEnabled = false;
  }
  setAdminUiVisible();
  applyAdminToExistingCards();
}

let streamers = [];

// грузим список стримеров из WORKER API (без кеша)
async function loadStreamersList() {
  const url = `${STREAMERS_API}?v=${Date.now()}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Не удалось загрузить /streamers: ${res.status}`);

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("/streamers должен вернуть массив");

  streamers = data
    .filter(x => x && x.realName && x.steamUrl)
    .map(x => ({
      id: x.id,
      realName: String(x.realName).trim(),
      steamUrl: String(x.steamUrl).trim(),
      twitch: x.twitch ? String(x.twitch).trim() : undefined,
      youtube: x.youtube ? String(x.youtube).trim() : undefined,
      battleMetrics: x.battleMetrics ? String(x.battleMetrics).trim() : undefined,
      kick: x.kick ? String(x.kick).trim() : undefined,
      tiktok: x.tiktok ? String(x.tiktok).trim() : undefined,
    }));
}

// DOM
const loader = document.getElementById("loader");
const loaderOverlay = document.getElementById("loader-overlay");
const lastUpdateEl = document.getElementById("last-update");
const container = document.getElementById("streamers-container");
const refreshBtn = document.getElementById("refresh-btn");
const searchInput = document.getElementById("search-input");

if (refreshBtn) refreshBtn.textContent = "Обновить данные";

// =====================
// App settings
// =====================
const STEAM_TTL_MS = 5 * 60 * 1000;
const STATUS_TTL_MS = 60 * 1000;
const YT_CHANNEL_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;
const STEAM_CONCURRENCY = 3;
const STATUS_CONCURRENCY = 4;

const GREEN = "#00ff5f";
const RED = "#ff4444";

// Default avatar
const DEFAULT_AVATAR =
  "data:image/svg+xml;base64," +
  btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
  <rect width="80" height="80" fill="#181818" rx="40" ry="40"/>
  <text x="50%" y="50%" font-size="16" fill="#66b2ff" font-family="Inter, sans-serif" font-weight="600" text-anchor="middle" dominant-baseline="central">?</text>
</svg>`);

// =====================
// Popup
// =====================
const popupContainer =
  document.querySelector(".popup-container") ||
  (() => {
    const el = document.createElement("div");
    el.className = "popup-container";
    document.body.appendChild(el);
    return el;
  })();

function showPopup(message) {
  const popup = document.createElement("div");
  popup.className = "popup";
  popup.textContent = message;
  popupContainer.appendChild(popup);
  setTimeout(() => popup.remove(), 1500);
}

// =====================
// Search
// =====================
function applySearchFilter() {
  const term = (searchInput?.value || "").toLowerCase();
  container?.querySelectorAll?.(".streamer")?.forEach((card) => {
    const steamNick = (card._steamNickEl?.textContent || "").toLowerCase();
    const realName = (card.querySelector?.(".streamer-name")?.textContent || "").toLowerCase();
    const steamId = (card._steamIdEl?.textContent || "").toLowerCase();
    card.style.display =
      steamNick.includes(term) || realName.includes(term) || steamId.includes(term) ? "" : "none";
  });
}
searchInput?.addEventListener?.("input", applySearchFilter);

// =====================
// Loader
// =====================
function setLoading(on, text) {
  if (loader) loader.style.display = on ? "block" : "none";
  if (loaderOverlay) loaderOverlay.style.display = on ? "block" : "none";
  const lt = loader?.querySelector?.(".loader-text");
  if (lt) lt.textContent = on ? text || "" : "";
}

// =====================
// fetch with hard timeout
// =====================
async function fetchText(url, timeout = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer = null;

  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch {}
      resolve(null);
    }, timeout);
  });

  try {
    const fetchPromise = fetch(url, {
      signal: controller.signal,
      headers: { Accept: "*/*" },
    })
      .then((r) => (r && r.ok ? r.text() : null))
      .catch(() => null);

    return await Promise.race([fetchPromise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// =====================
// Proxy helpers
// =====================
function proxied(url) {
  return `${WORKER_PROXY}${encodeURIComponent(url)}`;
}

async function fetchTextAnyWay(url, timeout = FETCH_TIMEOUT_MS) {
  try {
    const s = String(url);
    const isSteamOrYoutube = s.includes("steamcommunity.com") || s.includes("youtube.com");

    if (isSteamOrYoutube) return await fetchText(proxied(url), timeout);

    const direct = await fetchText(url, timeout);
    if (direct) return direct;

    const t = await fetchText(proxied(url), timeout);
    if (t && !t.includes("<!DOCTYPE html") && !t.includes("<html")) return t;
  } catch {}
  return null;
}

async function fetchTextAnyWayAllowHtml(url, timeout = FETCH_TIMEOUT_MS) {
  try {
    const s = String(url);
    const isSteamOrYoutube = s.includes("steamcommunity.com") || s.includes("youtube.com");

    if (isSteamOrYoutube) return await fetchText(proxied(url), timeout);

    const direct = await fetchText(url, timeout);
    if (direct) return direct;

    return await fetchText(proxied(url), timeout);
  } catch {}
  return null;
}

// =====================
// TTL caches
// =====================
const steamCache = new Map();
const statusCache = new Map();
const ytChannelCache = new Map();

function getTtl(cache, key, ttlMs) {
  const rec = cache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.ts > ttlMs) return null;
  return rec.value;
}
function setTtl(cache, key, value) {
  cache.set(key, { value, ts: Date.now() });
}

// =====================
// Steam
// =====================
function makeSteamXmlUrl(profileUrl) {
  const base = profileUrl.endsWith("/") ? profileUrl : profileUrl + "/";
  return `${base}?xml=1&cacheBust=${Date.now()}`;
}

async function fetchSteamProfile(steamUrl) {
  const cached = getTtl(steamCache, steamUrl, STEAM_TTL_MS);
  if (cached) return cached;

  const xmlUrl = makeSteamXmlUrl(steamUrl);
  const text = await fetchTextAnyWay(xmlUrl, 16000);
  if (!text) return { avatar: null, nick: null, steamId: null };

  try {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const value = {
      avatar: xml.querySelector("avatarFull")?.textContent || null,
      nick: xml.querySelector("steamID")?.textContent || null,
      steamId: xml.querySelector("steamID64")?.textContent || null,
    };
    setTtl(steamCache, steamUrl, value);
    return value;
  } catch {
    return { avatar: null, nick: null, steamId: null };
  }
}

async function fetchSteamProfileWithRetry(steamUrl, maxAttempts = 4, delay = 1100) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const data = await fetchSteamProfile(steamUrl);
    if (data.avatar || data.nick || data.steamId) return data;
    await new Promise((r) => setTimeout(r, delay * Math.min(attempt, 4)));
  }
  return { avatar: null, nick: null, steamId: null };
}

// =====================
// Twitch
// =====================
function parseTwitchUsername(twitchUrl) {
  try {
    const u = new URL(twitchUrl);
    const name = u.pathname.replace(/^\/+|\/+$/g, "");
    return name || null;
  } catch {
    const m = String(twitchUrl).match(/twitch\.tv\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
}

async function getTwitchStatusStrict(username) {
  if (!username) return false;

  const key = `tw:${username.toLowerCase()}`;
  const cached = getTtl(statusCache, key, STATUS_TTL_MS);
  if (cached !== null) return cached;

  const endpoints = [
    `https://decapi.me/twitch/uptime/${encodeURIComponent(username)}`,
    `https://decapi.me/twitch/status/${encodeURIComponent(username)}`,
    `https://decapi.me/twitch/stream/${encodeURIComponent(username)}`,
  ];

  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const url of endpoints) {
      const text = await fetchTextAnyWay(url, 18000);
      if (!text) continue;

      const t = text.toLowerCase();

      if (t.includes("offline")) {
        setTtl(statusCache, key, false);
        return false;
      }

      if (!t.includes("error") && !t.includes("not found") && t.trim().length > 0) {
        setTtl(statusCache, key, true);
        return true;
      }
    }
    await new Promise((r) => setTimeout(r, 1300 * attempt));
  }

  setTtl(statusCache, key, false);
  return false;
}

// =====================
// YouTube
// =====================
function extractYoutubeChannelIdFromUrl(youtubeUrl) {
  if (!youtubeUrl) return null;
  const s = String(youtubeUrl);

  const m1 = s.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{18,})/i);
  if (m1) return m1[1];

  const m2 = s.match(/channel_id=(UC[a-zA-Z0-9_-]{18,})/i);
  if (m2) return m2[1];

  return null;
}

function extractYoutubeHandleFromUrl(youtubeUrl) {
  if (!youtubeUrl) return null;
  const s = String(youtubeUrl);

  const m = s.match(/youtube\.com\/@([^/?#]+)/i);
  if (m) return m[1];

  const mc = s.match(/youtube\.com\/c\/([^/?#]+)/i);
  if (mc) return mc[1];

  const mu = s.match(/youtube\.com\/user\/([^/?#]+)/i);
  if (mu) return mu[1];

  return null;
}

function ytRssUrl(channelId) {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

function detectLiveFromRss(rssText) {
  if (!rssText) return false;
  const s = rssText.toLowerCase();
  if (s.includes("yt:livebroadcastcontent") && s.includes(">live<")) return true;
  if (s.includes('"islivecontent":true')) return true;
  const hasEntry = s.includes("<entry");
  if (hasEntry && s.includes("live")) return true;
  return false;
}

function extractChannelIdFromYoutubeHtml(html) {
  if (!html) return null;

  let m = html.match(/"channelId"\s*:\s*"(UC[a-zA-Z0-9_-]{18,})"/);
  if (m) return m[1];

  m = html.match(/\/channel\/(UC[a-zA-Z0-9_-]{18,})/);
  if (m) return m[1];

  m = html.match(/"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]{18,})"/);
  if (m) return m[1];

  return null;
}

async function resolveYoutubeChannelId(youtubeUrl) {
  if (!youtubeUrl) return null;

  const cached = getTtl(ytChannelCache, youtubeUrl, YT_CHANNEL_TTL_MS);
  if (cached !== null) return cached;

  const directId = extractYoutubeChannelIdFromUrl(youtubeUrl);
  if (directId) {
    setTtl(ytChannelCache, youtubeUrl, directId);
    return directId;
  }

  const handle = extractYoutubeHandleFromUrl(youtubeUrl);
  if (!handle) {
    setTtl(ytChannelCache, youtubeUrl, null);
    return null;
  }

  const pageUrl = `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  const html = await fetchTextAnyWayAllowHtml(pageUrl, 20000);
  const id = extractChannelIdFromYoutubeHtml(html);

  setTtl(ytChannelCache, youtubeUrl, id || null);
  return id || null;
}

async function getYoutubeStatusStrict(youtubeUrl) {
  if (!youtubeUrl) return false;

  const key = `yt:${youtubeUrl.toLowerCase()}`;
  const cached = getTtl(statusCache, key, STATUS_TTL_MS);
  if (cached !== null) return cached;

  const channelId = await resolveYoutubeChannelId(youtubeUrl);
  if (!channelId) {
    setTtl(statusCache, key, false);
    return false;
  }

  const rss = await fetchTextAnyWayAllowHtml(ytRssUrl(channelId), 18000);
  const online = detectLiveFromRss(rss);

  setTtl(statusCache, key, online);
  return online;
}

// =====================
// Kick
// =====================
function parseKickUsername(kickUrl) {
  try {
    const u = new URL(kickUrl);
    return u.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    const m = String(kickUrl).match(/kick\.com\/([^/?#]+)/i);
    return m ? m[1] : null;
  }
}

async function getKickStatusStrict(kickUrl) {
  const username = parseKickUsername(kickUrl);
  if (!username) return false;

  const key = `kick:${username.toLowerCase()}`;
  const cached = getTtl(statusCache, key, STATUS_TTL_MS);
  if (cached !== null) return cached;

  const apiUrl = `https://kick.com/api/v2/channels/${encodeURIComponent(username)}`;
  const text = await fetchTextAnyWay(apiUrl, 15000);
  if (!text) {
    setTtl(statusCache, key, false);
    return false;
  }

  try {
    const data = JSON.parse(text);
    const online = !!data?.livestream;
    setTtl(statusCache, key, online);
    return online;
  } catch {
    setTtl(statusCache, key, false);
    return false;
  }
}

// =====================
// TikTok (best-effort)
// =====================
function parseTiktokUsername(tiktokUrl) {
  try {
    const u = new URL(tiktokUrl);
    return u.pathname.replace(/^\/+|\/+$/g, "").replace(/^@/, "");
  } catch {
    const m = String(tiktokUrl).match(/tiktok\.com\/@([^/?#]+)/i);
    return m ? m[1] : null;
  }
}

async function getTiktokStatusStrict(tiktokUrl) {
  const username = parseTiktokUsername(tiktokUrl);
  if (!username) return false;

  const key = `tt:${username.toLowerCase()}`;
  const cached = getTtl(statusCache, key, STATUS_TTL_MS);
  if (cached !== null) return cached;

  const pageUrl = `https://www.tiktok.com/@${encodeURIComponent(username)}/live`;
  const html = await fetchTextAnyWayAllowHtml(pageUrl, 15000);
  if (!html) {
    setTtl(statusCache, key, false);
    return false;
  }

  const s = html.toLowerCase();
  const online =
    s.includes('"islive":true') ||
    s.includes('"livestatus":1') ||
    s.includes('"live":true');

  setTtl(statusCache, key, online);
  return online;
}

// =====================
// Admin modals wiring (requires index.html admin blocks)
// =====================
const adminFab = document.getElementById("admin-fab");
const newStreamerFab = document.getElementById("new-streamer-fab");

const adminModal = document.getElementById("admin-modal");
const adminClose = document.getElementById("admin-close");
const adminTokenInput = document.getElementById("admin-token");
const adminSave = document.getElementById("admin-save");
const adminClear = document.getElementById("admin-clear");
const adminTest = document.getElementById("admin-test");
const adminHint = document.getElementById("admin-hint");

const streamerModal = document.getElementById("streamer-modal");
const streamerClose = document.getElementById("streamer-close");
const streamerCancel = document.getElementById("streamer-cancel");
const streamerSave = document.getElementById("streamer-save");
const streamerHint = document.getElementById("streamer-hint");
const streamerTitle = document.getElementById("streamer-modal-title");

const fId = document.getElementById("streamer-id");
const fRealName = document.getElementById("streamer-realName");
const fSteamUrl = document.getElementById("streamer-steamUrl");
const fTwitch = document.getElementById("streamer-twitch");
const fYoutube = document.getElementById("streamer-youtube");
const fBm = document.getElementById("streamer-battleMetrics");
const fKick = document.getElementById("streamer-kick");
const fTiktok = document.getElementById("streamer-tiktok");

function openModal(modal) {
  modal?.classList?.add("is-open");
  modal?.setAttribute?.("aria-hidden", "false");
}
function closeModal(modal) {
  modal?.classList?.remove("is-open");
  modal?.setAttribute?.("aria-hidden", "true");
}
function setHint(el, text) {
  if (el) el.textContent = text || "";
}

function openStreamerModal(mode, s) {
  setHint(streamerHint, "");

  if (mode === "new") {
    streamerTitle && (streamerTitle.textContent = "Новый стример");
    if (fId) fId.value = "";
    if (fRealName) fRealName.value = "";
    if (fSteamUrl) fSteamUrl.value = "";
    if (fTwitch) fTwitch.value = "";
    if (fYoutube) fYoutube.value = "";
    if (fBm) fBm.value = "";
    if (fKick) fKick.value = "";
    if (fTiktok) fTiktok.value = "";
  } else {
    streamerTitle && (streamerTitle.textContent = "Редактировать стримера");
    if (fId) fId.value = (s?.id ?? "");
    if (fRealName) fRealName.value = (s?.realName ?? "");
    if (fSteamUrl) fSteamUrl.value = (s?.steamUrl ?? "");
    if (fTwitch) fTwitch.value = (s?.twitch ?? "");
    if (fYoutube) fYoutube.value = (s?.youtube ?? "");
    if (fBm) fBm.value = (s?.battleMetrics ?? "");
    if (fKick) fKick.value = (s?.kick ?? "");
    if (fTiktok) fTiktok.value = (s?.tiktok ?? "");
  }

  openModal(streamerModal);
}

adminFab?.addEventListener?.("click", () => {
  if (!adminModal) return;
  if (adminTokenInput) adminTokenInput.value = adminToken || "";
  setHint(adminHint, "");
  openModal(adminModal);
});

adminClose?.addEventListener?.("click", () => closeModal(adminModal));
adminModal?.querySelector?.(".admin-modal__backdrop")?.addEventListener?.("click", () =>
  closeModal(adminModal)
);

streamerClose?.addEventListener?.("click", () => closeModal(streamerModal));
streamerCancel?.addEventListener?.("click", () => closeModal(streamerModal));
streamerModal?.querySelector?.(".admin-modal__backdrop")?.addEventListener?.("click", () =>
  closeModal(streamerModal)
);

adminSave?.addEventListener?.("click", async () => {
  adminToken = (adminTokenInput?.value || "").trim();
  localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
  setHint(adminHint, "Проверяем...");
  await tryEnableAdmin();
  setHint(adminHint, adminEnabled ? "✅ Админ включен" : "❌ Неверный токен");
});

adminClear?.addEventListener?.("click", async () => {
  adminToken = "";
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  adminEnabled = false;
  if (adminTokenInput) adminTokenInput.value = "";
  setAdminUiVisible();
  applyAdminToExistingCards();
  setHint(adminHint, "Очищено");
});

adminTest?.addEventListener?.("click", async () => {
  setHint(adminHint, "Проверяем...");
  await tryEnableAdmin();
  setHint(adminHint, adminEnabled ? "✅ Ок" : "❌ Неверный токен");
});

newStreamerFab?.addEventListener?.("click", () => {
  if (!adminEnabled) return showPopup("🔒 Нужен токен");
  openStreamerModal("new");
});

streamerSave?.addEventListener?.("click", async () => {
  try {
    if (!adminEnabled) return setHint(streamerHint, "🔒 Нужен токен");

    const body = {
      realName: (fRealName?.value || "").trim(),
      steamUrl: (fSteamUrl?.value || "").trim(),
      twitch: (fTwitch?.value || "").trim() || null,
      youtube: (fYoutube?.value || "").trim() || null,
      battleMetrics: (fBm?.value || "").trim() || null,
      kick: (fKick?.value || "").trim() || null,
      tiktok: (fTiktok?.value || "").trim() || null,
    };

    if (!body.realName || !body.steamUrl) {
      return setHint(streamerHint, "Нужны минимум Real name и Steam URL");
    }

    const id = (fId?.value || "").trim();

    setHint(streamerHint, "Сохраняем...");
    if (id) {
      await adminApi(`/streamers?id=${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      showPopup("✅ Обновлено");
    } else {
      await adminApi(`/streamers`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      showPopup("✅ Добавлено");
    }

    closeModal(streamerModal);
    await loadStreamersList();
    await updateAllStreamers(true);
    applyAdminToExistingCards();
  } catch (e) {
    console.error(e);
    setHint(streamerHint, "Ошибка: " + (e?.message || "unknown"));
  }
});

// =====================
// UI helpers
// =====================
function badge(text) {
  const b = document.createElement("span");
  b.textContent = text;
  b.style.cssText =
    "display:inline-flex;align-items:center;justify-content:center;" +
    "height:32px;padding:0 10px;border:1px solid #66b2ff;border-radius:5px;" +
    "color:#66b2ff;font-weight:600;font-size:12px;text-decoration:none";
  return b;
}

// =====================
// UI card
// =====================
function createStreamerCard(s, data) {
  const el = document.createElement("div");
  el.className = "streamer";
  el._steamUrl = s.steamUrl;
  el._id = s.id;

  const adminActions = document.createElement("div");
  adminActions.className = "admin-card-actions";
  adminActions.style.display = adminEnabled ? "flex" : "none";
  adminActions.innerHTML = `
    <button class="admin-mini" type="button" title="Редактировать" aria-label="Редактировать">✏</button>
    <button class="admin-mini" type="button" title="Удалить" aria-label="Удалить">🗑</button>
  `;

  const btns = adminActions.querySelectorAll("button");
  btns[0].onclick = () => openStreamerModal("edit", s);
  btns[1].onclick = async () => {
    try {
      if (!adminEnabled) return;
      if (!s.id) return showPopup("❌ Нет id");
      if (!confirm(`Удалить "${s.realName}"?`)) return;
      await adminApi(`/streamers?id=${encodeURIComponent(s.id)}`, { method: "DELETE" });
      showPopup("✅ Удалено");
      await loadStreamersList();
      await updateAllStreamers(true);
      applyAdminToExistingCards();
    } catch (e) {
      console.error(e);
      showPopup("❌ Ошибка удаления");
    }
  };

  el.appendChild(adminActions);

  const avatarWrapper = document.createElement("div");
  avatarWrapper.className = "avatar-wrapper";
  avatarWrapper.style.position = "relative";

  const img = document.createElement("img");
  img.src = data.avatar || DEFAULT_AVATAR;
  avatarWrapper.appendChild(img);

  if (s.twitch || s.youtube || s.kick || s.tiktok) {
    const indicator = document.createElement("span");
    indicator.style.cssText =
      "position:absolute;top:4px;right:4px;width:12px;height:12px;border-radius:50%;" +
      "box-shadow:0 0 4px rgba(0,0,0,0.5);background:" + RED;
    avatarWrapper.appendChild(indicator);
    el._indicatorEl = indicator;
  }

  el.appendChild(avatarWrapper);

  const infoWrapper = document.createElement("div");
  infoWrapper.className = "streamer-info";
  infoWrapper.innerHTML = `
    <div class="streamer-name">${s.realName}</div>
    <div class="streamer-steam">
      <span class="steam-label">Имя в стим:</span>
      <span class="steam-nick">${data.nick || "Загрузка..."}</span>
    </div>
    <div class="streamer-id">
      <span class="steam-label">Steam ID:</span>
      <span class="steam-id clickable">${data.steamId || "Загрузка..."}</span>
    </div>
  `;

  el._steamNickEl = infoWrapper.querySelector(".steam-nick");
  el._steamIdEl = infoWrapper.querySelector(".steam-id");

  el._steamIdEl?.addEventListener?.("click", async () => {
    const text = el._steamIdEl?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      showPopup("✅ Скопировано!");
    } catch {
      showPopup("❌ Не удалось скопировать");
    }
  });

  el.appendChild(infoWrapper);

  const buttonsWrapper = document.createElement("div");
  buttonsWrapper.className = "streamer-buttons";

  const steamBtn = document.createElement("a");
  steamBtn.href = s.steamUrl;
  steamBtn.target = "_blank";
  steamBtn.rel = "noopener noreferrer";
  steamBtn.className = "primary-btn";
  steamBtn.innerHTML = `Открыть профиль`;
  buttonsWrapper.appendChild(steamBtn);

  const iconGroup = document.createElement("div");
  iconGroup.className = "icon-group";

  if (s.battleMetrics) {
    const bm = document.createElement("a");
    bm.href = s.battleMetrics;
    bm.target = "_blank";
    bm.rel = "noopener noreferrer";
    bm.className = "bm-btn";
    bm.textContent = "BattleMetrics";
    iconGroup.appendChild(bm);
  }

  if (s.twitch) {
    const a = document.createElement("a");
    a.href = s.twitch;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "icon-btn";
    a.textContent = "TW";
    iconGroup.appendChild(a);
  }
  if (s.youtube) {
    const a = document.createElement("a");
    a.href = s.youtube;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "icon-btn";
    a.textContent = "YT";
    iconGroup.appendChild(a);
  }
  if (s.kick) {
    const a = document.createElement("a");
    a.href = s.kick;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "icon-btn";
    a.textContent = "K";
    iconGroup.appendChild(a);
  }
  if (s.tiktok) {
    const a = document.createElement("a");
    a.href = s.tiktok;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.className = "icon-btn";
    a.textContent = "TT";
    iconGroup.appendChild(a);
  }

  buttonsWrapper.appendChild(iconGroup);
  el.appendChild(buttonsWrapper);

  return el;
}

function setIndicatorStrict(card, online) {
  if (!card._indicatorEl) return;
  card._indicatorEl.style.background = online ? GREEN : RED;
}

// =====================
// Countdown
// =====================
let countdown = 300;
let lastUpdateTime = null;

function updateLastUpdateText() {
  if (!lastUpdateEl) return;
  lastUpdateEl.textContent = lastUpdateTime
    ? `Последнее обновление: ${lastUpdateTime} | Автообновление через: ${countdown}s`
    : `Автообновление через: ${countdown}s`;
}

function startCountdown() {
  updateLastUpdateText();
  setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = 300;
      updateAllStreamers(false);
    }
    updateLastUpdateText();
  }, 1000);
}

// =====================
// MAIN
// =====================
async function updateAllStreamers(forceRefresh = false) {
  const total = streamers.length;
  setLoading(true, `Подтягиваем данные Steam… 0/${total}`);

  const cards = [];
  if (!forceRefresh && container && container.children.length > 0) {
    Array.from(container.children).forEach((card) => {
      const s = streamers.find((st) => st.steamUrl === card._steamUrl);
      if (s) cards.push({ card, s });
    });
  } else {
    if (container) container.innerHTML = "";
    const frag = document.createDocumentFragment();
    streamers.forEach((s) => {
      const card = createStreamerCard(s, { avatar: null, nick: "Загрузка...", steamId: "Загрузка..." });
      frag.appendChild(card);
      cards.push({ card, s });
    });
    container?.appendChild?.(frag);
  }

  let steamDone = 0;
  for (let i = 0; i < cards.length; i += STEAM_CONCURRENCY) {
    const chunk = cards.slice(i, i + STEAM_CONCURRENCY);
    await Promise.all(
      chunk.map(async ({ card, s }) => {
        const data = await fetchSteamProfileWithRetry(s.steamUrl);
        const avatarWrapper = card.querySelector?.(".avatar-wrapper");
        const img = avatarWrapper?.querySelector?.("img");
        if (img) img.src = data.avatar || DEFAULT_AVATAR;
        if (card._steamNickEl) card._steamNickEl.textContent = data.nick || "Не доступен";
        if (card._steamIdEl) card._steamIdEl.textContent = data.steamId || "Не найден";
        steamDone++;
      })
    );
    setLoading(true, `Подтягиваем данные Steam… ${steamDone}/${total}`);
  }

  setLoading(true, `Проверяем статусы... 0/${total}`);

  const cardsArray = Array.from(container?.children || []);
  const HARD_LIMIT_MS = 90000;
  const started = Date.now();

  let statusDone = 0;
  for (let i = 0; i < cardsArray.length; i += STATUS_CONCURRENCY) {
    if (Date.now() - started > HARD_LIMIT_MS) break;

    const chunk = cardsArray.slice(i, i + STATUS_CONCURRENCY);
    await Promise.all(
      chunk.map(async (card) => {
        const s = streamers.find((st) => st.steamUrl === card._steamUrl);
        if (!s) return;

        if (!s.twitch && !s.youtube && !s.kick && !s.tiktok) {
          card._status = 2;
          statusDone++;
          return;
        }

        // приоритет: twitch -> youtube -> kick -> tiktok
        if (s.twitch) {
          const online = await getTwitchStatusStrict(parseTwitchUsername(s.twitch));
          setIndicatorStrict(card, online);
          card._status = online ? 0 : 1;
          statusDone++;
          return;
        }

        if (s.youtube) {
          const online = await getYoutubeStatusStrict(s.youtube);
          setIndicatorStrict(card, online);
          card._status = online ? 0 : 1;
          statusDone++;
          return;
        }

        if (s.kick) {
          const online = await getKickStatusStrict(s.kick);
          setIndicatorStrict(card, online);
          card._status = online ? 0 : 1;
          statusDone++;
          return;
        }

        if (s.tiktok) {
          const online = await getTiktokStatusStrict(s.tiktok);
          setIndicatorStrict(card, online);
          card._status = online ? 0 : 1;
          statusDone++;
          return;
        }
      })
    );

    setLoading(true, `Проверяем статусы... ${statusDone}/${total}`);
  }

  // sort online -> offline -> no info
  cardsArray.sort((a, b) => {
    const sa = typeof a._status === "number" ? a._status : 1;
    const sb = typeof b._status === "number" ? b._status : 1;
    if (sa !== sb) return sa - sb;
    const an = (a._steamNickEl?.textContent || "").toLowerCase();
    const bn = (b._steamNickEl?.textContent || "").toLowerCase();
    return an.localeCompare(bn);
  });

  const frag = document.createDocumentFragment();
  cardsArray.forEach((card) => frag.appendChild(card));
  if (container) {
    container.innerHTML = "";
    container.appendChild(frag);
  }

  setLoading(false);

  lastUpdateTime = new Date().toLocaleTimeString();
  updateLastUpdateText();
  applySearchFilter();
  applyAdminToExistingCards();
}

refreshBtn?.addEventListener?.("click", async () => {
  try {
    steamCache.clear();
    statusCache.clear();
    ytChannelCache.clear();

    await loadStreamersList();
    await updateAllStreamers(true);

    showPopup("♻️ Данные обновлены!");
  } catch (e) {
    console.error(e);
    showPopup("❌ Ошибка загрузки списка");
    setLoading(false);
  }
});

(async () => {
  try {
    setLoading(true, "Загружаем список стримеров...");
    await loadStreamersList();
    await updateAllStreamers(true);

    setAdminUiVisible();
    if (adminToken) await tryEnableAdmin();

    startCountdown();
  } catch (e) {
    console.error(e);
    showPopup("❌ Не удалось загрузить список стримеров");
    setLoading(false);
  }
})();
