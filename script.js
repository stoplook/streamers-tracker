// =====================
// Settings (Worker)
// =====================
const WORKER_BASE = "https://streamers-proxy.yasonsworkshop.workers.dev";
const WORKER_PROXY = `${WORKER_BASE}/proxy?url=`;
const STREAMERS_API = `${WORKER_BASE}/streamers`;

// =====================
// Admin
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
    cache: "no-store",
  });

  const text = await res.text();
  let data = null;

  try {
    data = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    throw new Error((data && data.error) ? data.error : text || ("HTTP " + res.status));
  }

  return data ?? text;
}

// =====================
// State
// =====================
let streamers = [];

const container = document.getElementById("streamers-container");
const loader = document.getElementById("loader");
const loaderOverlay = document.getElementById("loader-overlay");
const lastUpdateEl = document.getElementById("last-update");
const refreshBtn = document.getElementById("refresh-btn");
const searchInput = document.getElementById("search-input");

// =====================
// Utils
// =====================
function setLoading(on, text) {
  if (loader) loader.style.display = on ? "block" : "none";
  if (loaderOverlay) loaderOverlay.style.display = on ? "block" : "none";
  const t = loader?.querySelector(".loader-text");
  if (t) t.textContent = on ? text : "";
}

// =====================
// Fetch list
// =====================
async function loadStreamersList() {
  const res = await fetch(`${STREAMERS_API}?v=${Date.now()}`, { cache: "no-store" });
  const data = await res.json();

  streamers = data
    .filter(x => x?.realName && x?.steamUrl)
    .map(x => ({
      id: x.id,
      realName: x.realName,
      steamUrl: x.steamUrl,
      twitch: x.twitch,
      youtube: x.youtube,
      kick: x.kick,
      tiktok: x.tiktok,
      battleMetrics: x.battleMetrics
    }));
}

// =====================
// Steam
// =====================
async function fetchSteamProfile(url) {
  try {
    const xmlUrl = url.replace(/\/$/, "") + "/?xml=1&cacheBust=" + Date.now();
    const res = await fetch(xmlUrl);
    const text = await res.text();

    const avatar = text.match(/<avatarFull>(.*?)<\/avatarFull>/)?.[1] || null;
    const nick = text.match(/<steamID>(.*?)<\/steamID>/)?.[1] || null;
    const steamId = text.match(/<steamID64>(.*?)<\/steamID64>/)?.[1] || null;

    return { avatar, nick, steamId };
  } catch {
    return { avatar: null, nick: null, steamId: null };
  }
}

// =====================
// Status helpers
// =====================
async function isOnlineSimple(url) {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const t = await r.text();
    return !t.toLowerCase().includes("offline");
  } catch {
    return false;
  }
}

function parseTwitch(u) {
  try {
    return new URL(u).pathname.replace("/", "");
  } catch {
    return null;
  }
}

// =====================
// Card
// =====================
function createCard(s, steam) {
  const el = document.createElement("div");
  el.className = "streamer";

  el._steamUrl = s.steamUrl;

  const info = document.createElement("div");
  info.innerHTML = `
    <div class="streamer-name">${s.realName}</div>
    <div class="steam-nick">${steam.nick || "loading..."}</div>
    <div class="steam-id">${steam.steamId || "loading..."}</div>
  `;

  el._nick = info.querySelector(".steam-nick");
  el._id = info.querySelector(".steam-id");

  const img = document.createElement("img");
  img.src = steam.avatar || "";

  el.appendChild(img);
  el.appendChild(info);

  const dot = document.createElement("div");
  dot.style = "width:10px;height:10px;border-radius:50%;background:red;position:absolute;top:5px;right:5px;";
  el._dot = dot;
  el.appendChild(dot);

  return el;
}

// =====================
// MAIN UPDATE (FULL FIXED)
// =====================
async function updateAllStreamers() {
  if (!container) return;

  setLoading(true, "Loading...");

  container.innerHTML = [];

  const cards = [];

  // 1 create cards
  for (const s of streamers) {
    const steam = await fetchSteamProfile(s.steamUrl);
    const card = createCard(s, steam);
    container.appendChild(card);
    cards.push({ card, s });
  }

  // 2 steam done already

  // 3 statuses
  for (const { card, s } of cards) {
    let online = false;

    if (s.twitch) {
      const user = parseTwitch(s.twitch);
      online = await isOnlineSimple(`https://decapi.me/twitch/stream/${user}`);
    }

    if (!online && s.youtube) {
      online = await isOnlineSimple(`https://www.youtube.com/@live`);
    }

    card._dot.style.background = online ? "green" : "red";
  }

  setLoading(false);
}

// =====================
// init
// =====================
(async () => {
  await loadStreamersList();
  await updateAllStreamers();
})();
