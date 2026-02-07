// js/place.js

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

let currentSession = null;
let currentFilter = "all";
let lastPosts = [];
let isFollowing = false;

(async () => {
  if (!placeId) {
    placeNameEl.textContent = "Place not found";
    postsEl.innerHTML = `<div class="alert alert-warning mt-3">Missing place id.</div>`;
    return;
  }

  await renderAuth();

  supabase.auth.onAuthStateChange(async () => {
    await renderAuth();
    await refreshFollowUI();
    await loadPosts();
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
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

    const type = document.getElementById("type").value;
    const title = document.getElementById("title").value.trim();
    const body = document.getElementById("body").value.trim();

    if (!title) {
      postMsg.textContent = "Title is required.";
      return;
    }

    const { error } = await supabase.from("posts").insert({
      place_id: placeId,
      type,
      title,
      body: body || null,
      author_id: currentSession.user.id,
    });

    if (error) {
      postMsg.textContent = error.message;
      return;
    }

    document.getElementById("type").value = "general";
    document.getElementById("title").value = "";
    document.getElementById("body").value = "";
    postMsg.textContent = "Posted.";

    await loadPosts();
  });

  // Initial load
  await refreshFollowUI();
  await loadPosts();
})();

async function renderAuth() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  currentSession = session;

  if (session) {
    if (authStatusEl) authStatusEl.textContent = session.user.email;
    loginLink?.classList.add("d-none");
    logoutBtn?.classList.remove("d-none");
    createPostCard?.classList.remove("d-none");
  } else {
    if (authStatusEl) authStatusEl.textContent = "";
    loginLink?.classList.remove("d-none");
    logoutBtn?.classList.add("d-none");
    createPostCard?.classList.add("d-none");
  }
}

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

  const { data, error } = await supabase
    .from("follows")
    .select("place_id")
    .eq("user_id", currentSession.user.id)
    .eq("place_id", placeId)
    .maybeSingle();

  if (error) {
    // If policies block select, you'll see it here; but with our RLS above it should work.
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

  const { data, error } = await supabase
    .from("v_post_scores")
    .select("id, place_id, type, title, body, score")
    .eq("place_id", placeId)
    .order("score", { ascending: false });

  if (error) {
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
            <div class="mb-2">${typeBadge(p.type)}</div>
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

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
