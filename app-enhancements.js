(function () {
  const config = window.CORNER_CONFIG || {};
  let installPrompt = null;
  let accountCenter = null;
  let notifications = [];
  let notificationChannel = null;
  let mediaObserver = null;
  let activeRecorder = null;
  let welcomeExperience = null;
  let presenceTimer = null;
  const signedMediaCache = new Map();
  const notificationCooldowns = new Map();

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    document.querySelectorAll("[data-install-app]").forEach((button) => button.hidden = false);
  });

  function runtime() {
    return window.CornerRuntime;
  }

  function identity() {
    return window.CornerIdentity?.current || { mode: "preview", role: null, user: null };
  }

  function otherRole(role) {
    return role === "frog" ? "princess" : "frog";
  }

  function roleName(role) {
    return role === "frog" ? "Frog" : role === "princess" ? "Princess" : "Our Corner";
  }

  function notificationPreferences(role) {
    const saved = runtime()?.shared?.get(`pf_notification_preferences_${role}`, null);
    const defaults = {
      enabled: {
        love: true,
        memory: true,
        letter: true,
        message: true,
        game: true,
        ritual: true,
        date: true,
        movie: true,
        nudge: true
      },
      quietStart: "22:30",
      quietEnd: "08:00",
      preview: true
    };
    return {
      ...defaults,
      ...(saved && typeof saved === "object" ? saved : {}),
      enabled: { ...defaults.enabled, ...(saved?.enabled || {}) }
    };
  }

  function inQuietHours(preferences, now = new Date()) {
    const toMinutes = (value) => {
      const [hours, minutes] = String(value || "").split(":").map(Number);
      return Number.isFinite(hours) && Number.isFinite(minutes) ? (hours * 60) + minutes : null;
    };
    const start = toMinutes(preferences.quietStart);
    const end = toMinutes(preferences.quietEnd);
    if (start === null || end === null || start === end) return false;
    const current = (now.getHours() * 60) + now.getMinutes();
    return start < end ? current >= start && current < end : current >= start || current < end;
  }

  const welcomeCopy = {
    princess: {
      eyebrow: "A private entrance for Her Royal Highness",
      titleLead: "Welcome home,",
      titleName: "Princess.",
      message: "My favourite girl has entered the story. This little corner is yours: every letter, memory, game, and small surprise was made to remind you that you are loved, chosen, and always on my mind.",
      signoff: "With love, your Frog.",
      image: "images/optimized/june21-flowers-1200.webp",
      imageSmall: "images/optimized/june21-flowers-640.webp",
      position: "center 38%"
    },
    frog: {
      eyebrow: "The keeper of our little corner returns",
      titleLead: "Welcome back,",
      titleName: "Frog.",
      message: "The lights are on, the memories are safe, and your Princess is only one message away. Come in, add something beautiful, and keep making this story worth returning to.",
      signoff: "Our favourite chapter is waiting.",
      image: "images/optimized/june21-question-1200.webp",
      imageSmall: "images/optimized/june21-question-640.webp",
      position: "center 45%"
    }
  };

  function chapterDay() {
    const beginning = new Date("2026-06-21T00:00:00");
    const now = new Date();
    const localBeginning = new Date(beginning.getFullYear(), beginning.getMonth(), beginning.getDate());
    const localToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.max(1, Math.floor((localToday - localBeginning) / 86400000) + 1);
  }

  function welcomeSessionKey() {
    return `pf_welcome_seen_${identity().user?.id || identity().role || "preview"}`;
  }

  function welcomeMessageKey(role) {
    return `pf_welcome_message_${role}`;
  }

  function welcomeMessageFor(role) {
    const saved = runtime()?.shared?.get(welcomeMessageKey(role), null);
    if (typeof saved === "string") {
      const text = saved.trim();
      return text ? { text, from: otherRole(role), updatedAt: "" } : null;
    }
    if (!saved || typeof saved !== "object" || typeof saved.text !== "string") return null;
    const text = saved.text.trim();
    if (!text) return null;
    const from = ["frog", "princess"].includes(saved.from) ? saved.from : otherRole(role);
    return { text, from, updatedAt: saved.updatedAt || "" };
  }

  function partnerPresence() {
    const partner = otherRole(identity().role);
    const seenAt = Date.parse(runtime()?.shared?.get(`pf_presence_${partner}`, "") || "");
    return {
      partner,
      online: Number.isFinite(seenAt) && Date.now() - seenAt < 70000
    };
  }

  function updateWelcomePresence(root = welcomeExperience) {
    const status = root?.querySelector("[data-welcome-presence]");
    if (!status) return;
    const partner = partnerPresence();
    status.classList.toggle("online", partner.online);
    status.querySelector("strong").textContent = partner.online
      ? `${roleName(partner.partner)} is here too`
      : `${roleName(partner.partner)} has a place here`;
    status.querySelector("small").textContent = partner.online
      ? "You are in your corner together, right now."
      : "They will see what you leave for them.";
  }

  async function heartbeatPresence() {
    if (!window.CornerIdentity?.isAccount() || !runtime()?.shared) return;
    await runtime().shared.set(`pf_presence_${identity().role}`, new Date().toISOString());
    updateWelcomePresence();
  }

  function initializePresence() {
    if (!window.CornerIdentity?.isAccount() || presenceTimer) return;
    heartbeatPresence();
    presenceTimer = window.setInterval(heartbeatPresence, 25000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) heartbeatPresence();
    });
  }

  function greetingForNow() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function closeWelcome({ destination = "" } = {}) {
    if (!welcomeExperience) return;
    const root = welcomeExperience;
    sessionStorage.setItem(welcomeSessionKey(), "yes");
    root.classList.add("is-leaving");
    document.body.classList.remove("welcome-open");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(() => {
      root.remove();
      if (welcomeExperience === root) welcomeExperience = null;
      if (destination) location.href = destination;
    }, reducedMotion ? 20 : 720);
  }

  function showWelcomeExperience({ force = false } = {}) {
    const me = identity();
    if (me.mode !== "account" || !["frog", "princess"].includes(me.role)) return null;
    if (!force && sessionStorage.getItem(welcomeSessionKey()) === "yes") return null;
    welcomeExperience?.remove();

    const copy = welcomeCopy[me.role];
    const partner = otherRole(me.role);
    const waitingNote = welcomeMessageFor(me.role);
    const welcomeMessage = waitingNote?.text || copy.message;
    const welcomeSignoff = waitingNote
      ? `Left for you by your ${roleName(waitingNote.from)}.`
      : copy.signoff;
    const root = document.createElement("section");
    root.className = "welcome-experience";
    root.dataset.role = me.role;
    root.dataset.note = waitingNote ? "partner" : "default";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "welcomeExperienceTitle");
    root.innerHTML = `
      <div class="welcome-portrait" aria-hidden="true">
        <picture>
          <source media="(max-width: 760px)" srcset="${copy.imageSmall}">
          <img src="${copy.image}" alt="" style="object-position:${copy.position}">
        </picture>
        <div class="welcome-portrait-shade"></div>
        <span class="welcome-portrait-caption">21 / 06 &nbsp; Our favourite chapter</span>
      </div>
      <div class="welcome-stage">
        <button class="welcome-skip" type="button" aria-label="Skip welcome and enter the site">Skip</button>
        <div class="welcome-monogram" aria-hidden="true"><span>P</span><i></i><span>F</span></div>
        <div class="welcome-copy">
          <p class="welcome-time">${greetingForNow()}, ${roleName(me.role)}</p>
          <p class="eyebrow">${copy.eyebrow}</p>
          <h1 id="welcomeExperienceTitle"><span>${copy.titleLead}</span><strong>${copy.titleName}</strong></h1>
          ${waitingNote ? `<p class="welcome-note-label">A note waiting from ${roleName(waitingNote.from)}</p>` : ""}
          <p class="welcome-message">${escapeHtml(welcomeMessage)}</p>
          <p class="welcome-signoff">${escapeHtml(welcomeSignoff)}</p>
        </div>
        <div class="welcome-details" aria-label="Your corner today">
          <div class="welcome-detail">
            <span>Our chapter</span>
            <strong>Day ${chapterDay()}</strong>
            <small>Since the best yes I have heard.</small>
          </div>
          <div class="welcome-detail welcome-presence" data-welcome-presence>
            <span><i aria-hidden="true"></i> Live corner</span>
            <strong>${roleName(partner)} has a place here</strong>
            <small>They will see what you leave for them.</small>
          </div>
        </div>
        <div class="welcome-actions">
          <button class="welcome-enter" type="button" data-welcome-enter>Enter our little corner <span aria-hidden="true">&rarr;</span></button>
          <button class="welcome-surprise" type="button" data-welcome-surprise>Take me somewhere sweet</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);
    document.body.classList.add("welcome-open");
    welcomeExperience = root;
    updateWelcomePresence(root);

    const sweetPlaces = ["love.html", "letters.html", "memories.html", "messages.html"];
    root.querySelector("[data-welcome-enter]").addEventListener("click", () => closeWelcome());
    root.querySelector(".welcome-skip").addEventListener("click", () => closeWelcome());
    root.querySelector("[data-welcome-surprise]").addEventListener("click", () => {
      const index = Math.floor(Math.random() * sweetPlaces.length);
      closeWelcome({ destination: sweetPlaces[index] });
    });
    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeWelcome();
    });
    requestAnimationFrame(() => {
      root.classList.add("is-visible");
      root.querySelector("[data-welcome-enter]").focus({ preventScroll: true });
    });
    return root;
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  async function registerPWA() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    try {
      const registration = await navigator.serviceWorker.register("service-worker.js", { scope: "./" });
      if (registration.waiting) registration.waiting.postMessage("SKIP_WAITING");
    } catch (error) {
      console.warn("App installation is unavailable.", error);
    }
  }

  async function installApp() {
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      document.querySelectorAll("[data-install-app]").forEach((button) => button.hidden = true);
      return;
    }
    runtime()?.toast("Use Add to Home Screen from your browser menu");
  }

  function initializeWelcomeNoteStudio(drawer) {
    const studio = drawer.querySelector("[data-welcome-note-studio]");
    if (!studio) return;
    const recipient = otherRole(identity().role);
    const textarea = studio.querySelector("[data-welcome-note-input]");
    const count = studio.querySelector("[data-welcome-note-count]");
    const status = studio.querySelector("[data-welcome-note-status]");
    const saved = welcomeMessageFor(recipient);

    textarea.value = saved?.text || "";
    const updateCount = () => {
      count.textContent = `${textarea.value.length} / ${textarea.maxLength}`;
    };
    const setStatus = (message, state = "") => {
      status.textContent = message;
      status.dataset.state = state;
    };
    updateCount();
    textarea.addEventListener("input", () => {
      updateCount();
      setStatus("Your changes are waiting to be saved.");
    });
    studio.querySelector("[data-save-welcome-note]").addEventListener("click", async () => {
      const text = textarea.value.trim();
      if (!text) {
        textarea.focus();
        setStatus(`Write something for ${roleName(recipient)} first.`, "error");
        return;
      }
      setStatus("Saving their next entrance...");
      await runtime()?.shared?.set(welcomeMessageKey(recipient), {
        text,
        from: identity().role,
        updatedAt: new Date().toISOString()
      });
      textarea.value = text;
      updateCount();
      setStatus(`${roleName(recipient)} will see this at their next sign-in.`, "saved");
      runtime()?.toast(`Welcome saved for ${roleName(recipient)}`);
    });
    studio.querySelector("[data-clear-welcome-note]").addEventListener("click", async () => {
      textarea.value = "";
      updateCount();
      setStatus("Clearing the saved entrance...");
      await runtime()?.shared?.set(welcomeMessageKey(recipient), null);
      setStatus(`${roleName(recipient)} will see the original welcome next time.`, "saved");
    });
  }

  function ensureAccountCenter() {
    if (accountCenter) return accountCenter;
    const header = document.querySelector(".site-header");
    if (!header) return null;
    const me = identity();
    const partner = otherRole(me.role);
    const actions = document.createElement("div");
    actions.className = "header-account-actions";
    actions.innerHTML = `
      <button class="header-icon-button notification-button" type="button" aria-label="Open notifications" title="Notifications">
        <span aria-hidden="true">&#9671;</span><b class="notification-count" hidden>0</b>
      </button>
      <button class="identity-button" type="button" aria-label="Open account">
        <span class="identity-dot" aria-hidden="true"></span>
        <span>${me.mode === "account" ? roleName(me.role) : "Preview"}</span>
      </button>
    `;
    header.appendChild(actions);

    const backdrop = document.createElement("div");
    backdrop.className = "account-drawer-backdrop";
    backdrop.hidden = true;
    const drawer = document.createElement("aside");
    drawer.className = "account-drawer";
    drawer.hidden = true;
    drawer.setAttribute("aria-label", "Account and notifications");
    drawer.innerHTML = `
      <div class="account-drawer-head">
        <div><p class="eyebrow">Signed in as</p><h2>${me.mode === "account" ? roleName(me.role) : "Local preview"}</h2></div>
        <button class="icon-btn close-account-drawer" type="button" aria-label="Close account panel">&times;</button>
      </div>
      <div class="account-summary">
        <span class="account-avatar" aria-hidden="true">${me.role === "frog" ? "F" : me.role === "princess" ? "P" : "PF"}</span>
        <div><strong>${me.displayName || roleName(me.role)}</strong><small>${me.user?.email || "Passcode preview on this device"}</small></div>
      </div>
      <div class="account-commands">
        <button class="btn" type="button" data-enable-notifications>Enable notifications</button>
        <button class="btn" type="button" data-install-app>Install on this device</button>
        ${me.mode === "account" ? '<button class="btn account-command-wide" type="button" data-replay-welcome>Replay welcome</button>' : ''}
      </div>
      ${me.mode === "account" ? `
        <section class="welcome-note-studio" data-welcome-note-studio aria-labelledby="welcomeNoteTitle">
          <p class="eyebrow">Next entrance</p>
          <h3 id="welcomeNoteTitle">Welcome ${roleName(partner)}</h3>
          <p>Leave a private message for the next time ${roleName(partner)} opens your corner.</p>
          <label for="partnerWelcomeNote">Your message for ${roleName(partner)}</label>
          <textarea id="partnerWelcomeNote" data-welcome-note-input maxlength="260" rows="5" placeholder="Write the words you want waiting for them..."></textarea>
          <div class="welcome-note-meta">
            <small data-welcome-note-count>0 / 260</small>
            <span data-welcome-note-status aria-live="polite">Only ${roleName(partner)} sees this on their welcome screen.</span>
          </div>
          <div class="welcome-note-actions">
            <button class="text-action" type="button" data-clear-welcome-note>Use original</button>
            <button class="btn primary" type="button" data-save-welcome-note>Save for ${roleName(partner)}</button>
          </div>
        </section>
      ` : ""}
      <section class="notification-center" aria-labelledby="notificationTitle">
        <div class="notification-heading"><h3 id="notificationTitle">Notifications</h3><button class="text-action" type="button" data-read-all>Mark all read</button></div>
        <div class="notification-list"><p class="notification-empty">Nothing new yet.</p></div>
      </section>
      ${me.mode === "account" ? '<button class="text-action sign-out-button" type="button">Sign out</button>' : ''}
    `;
    document.body.append(backdrop, drawer);

    const openDrawer = () => {
      drawer.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add("account-drawer-open");
      drawer.querySelector(".close-account-drawer").focus();
    };
    const closeDrawer = () => {
      drawer.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove("account-drawer-open");
    };
    actions.querySelectorAll("button").forEach((button) => button.addEventListener("click", openDrawer));
    drawer.querySelector(".close-account-drawer").addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !drawer.hidden) closeDrawer();
    });
    drawer.querySelector("[data-install-app]").addEventListener("click", installApp);
    drawer.querySelector("[data-enable-notifications]").addEventListener("click", enablePushNotifications);
    drawer.querySelector("[data-read-all]").addEventListener("click", markAllNotificationsRead);
    drawer.querySelector("[data-replay-welcome]")?.addEventListener("click", () => {
      closeDrawer();
      showWelcomeExperience({ force: true });
    });
    drawer.querySelector(".sign-out-button")?.addEventListener("click", () => window.CornerIdentity.signOut());
    initializeWelcomeNoteStudio(drawer);

    accountCenter = { actions, drawer, backdrop, open: openDrawer, close: closeDrawer };
    return accountCenter;
  }

  function formatRelativeDate(value) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return "";
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(time));
  }

  function renderNotifications() {
    const center = ensureAccountCenter();
    if (!center) return;
    const userId = identity().user?.id;
    const visible = notifications.filter((item) => !item.recipient_role || item.recipient_role === identity().role);
    const unread = visible.filter((item) => userId && (!Array.isArray(item.read_by) || !item.read_by.includes(userId))).length;
    const badge = center.actions.querySelector(".notification-count");
    badge.textContent = String(Math.min(unread, 99));
    badge.hidden = unread === 0;
    const list = center.drawer.querySelector(".notification-list");
    if (!visible.length) {
      list.innerHTML = '<p class="notification-empty">Nothing new yet.</p>';
      return;
    }
    list.innerHTML = visible.map((item) => {
      const isUnread = userId && !(Array.isArray(item.read_by) && item.read_by.includes(userId));
      return `<a class="notification-item ${isUnread ? "unread" : ""}" href="${escapeHtml(item.url || "index.html")}" data-notification-id="${escapeHtml(item.id)}">
        <span class="notification-kind" aria-hidden="true">${item.kind === "game" ? "G" : item.kind === "memory" ? "M" : item.kind === "letter" ? "L" : "PF"}</span>
        <span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small><time>${formatRelativeDate(item.created_at)}</time></span>
      </a>`;
    }).join("");
    list.querySelectorAll("[data-notification-id]").forEach((link) => {
      link.addEventListener("click", () => markNotificationRead(link.dataset.notificationId));
    });
  }

  async function loadNotifications() {
    const client = window.CornerIdentity?.client;
    if (!client || !window.CornerIdentity.isAccount()) return;
    const { data, error } = await client
      .from("corner_notifications")
      .select("id,actor_id,actor_role,recipient_role,kind,title,body,url,created_at,read_by")
      .eq("site_id", config.siteId || "princess-frog-corner")
      .order("created_at", { ascending: false })
      .limit(40);
    if (!error) {
      notifications = data || [];
      renderNotifications();
    }
  }

  async function markNotificationRead(id) {
    const client = window.CornerIdentity?.client;
    const userId = identity().user?.id;
    const item = notifications.find((entry) => entry.id === id);
    if (!client || !userId || !item) return;
    const readBy = [...new Set([...(item.read_by || []), userId])];
    item.read_by = readBy;
    renderNotifications();
    await client.from("corner_notifications").update({ read_by: readBy }).eq("id", id);
  }

  async function markAllNotificationsRead() {
    const userId = identity().user?.id;
    if (!userId) return;
    await Promise.all(notifications.map((item) => markNotificationRead(item.id)));
    runtime()?.toast("Notifications marked as read");
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function enablePushNotifications() {
    if (!window.CornerIdentity?.isAccount()) {
      runtime()?.toast("Notifications become private after account sign-in");
      return;
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      runtime()?.toast("This browser does not support push notifications");
      return;
    }
    if (!config.vapidPublicKey) {
      runtime()?.toast("Add the VAPID public key to finish push setup");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      runtime()?.toast("Notification permission was not enabled");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });
    }
    const json = subscription.toJSON();
    const { error } = await window.CornerIdentity.client.from("push_subscriptions").upsert({
      endpoint: subscription.endpoint,
      user_id: identity().user.id,
      site_id: config.siteId || "princess-frog-corner",
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    runtime()?.toast(error ? "Could not save notification permission" : "Private notifications enabled");
  }

  function notificationForChange(key, value) {
    if (key === "pf_love_notes") return { kind: "love", title: `${roleName(identity().role)} left a love note`, body: "A new little note is waiting for you.", url: "love.html" };
    if (key === "pf_memory_items") return { kind: "memory", title: "Memory Wall updated", body: `${roleName(identity().role)} added something to your story.`, url: "memories.html" };
    if (key === "pf_letter_categories") return { kind: "letter", title: "Open When Letters updated", body: "There is something new in the letter shelf.", url: "letters.html" };
    if (key.startsWith("pf_media_letter_")) return { kind: "letter", title: "A voice note is waiting", body: `${roleName(identity().role)} recorded something for you.`, url: "letters.html" };
    if (key.startsWith("pf_media_memory_")) return { kind: "memory", title: "A memory has new media", body: `${roleName(identity().role)} added a recording to the Memory Wall.`, url: "memories.html" };
    if (key === "pf_messages" && Array.isArray(value) && value[0]?.sender === identity().role) return { kind: "message", title: `${roleName(identity().role)} sent a message`, body: value[0].text?.slice(0, 90) || "Open your chat.", url: "messages.html" };
    if (/^pf_ritual_\d{4}-\d{2}-\d{2}_(frog|princess)$/.test(key)) return { kind: "ritual", title: `${roleName(identity().role)} completed today's ritual`, body: "Your shared reveal may be ready.", url: "index.html#dailyRitual" };
    if (key === "pf_date_ideas") return { kind: "date", title: `${roleName(identity().role)} updated your date shortlist`, body: "A date idea is waiting for your vote.", url: "index.html#datePlanner" };
    if (key === "pf_date_selected") return { kind: "date", title: "Your next date has been chosen", body: "Open the planner to see tonight's pick.", url: "index.html#datePlanner" };
    if (key === "pf_movie_items") return { kind: "movie", title: `${roleName(identity().role)} updated the Movie Shelf`, body: "A film was added, watched, ranked, or rated.", url: "movies.html" };
    if (["pf_number_duel_round", "pf_word_round"].includes(key) && value?.id) return { kind: "game", title: `${roleName(identity().role)} started a game`, body: key.includes("word") ? "A Secret Word duel is ready." : "A Guess Number duel is ready.", url: "game.html" };
    if (key === "pf_game_invite" && value?.id && value.from === identity().role) return { kind: "game", title: `${roleName(identity().role)} invited you to play`, body: value.label || "A new game is waiting.", url: `game.html?game=${encodeURIComponent(value.game || "number")}` };
    return null;
  }

  async function createNotification(details) {
    const me = identity();
    const client = window.CornerIdentity?.client;
    if (!details || !client || me.mode !== "account") return;
    const recipientRole = otherRole(me.role);
    const preferences = notificationPreferences(recipientRole);
    if (preferences.enabled?.[details.kind] === false) return;
    const storedDetails = preferences.preview === false
      ? { ...details, body: "Something new is waiting in your private corner." }
      : details;
    const { data, error } = await client.from("corner_notifications").insert({
      site_id: config.siteId || "princess-frog-corner",
      actor_id: me.user.id,
      actor_role: me.role,
      recipient_role: recipientRole,
      ...storedDetails
    }).select("id").single();
    if (error || !data) return;
    if (!inQuietHours(preferences)) {
      client.functions.invoke("send-notification", { body: { notificationId: data.id } }).catch(() => {});
    }
  }

  async function fromSharedChange(key, value) {
    const details = notificationForChange(key, value);
    if (!details) return;
    const now = Date.now();
    if (now - Number(notificationCooldowns.get(key) || 0) < 5000) return;
    notificationCooldowns.set(key, now);
    await createNotification(details);
  }

  async function initializeNotifications() {
    ensureAccountCenter();
    if (!window.CornerIdentity?.isAccount()) return;
    await loadNotifications();
    const client = window.CornerIdentity.client;
    notificationChannel = client
      .channel(`corner-notifications-${config.siteId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "corner_notifications",
        filter: `site_id=eq.${config.siteId || "princess-frog-corner"}`
      }, async (payload) => {
        const item = payload.new;
        if (item.actor_id !== identity().user.id && (!item.recipient_role || item.recipient_role === identity().role)) {
          runtime()?.toast(item.title);
          if (document.hidden && Notification.permission === "granted") {
            const registration = await navigator.serviceWorker.ready;
            registration.showNotification(item.title, {
              body: item.body,
              icon: "images/icon-192.png",
              data: { url: item.url }
            });
          }
        }
        loadNotifications();
      })
      .subscribe();
  }

  function extensionForType(type) {
    if (type.includes("mp4")) return "mp4";
    if (type.includes("mpeg")) return "mp3";
    if (type.includes("quicktime")) return "mov";
    return "webm";
  }

  async function signedMediaUrl(path) {
    const cached = signedMediaCache.get(path);
    if (cached && cached.expires > Date.now()) return cached.url;
    const client = window.CornerIdentity?.client;
    if (!client) return "";
    const { data, error } = await client.storage.from("corner-media").createSignedUrl(path, 3600);
    if (error) return "";
    signedMediaCache.set(path, { url: data.signedUrl, expires: Date.now() + 50 * 60 * 1000 });
    return data.signedUrl;
  }

  async function renderMediaStudio(studio) {
    const list = studio.querySelector(".media-attachment-list");
    const attachments = runtime().shared.get(studio.dataset.mediaKey, []);
    if (!Array.isArray(attachments) || !attachments.length) {
      list.innerHTML = "";
      list.hidden = true;
      studio.classList.add("media-studio-empty");
      return;
    }
    list.hidden = false;
    studio.classList.remove("media-studio-empty");
    const rows = await Promise.all(attachments.map(async (item) => ({ ...item, url: await signedMediaUrl(item.path) })));
    list.innerHTML = rows.map((item) => {
      const safeUrl = escapeHtml(item.url);
      const player = item.type?.startsWith("video/")
        ? `<video controls preload="metadata" src="${safeUrl}"></video>`
        : `<audio controls preload="metadata" src="${safeUrl}"></audio>`;
      return `<article class="media-attachment" data-media-id="${escapeHtml(item.id)}">${player}<div><strong>${item.type?.startsWith("video/") ? "Video memory" : "Voice note"}</strong><small>${roleName(item.createdBy)} · ${formatRelativeDate(item.createdAt)}</small></div><button class="item-action delete-media" type="button" aria-label="Delete recording">&times;</button></article>`;
    }).join("");
    list.querySelectorAll(".delete-media").forEach((button) => {
      button.addEventListener("click", () => deleteMedia(studio, button.closest(".media-attachment").dataset.mediaId));
    });
  }

  async function uploadMedia(studio, blob, filename) {
    if (!window.CornerIdentity?.isAccount()) {
      runtime()?.toast("Sign in with your private account to add recordings");
      return;
    }
    if (!blob.type.startsWith("audio/") && !blob.type.startsWith("video/")) {
      runtime()?.toast("Choose an audio or video file");
      return;
    }
    if (blob.size > 50 * 1024 * 1024) {
      runtime()?.toast("Keep recordings under 50 MB");
      return;
    }
    const status = studio.querySelector(".media-status");
    status.textContent = "Uploading...";
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const kind = studio.dataset.mediaKind;
    const itemId = studio.dataset.itemId;
    const extension = extensionForType(blob.type);
    const path = `${config.siteId || "princess-frog-corner"}/${kind}/${itemId}/${id}.${extension}`;
    const { error } = await window.CornerIdentity.client.storage.from("corner-media").upload(path, blob, {
      contentType: blob.type,
      cacheControl: "3600",
      upsert: false
    });
    if (error) {
      status.textContent = "Upload failed. Run the media storage upgrade first.";
      return;
    }
    const key = studio.dataset.mediaKey;
    const saved = runtime().shared.get(key, []);
    const next = [...(Array.isArray(saved) ? saved : []), {
      id,
      path,
      name: filename || `recording.${extension}`,
      type: blob.type,
      createdAt: new Date().toISOString(),
      createdBy: identity().role
    }].slice(-12);
    await runtime().shared.set(key, next);
    status.textContent = "";
    await renderMediaStudio(studio);
    runtime()?.toast(blob.type.startsWith("video/") ? "Video memory saved" : "Voice note saved");
  }

  async function deleteMedia(studio, id) {
    if (!window.CornerIdentity?.isAccount()) return;
    const key = studio.dataset.mediaKey;
    const saved = runtime().shared.get(key, []);
    const item = saved.find((entry) => entry.id === id);
    if (!item || !window.confirm("Delete this recording?")) return;
    await window.CornerIdentity.client.storage.from("corner-media").remove([item.path]);
    await runtime().shared.set(key, saved.filter((entry) => entry.id !== id));
    signedMediaCache.delete(item.path);
    renderMediaStudio(studio);
    runtime()?.toast("Recording deleted");
  }

  function preferredRecorderType(kind) {
    const candidates = kind === "video"
      ? ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    return candidates.find((type) => window.MediaRecorder?.isTypeSupported?.(type)) || "";
  }

  async function toggleRecording(studio, kind, button) {
    if (activeRecorder) {
      if (activeRecorder.studio === studio) activeRecorder.recorder.stop();
      else runtime()?.toast("Finish the current recording first");
      return;
    }
    if (!window.CornerIdentity?.isAccount()) {
      runtime()?.toast("Sign in with your private account to record");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      runtime()?.toast("Recording is not supported in this browser");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === "video" ? { audio: true, video: { facingMode: "user" } } : { audio: true });
      const mimeType = preferredRecorderType(kind);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const status = studio.querySelector(".media-status");
      const startedAt = Date.now();
      let timer = null;
      const preview = studio.querySelector(".recording-preview");
      if (kind === "video") {
        preview.hidden = false;
        preview.srcObject = stream;
        preview.play().catch(() => {});
      }
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        preview.hidden = true;
        preview.srcObject = null;
        button.classList.remove("recording");
        button.textContent = kind === "video" ? "Record video" : "Record voice";
        activeRecorder = null;
        const type = recorder.mimeType || (kind === "video" ? "video/webm" : "audio/webm");
        const blob = new Blob(chunks, { type });
        status.textContent = "Saving recording...";
        await uploadMedia(studio, blob, `${kind}-${Date.now()}.${extensionForType(type)}`);
      });
      recorder.start(500);
      button.classList.add("recording");
      button.textContent = "Stop and save";
      timer = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        status.textContent = `Recording ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        if (seconds >= 120 && recorder.state === "recording") recorder.stop();
      }, 500);
      activeRecorder = { recorder, stream, studio, button, timer };
    } catch (error) {
      console.warn("Recording permission failed.", error);
      runtime()?.toast("Camera or microphone permission was not granted");
    }
  }

  function createMediaStudio({ key, kind, itemId, allowVideo }) {
    const studio = document.createElement("section");
    studio.className = "media-studio";
    studio.dataset.mediaKey = key;
    studio.dataset.mediaKind = kind;
    studio.dataset.itemId = itemId;
    studio.innerHTML = `
      <div class="media-attachment-list" hidden></div>
      <video class="recording-preview" muted playsinline hidden></video>
      <div class="media-controls">
        <button class="btn record-audio" type="button">Record voice</button>
        ${allowVideo ? '<button class="btn record-video" type="button">Record video</button>' : ''}
        <label class="btn media-upload">Upload media<input type="file" accept="audio/*${allowVideo ? ",video/*" : ""}"></label>
      </div>
      <small class="media-status" aria-live="polite"></small>
    `;
    studio.querySelector(".record-audio").addEventListener("click", (event) => toggleRecording(studio, "audio", event.currentTarget));
    studio.querySelector(".record-video")?.addEventListener("click", (event) => toggleRecording(studio, "video", event.currentTarget));
    studio.querySelector("input[type='file']").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await uploadMedia(studio, file, file.name);
      event.target.value = "";
    });
    renderMediaStudio(studio);
    return studio;
  }

  function enhanceMediaStudios() {
    if (!runtime()) return;
    document.querySelectorAll(".letter-card[data-item-id]").forEach((card) => {
      const id = card.dataset.itemId;
      card.querySelectorAll(".letter-note").forEach((note, index) => {
        if (note.querySelector(".media-studio")) return;
        const role = index === 0 ? "frog" : "princess";
        note.appendChild(createMediaStudio({
          key: `pf_media_letter_${id}_${role}`,
          kind: "letter",
          itemId: `${id}-${role}`,
          allowVideo: false
        }));
      });
    });
    document.querySelectorAll(".memory-card[data-item-id]").forEach((card) => {
      if (card.querySelector(".media-studio")) return;
      const id = card.dataset.itemId;
      card.querySelector(".memory-copy")?.appendChild(createMediaStudio({
        key: `pf_media_memory_${id}`,
        kind: "memory",
        itemId: id,
        allowVideo: true
      }));
    });
  }

  function initializeMedia() {
    if (!['letters', 'memories'].includes(document.body.dataset.page)) return;
    enhanceMediaStudios();
    mediaObserver = new MutationObserver(() => requestAnimationFrame(enhanceMediaStudios));
    mediaObserver.observe(document.querySelector("main"), { childList: true, subtree: true });
    document.addEventListener("corner:remote-change", (event) => {
      const key = event.detail?.new?.key || "";
      if (!key.startsWith("pf_media_")) return;
      document.querySelectorAll(`.media-studio[data-media-key="${CSS.escape(key)}"]`).forEach(renderMediaStudio);
    });
  }

  async function initialize() {
    ensureAccountCenter();
    initializePresence();
    showWelcomeExperience();
    await initializeNotifications();
    initializeMedia();
    if (window.CornerIdentity?.isAccount()) {
      document.querySelectorAll("#gameIdentity, #messageSender").forEach((field) => {
        field.value = identity().role;
        field.disabled = true;
        field.closest("label")?.classList.add("account-bound-field");
      });
    }
  }

  window.CornerNotifications = { fromSharedChange, create: createNotification, refresh: loadNotifications };
  window.CornerWelcome = { show: showWelcomeExperience, close: closeWelcome };
  registerPWA();
  if (window.CORNER_READY) initialize();
  else document.addEventListener("corner:ready", initialize, { once: true });
})();
