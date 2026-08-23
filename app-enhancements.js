(function () {
  const config = window.CORNER_CONFIG || {};
  let installPrompt = null;
  let accountCenter = null;
  let notifications = [];
  let notificationChannel = null;
  let mediaObserver = null;
  let activeRecorder = null;
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

  function ensureAccountCenter() {
    if (accountCenter) return accountCenter;
    const header = document.querySelector(".site-header");
    if (!header) return null;
    const me = identity();
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
      </div>
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
    drawer.querySelector(".sign-out-button")?.addEventListener("click", () => window.CornerIdentity.signOut());

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
    if (["pf_number_duel_round", "pf_word_round"].includes(key) && value?.id) return { kind: "game", title: `${roleName(identity().role)} started a game`, body: key.includes("word") ? "A Secret Word duel is ready." : "A Guess Number duel is ready.", url: "game.html" };
    if (key === "pf_game_invite" && value?.id && value.from === identity().role) return { kind: "game", title: `${roleName(identity().role)} invited you to play`, body: value.label || "A new game is waiting.", url: `game.html?game=${encodeURIComponent(value.game || "number")}` };
    return null;
  }

  async function createNotification(details) {
    const me = identity();
    const client = window.CornerIdentity?.client;
    if (!details || !client || me.mode !== "account") return;
    const { data, error } = await client.from("corner_notifications").insert({
      site_id: config.siteId || "princess-frog-corner",
      actor_id: me.user.id,
      actor_role: me.role,
      recipient_role: otherRole(me.role),
      ...details
    }).select("id").single();
    if (error || !data) return;
    client.functions.invoke("send-notification", { body: { notificationId: data.id } }).catch(() => {});
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
      list.innerHTML = '<p class="media-empty">No recordings yet.</p>';
      return;
    }
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
      <div class="media-attachment-list"><p class="media-empty">Loading recordings...</p></div>
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
  registerPWA();
  if (window.CORNER_READY) initialize();
  else document.addEventListener("corner:ready", initialize, { once: true });
})();
