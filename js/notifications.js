// js/notifications.js

(async function () {
  const btn = document.getElementById("notifBtn");
  const badge = document.getElementById("notifBadge");
  const list = document.getElementById("notifList");
  const empty = document.getElementById("notifEmpty");
  const markAllBtn = document.getElementById("notifMarkAll");
  const modalEl = document.getElementById("notifModal");

  if (!btn || !badge || !list || !empty || !modalEl) return;

  async function getSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }

  async function refreshUnreadCount() {
    const session = await getSession();

    if (!session) {
      btn.classList.add("d-none");
      badge.classList.add("d-none");
      return;
    }

    btn.classList.remove("d-none");

    const { count, error } = await supabase
      .from("notifications")
      .select("*", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .is("read_at", null);

    if (error) {
      console.log("notif count error:", error);
      return;
    }

    const n = count ?? 0;
    if (n > 0) {
      badge.textContent = String(n);
      badge.classList.remove("d-none");
    } else {
      badge.classList.add("d-none");
    }
  }

  function fmtTime(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleString();
    } catch {
      return "";
    }
  }

  async function loadNotifications() {
    const session = await getSession();
    if (!session) return;

    list.innerHTML = `<div class="text-muted small">Loading…</div>`;
    empty.classList.add("d-none");

    const { data, error } = await supabase
      .from("notifications")
      .select("id, place_id, post_id, kind, title, body, created_at, read_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      list.innerHTML = `<div class="text-danger small">${escapeHtml(error.message)}</div>`;
      return;
    }

    if (!data?.length) {
      list.innerHTML = "";
      empty.classList.remove("d-none");
      return;
    }

    list.innerHTML = "";
    data.forEach((n) => {
      const a = document.createElement("a");
      a.className = "list-group-item list-group-item-action";
      a.href = `place.html?id=${n.place_id}`;
      a.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="fw-semibold">${escapeHtml(n.title || "Alert")}</div>
            <div class="text-muted small">${escapeHtml(n.body || "")}</div>
          </div>
          <div class="text-muted small text-nowrap">${fmtTime(n.created_at)}</div>
        </div>
        ${n.read_at ? "" : `<div class="badge bg-danger mt-2">NEW</div>`}
      `;
      list.appendChild(a);
    });

    // mark visible unread as read
    const unreadIds = data.filter((x) => !x.read_at).map((x) => x.id);
    if (unreadIds.length) {
      await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", unreadIds)
        .is("read_at", null);
    }

    await refreshUnreadCount();
  }

  markAllBtn?.addEventListener("click", async () => {
    const session = await getSession();
    if (!session) return;

    await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", session.user.id)
      .is("read_at", null);

    await loadNotifications();
  });

  // when modal opens, load list + mark read
  modalEl.addEventListener("shown.bs.modal", () => {
    loadNotifications();
  });

  // keep badge fresh
  await refreshUnreadCount();
  supabase.auth.onAuthStateChange(() => refreshUnreadCount());
  setInterval(refreshUnreadCount, 15000);
})();

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
