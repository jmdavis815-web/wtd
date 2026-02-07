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

  // Holds the current auth session (or null). Must be declared before WTDAuth.init()
  let currentSession = null;
  let lastSearch = "";
  let searchTimer = null;

  // Use shared auth UI controller
  currentSession = await WTDAuth.init({
    onChange: async (session) => {
      currentSession = session;
      if (session) addCard?.classList.remove("d-none");
      else addCard?.classList.add("d-none");

      await loadMyPlaces();
    },
  });

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
      .select("place_id, places(id, name, admin1, country)")
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
      li.innerHTML = `<a href="place.html?id=${p.id}">
        ${escapeHtml(p.name)}${p.admin1 ? ", " + escapeHtml(p.admin1) : ""}${
          p.country ? " (" + escapeHtml(p.country) + ")" : ""
        }</a>`;
      myUl.appendChild(li);
    });
  }

  function clearPlacesUI() {
    if (!ul) return;
    ul.innerHTML = "";
  }

  function showHint(text) {
    if (hintEl) hintEl.textContent = text;
  }

  async function searchPlaces(q) {
    if (!ul) return;

    const query = (q || "").trim();
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

    // OR-search across name/admin1/country (PostgREST syntax)
    const pattern = `%${query}%`;
    const { data, error } = await supabase
      .from("places")
      .select("id, name, admin1, country")
      .or(
        `name.ilike.${pattern},admin1.ilike.${pattern},country.ilike.${pattern}`,
      )
      .order("name")
      .limit(25);

    // If user typed more while this request was in flight, ignore stale results
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

  function displayText(p) {
    return `${p.name}${p.admin1 ? ", " + p.admin1 : ""}${
      p.country ? " (" + p.country + ")" : ""
    }`;
  }

  function makeRow(p) {
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.innerHTML = `<a href="place.html?id=${p.id}">${escapeHtml(
      displayText(p),
    )}</a>`;
    return li;
  }

  // Debounced search typing
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = searchEl.value;
      searchTimer = setTimeout(() => searchPlaces(q), 180);
    });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    if (!currentSession) {
      msg.textContent = "Please log in to add places.";
      return;
    }

    const name = document.getElementById("placeName").value.trim();
    const admin1 = document.getElementById("placeAdmin1").value.trim();
    const country = document.getElementById("placeCountry").value.trim();

    if (!name) {
      msg.textContent = "Name is required.";
      return;
    }

    const payload = {
      name,
      admin1: admin1 || null,
      country: country || null,
      provider: "user",
      provider_place_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from("places")
      .insert(payload)
      .select("id, name, admin1, country")
      .single();

    if (error) {
      console.log("places insert error:", error);
      console.log("places insert payload:", payload);

      if (error.code === "23505")
        msg.textContent = "That place already exists.";
      else msg.textContent = error.message;
      return;
    }

    document.getElementById("placeName").value = "";
    document.getElementById("placeAdmin1").value = "";
    document.getElementById("placeCountry").value = "";
    msg.textContent = "Added.";

    // If it matches the current search, show it immediately
    if (searchEl && (searchEl.value || "").trim().length >= 2) {
      await searchPlaces(searchEl.value);
    }
  });

  // ✅ Initial load
  await loadMyPlaces();
  // No giant list: start empty until user searches
  clearPlacesUI();
  showHint("Start typing to see matching places.");
})();
