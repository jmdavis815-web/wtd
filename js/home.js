// js/home.js
(async () => {
  const myWrap = document.getElementById("myPlacesWrap");
  const myUl = document.getElementById("myPlaces");

  const ul = document.getElementById("places");

  const addCard = document.getElementById("addPlaceCard");
  const form = document.getElementById("placeForm");
  const msg = document.getElementById("placeMsg");

  async function loadMyPlaces() {
    if (!myUl || !myWrap) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      myWrap.classList.add("d-none");
      myUl.innerHTML = "";
      return;
    }

    myWrap.classList.remove("d-none");
    myUl.innerHTML = `<li class="list-group-item text-muted">Loading…</li>`;

    const { data, error } = await supabase
      .from("follows")
      .select("place_id, places(id, name, admin1, country)")
      .eq("user_id", session.user.id);

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

  async function loadPlaces() {
    ul.innerHTML = `<li class="list-group-item text-muted">Loading…</li>`;

    const { data, error } = await supabase
      .from("places")
      .select("id, name, admin1, country")
      .order("name");

    if (error) {
      ul.innerHTML = `<li class="list-group-item text-danger">Could not load places: ${escapeHtml(
        error.message,
      )}</li>`;
      return;
    }

    if (!data?.length) {
      ul.innerHTML = `<li class="list-group-item text-muted">No places yet.</li>`;
      return;
    }

    ul.innerHTML = "";
    data.forEach((p) => insertPlaceSorted(p));
  }

  function displayText(p) {
    return `${p.name}${p.admin1 ? ", " + p.admin1 : ""}${
      p.country ? " (" + p.country + ")" : ""
    }`;
  }

  function sortKey(p) {
    const n = (p.name || "").trim().toLowerCase();
    const a = (p.admin1 || "").trim().toLowerCase();
    const c = (p.country || "").trim().toLowerCase();
    return `${n}|${a}|${c}`;
  }

  function makeRow(p) {
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.dataset.sortKey = sortKey(p);
    li.innerHTML = `<a href="place.html?id=${p.id}">${escapeHtml(
      displayText(p),
    )}</a>`;
    return li;
  }

  function insertPlaceSorted(p) {
    if (ul.children.length === 1 && ul.textContent.includes("No places yet")) {
      ul.innerHTML = "";
    }

    const li = makeRow(p);
    const key = li.dataset.sortKey;

    const kids = Array.from(ul.children);
    const before = kids.find((el) => (el.dataset.sortKey || "") > key);

    if (before) ul.insertBefore(li, before);
    else ul.appendChild(li);
  }

  async function renderAuthUI() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) addCard?.classList.remove("d-none");
    else addCard?.classList.add("d-none");
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
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

    insertPlaceSorted(data);
  });

  // ✅ Initial load
  await renderAuthUI();
  await loadMyPlaces();
  await loadPlaces();

  // ✅ Keep UI in sync with login/logout/magic link
  supabase.auth.onAuthStateChange(async () => {
    await renderAuthUI();
    await loadMyPlaces();
  });
})();

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
