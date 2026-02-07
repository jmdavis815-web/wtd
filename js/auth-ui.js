// js/auth-ui.js
// One shared auth controller for header UI + session changes.

(function () {
  let wired = false;

  async function maybeExchangeCodeForSession() {
    try {
      // Supabase magic links often return with a PKCE code in the query string.
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (!code) return;

      // Exchange code for a session (sets local storage session on this device)
      const { error } = await supabase.auth.exchangeCodeForSession(
        window.location.href,
      );
      if (error) console.log("exchangeCodeForSession error:", error);

      // Clean up URL (remove ?code=... so refreshes are clean)
      url.searchParams.delete("code");
      window.history.replaceState({}, document.title, url.toString());
    } catch (e) {
      console.log("maybeExchangeCodeForSession failed:", e);
    }
  }

  async function getSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session;
  }

  function getEls() {
    return {
      authStatusEl: document.getElementById("authStatus"),
      loginLink: document.getElementById("loginLink"),
      logoutBtn: document.getElementById("logoutBtn"),
    };
  }

  function applyUI(session) {
    const { authStatusEl, loginLink, logoutBtn } = getEls();

    if (session) {
      if (authStatusEl) authStatusEl.textContent = session.user.email || "";
      loginLink?.classList.add("d-none");
      logoutBtn?.classList.remove("d-none");
    } else {
      if (authStatusEl) authStatusEl.textContent = "";
      loginLink?.classList.remove("d-none");
      logoutBtn?.classList.add("d-none");
    }
  }

  async function init(opts = {}) {
    const { onChange } = opts;
    const { logoutBtn } = getEls();

    // ✅ Handle magic-link / PKCE callback if present
    await maybeExchangeCodeForSession();

    // Wire logout once
    if (!wired && logoutBtn) {
      wired = true;
      logoutBtn.addEventListener("click", async () => {
        await supabase.auth.signOut();
      });
    }

    const session = await getSession();
    applyUI(session);
    if (typeof onChange === "function") await onChange(session);

    supabase.auth.onAuthStateChange(async () => {
      const s = await getSession();
      applyUI(s);
      if (typeof onChange === "function") await onChange(s);
    });

    return session;
  }

  window.WTDAuth = { init };
})();
