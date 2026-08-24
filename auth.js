(function () {
  const config = window.CORNER_CONFIG || {};
  const isLocalPreview = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
  const forceLocalPreview = isLocalPreview && new URLSearchParams(location.search).get("preview") === "1";
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
      <div class="account-gate-shell">
        <aside class="account-gate-story" aria-hidden="true">
          <picture><source media="(max-width: 760px)" srcset="images/optimized/june21-flowers-640.webp"><img src="images/optimized/june21-flowers-1200.webp" alt=""></picture>
          <div class="account-gate-shade"></div>
          <div class="account-story-copy">
            <div class="account-story-mark"><span>P</span><i></i><span>F</span></div>
            <p class="eyebrow">Our private little corner</p>
            <h2>One story.<br>Two private seats.</h2>
            <p>Letters, memories, games, plans, and every little thing we keep between us.</p>
            <div class="account-members"><span><i>F</i> Frog</span><span><i>P</i> Princess</span></div>
          </div>
        </aside>
        <section class="account-card" aria-labelledby="accountGateTitle">
          <div class="account-card-top"><span>Princess + Frog</span><span class="account-private-status"><i></i> Private access</span></div>
          <div class="account-card-copy">
            <p class="eyebrow">Welcome back</p>
            <h1 id="accountGateTitle">Come back<br>to <em>us.</em></h1>
            <p>Use your own account. Your identity, theme, scores, votes, ratings, and private answers will follow you automatically.</p>
          </div>
          <form class="account-form">
            <label><span>Email address</span>
              <input name="email" type="email" autocomplete="username" required placeholder="Enter your email">
            </label>
            <label><span>Password</span>
              <span class="account-password-wrap"><input name="password" type="password" autocomplete="current-password" required placeholder="Enter your password"><button class="account-password-toggle" type="button" aria-label="Show password">Show</button></span>
            </label>
            <button class="btn primary account-submit" type="submit"><span>Open our corner</span><i aria-hidden="true">&rarr;</i></button>
            <div class="account-form-footer"><span>Only Frog and Princess can enter.</span><button class="account-reset" type="button">Forgot password?</button></div>
            <p class="account-error" aria-live="polite"></p>
          </form>
          <div class="account-linked" hidden>
            <p>This login works, but it has not been assigned to Frog or Princess.</p>
            <button class="btn account-sign-out" type="button">Sign out</button>
          </div>
          <div class="account-authorized" aria-live="polite" hidden><span>Identity confirmed</span><strong>Opening your corner...</strong></div>
        </section>
      </div>
    `;
    document.body.appendChild(gate);
    const password = gate.querySelector('input[name="password"]');
    const toggle = gate.querySelector(".account-password-toggle");
    toggle.addEventListener("click", () => {
      const showing = password.type === "text";
      password.type = showing ? "password" : "text";
      toggle.textContent = showing ? "Show" : "Hide";
      toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      password.focus();
    });
    return gate;
  }

  async function showSignInGate(existingUser = null) {
    const gate = buildGate();
    const form = gate.querySelector(".account-form");
    const errorEl = gate.querySelector(".account-error");
    const linkedEl = gate.querySelector(".account-linked");
    const submit = form.querySelector("button[type='submit']");

    async function finish(user, celebrate = false) {
      try {
        const profile = await loadProfile(user);
        applyIdentity(profile, user);
        if (celebrate) {
          gate.dataset.role = profile.role;
          gate.classList.add("is-authorized");
          form.hidden = true;
          const authorized = gate.querySelector(".account-authorized");
          authorized.hidden = false;
          authorized.querySelector("strong").textContent = `Welcome, ${profile.display_name || roleLabel(profile.role)}. Opening your corner...`;
          await new Promise((resolve) => window.setTimeout(resolve, 680));
        }
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
        submit.querySelector("span").textContent = "Checking your account...";
        const fields = new FormData(form);
        const { data, error } = await client.auth.signInWithPassword({
          email: String(fields.get("email") || "").trim(),
          password: String(fields.get("password") || "")
        });
        submit.disabled = false;
        submit.querySelector("span").textContent = "Open our corner";
        if (error) {
          errorEl.textContent = error.message;
          return;
        }
        if (await finish(data.user, true)) resolve(current);
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
      if (forceLocalPreview || (isLocalPreview && config.localAccountPreview !== true)) return current;
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
    const userId = current.user?.id;
    if (client) await client.auth.signOut();
    sessionStorage.removeItem("pf_game_player");
    sessionStorage.removeItem("pf_message_sender");
    if (userId) sessionStorage.removeItem(`pf_welcome_seen_${userId}`);
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
