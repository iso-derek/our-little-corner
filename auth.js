(function () {
  const config = window.CORNER_CONFIG || {};
  const isLocalPreview = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
  const canConnect = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const client = canConnect
    ? (window.CORNER_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey))
    : null;
  if (client) window.CORNER_SUPABASE_CLIENT = client;

  let current = {
    mode: "preview",
    role: null,
    displayName: "Preview",
    user: null,
    profile: null
  };
  let initPromise = null;

  function roleLabel(role) {
    return role === "frog" ? "Frog" : role === "princess" ? "Princess" : "Our Corner";
  }

  function applyIdentity(profile, user) {
    current = {
      mode: "account",
      role: profile.role,
      displayName: profile.display_name || roleLabel(profile.role),
      user,
      profile
    };
    document.body.classList.add("has-account-identity");
    document.body.dataset.identity = profile.role;
    sessionStorage.setItem("pf_game_player", profile.role);
    sessionStorage.setItem("pf_message_sender", profile.role);
    document.dispatchEvent(new CustomEvent("corner:identity", { detail: current }));
    return current;
  }

  async function loadProfile(user) {
    const { data, error } = await client
      .from("couple_profiles")
      .select("user_id,site_id,role,display_name")
      .eq("user_id", user.id)
      .eq("site_id", config.siteId || "princess-frog-corner")
      .maybeSingle();
    if (error) throw new Error("The private account tables are not ready yet. Run supabase-auth-upgrade.sql first.");
    if (!data) throw new Error("This account has not been linked to Frog or Princess yet.");
    return data;
  }

  function buildGate() {
    const gate = document.createElement("div");
    gate.className = "account-gate";
    gate.innerHTML = `
      <section class="account-card" aria-labelledby="accountGateTitle">
        <div class="account-mark" aria-hidden="true">PF</div>
        <p class="eyebrow">Our private corner</p>
        <h1 id="accountGateTitle">Welcome back.</h1>
        <p>Sign in with your own Frog or Princess account.</p>
        <form class="account-form">
          <label>Email
            <input name="email" type="email" autocomplete="username" required placeholder="you@example.com">
          </label>
          <label>Password
            <input name="password" type="password" autocomplete="current-password" required placeholder="Your password">
          </label>
          <button class="btn primary" type="submit">Sign in</button>
          <button class="text-action account-reset" type="button">Send password reset email</button>
          <p class="account-error" aria-live="polite"></p>
        </form>
        <div class="account-linked" hidden>
          <p>This login works, but it has not been assigned to Frog or Princess.</p>
          <button class="btn account-sign-out" type="button">Sign out</button>
        </div>
      </section>
    `;
    document.body.appendChild(gate);
    return gate;
  }

  async function showSignInGate(existingUser = null) {
    const gate = buildGate();
    const form = gate.querySelector(".account-form");
    const errorEl = gate.querySelector(".account-error");
    const linkedEl = gate.querySelector(".account-linked");
    const submit = form.querySelector("button[type='submit']");

    async function finish(user) {
      try {
        const profile = await loadProfile(user);
        applyIdentity(profile, user);
        gate.remove();
        return true;
      } catch (error) {
        form.hidden = true;
        linkedEl.hidden = false;
        linkedEl.querySelector("p").textContent = error.message;
        return false;
      }
    }

    if (existingUser && await finish(existingUser)) return current;

    return new Promise((resolve) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        submit.disabled = true;
        submit.textContent = "Signing in...";
        const fields = new FormData(form);
        const { data, error } = await client.auth.signInWithPassword({
          email: String(fields.get("email") || "").trim(),
          password: String(fields.get("password") || "")
        });
        submit.disabled = false;
        submit.textContent = "Sign in";
        if (error) {
          errorEl.textContent = error.message;
          return;
        }
        if (await finish(data.user)) resolve(current);
      });

      gate.querySelector(".account-reset").addEventListener("click", async () => {
        const email = form.elements.email.value.trim();
        if (!email) {
          errorEl.textContent = "Enter your email first.";
          form.elements.email.focus();
          return;
        }
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: location.origin + location.pathname
        });
        errorEl.textContent = error ? error.message : "Password reset email sent.";
      });

      gate.querySelector(".account-sign-out").addEventListener("click", async () => {
        await client.auth.signOut();
        location.reload();
      });
    });
  }

  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      if (isLocalPreview && config.localAccountPreview !== true) return current;
      if (config.authEnabled === false) return current;
      if (!client) {
        current = { ...current, mode: "unavailable" };
        return current;
      }
      const { data } = await client.auth.getSession();
      const user = data.session?.user || null;
      if (user) {
        try {
          return applyIdentity(await loadProfile(user), user);
        } catch {
          return showSignInGate(user);
        }
      }
      return showSignInGate();
    })();
    return initPromise;
  }

  async function signOut() {
    if (client) await client.auth.signOut();
    sessionStorage.removeItem("pf_game_player");
    sessionStorage.removeItem("pf_message_sender");
    location.reload();
  }

  window.CornerIdentity = {
    client,
    init,
    signOut,
    get current() {
      return current;
    },
    role() {
      return current.role || sessionStorage.getItem("pf_game_player") || "";
    },
    isAccount() {
      return current.mode === "account";
    }
  };
})();
