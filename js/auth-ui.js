// js/auth-ui.js
// One shared auth controller for header UI + session changes.

(function () {
  let wired = false;

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
