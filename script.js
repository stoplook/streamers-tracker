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

// =====================
// GLOBAL DATA
// =====================
let streamers = [];

// =====================
// DOM
// =====================
const container = document.getElementById("streamers-container");
const loader = document.getElementById("loader");
const loaderOverlay = document.getElementById("loader-overlay");
const lastUpdateEl = document.getElementById("last-update");

// =====================
// COLORS
// =====================
const GREEN = "#00ff5f";
const RED = "#ff4444";
const GRAY = "#7a7a7a";

// =====================
// DEFAULTS
// =====================
const DEFAULT_AVATAR = "data:image/svg+xml;base64," + btoa(`
<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80">
<rect width="80" height="80" fill="#181818"/>
<text x="50%" y="50%" fill="#66b2ff" font-size="14" text-anchor="middle" dominant-baseline="middle">?</text>
</svg>`);

// =====================
// POPUP
// =====================
function showPopup(msg) {
  const div = document.createElement("div");
  div.className = "popup";
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1500);
}

// =====================
// FETCH STREAMERS
// =====================
async function loadStreamersList() {
  const res = await fetch(`${STREAMERS_API}?v=${Date.now()}`);
  const data = await res.json();

  streamers = data.map(s => ({
    ...s,
    id: s.id,
    realName: s.realName,
    steamUrl: s.steamUrl
  }));
}

// =====================
// STREAMER CARD
// =====================
function createStreamerCard(s, data) {
  const el = document.createElement("div");
  el.className = "streamer";
  el._steamUrl = s.steamUrl;
  el._id = s.id;

  const avatar = document.createElement("img");
  avatar.src = data.avatar || DEFAULT_AVATAR;

  const avatarWrapper = document.createElement("div");
  avatarWrapper.className = "avatar-wrapper";
  avatarWrapper.appendChild(avatar);

  el.appendChild(avatarWrapper);

  // =====================
  // INFO (ВАЖНО ЧАСЫ)
  // =====================
  const infoWrapper = document.createElement("div");
  infoWrapper.className = "streamer-info";

  infoWrapper.innerHTML = `
    <div class="streamer-name">${s.realName}</div>

    <div class="streamer-steam">
      <span>${data.nick || "Загрузка..."}</span>
    </div>

    <div class="streamer-id">
      <span class="steam-id">${data.steamId || "Загрузка..."}</span>
    </div>

    <div class="streamer-hours" id="hours-${s.id}">
      ⏳ Часы в Rust: загрузка...
    </div>
  `;

  el.appendChild(infoWrapper);

  el._hoursEl = infoWrapper.querySelector(`#hours-${s.id}`);

  return el;
}

// =====================
// RENDER
// =====================
async function updateAllStreamers() {
  container.innerHTML = "";

  const cards = [];

  for (const s of streamers) {
    const data = {
      avatar: null,
      nick: "Steam",
      steamId: "..."
    };

    const card = createStreamerCard(s, data);
    container.appendChild(card);

    cards.push({ card, s });
  }

  await loadRustHoursForAll(cards);
}

// =====================
// 🔥 FIX: RUST HOURS
// =====================
async function loadRustHoursForAll(cards) {
  for (const { card, s } of cards) {
    try {
      const el = card._hoursEl || document.getElementById(`hours-${s.id}`);
      if (!el) continue;

      // ⚠️ тут твой API / Worker / источник часов
      const res = await fetch(`${WORKER_BASE}/rust-hours?steamUrl=${encodeURIComponent(s.steamUrl)}`);
      const data = await res.json();

      const hours = data?.hours ?? null;

      el.textContent =
        hours !== null
          ? `⏳ Часы в Rust: ${hours}`
          : `⏳ Часы в Rust: нет данных`;

    } catch (e) {
      console.error("hours error", e);
      const el = document.getElementById(`hours-${s.id}`);
      if (el) el.textContent = "⏳ Часы в Rust: ошибка";
    }
  }
}

// =====================
// INIT
// =====================
(async () => {
  await loadStreamersList();
  await updateAllStreamers();
})();
