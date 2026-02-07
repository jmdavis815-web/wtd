// js/place.js

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

const params = new URLSearchParams(window.location.search);
const placeId = params.get("id");

const placeNameEl = document.getElementById("placeName");
const postsEl = document.getElementById("posts");

const authStatusEl = document.getElementById("authStatus");
const loginLink = document.getElementById("loginLink");
const logoutBtn = document.getElementById("logoutBtn");

const createPostCard = document.getElementById("createPostCard");
const postForm = document.getElementById("postForm");
const postMsg = document.getElementById("postMsg");

const filterHint = document.getElementById("filterHint");
const filterButtons = Array.from(document.querySelectorAll("[data-filter]"));

const followBtn = document.getElementById("followBtn");
const followCountEl = document.getElementById("followCount");

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

let currentSession = null;
let currentFilter = "all";
let lastPosts = [];
let isFollowing = false;

let ghMode = null; // 'bored' | 'hungry' | 'idk'
let ghCurrent = null; // current suggestion post record
let ghShownIds = new Set(); // local anti-repeat
let ghLastTopic = null;

const GH_DISTANCE_KEY = "wtd_gh_distance_pref";
if (ghDistance) {
  ghDistance.value = localStorage.getItem(GH_DISTANCE_KEY) || "near";
  ghDistance.addEventListener("change", () => {
    localStorage.setItem(GH_DISTANCE_KEY, ghDistance.value);
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

function setGhButtonsActive(mode) {
  modeButtons.forEach((b) => {
    if (b.dataset.mode === mode) b.classList.add("active");
    else b.classList.remove("active");
  });
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

function matchesMode(post, mode) {
  const t = (post.type || "general").toLowerCase();
  const topic = (post.topic || "").toLowerCase();

  const text = `${post.title || ""} ${post.body || ""}`.toLowerCase();

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
    return t === "event" || t === "general" || t === "advice";
  }

  return true; // idk
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

  const sorted = candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const top = sorted.slice(0, Math.min(8, sorted.length));
  return top[Math.floor(Math.random() * top.length)];
}

async function showNextSuggestion() {
  ghMsg.textContent = "";
  if (!ghMode) return;

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
    return;
  }

  ghCurrent = next;
  ghShownIds.add(next.id);
  ghLastTopic = next.topic || "everyday";

  ghWrap?.classList.remove("d-none");
  ghWhy.textContent = `Because you said you’re ${modeLabel(ghMode)} · ${timeBucket()}`;
  ghTitle.textContent = next.title || "(Untitled)";
  ghBody.textContent = next.body || "";
  ghMeta.textContent = `Score: ${next.score ?? 0}`;

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
      await loadPosts();

      // If user already picked a mode, refresh the next suggestion after posts load
      if (ghMode) await showNextSuggestion();
    },
  });

  // Filters
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderPosts(lastPosts);
    });
  });

  // Load place name
  const { data: place, error: placeErr } = await supabase
    .from("places")
    .select("name")
    .eq("id", placeId)
    .single();

  if (placeErr || !place) {
    placeNameEl.textContent = "Place not found";
    postsEl.innerHTML = `<div class="alert alert-warning mt-3">That place doesn't exist (or you don't have access).</div>`;
    return;
  }

  placeNameEl.textContent = place.name;

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

    const { error } = await supabase.from("posts").insert({
      place_id: placeId,
      type,
      topic,
      title,
      body: body || null,
      author_id: currentSession.user.id,
    });

    if (error) {
      postMsg.textContent = error.message;
      return;
    }

    // Reset form state
    const typeEl = document.getElementById("type");
    const topicEl = document.getElementById("topic");
    if (typeEl) typeEl.value = "general";
    if (topicEl) topicEl.value = "everyday";
    document.getElementById("title").value = "";
    document.getElementById("body").value = "";
    postMsg.textContent = "Posted.";

    await loadPosts();

    if (ghMode) await showNextSuggestion();
  });

  // Initial load
  await refreshFollowUI();
  await loadPosts();
})();

async function refreshFollowUI() {
  // follower count (public aggregate)
  const { count, error: countErr } = await supabase
    .from("follows")
    .select("*", { count: "exact", head: true })
    .eq("place_id", placeId);

  if (!countErr && followCountEl) {
    followCountEl.textContent = `${count ?? 0} follower${(count ?? 0) === 1 ? "" : "s"}`;
  }

  // following status (only if logged in)
  if (!followBtn) return;

  if (!currentSession) {
    isFollowing = false;
    followBtn.classList.remove("d-none");
    followBtn.textContent = "Follow";
    followBtn.className = "btn btn-sm btn-outline-dark";
    return;
  }

  // ✅ check if THIS user follows THIS place
  const { data, error } = await supabase
    .from("follows")
    .select("place_id")
    .eq("user_id", currentSession.user.id)
    .eq("place_id", placeId)
    .maybeSingle();

  if (error) {
    console.log("FOLLOW STATUS ERROR:", error);
    isFollowing = false;
  } else {
    isFollowing = !!data;
  }

  followBtn.classList.remove("d-none");
  followBtn.textContent = isFollowing ? "Following" : "Follow";
  followBtn.className = isFollowing
    ? "btn btn-sm btn-dark"
    : "btn btn-sm btn-outline-dark";
}

async function loadPosts() {
  postsEl.innerHTML = `<div class="text-muted">Loading…</div>`;

  // ✅ load posts for this place (NO inserts here)
  const { data, error } = await supabase
    // Use your scoring view if it exists; otherwise swap to "posts"
    .from("v_post_scores")
    .select("id, place_id, type, topic, title, body, score")
    .eq("place_id", placeId)
    .order("score", { ascending: false });

  if (error) {
    console.log("LOAD POSTS ERROR:", error);
    postsEl.innerHTML = `<div class="alert alert-danger">Could not load posts: ${escapeHtml(
      error.message,
    )}</div>`;
    return;
  }

  lastPosts = data || [];
  renderPosts(lastPosts);
}

function renderPosts(posts) {
  const list = (posts || []).filter((p) => {
    if (currentFilter === "all") return true;
    return (p.type || "general") === currentFilter;
  });

  if (filterHint) {
    filterHint.textContent =
      currentFilter === "all"
        ? `${posts.length} total`
        : `${list.length} of ${posts.length} shown`;
  }

  if (!list.length) {
    postsEl.innerHTML = `<div class="alert alert-secondary">No posts for this filter yet.</div>`;
    return;
  }

  postsEl.innerHTML = "";
  list.forEach((p) => {
    const div = document.createElement("div");
    div.className = "card mb-3";

    div.innerHTML = `
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="mb-2">
              ${typeBadge(p.type)}
              ${topicBadge(p.topic)}
            </div>
            <h5 class="mb-2">${escapeHtml(p.title || "(Untitled)")}</h5>
          </div>
          <span class="text-muted small">Score: ${p.score ?? 0}</span>
        </div>

        <p class="mb-3">${escapeHtml(p.body || "")}</p>

        <button class="btn btn-sm btn-outline-primary me-2" onclick="vote('${p.id}', 1)">👍</button>
        <button class="btn btn-sm btn-outline-secondary me-2" onclick="vote('${p.id}', -1)">👎</button>
      </div>
    `;

    postsEl.appendChild(div);
  });
}

function topicBadge(topic) {
  const t = (topic || "everyday").toLowerCase();
  const map = {
    food_drink: { label: "FOOD", cls: "bg-warning text-dark" },
    outdoors: { label: "OUTDOORS", cls: "bg-success" },
    history: { label: "HISTORY", cls: "bg-info text-dark" },
    events: { label: "EVENTS", cls: "bg-primary" },
    attractions: { label: "ATTRACTIONS", cls: "bg-secondary" },
    nightlife: { label: "NIGHTLIFE", cls: "bg-dark" },
    legends: { label: "LEGENDS", cls: "bg-danger" },
    everyday: { label: "EVERYDAY", cls: "bg-light text-dark border" },
  };
  const x = map[t] || map.everyday;
  return `<span class="badge ${x.cls} ms-2">${x.label}</span>`;
}

function typeBadge(type) {
  const t = (type || "general").toLowerCase();
  const map = {
    alert: { label: "ALERT", cls: "bg-danger" },
    advice: { label: "ADVICE", cls: "bg-primary" },
    event: { label: "EVENT", cls: "bg-success" },
    general: { label: "GENERAL", cls: "bg-secondary" },
  };
  const x = map[t] || map.general;
  return `<span class="badge ${x.cls}">${x.label}</span>`;
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
  await showNextSuggestion();
});

ghNo?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  disableGhActions(true);
  await logSuggestion("no", ghCurrent);
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
  // ✅ add this
  await showNextSuggestion();
});

ghDown?.addEventListener("click", async () => {
  if (!ghCurrent) return;
  ghShownIds.add(ghCurrent.id);
  await logSuggestion("downvote", ghCurrent);
  await vote(ghCurrent.id, -1);
  // ✅ add this
  await showNextSuggestion();
});
