// js/home.js
(async () => {
  const myWrap = document.getElementById("myPlacesWrap");
  const myUl = document.getElementById("myPlaces");

  const ul = document.getElementById("places");

  const searchEl = document.getElementById("placeSearch");
  const hintEl = document.getElementById("placesHint");

  const addCard = document.getElementById("addPlaceCard");
  const form = document.getElementById("placeForm");
  const msg = document.getElementById("placeMsg");

  let currentSession = null;
  let lastSearch = "";
  let searchTimer = null;

  // ---- helpers ----
  function showHint(text) {
    if (hintEl) hintEl.textContent = text;
  }

  function clearPlacesUI() {
    if (!ul) return;
    ul.innerHTML = "";
  }

  // Avoid PostgREST .or() filter parsing issues (commas/parentheses)
  function safeQuery(v) {
    return (v || "")
      .trim()
      .replaceAll(",", " ")
      .replaceAll("(", " ")
      .replaceAll(")", " ");
  }

  function normalizeCountryCode(v) {
    const s = (v || "").trim().toUpperCase();
    if (!s) return null;
    if (
      [
        "US",
        "USA",
        "U.S",
        "UNITED STATES",
        "UNITED STATES OF AMERICA",
        "U.S.A",
        "U.S.",
        "U.S.A.",
      ].includes(s)
    )
      return "US";
    if (["CA", "CAN", "CANADA"].includes(s)) return "CA";
    // allow 2-letter codes through; otherwise store null for now
    if (/^[A-Z]{2}$/.test(s)) return s;
    return null;
  }

  function displayText(p) {
    const region = p.region || p.admin1 || "";
    const cc = p.country_code || p.country || "";
    const parts = [p.name];
    if (region) parts.push(region);
    const tail = parts.join(", ");
    return cc ? `${tail} (${cc})` : tail;
  }

  function makeRow(p) {
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.innerHTML = `<a href="place.html?id=${p.id}">${escapeHtml(displayText(p))}</a>`;
    return li;
  }

  // ---- auth ----
  currentSession = await WTDAuth.init({
    onChange: async (session) => {
      currentSession = session;
      if (session) addCard?.classList.remove("d-none");
      else addCard?.classList.add("d-none");

      await loadMyPlaces();
    },
  });

  // ---- My Places ----
  async function loadMyPlaces() {
    if (!myUl || !myWrap) return;

    if (!currentSession) {
      myWrap.classList.add("d-none");
      myUl.innerHTML = "";
      return;
    }

    myWrap.classList.remove("d-none");
    myUl.innerHTML = `<li class="list-group-item text-muted">Loading…</li>`;

    const { data, error } = await supabase
      .from("follows")
      .select(
        "place_id, places(id, name, region, country_code, admin1, country)",
      )
      .eq("user_id", currentSession.user.id);

    if (error) {
      myUl.innerHTML = `<li class="list-group-item text-danger">Could not load My Places: ${escapeHtml(
        error.message,
      )}</li>`;
      return;
    }

    const places = (data || [])
      .map((x) => x.places)
      .filter(Boolean)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (!places.length) {
      myUl.innerHTML = `<li class="list-group-item text-muted">You’re not following any places yet.</li>`;
      return;
    }

    myUl.innerHTML = "";
    places.forEach((p) => {
      const li = document.createElement("li");
      li.className = "list-group-item";
      li.innerHTML = `<a href="place.html?id=${p.id}">${escapeHtml(displayText(p))}</a>`;
      myUl.appendChild(li);
    });
  }

  // ---- search ----
  async function searchPlaces(q) {
    if (!ul) return;

    const query = safeQuery(q);
    lastSearch = query;

    if (!query) {
      clearPlacesUI();
      showHint("Start typing to see matching places.");
      return;
    }

    if (query.length < 2) {
      clearPlacesUI();
      showHint("Type at least 2 characters.");
      return;
    }

    ul.innerHTML = `<li class="list-group-item text-muted">Searching…</li>`;
    showHint(`Searching for “${query}”…`);

    const pattern = `%${query}%`;

    // Search across name/city/region/country_code (works with your new schema)
    const { data, error } = await supabase
      .from("places")
      .select("id, name, region, country_code, admin1, country")
      .or(
        `name.ilike.${pattern},city.ilike.${pattern},region.ilike.${pattern},country_code.ilike.${pattern}`,
      )
      .order("name")
      .limit(25);

    if (lastSearch !== query) return;

    if (error) {
      ul.innerHTML = `<li class="list-group-item text-danger">Could not search places: ${escapeHtml(
        error.message,
      )}</li>`;
      showHint("Search error.");
      return;
    }

    if (!data?.length) {
      ul.innerHTML = `<li class="list-group-item text-muted">No matches.</li>`;
      showHint("No matches. You can add it below (when logged in).");
      return;
    }

    ul.innerHTML = "";
    data.forEach((p) => ul.appendChild(makeRow(p)));
    showHint(`${data.length} match${data.length === 1 ? "" : "es"}.`);
  }

  // Debounced search typing
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = searchEl.value;
      searchTimer = setTimeout(() => searchPlaces(q), 180);
    });
  }

  // ---- add place (RPC upsert) ----
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!msg) return;
    msg.textContent = "";

    if (!currentSession) {
      msg.textContent = "Please log in to add places.";
      return;
    }

    const name = document.getElementById("placeName")?.value?.trim() || "";
    const admin1 = document.getElementById("placeAdmin1")?.value?.trim() || "";
    const country =
      document.getElementById("placeCountry")?.value?.trim() || "";

    if (!name) {
      msg.textContent = "Name is required.";
      return;
    }

    const countryCode = normalizeCountryCode(country);

    // RPC: returns existing place if duplicate/close-dupe
    const { data, error } = await supabase.rpc("wtd_upsert_place_simple", {
      p_name: name,
      p_region: admin1 || null,
      p_country_code: countryCode || null,
    });

    if (error) {
      console.log("place upsert error:", error);

      const isDuplicate =
        error.code === "23505" ||
        (error.message || "").toLowerCase().includes("duplicate");

      msg.textContent = isDuplicate
        ? "That place already exists."
        : error.message || "Could not save place.";

      return; // ✅ stop here on error
    }

    // Clear inputs
    document.getElementById("placeName").value = "";
    document.getElementById("placeAdmin1").value = "";
    document.getElementById("placeCountry").value = "";
    // RPC may return an existing place; keep message neutral
    msg.textContent = "Saved.";

    // Refresh My Places
    await loadMyPlaces();

    // If it matches the current search, show it immediately
    if (searchEl && (searchEl.value || "").trim().length >= 2) {
      await searchPlaces(searchEl.value);
    }
  });

  // ✅ Initial load
  await loadMyPlaces();
  clearPlacesUI();
  showHint("Start typing to see matching places.");
})();
