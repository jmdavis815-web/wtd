// js/place.js
// NOTE: post.tags are auto-generated in DB via trigger (see SQL)
// NOTE: post creation must use RPC wtd_create_post (direct INSERT on posts is revoked)
// NOTE: map can optionally show last N "positive reactions" via RPC wtd_recent_positive_posts(p_place_id, p_limit)
// Allowed values (keeps DB enums/checks happy even if the DOM ever gets weird)
const ALLOWED_POST_TYPES = new Set(["general", "advice", "event", "alert"]);
const ALLOWED_TOPICS = new Set([
  "everyday",
  "food_drink",
  "outdoors",
  "history",
  "events",
  "attractions",
  "nightlife",
  "legends",
]);

const USE_LOC_KEY = "wtd_use_location_v1";
const useLocToggle = document.getElementById("useLocationToggle");
const locHint = document.getElementById("locHint");

const params = new URLSearchParams(window.location.search);
const placeId = params.get("id");

const ghLinks = document.getElementById("ghLinks");
const placeNameEl = document.getElementById("placeName");
const postsEl = document.getElementById("posts");

function buildMapsUrl(p) {
  const lat = p?.lat;
  const lng = p?.lng;

  const label = (p?.venue_name || p?.title || "Location").trim();
  const addr = (p?.address_text || "").trim();

  // If we have coordinates, use them (best)
  if (lat != null && lng != null) {
    const q = encodeURIComponent(`${lat},${lng} (${label})`);
    // This opens the default map app on mobile; in desktop it opens browser maps
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  // Fallback to address text if no coords
  if (addr) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  }

  return null;
}

// Map refresh helper (only renders if open/visible)
function maybeRenderMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  const collapse = mapEl.closest(".collapse");
  if (collapse && !collapse.classList.contains("show")) return;
  if (mapEl.offsetParent === null) return;
  renderMapFromPosts();
}

function formatCount(n) {
  if (!n || n < 1) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function isOwner(post) {
  return !!currentSession && post?.author_id === currentSession.user.id;
}

function toDatetimeLocalFromIso(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

// ----------------------------------------------------------
// MAP: "last 5 positive reactions" source
// ----------------------------------------------------------
async function fetchRecentPositivePosts(limit = 5) {
  if (!currentSession) return null;
  if (!placeId) return null;

  const { data, error } = await supabase.rpc("wtd_recent_positive_posts", {
    p_place_id: placeId,
    p_limit: limit,
  });

  if (error) {
    console.log("wtd_recent_positive_posts error:", error);
    return null;
  }

  // Normalize into the shape the map expects (p.lat/p.lng etc)
  return (data || [])
    .filter((x) => x?.lat != null && x?.lng != null)
    .map((x) => ({
      id: x.id,
      title: x.title,
      venue_name: x.venue_name,
      address_text: x.address_text,
      lat: x.lat,
      lng: x.lng,
      reacted_at: x.reacted_at,
    }));
}

// One-time click handler for Edit/Delete/Save/Cancel inside posts list
postsEl?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const postId = btn.dataset.id;
  if (!postId) return;

  const post = (lastPosts || []).find((p) => p.id === postId);
  if (!post) return;

  if (!currentSession) {
    alert("Please log in first.");
    window.location.href = "login.html";
    return;
  }

  // Extra guard: even if UI glitches, don’t allow non-owners to attempt.
  if (!isOwner(post)) {
    alert("You can only edit or delete your own posts.");
    return;
  }

  if (action === "delete") {
    if (!confirm("Delete this post?")) return;

    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .eq("author_id", currentSession.user.id);

    if (error) {
      alert(error.message);
      return;
    }

    await loadPosts();
    if (ghMode) await showNextSuggestion();
    return;
  }

  if (action === "edit") {
    // Render inline editor into this card
    const card = btn.closest(".card");
    if (!card) return;

    const isEvent = (post.type || "general").toLowerCase() === "event";

    card.innerHTML = `
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="fw-semibold">Edit your post</div>
          <div class="text-muted small">Score: ${post.score ?? 0}</div>
        </div>

        <div class="row g-2 mt-2">
          <div class="col-12 col-md-3">
            <select class="form-select form-select-sm" data-edit="type">
              <option value="general">General</option>
              <option value="advice">Advice</option>
              <option value="event">Event</option>
              <option value="alert">Alert</option>
            </select>
          </div>

          <div class="col-12 col-md-3">
            <select class="form-select form-select-sm" data-edit="topic">
              <option value="everyday">Everyday</option>
              <option value="food_drink">Food & Drink</option>
              <option value="outdoors">Outdoors</option>
              <option value="history">History</option>
              <option value="events">Entertainment</option>
              <option value="attractions">Attractions</option>
              <option value="nightlife">Nightlife</option>
              <option value="legends">Legends & Lore</option>
            </select>
          </div>

          <div class="col-12 col-md-6">
            <input class="form-control form-control-sm" data-edit="title" maxlength="120" />
          </div>

          <div class="col-12">
            <textarea class="form-control form-control-sm" data-edit="body" rows="3"></textarea>
          </div>

          <div class="col-12 ${isEvent ? "" : "d-none"}" data-edit="eventRow">
            <div class="row g-2">
              <div class="col-12 col-md-6">
                <label class="form-label mb-1 small">Starts</label>
                <input type="datetime-local" class="form-control form-control-sm" data-edit="starts_at" />
              </div>
              <div class="col-12 col-md-6">
                <label class="form-label mb-1 small">Ends (optional)</label>
                <input type="datetime-local" class="form-control form-control-sm" data-edit="ends_at" />
              </div>
            </div>
          </div>

          <div class="col-12 d-flex align-items-center gap-2 mt-1">
            <button class="btn btn-sm btn-primary" data-action="save" data-id="${postId}">Save</button>
            <button class="btn btn-sm btn-outline-secondary" data-action="cancel" data-id="${postId}">Cancel</button>
            <span class="text-muted small" data-edit="msg"></span>
          </div>
        </div>
      </div>
    `;

    // Fill values
    const typeSel = card.querySelector('[data-edit="type"]');
    const topicSel = card.querySelector('[data-edit="topic"]');
    const titleIn = card.querySelector('[data-edit="title"]');
    const bodyIn = card.querySelector('[data-edit="body"]');
    const eventRow = card.querySelector('[data-edit="eventRow"]');
    const startsIn = card.querySelector('[data-edit="starts_at"]');
    const endsIn = card.querySelector('[data-edit="ends_at"]');

    if (typeSel) typeSel.value = post.type || "general";
    if (topicSel) topicSel.value = post.topic || "everyday";
    if (titleIn) titleIn.value = post.title || "";
    if (bodyIn) bodyIn.value = post.body || "";

    if (startsIn) startsIn.value = toDatetimeLocalFromIso(post.starts_at);
    if (endsIn) endsIn.value = toDatetimeLocalFromIso(post.ends_at);

    // If user changes type, show/hide event inputs
    typeSel?.addEventListener("change", () => {
      const isEv = (typeSel.value || "general").toLowerCase() === "event";
      eventRow?.classList.toggle("d-none", !isEv);
      if (!isEv) {
        if (startsIn) startsIn.value = "";
        if (endsIn) endsIn.value = "";
      }
    });

    return;
  }

  if (action === "cancel") {
    // Just re-render list
    renderPosts(lastPosts);
    return;
  }

  if (action === "save") {
    const card = btn.closest(".card");
    if (!card) return;

    const msgEl = card.querySelector('[data-edit="msg"]');
    const typeVal =
      card.querySelector('[data-edit="type"]')?.value || "general";
    const topicVal =
      card.querySelector('[data-edit="topic"]')?.value || "everyday";
    const titleVal = (
      card.querySelector('[data-edit="title"]')?.value || ""
    ).trim();
    const bodyVal = (
      card.querySelector('[data-edit="body"]')?.value || ""
    ).trim();

    const isEvent = (typeVal || "general").toLowerCase() === "event";
    const startsIso = isEvent
      ? toIsoFromDatetimeLocal(
          card.querySelector('[data-edit="starts_at"]')?.value,
        )
      : null;
    const endsIso = isEvent
      ? toIsoFromDatetimeLocal(
          card.querySelector('[data-edit="ends_at"]')?.value,
        )
      : null;

    if (!ALLOWED_POST_TYPES.has(typeVal)) {
      if (msgEl) msgEl.textContent = "Invalid post type.";
      return;
    }
    if (!ALLOWED_TOPICS.has(topicVal)) {
      if (msgEl) msgEl.textContent = "Invalid topic.";
      return;
    }
    if (!titleVal) {
      if (msgEl) msgEl.textContent = "Title is required.";
      return;
    }
    if (isEvent && !startsIso) {
      if (msgEl) msgEl.textContent = "Events need a start date/time.";
      return;
    }
    if (
      isEvent &&
      endsIso &&
      startsIso &&
      new Date(endsIso) < new Date(startsIso)
    ) {
      if (msgEl) msgEl.textContent = "End time can’t be before start time.";
      return;
    }

    if (msgEl) msgEl.textContent = "Saving…";

    const { error } = await supabase
      .from("posts")
      .update({
        type: typeVal,
        topic: topicVal,
        title: titleVal,
        body: bodyVal || null,
        starts_at: startsIso,
        ends_at: endsIso,
      })
      .eq("id", postId)
      .eq("author_id", currentSession.user.id);

    if (error) {
      if (msgEl) msgEl.textContent = error.message;
      return;
    }

    await loadPosts();
    if (ghMode) await showNextSuggestion();
  }
});

const authStatusEl = document.getElementById("authStatus");
const loginLink = document.getElementById("loginLink");
const logoutBtn = document.getElementById("logoutBtn");

const createPostCard = document.getElementById("createPostCard");
const postForm = document.getElementById("postForm");
const postMsg = document.getElementById("postMsg");

// Event time UI
const eventTimeRow = document.getElementById("eventTimeRow");
const eventStartEl = document.getElementById("eventStart");
const eventEndEl = document.getElementById("eventEnd");

// Venue/location picker (Google Places Autocomplete)
const venueSearchEl = document.getElementById("venueSearch");
let selectedVenue = null;

// Map state (persist across loadPosts calls)
let map = null;
let markers = [];

const filterHint = document.getElementById("filterHint");
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

const followBtn = document.getElementById("followBtn");
const followLabel = document.getElementById("followLabel");
const followBadge = document.getElementById("followBadge");

// -------------------------
// GH-Mind "Take the wheel"
// -------------------------
const ghCard = document.getElementById("ghMindCard");
const ghHint = document.getElementById("ghHint");
const ghWrap = document.getElementById("ghSuggestionWrap");
const ghWhy = document.getElementById("ghWhy");
const ghTitle = document.getElementById("ghTitle");
const ghBody = document.getElementById("ghBody");
const ghMeta = document.getElementById("ghMeta");
const ghMsg = document.getElementById("ghMsg");

const ghYes = document.getElementById("ghYes");
const ghNo = document.getElementById("ghNo");
const ghSkip = document.getElementById("ghSkip");
const ghUp = document.getElementById("ghUp");
const ghDown = document.getElementById("ghDown");
const ghDistance = document.getElementById("ghDistance");
const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));

// Minimize / expand GH hero card
const ghCollapseEl = document.getElementById("ghCollapse");
const ghMinBtn = document.getElementById("ghMinBtn");

if (ghCollapseEl && ghMinBtn) {
  const setGhBtn = (isOpen) => {
    ghMinBtn.textContent = isOpen ? "Minimize" : "Expand";
    ghMinBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    ghMinBtn.title = isOpen ? "Minimize GH-Mind" : "Expand GH-Mind";
  };

  // Initial state
  setGhBtn(ghCollapseEl.classList.contains("show"));

  ghCollapseEl.addEventListener("shown.bs.collapse", () => setGhBtn(true));
  ghCollapseEl.addEventListener("hidden.bs.collapse", () => setGhBtn(false));
}

// -------------------------
// Create Post collapse (bulletproof toggle)
// -------------------------
const createToggleBtn = document.getElementById("createToggleBtn");
const createCollapse = document.getElementById("createCollapse");

if (createToggleBtn && createCollapse && window.bootstrap?.Collapse) {
  const inst = window.bootstrap.Collapse.getOrCreateInstance(createCollapse, {
    toggle: false,
  });

  createToggleBtn.addEventListener("click", (e) => {
    e.preventDefault();
    inst.toggle();
  });
} else if (createToggleBtn && createCollapse) {
  console.warn(
    "Create collapse: Bootstrap Collapse not found. Is bootstrap.bundle loaded?",
  );
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371e3; // meters
  const toRad = (x) => (x * Math.PI) / 180;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const dφ = toRad(lat2 - lat1);
  const dλ = toRad(lng2 - lng1);

  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function attachDistances(posts, coords) {
  if (!coords) return posts;
  return (posts || []).map((p) => {
    if (p?.lat == null || p?.lng == null) return p;
    const m = haversineMeters(
      coords.lat,
      coords.lng,
      Number(p.lat),
      Number(p.lng),
    );
    return { ...p, distance_m: Math.round(m) };
  });
}

// Persist GH distance band
const GH_DISTANCE_KEY = "wtd_gh_distance_pref";

const postSearchEl = document.getElementById("postSearch");
document
  .getElementById("browseCollapse")
  ?.addEventListener("shown.bs.collapse", () => postSearchEl?.focus());

let currentSearch = "";

let currentSession = null;
let currentFilter = "all";
let lastPosts = [];
let isFollowing = false;

let ghMode = null; // 'bored' | 'hungry' | 'idk'
let ghCurrent = null; // current suggestion post record
let ghShownIds = new Set(); // local anti-repeat
let ghLastTopic = null;
let ghTagPrefs = new Map(); // tag -> weight (learned)
let ghTagPrefsLoadedForUser = null; // user id we loaded prefs for

if (ghDistance) {
  ghDistance.value = localStorage.getItem(GH_DISTANCE_KEY) || "near";
  ghDistance.addEventListener("change", async () => {
    localStorage.setItem(GH_DISTANCE_KEY, ghDistance.value);
    await loadPosts();
    if (ghMode) await showNextSuggestion();
  });
}

function setLocHint(msg = "") {
  if (locHint) locHint.textContent = msg;
}

function clearGeoCache() {
  try {
    localStorage.removeItem(GEO_CACHE_KEY);
  } catch {}
}

async function canUseGeoNow() {
  // Optional: permissions API (not supported everywhere)
  try {
    if (!navigator.permissions) return null;
    const p = await navigator.permissions.query({ name: "geolocation" });
    return p.state; // "granted" | "prompt" | "denied"
  } catch {
    return null;
  }
}

(async function wireVenueAutocomplete() {
  if (!venueSearchEl) return;

  try {
    await window.WTDLoadGoogleMaps();

    const ac = new google.maps.places.Autocomplete(venueSearchEl, {
      // allow places + addresses
      types: ["establishment", "geocode"],
      fields: ["name", "formatted_address", "geometry", "place_id"],
    });

    ac.addListener("place_changed", () => {
      const p = ac.getPlace();
      if (!p?.geometry?.location) {
        selectedVenue = null;
        return;
      }

      selectedVenue = {
        place_id: p.place_id || null,
        name: p.name || null,
        address_text: p.formatted_address || venueSearchEl.value || null,
        lat: p.geometry.location.lat(),
        lng: p.geometry.location.lng(),
      };
    });
  } catch (e) {
    console.log("Venue autocomplete not available:", e);
  }
})();

// -------------------------
// GEOLOCATION (device)
// -------------------------
const GEO_CACHE_KEY = "wtd_geo_cache_v1"; // {lat,lng,ts}
const GEO_TTL_MS = 5 * 60 * 1000; // 5 minutes

function milesToMeters(mi) {
  return Math.round(mi * 1609.34);
}

function radiusMetersForBand(band) {
  // Tune these later if you want
  if (band === "near") return milesToMeters(3);
  if (band === "medium") return milesToMeters(10);
  if (band === "far") return milesToMeters(25);
  return null; // "any"
}

function fmtMilesFromMeters(m) {
  if (m == null || Number.isNaN(Number(m))) return "";
  const mi = Number(m) / 1609.34;
  if (mi < 1) return `${mi.toFixed(1)} mi`;
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${mi.toFixed(0)} mi`;
}

function readGeoCache() {
  try {
    const raw = localStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const x = JSON.parse(raw);
    if (!x?.lat || !x?.lng || !x?.ts) return null;
    if (Date.now() - x.ts > GEO_TTL_MS) return null;
    return { lat: x.lat, lng: x.lng };
  } catch {
    return null;
  }
}

function writeGeoCache(lat, lng) {
  try {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify({ lat, lng, ts: Date.now() }),
    );
  } catch {}
}

async function getDeviceCoords() {
  // return cached if fresh
  const cached = readGeoCache();
  if (cached) return cached;

  return await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        writeGeoCache(lat, lng);
        resolve({ lat, lng });
      },
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 300000 },
    );
  });
}

function timeBucket(d = new Date()) {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "late";
}

function modeLabel(m) {
  if (m === "bored") return "bored";
  if (m === "hungry") return "hungry";
  return "unsure";
}

function formatEventRange(starts_at, ends_at) {
  if (!starts_at) return "";
  const start = new Date(starts_at);
  if (isNaN(start.getTime())) return "";

  const dateFmt = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const startDate = dateFmt.format(start);
  const startTime = timeFmt.format(start);

  if (!ends_at) {
    return `${startDate} · ${startTime}`;
  }

  const end = new Date(ends_at);
  if (isNaN(end.getTime())) {
    return `${startDate} · ${startTime}`;
  }

  const endDate = dateFmt.format(end);
  const endTime = timeFmt.format(end);

  // Same day: "Fri, Jun 19 · 7:00 PM – 9:00 PM"
  if (start.toDateString() === end.toDateString()) {
    return `${startDate} · ${startTime} – ${endTime}`;
  }

  // Different days: "Fri, Jun 19 · 7:00 PM → Sat, Jun 20 · 12:30 AM"
  return `${startDate} · ${startTime} → ${endDate} · ${endTime}`;
}

function toIsoFromDatetimeLocal(v) {
  // v like "2026-06-19T19:00" (no timezone)
  // JS treats it as local time, then toISOString() converts to UTC
  if (!v || !String(v).trim()) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function setEventTimeUi(typeValue) {
  const t = (typeValue || "general").toLowerCase();
  const isEvent = t === "event";
  if (eventTimeRow) eventTimeRow.classList.toggle("d-none", !isEvent);

  // If switching away from event, clear values to avoid accidental inserts later
  if (!isEvent) {
    if (eventStartEl) eventStartEl.value = "";
    if (eventEndEl) eventEndEl.value = "";
  }
}

function setGhButtonsActive(mode) {
  modeButtons.forEach((b) => {
    if (b.dataset.mode === mode) b.classList.add("active");
    else b.classList.remove("active");
  });
}

function renderGhEmpty() {
  // Primary "widget" state before a mode is chosen.
  // No suggestion shown until user taps a vibe.
  if (ghWrap) ghWrap.classList.remove("d-none");
  if (ghWhy) ghWhy.textContent = "";
  if (ghTitle) ghTitle.textContent = "What do you want to do?";
  if (ghBody)
    ghBody.textContent =
      "Tap I’m bored, I’m hungry, or I don’t know — and I’ll pick something.";
  if (ghMeta) ghMeta.textContent = "";
  if (ghMsg) ghMsg.textContent = "";
  if (ghLinks) ghLinks.innerHTML = "";
  if (ghHint) ghHint.textContent = "Pick a vibe to get a suggestion.";
  disableGhActions(true);
  ghCurrent = null;
}

function disableGhActions(disabled) {
  [ghYes, ghNo, ghSkip, ghUp, ghDown].forEach((b) => {
    if (b) b.disabled = !!disabled;
  });
}

async function logSuggestion(action, suggestion) {
  // Only learn when logged in (keeps it non-invasive)
  if (!currentSession) return;

  const payload = {
    user_id: currentSession.user.id,
    place_id: placeId,
    mode: ghMode || "idk",
    suggestion_type: "post",
    suggestion_id: suggestion?.id || null,
    action,
    distance_band: ghDistance?.value || null,
    time_bucket: timeBucket(),
  };

  await supabase.from("suggestion_events").insert(payload);
}

async function loadGhTagPrefs() {
  ghTagPrefs = new Map();
  ghTagPrefsLoadedForUser = null;

  if (!currentSession) return;
  if (!placeId) return;

  ghTagPrefsLoadedForUser = currentSession.user.id;

  const { data, error } = await supabase.rpc("wtd_user_tag_affinity", {
    p_user_id: currentSession.user.id,
    p_place_id: placeId,
  });

  if (error) {
    console.log("GH tag prefs RPC error:", error);
    ghTagPrefs = new Map();
    return;
  }

  (data || []).forEach((row) => {
    if (!row?.tag) return;
    ghTagPrefs.set(String(row.tag), Number(row.weight) || 0);
  });
}

function matchesMode(post, mode) {
  const t = (post.type || "general").toLowerCase();
  const topic = (post.topic || "").toLowerCase();

  const text = `${post.title || ""} ${post.body || ""}`.toLowerCase();
  const tags = Array.isArray(post.tags)
    ? post.tags.map((x) => String(x).toLowerCase())
    : [];

  // keyword fallback if topic missing
  const foodWords = [
    "eat",
    "food",
    "restaurant",
    "pizza",
    "taco",
    "coffee",
    "brunch",
    "dinner",
    "lunch",
    "breakfast",
    "bar",
    "pub",
    "sushi",
    "bbq",
    "burger",
  ];

  if (mode === "hungry") {
    if (topic) return topic === "food_drink" || topic === "nightlife";
    if (tags.includes("food")) return true;
    return foodWords.some((w) => text.includes(w));
  }

  if (mode === "bored") {
    if (topic)
      return [
        "events",
        "outdoors",
        "attractions",
        "everyday",
        "history",
        "legends",
        "nightlife",
      ].includes(topic);
    if (
      tags.includes("music") ||
      tags.includes("comedy") ||
      tags.includes("outdoors")
    )
      return true;
    return t === "event" || t === "general" || t === "advice";
  }

  return true; // idk
}

function ghPersonalScore(p) {
  // base score (from v_post_scores)
  let s = Number(p.score ?? 0) || 0;
  // add preference weights for tags (small bias)
  const tags = Array.isArray(p.tags) ? p.tags : [];
  for (const tag of tags) {
    const w = ghTagPrefs.get(String(tag)) || 0;
    s += w;
  }
  return s;
}

function pickNextSuggestion(posts) {
  let candidates = (posts || [])
    .filter((p) => p?.id)
    .filter((p) => matchesMode(p, ghMode))
    .filter((p) => !ghShownIds.has(p.id));

  // ✅ If "idk", avoid showing the same topic twice in a row
  if (ghMode === "idk" && ghLastTopic) {
    const alt = candidates.filter(
      (p) => (p.topic || "everyday") !== ghLastTopic,
    );
    if (alt.length) candidates = alt;
  }

  if (!candidates.length) return null;

  const sorted = candidates.sort(
    (a, b) => ghPersonalScore(b) - ghPersonalScore(a),
  );
  const top = sorted.slice(0, Math.min(8, sorted.length));
  return top[Math.floor(Math.random() * top.length)];
}

async function showNextSuggestion() {
  if (ghMsg) ghMsg.textContent = "";
  if (!ghMode) {
    renderGhEmpty();
    return;
  }

  // Ensure we have posts loaded
  if (!lastPosts?.length) {
    await loadPosts();
  }

  const next = pickNextSuggestion(lastPosts);

  if (!next) {
    ghWrap?.classList.add("d-none");
    ghHint.textContent =
      "No more suggestions yet — add more posts or switch mode.";
    ghCurrent = null;
    if (ghLinks) ghLinks.innerHTML = "";
    return;
  }

  ghCurrent = next;
  ghShownIds.add(next.id);
  ghLastTopic = next.topic || "everyday";

  ghWrap?.classList.remove("d-none");
  ghWhy.textContent = `Because you said you’re ${modeLabel(ghMode)} · ${timeBucket()}`;
  ghTitle.textContent = next.title || "(Untitled)";
  ghBody.textContent = next.body || "";

  // Optional: show distance in the GH widget if present
  const distText =
    next.distance_m != null ? fmtMilesFromMeters(next.distance_m) : "";
  const distPart = distText ? ` · ${distText} away` : "";

  const tagText =
    Array.isArray(next.tags) && next.tags.length
      ? ` · Tags: ${next.tags.join(", ")}`
      : "";
  ghMeta.textContent = `Score: ${next.score ?? 0}${distPart}${tagText}`;

  // ✅ Add “Map it” to suggestions (only when we have coords/address)
  if (ghLinks) {
    const url = buildMapsUrl(next);
    ghLinks.innerHTML = url
      ? `<a class="btn btn-sm wtd-actionbtn" href="${url}" target="_blank" rel="noopener">Map it</a>`
      : "";
  }

  ghHint.textContent = currentSession
    ? "Learning from your Yes/No."
    : "Log in to personalize suggestions.";

  disableGhActions(false);

  // log "shown" (only if logged in)
  await logSuggestion("shown", next);
}

(async () => {
  if (!placeId) {
    placeNameEl.textContent = "Place not found";
    postsEl.innerHTML = `<div class="alert alert-warning mt-3">Missing place id.</div>`;
    return;
  }

  // Shared auth controller updates header + gives us session changes.
  currentSession = await WTDAuth.init({
    onChange: async (session) => {
      currentSession = session;
      if (session) createPostCard?.classList.remove("d-none");
      else createPostCard?.classList.add("d-none");

      await refreshFollowUI();
      await loadGhTagPrefs();
      await loadPosts();

      // ✅ refresh map pins after login/logout (only if map is open/visible)
      maybeRenderMap();

      // If user already picked a mode, refresh the next suggestion after posts load
      if (ghMode) await showNextSuggestion();
      else renderGhEmpty();
    },
  });

  // Init toggle state
  if (useLocToggle) {
    useLocToggle.checked = localStorage.getItem(USE_LOC_KEY) === "on";

    setLocHint(useLocToggle.checked ? "Distance on." : "Distance off.");

    useLocToggle.addEventListener("change", async () => {
      if (useLocToggle.checked) {
        // Turn ON: request coords (will prompt if needed)
        const state = await canUseGeoNow();
        if (state === "denied") {
          setLocHint("Location is blocked. Enable it in site settings.");
          useLocToggle.checked = false;
          localStorage.setItem(USE_LOC_KEY, "off");
          clearGeoCache();
          // Force Any so distance UI doesn’t lie
          if (ghDistance) ghDistance.value = "any";
          localStorage.setItem(GH_DISTANCE_KEY, "any");
          await loadPosts();
          return;
        }

        const coords = await getDeviceCoords();
        if (!coords) {
          setLocHint("Allow location to show distance.");
          // leave toggle on (prompt might still be pending), but fallback to Any
          if (ghDistance) ghDistance.value = "any";
          localStorage.setItem(GH_DISTANCE_KEY, "any");
        } else {
          setLocHint("Showing distance from you.");
        }

        localStorage.setItem(USE_LOC_KEY, "on");
        await loadPosts();
        if (ghMode) await showNextSuggestion();
      } else {
        // Turn OFF: stop using location
        localStorage.setItem(USE_LOC_KEY, "off");
        clearGeoCache();
        setLocHint("Distance off.");

        // Hide distance by removing computed values
        lastPosts = (lastPosts || []).map((p) => ({ ...p, distance_m: null }));
        renderPosts(lastPosts);

        // Force Any so we don’t call wtd_posts_near
        if (ghDistance) ghDistance.value = "any";
        localStorage.setItem(GH_DISTANCE_KEY, "any");

        await loadPosts();
        if (ghMode) await showNextSuggestion();
      }
    });
  }

  // GH should look "ready" on first paint even before user taps a mode
  renderGhEmpty();

  // Filters
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderPosts(lastPosts);
    });
  });

  // Search (title/body/tags) inside Browse Posts
  postSearchEl?.addEventListener("input", () => {
    currentSearch = (postSearchEl.value || "").trim().toLowerCase();
    renderPosts(lastPosts);
  });

  // Load place name
  const { data: place, error: placeErr } = await supabase
    .from("places")
    .select("name")
    .eq("id", placeId)
    .single();

  if (placeErr || !place) {
    if (placeNameEl) placeNameEl.textContent = "Place not found";
    postsEl.innerHTML = `<div class="alert alert-warning mt-3">That place doesn't exist (or you don't have access).</div>`;
    return;
  }

  if (placeNameEl) placeNameEl.textContent = place.name;

  // Show/hide event time fields based on type select
  const typeSelect = document.getElementById("type");
  if (typeSelect) {
    setEventTimeUi(typeSelect.value);
    typeSelect.addEventListener("change", () =>
      setEventTimeUi(typeSelect.value),
    );
  }

  // Follow button click
  followBtn?.addEventListener("click", async () => {
    if (!currentSession) {
      window.location.href = "login.html";
      return;
    }

    followBtn.disabled = true;

    if (!isFollowing) {
      const { error } = await supabase.from("follows").insert({
        user_id: currentSession.user.id,
        place_id: placeId,
      });

      if (error) alert(error.message);
    } else {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("user_id", currentSession.user.id)
        .eq("place_id", placeId);

      if (error) alert(error.message);
    }

    await refreshFollowUI();
    followBtn.disabled = false;
  });

  // Create post
  postForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    postMsg.textContent = "";

    if (!currentSession) {
      postMsg.textContent = "Please log in first.";
      return;
    }

    const rawType = document.getElementById("type")?.value;
    const type = rawType && rawType.trim() ? rawType : "general";
    const title = document.getElementById("title").value.trim();
    const body = document.getElementById("body").value.trim();
    const rawTopic = document.getElementById("topic")?.value;
    const topic = rawTopic && rawTopic.trim() ? rawTopic : "everyday";

    const isEvent = (type || "general").toLowerCase() === "event";
    const starts_at = isEvent
      ? toIsoFromDatetimeLocal(eventStartEl?.value)
      : null;
    const ends_at = isEvent ? toIsoFromDatetimeLocal(eventEndEl?.value) : null;

    if (isEvent && !starts_at) {
      postMsg.textContent = "Events need a start date/time.";
      return;
    }
    if (
      isEvent &&
      ends_at &&
      starts_at &&
      new Date(ends_at) < new Date(starts_at)
    ) {
      postMsg.textContent = "End time can’t be before start time.";
      return;
    }

    // Guardrails: prevent invalid enum/check values from ever being sent
    if (!ALLOWED_POST_TYPES.has(type)) {
      postMsg.textContent = "Invalid post type.";
      return;
    }
    if (!ALLOWED_TOPICS.has(topic)) {
      postMsg.textContent = "Invalid topic.";
      return;
    }

    if (!title) {
      postMsg.textContent = "Title is required.";
      return;
    }

    if (!selectedVenue?.lat || !selectedVenue?.lng) {
      postMsg.textContent = "Please pick a location from the dropdown.";
      return;
    }

    const { data, error } = await supabase.rpc("wtd_create_post", {
      p_place_id: placeId,
      p_type: type,
      p_topic: topic,
      p_title: title,
      p_body: body || null,
      p_starts_at: starts_at || null,
      p_ends_at: ends_at || null,

      p_venue_name: selectedVenue.name,
      p_address_text: selectedVenue.address_text,
      p_lat: selectedVenue.lat,
      p_lng: selectedVenue.lng,
    });

    if (error) {
      postMsg.textContent = error.message;
      return;
    }

    selectedVenue = null;
    if (venueSearchEl) venueSearchEl.value = "";

    // Reset form state
    const typeEl = document.getElementById("type");
    const topicEl = document.getElementById("topic");
    if (typeEl) typeEl.value = "general";
    if (topicEl) topicEl.value = "everyday";
    document.getElementById("title").value = "";
    document.getElementById("body").value = "";
    postMsg.textContent = "Posted.";

    // Clear event fields
    if (eventStartEl) eventStartEl.value = "";
    if (eventEndEl) eventEndEl.value = "";
    setEventTimeUi(document.getElementById("type")?.value);

    await loadPosts();

    if (ghMode) await showNextSuggestion();
  });

  // Initial load
  await refreshFollowUI();
  await loadPosts();
})();

async function refreshFollowUI() {
  // --- follower count badge ---
  let followerCount = 0;

  {
    const { data, error: countErr } = await supabase.rpc(
      "wtd_place_follower_count",
      { p_place_id: placeId },
    );
    followerCount = countErr ? 0 : Number(data || 0);
  }

  if (followBadge) {
    if (followerCount > 0) {
      followBadge.textContent = formatCount(followerCount);
      followBadge.classList.remove("d-none");
    } else {
      followBadge.classList.add("d-none");
    }
  }

  // --- follow button + state ---
  if (!followBtn) return;

  followBtn.classList.remove("d-none");

  if (!currentSession) {
    isFollowing = false;

    if (followLabel) followLabel.textContent = "Follow";

    // keep position-relative, only swap style classes
    followBtn.classList.remove("btn-dark");
    followBtn.classList.add(
      "btn",
      "btn-sm",
      "btn-outline-dark",
      "position-relative",
    );
    return;
  }

  const { data, error } = await supabase
    .from("follows")
    .select("place_id")
    .eq("user_id", currentSession.user.id)
    .eq("place_id", placeId)
    .maybeSingle();

  isFollowing = !error && !!data;

  if (followLabel)
    followLabel.textContent = isFollowing ? "Following" : "Follow";

  followBtn.classList.add("btn", "btn-sm", "position-relative");
  followBtn.classList.toggle("btn-dark", isFollowing);
  followBtn.classList.toggle("btn-outline-dark", !isFollowing);
}

async function loadPosts() {
  postsEl.innerHTML = `<div class="text-muted">Loading…</div>`;

  const useLoc = localStorage.getItem(USE_LOC_KEY) !== "off";

  const band = ghDistance?.value || "near";
  const radius = useLoc ? radiusMetersForBand(band) : null;

  let data, error;

  // If user selects Any, don't use geo — just load all (existing behavior)
  if (!radius) {
    const resp = await supabase
      .from("v_post_scores")
      .select(
        "id, place_id, author_id, type, topic, title, body, tags, score, starts_at, ends_at, venue_name, address_text, lat, lng",
      )
      .eq("place_id", placeId)
      .order("score", { ascending: false });

    data = resp.data;
    error = resp.error;
  } else {
    // Ask for device location (cached)
    const coords = await getDeviceCoords();

    if (!coords) {
      // Permission denied / unavailable → fallback to normal list
      const resp = await supabase
        .from("v_post_scores")
        .select(
          "id, place_id, author_id, type, topic, title, body, tags, score, starts_at, ends_at, venue_name, address_text, lat, lng",
        )
        .eq("place_id", placeId)
        .order("score", { ascending: false });

      data = resp.data;
      error = resp.error;

      // Optional: hint (non-blocking)
      if (ghHint) {
        ghHint.textContent =
          "Enable location to filter by distance (or set Distance to Any).";
      }
    } else {
      // Use RPC: only posts with coords within radius
      const resp = await supabase.rpc("wtd_posts_near", {
        p_place_id: placeId,
        p_lat: coords.lat,
        p_lng: coords.lng,
        p_radius_m: radius,
        p_limit: 200,
      });

      data = resp.data;
      error = resp.error;

      if (ghHint) {
        ghHint.textContent = currentSession
          ? "Learning from your Yes/No."
          : "Log in to personalize suggestions.";
      }
    }
  }

  if (error) {
    console.log("LOAD POSTS ERROR:", error);
    postsEl.innerHTML = `<div class="alert alert-danger">Could not load posts: ${escapeHtml(
      error.message,
    )}</div>`;
    return;
  }

  lastPosts = data || [];

  if (useLoc) {
    const coords = await getDeviceCoords();
    lastPosts = attachDistances(lastPosts, coords);
  } else {
    lastPosts = (lastPosts || []).map((p) => ({ ...p, distance_m: null }));
  }

  // Hide expired events (works for both normal list + nearby RPC)
  const now = new Date();
  lastPosts = lastPosts.filter((p) => {
    if ((p.type || "general") !== "event") return true;

    if (p.ends_at) return new Date(p.ends_at) >= now;

    if (p.starts_at) {
      const start = new Date(p.starts_at);
      const endGuess = new Date(start.getTime() + 4 * 60 * 60 * 1000);
      return endGuess >= now;
    }

    return true;
  });

  renderPosts(lastPosts);
  // Map should NOT re-render unless the map panel is actually open/visible.
  maybeRenderMap();
}

function maybeRenderMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  // If map is inside a Bootstrap collapse, only render when it's open.
  const collapse = mapEl.closest(".collapse");
  if (collapse && !collapse.classList.contains("show")) return;

  // If map is not visible in layout (display:none), skip.
  if (mapEl.offsetParent === null) return;

  renderMapFromPosts(); // render when opened
}

// Map renderer (global so it persists and can be called after every loadPosts)
async function renderMapFromPosts() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return; // map panel not on this page

  try {
    await window.WTDLoadGoogleMaps();
  } catch {
    mapEl.innerHTML = `<div class="text-muted small">Map unavailable.</div>`;
    return;
  }

  // ✅ Prefer: last 5 posts you reacted positively to (Yes/Upvote/Like)
  // If not logged in or none found, fallback to lastPosts (normal behavior).
  const preferred = await fetchRecentPositivePosts(5);
  const source = preferred && preferred.length ? preferred : [];

  const pts = source
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => ({ p, pos: { lat: Number(p.lat), lng: Number(p.lng) } }));

  if (!pts.length) {
    mapEl.innerHTML = currentSession
      ? `<div class="text-muted small">No positive-reaction locations yet. Like (👍) a few posts and reopen the map.</div>`
      : `<div class="text-muted small">Log in and react 👍 to show your last 5 liked locations here.</div>`;
    return;
  }

  // Init map once
  if (!map) {
    map = new google.maps.Map(mapEl, {
      center: pts[0].pos,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
    });
  }

  // Clear old markers
  markers.forEach((m) => m.setMap(null));
  markers = [];

  const bounds = new google.maps.LatLngBounds();

  pts.forEach(({ p, pos }, idx) => {
    const m = new google.maps.Marker({
      position: pos,
      map,
      label: String(idx + 1),
    });
    m.addListener("click", () => {
      const txt = `${p.title || ""}\n${p.venue_name || ""}\n${p.address_text || ""}`;
      alert(txt.trim());
    });
    markers.push(m);
    bounds.extend(pos);
  });

  map.fitBounds(bounds);
}

// OPTIONAL (recommended):
// If your map is inside a Bootstrap collapse, render only when opened.
// Add id="mapCollapse" to the collapse div in place.html if you want this.
document
  .getElementById("mapCollapse")
  ?.addEventListener("shown.bs.collapse", () => {
    renderMapFromPosts();
  });

function renderPosts(posts) {
  const q = (currentSearch || "").trim().toLowerCase();

  const base = (posts || []).filter((p) => {
    if (currentFilter === "all") return true;
    return (p.type || "general") === currentFilter;
  });

  // Apply search across title/body/tags
  const list = !q
    ? base
    : base.filter((p) => {
        const title = String(p.title || "").toLowerCase();
        const body = String(p.body || "").toLowerCase();
        const tags = Array.isArray(p.tags)
          ? p.tags.map((x) => String(x).toLowerCase()).join(" ")
          : "";
        return title.includes(q) || body.includes(q) || tags.includes(q);
      });

  if (filterHint) {
    const total = (posts || []).length;
    const baseCount = base.length;
    const shown = list.length;
    const parts = [];
    if (currentFilter === "all") parts.push(`${total} total`);
    else parts.push(`${baseCount} in filter`);
    if (q) parts.push(`${shown} match${shown === 1 ? "" : "es"} search`);
    else parts.push(`${shown} shown`);
    filterHint.textContent = parts.join(" · ");
  }

  if (!list.length) {
    postsEl.innerHTML = `
      <div class="wtd-empty sheet p-3">
        <div class="fw-semibold mb-1">${q ? "No posts match your search." : "No posts for this filter yet."}</div>
        <div class="text-muted small">Try a different filter, or create the first post for this place.</div>
      </div>
    `;
    return;
  }

  postsEl.innerHTML = "";
  list.forEach((p) => {
    const div = document.createElement("div");
    div.className = "card sheet post-card mb-3";

    const isEvent = (p.type || "general").toLowerCase() === "event";
    const whenText = isEvent ? formatEventRange(p.starts_at, p.ends_at) : "";
    const whenHtml = whenText
      ? `<div class="text-muted small mb-2">📅 ${escapeHtml(whenText)}</div>`
      : "";

    // NEW: distance line if RPC returned distance_m
    const distText =
      p.distance_m != null ? fmtMilesFromMeters(p.distance_m) : "";
    const distHtml = distText
      ? `<div class="text-muted small mb-2">📍 ${escapeHtml(distText)} away</div>`
      : "";

    div.innerHTML = `
      <div class="card-body post-body">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="mb-2 d-flex flex-wrap gap-2 align-items-center">
              ${typeBadge(p.type)}
              ${topicBadge(p.topic)}
            </div>
            <div class="post-title mb-2">${escapeHtml(p.title || "(Untitled)")}</div>
            ${whenHtml}
            ${distHtml}
          </div>
          <span class="post-score text-muted small">Score: ${p.score ?? 0}</span>
        </div>

        <div class="post-text mb-3">${escapeHtml(p.body || "")}</div>

<div class="d-flex flex-wrap gap-2 align-items-center">
  <button class="btn btn-sm wtd-iconbtn" onclick="vote('${p.id}', 1)">👍</button>
  <button class="btn btn-sm wtd-iconbtn" onclick="vote('${p.id}', -1)">👎</button>

  ${
    p.lat != null && p.lng != null
      ? `<a class="btn btn-sm wtd-actionbtn" href="${buildMapsUrl(p)}" target="_blank" rel="noopener">Map it</a>`
      : ``
  }

  ${
    isOwner(p)
      ? `
        <div class="ms-auto d-flex gap-2">
          <button class="btn btn-sm wtd-actionbtn" data-action="edit" data-id="${p.id}">Edit</button>
          <button class="btn btn-sm wtd-dangerbtn" data-action="delete" data-id="${p.id}">Delete</button>
        </div>
      `
      : `<div class="ms-auto"></div>`
  }
</div>

    `;

    postsEl.appendChild(div);
  });
}

function topicBadge(topic) {
  const t = (topic || "everyday").toLowerCase();
  const map = {
    food_drink: { label: "Food & Drink" },
    outdoors: { label: "Outdoors" },
    history: { label: "History" },
    events: { label: "Entertainment" },
    attractions: { label: "Attractions" },
    nightlife: { label: "Nightlife" },
    legends: { label: "Legends & Lore" },
    everyday: { label: "Everyday" },
  };
  const x = map[t] || map.everyday;
  return `<span class="wtd-badge wtd-topic-${t}">${escapeHtml(x.label)}</span>`;
}

function typeBadge(type) {
  const t = (type || "general").toLowerCase();
  const map = {
    alert: { label: "Alert" },
    advice: { label: "Advice" },
    event: { label: "Event" },
    general: { label: "General" },
  };
  const x = map[t] || map.general;
  return `<span class="wtd-badge wtd-type-${t}">${escapeHtml(x.label)}</span>`;
}

async function vote(postId, value) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    alert("Please log in to vote.");
    window.location.href = "login.html";
    return;
  }

  const { error } = await supabase
    .from("votes")
    .upsert(
      { post_id: postId, user_id: session.user.id, value },
      { onConflict: "user_id,post_id" },
    );

  if (error) {
    alert(error.message);
    return;
  }

  await loadPosts();
}

// GH-Mind sanity check
if (modeButtons.length === 0) {
  console.warn(
    "GH-Mind: no [data-mode] buttons found. Did you add the GH-Mind HTML to place.html?",
  );
}

// GH-Mind mode selection
modeButtons.forEach((btn) => {
  btn.addEventListener("click", async () => {
    ghMode = btn.dataset.mode;
    setGhButtonsActive(ghMode);
    ghShownIds = new Set(); // reset per mode (simple v1)
    ghLastTopic = null;
    await showNextSuggestion();
  });
});

// Yes / No / Skip
ghYes?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  disableGhActions(true);
  await logSuggestion("yes", ghCurrent);
  // Update prefs so next picks adapt immediately
  await loadGhTagPrefs();
  await showNextSuggestion();
});

ghNo?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  disableGhActions(true);
  await logSuggestion("no", ghCurrent);
  await loadGhTagPrefs();
  await showNextSuggestion();
});

ghSkip?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  disableGhActions(true);
  await logSuggestion("skip", ghCurrent);
  await showNextSuggestion();
});

// Hook thumbs to your existing vote() (and log)
ghUp?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  ghShownIds.add(ghCurrent.id);
  await logSuggestion("upvote", ghCurrent);
  await vote(ghCurrent.id, 1);
  await loadGhTagPrefs();
  // ✅ add this
  await showNextSuggestion();
});

ghDown?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  ghShownIds.add(ghCurrent.id);
  await logSuggestion("downvote", ghCurrent);
  await vote(ghCurrent.id, -1);
  await loadGhTagPrefs();
  // ✅ add this
  await showNextSuggestion();
});
