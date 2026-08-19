(function () {
  const page = document.body.dataset.page;
  const toastEl = document.getElementById("toast");
  const config = window.CORNER_CONFIG || {};
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const supabaseClient = hasSupabaseConfig
    ? window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey)
    : null;
  const siteId = config.siteId || "princess-frog-corner";
  const passcode = config.passcode || "";
  const authKey = `pf_auth_${siteId}`;
  const remoteCache = {};
  const controllers = {};
  let remoteReady = false;
  let remotePullPromise = null;
  let syncStatusEl = null;

  const defaultLoveNotes = [
    "The frog misses his princess 🐸👑",
    "You are my favourite notification 💕",
    "I choose you every time.",
    "You looked too good in this memory.",
    "You deserve flowers, softness, and peace.",
    "The frog knew he was lucky.",
    "My princess makes ordinary days feel golden."
  ];

  function toast(message = "Saved 💕") {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastEl.timer);
    toastEl.timer = setTimeout(() => toastEl.classList.remove("show"), 1400);
  }

  function localGet(key, fallback = "") {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  function localSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  const shared = {
    async init() {
      if (!supabaseClient) return;
      const connected = await this.pull();
      if (!connected) {
        updateSyncStatus("offline");
        toast("Offline mode");
        return;
      }
      subscribeToRemoteChanges();
      const pollDelay = page === "game" ? 2000 : page === "messages" ? 4000 : 10000;
      window.setInterval(async () => {
        if (await this.pull()) refreshCurrentPage(false);
      }, pollDelay);
    },
    async pull(requireFresh = false) {
      if (!supabaseClient) return false;
      if (remotePullPromise) {
        const connected = await remotePullPromise;
        if (!requireFresh) return connected;
      }
      const pullPromise = (async () => {
        const { data, error } = await supabaseClient
          .from("corner_kv")
          .select("key,value")
          .eq("site_id", siteId);
        if (error) {
          console.warn("Supabase load failed, using localStorage.", error);
          updateSyncStatus("offline");
          return false;
        }
        const remoteKeys = new Set();
        data.forEach((row) => {
          remoteKeys.add(row.key);
          remoteCache[row.key] = row.value;
        });
        if (remoteReady) {
          Object.keys(remoteCache).forEach((key) => {
            if (!remoteKeys.has(key)) delete remoteCache[key];
          });
        }
        remoteReady = true;
        updateSyncStatus("online");
        return true;
      })();
      remotePullPromise = pullPromise;
      try {
        return await pullPromise;
      } finally {
        if (remotePullPromise === pullPromise) remotePullPromise = null;
      }
    },
    get(key, fallback = "") {
      if (remoteReady && Object.prototype.hasOwnProperty.call(remoteCache, key)) {
        return remoteCache[key];
      }
      return localGet(key, fallback);
    },
    async set(key, value) {
      localSet(key, value);
      if (!supabaseClient) return;
      remoteCache[key] = value;
      const { error } = await supabaseClient
        .from("corner_kv")
        .upsert({
          site_id: siteId,
          key,
          value,
          updated_at: new Date().toISOString()
        });
      if (error) {
        console.warn("Supabase save failed.", error);
        updateSyncStatus("offline");
        toast("Saved on this device");
      } else {
        updateSyncStatus("online");
      }
    },
    async uploadPhoto(file, memoryId) {
      if (!supabaseClient) {
        toast("Photo uploads need shared mode");
        return null;
      }
      const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${siteId}/${memoryId}-${Date.now()}.${extension || "jpg"}`;
      const { error } = await supabaseClient.storage
        .from("corner-photos")
        .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type });
      if (error) {
        console.warn("Photo upload failed.", error);
        toast("Photo storage needs setup");
        return null;
      }
      const { data } = supabaseClient.storage.from("corner-photos").getPublicUrl(path);
      return data.publicUrl;
    }
  };

  function subscribeToRemoteChanges() {
    if (!supabaseClient) return;
    supabaseClient
      .channel(`corner-kv-${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "corner_kv",
          filter: `site_id=eq.${siteId}`
        },
        (payload) => {
          if (payload.eventType === "DELETE") delete remoteCache[payload.old.key];
          if (payload.new) remoteCache[payload.new.key] = payload.new.value;
          refreshCurrentPage(false);
        }
      )
      .subscribe();
  }

  function debounce(fn, delay = 450) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value ?? "");
    return element.innerHTML;
  }

  function saveOnInput(input, key) {
    input.value = shared.get(key, "");
    const save = debounce(async () => {
      await shared.set(key, input.value);
      toast("Saved 💕");
    });
    input.addEventListener("input", save);
  }

  function addStatusPill() {
    const header = document.querySelector(".site-header");
    if (!header) return;
    syncStatusEl = document.createElement("span");
    syncStatusEl.className = "sync-status local";
    syncStatusEl.textContent = supabaseClient ? "Connecting" : "Local mode";
    syncStatusEl.title = supabaseClient
      ? "Checking the shared Supabase connection"
      : "Add Supabase details in supabase-config.js to sync across devices";
    header.appendChild(syncStatusEl);
  }

  function updateSyncStatus(mode) {
    if (!syncStatusEl) return;
    syncStatusEl.className = `sync-status ${mode}`;
    if (mode === "online") {
      syncStatusEl.textContent = "Shared mode";
      syncStatusEl.title = "Connected to shared Supabase storage";
      return;
    }
    if (mode === "offline") {
      syncStatusEl.textContent = "Offline mode";
      syncStatusEl.title = "Shared storage is unavailable; changes are staying on this device";
      return;
    }
    syncStatusEl.textContent = "Local mode";
  }

  function requirePasscode() {
    if (!passcode || passcode === "change-this-passcode") return Promise.resolve();
    if (sessionStorage.getItem(authKey) === "yes") return Promise.resolve();

    return new Promise((resolve) => {
      const gate = document.createElement("div");
      gate.className = "passcode-gate";
      gate.innerHTML = `
        <form class="passcode-card">
          <p class="eyebrow">Private corner</p>
          <h1>Princess and the Frog's Corner 🐸👑</h1>
          <p>Enter the shared passcode to come in.</p>
          <input type="password" autocomplete="current-password" placeholder="Passcode" aria-label="Passcode">
          <button class="btn primary" type="submit">Unlock 💕</button>
          <p class="passcode-error" aria-live="polite"></p>
        </form>
      `;
      document.body.appendChild(gate);
      const form = gate.querySelector("form");
      const input = gate.querySelector("input");
      const error = gate.querySelector(".passcode-error");
      input.focus();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (input.value === passcode) {
          sessionStorage.setItem(authKey, "yes");
          gate.remove();
          toast("Welcome 💕");
          resolve();
        } else {
          error.textContent = "Wrong passcode, try again.";
          input.value = "";
          input.focus();
        }
      });
    });
  }

  function markActiveNav() {
    const current = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav a").forEach((link) => {
      if (link.getAttribute("href") === current) link.classList.add("active");
    });
  }

  function getLoveNotes() {
    return shared.get("pf_love_notes", defaultLoveNotes);
  }

  async function setLoveNotes(notes) {
    await shared.set("pf_love_notes", notes);
  }

  function showRandomLoveNote() {
    const notes = getLoveNotes();
    const note = notes[Math.floor(Math.random() * notes.length)] || "You are loved 💕";
    const output = document.getElementById("homeRandomNote") || document.getElementById("loveRandomNote");
    if (output) output.textContent = note;
  }

  function setupRandomButtons() {
    document.querySelectorAll("[data-random-love]").forEach((button) => {
      button.addEventListener("click", showRandomLoveNote);
    });
  }

  function initLetters() {
    const categories = [
      ["sad", "Open when you are sad 🥺🫂"],
      ["happy", "Open when you are happy 😁🌸"],
      ["miss", "Open when you miss me 🥹💭"],
      ["mood", "Open when you are in the mood, wink 😉🌝"],
      ["stressed", "Open when you are stressed 😭📚"],
      ["love", "Open when you need love 💕🫶"]
    ];
    const list = document.getElementById("lettersList");
    if (!list) return;

    list.innerHTML = categories.map(([id, title], index) => `
      <article class="letter-card ${index === 0 ? "open" : ""}">
        <button class="letter-toggle" type="button">
          <strong>${title}</strong>
          <span>⌄</span>
        </button>
        <div class="letter-content">
          <div>
            <label>Frog's note 🐸
              <textarea id="derek-${id}" data-key="openwhen_derek_${id}" placeholder="Write Frog's note..."></textarea>
            </label>
            <button class="btn clear-note" type="button" data-target="derek-${id}">Clear note</button>
          </div>
          <div>
            <label>Princess's note 👑
              <textarea id="princess-${id}" data-key="openwhen_princess_${id}" placeholder="Write Princess's note..."></textarea>
            </label>
            <button class="btn clear-note" type="button" data-target="princess-${id}">Clear note</button>
          </div>
        </div>
      </article>
    `).join("");

    list.querySelectorAll(".letter-toggle").forEach((button) => {
      button.addEventListener("click", () => button.closest(".letter-card").classList.toggle("open"));
    });
    list.querySelectorAll("textarea").forEach((textarea) => saveOnInput(textarea, textarea.dataset.key));
    list.querySelectorAll(".clear-note").forEach((button) => {
      button.addEventListener("click", async () => {
        const target = document.getElementById(button.dataset.target);
        target.value = "";
        await shared.set(target.dataset.key, "");
        toast("Cleared 💕");
      });
    });
  }

  function initMemoriesLegacy() {
    const memories = [
      ["alton", "Alton Towers 🎢", "images/memory1.jpeg"],
      ["museum", "Museum of Illusions ✨", "images/memory2.jpeg"],
      ["train", "Train ride 🚆", "images/memory11.jpeg"],
      ["chill", "Chill day 🍦", "images/memory3.jpeg"],
      ["f1", "F1 🏎️", "images/memory4.jpeg"],
    ["flowers", "Flowers for my princess 🌷", "images/flowers-for-my-princess.png", true],
      ["hike", "The Hike 🏞️🥾", "images/memory6.jpeg"],
      ["date-night", "Date night ❤️", "images/memory7.jpeg"],
      ["birthday", "Her birthday 🎂", "images/memory8.jpeg"],
      ["go-ape", "Vals / GO APE 🌲", "images/memory9.jpeg"],
      ["first-date", "Our first date 💕", "images/memory10.jpeg"]
    ];
    const grid = document.getElementById("memoryGrid");
    if (!grid) return;

    grid.innerHTML = memories.map(([id, title, src, featured]) => `
      <article class="memory-card ${featured ? "featured" : ""}">
        <img src="${src}" alt="${title}" data-title="${title}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';">
        <div class="image-placeholder" style="display:none;">Add photo later<br>${title}</div>
        <div class="memory-fields">
          <h3>${title}</h3>
          <label>Date
            <input type="text" data-key="pf_memory_${id}_date" placeholder="Add date">
          </label>
          <label>Caption
            <textarea data-key="pf_memory_${id}_caption" placeholder="Add a cute caption"></textarea>
          </label>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll("input, textarea").forEach((field) => saveOnInput(field, field.dataset.key));
    grid.querySelectorAll("img").forEach((img) => {
      img.addEventListener("click", () => openLightbox(img.src, img.dataset.title));
    });
    setupLightbox();
  }

  function initMemories() {
    const grid = document.getElementById("memoryGrid");
    if (!grid) return;
    if (controllers.memories) {
      controllers.memories.refresh();
      return;
    }

    const memories = [
      ["alton", "Alton Towers 🎢", "images/memory1.jpeg"],
      ["museum", "Museum of Illusions ✨", "images/memory2.jpeg"],
      ["train", "Train ride 🚆", "images/memory11.jpeg"],
      ["chill", "Chill day 🍦", "images/memory3.jpeg"],
      ["f1", "F1 🏎️", "images/memory4.jpeg"],
      ["flowers", "Flowers for my princess 🌷", "images/memory5.jpeg", true],
      ["hike", "The Hike 🏞️🥾", "images/memory6.jpeg"],
      ["date-night", "Date night ❤️", "images/memory7.jpeg"],
      ["birthday", "Her birthday 🎂", "images/memory8.jpeg"],
      ["go-ape", "Vals / GO APE 🌲", "images/memory9.jpeg"],
      ["first-date", "Our first date 💕", "images/memory10.jpeg"]
    ];

    grid.innerHTML = memories.map(([id, title, src, featured]) => `
      <article class="memory-card ${featured ? "featured" : ""}" data-memory-id="${id}">
        <div class="memory-photo">
          <img src="${src}" data-default-src="${src}" alt="${title}" data-title="${title}">
          <div class="image-placeholder" hidden>Add a photo<br>${title}</div>
          <label class="photo-upload-btn" title="Upload a new photo">
            <span>📷 Replace photo</span>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" data-photo-id="${id}">
          </label>
        </div>
        <div class="memory-fields">
          <h3>${title}</h3>
          <label>Date
            <input type="text" data-key="pf_memory_${id}_date" placeholder="Add date">
          </label>
          <label>Caption
            <textarea data-key="pf_memory_${id}_caption" placeholder="Add a cute caption"></textarea>
          </label>
          <small class="upload-state" id="uploadState-${id}" aria-live="polite"></small>
        </div>
      </article>
    `).join("");

    grid.querySelectorAll("input[data-key], textarea[data-key]").forEach((field) => {
      saveOnInput(field, field.dataset.key);
    });

    function renderPhotos() {
      memories.forEach(([id]) => {
        const card = grid.querySelector(`[data-memory-id="${id}"]`);
        const img = card.querySelector("img");
        const placeholder = card.querySelector(".image-placeholder");
        const savedPhoto = shared.get(`pf_memory_${id}_photo`, "");
        const nextSrc = savedPhoto || img.dataset.defaultSrc;
        if (img.src !== new URL(nextSrc, location.href).href) img.src = nextSrc;
        img.hidden = false;
        placeholder.hidden = true;
      });
      grid.querySelectorAll("input[data-key], textarea[data-key]").forEach((field) => {
        if (document.activeElement !== field) field.value = shared.get(field.dataset.key, "");
      });
    }

    grid.querySelectorAll(".memory-photo img").forEach((img) => {
      const placeholder = img.nextElementSibling;
      img.addEventListener("load", () => {
        img.hidden = false;
        placeholder.hidden = true;
      });
      img.addEventListener("error", () => {
        img.hidden = true;
        placeholder.hidden = false;
      });
      img.addEventListener("click", () => openLightbox(img.src, img.dataset.title));
    });

    grid.querySelectorAll("input[type='file']").forEach((input) => {
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        const state = document.getElementById(`uploadState-${input.dataset.photoId}`);
        if (!file.type.startsWith("image/")) {
          state.textContent = "Choose an image file.";
          input.value = "";
          return;
        }
        if (file.size > 8 * 1024 * 1024) {
          state.textContent = "Choose an image under 8 MB.";
          input.value = "";
          return;
        }

        const uploadButton = input.closest(".photo-upload-btn");
        uploadButton.classList.add("uploading");
        state.textContent = "Uploading photo…";
        const publicUrl = await shared.uploadPhoto(file, input.dataset.photoId);
        uploadButton.classList.remove("uploading");
        input.value = "";
        if (!publicUrl) {
          state.textContent = "Upload failed. Run the updated Supabase setup first.";
          return;
        }
        await shared.set(`pf_memory_${input.dataset.photoId}_photo`, publicUrl);
        state.textContent = "Photo shared on both devices.";
        renderPhotos();
        toast("Photo uploaded 📸");
      });
    });

    setupLightbox();
    controllers.memories = { refresh: renderPhotos };
    renderPhotos();
  }

  function openLightbox(src, title) {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightbox.querySelector("img").src = src;
    lightbox.querySelector("img").alt = title;
    lightbox.querySelector("p").textContent = title;
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
  }

  function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
  }

  function setupLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target.classList.contains("lightbox-close")) closeLightbox();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeLightbox();
    });
  }

  function initBadges() {
    const badges = [
      ["first-date", "First Date Unlocked 💕"],
      ["said-yes", "She Said Yes — 21 June 💍"],
      ["flowers", "Flowers Delivered 🌷"],
      ["gifts", "Gifts Given 🎁"],
      ["go-ape", "Survived GO APE 🌲"],
      ["birthday", "Her Birthday 🎂"],
      ["f1", "F1 Moment 🏎️"],
      ["train", "Train Ride Memories 🚆"],
      ["museum", "Museum Day ✨"],
      ["alton", "Alton Towers Done 🎢"],
      ["hike", "The Hike 🥾"],
      ["date-night", "Date Night ❤️"]
    ];
    const grid = document.getElementById("badgeGrid");
    if (!grid) return;
    const unlocked = shared.get("pf_badges", {});

    function renderProgress() {
      const count = badges.filter(([id]) => unlocked[id]).length;
      document.getElementById("badgeProgressText").textContent = `Unlocked ${count} / ${badges.length} badges`;
      document.getElementById("badgeProgressBar").style.width = `${(count / badges.length) * 100}%`;
    }

    grid.innerHTML = badges.map(([id, label]) => `
      <button class="badge-card ${unlocked[id] ? "unlocked" : "locked"}" type="button" data-id="${id}">
        <span class="badge-emoji">${label.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]|\u2764\uFE0F|\u2728/)?.[0] || "🏆"}</span>
        <strong>${label}</strong>
      </button>
    `).join("");

    grid.querySelectorAll(".badge-card").forEach((badge) => {
      badge.addEventListener("click", async () => {
        const id = badge.dataset.id;
        unlocked[id] = !unlocked[id];
        await shared.set("pf_badges", unlocked);
        badge.classList.toggle("unlocked", unlocked[id]);
        badge.classList.toggle("locked", !unlocked[id]);
        renderProgress();
        toast(unlocked[id] ? "Unlocked 💕" : "Locked");
      });
    });
    renderProgress();
  }

  const gamePlayers = ["frog", "princess"];
  const gamePresenceWindowMs = 90000;

  function isGamePlayer(player) {
    return gamePlayers.includes(player);
  }

  function setupGameHub() {
    const identity = document.getElementById("gameIdentity");
    const tabs = [...document.querySelectorAll("[data-game-tab]")];
    if (!identity || !tabs.length) return;
    if (controllers.gameHub) {
      controllers.gameHub.refresh();
      return;
    }

    const panels = {
      number: document.getElementById("numberGamePanel"),
      word: document.getElementById("wordGamePanel"),
      same: document.getElementById("sameGamePanel")
    };
    const savedIdentity = sessionStorage.getItem("pf_game_player");
    identity.value = ["frog", "princess"].includes(savedIdentity) ? savedIdentity : "";

    function selectGame(name) {
      const selected = panels[name] ? name : "number";
      localStorage.setItem("pf_active_game", selected);
      tabs.forEach((tab) => {
        const active = tab.dataset.gameTab === selected;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
      });
      Object.entries(panels).forEach(([panelName, panel]) => {
        panel.hidden = panelName !== selected;
      });
    }

    function renderPresence() {
      const now = Date.now();
      ["frog", "princess"].forEach((player) => {
        const label = document.getElementById(`${player}Presence`);
        const seenAt = Date.parse(shared.get(`pf_presence_${player}`, ""));
        const online = Number.isFinite(seenAt) && now - seenAt < gamePresenceWindowMs;
        const displayName = player === "frog" ? "Frog" : "Princess";
        label.classList.toggle("online", online);
        label.lastChild.textContent = online ? ` ${displayName} is here` : ` ${displayName} is away`;
      });
    }

    async function heartbeat() {
      if (!["frog", "princess"].includes(identity.value)) {
        renderPresence();
        return;
      }
      await shared.set(`pf_presence_${identity.value}`, new Date().toISOString());
      renderPresence();
      controllers.numberGame?.refresh();
      controllers.wordGame?.refresh();
      controllers.sameGame?.refresh();
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => selectGame(tab.dataset.gameTab));
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + direction + tabs.length) % tabs.length];
        selectGame(next.dataset.gameTab);
        next.focus();
      });
    });

    identity.addEventListener("change", async () => {
      if (!["frog", "princess"].includes(identity.value)) return;
      sessionStorage.setItem("pf_game_player", identity.value);
      await heartbeat();
      controllers.numberGame?.refresh();
      controllers.wordGame?.refresh();
      controllers.sameGame?.refresh();
    });

    const wakeHeartbeat = () => {
      if (!document.hidden) heartbeat();
    };
    controllers.gameHub = { refresh: renderPresence, heartbeat };
    selectGame(localStorage.getItem("pf_active_game") || "number");
    heartbeat();
    window.addEventListener("focus", wakeHeartbeat);
    window.addEventListener("online", wakeHeartbeat);
    document.addEventListener("visibilitychange", wakeHeartbeat);
    setInterval(wakeHeartbeat, 15000);
  }

  function initSameGame() {
    const identity = document.getElementById("gameIdentity");
    const questionEl = document.getElementById("sameQuestion");
    const optionA = document.getElementById("sameOptionA");
    const optionB = document.getElementById("sameOptionB");
    if (!identity || !questionEl) return;
    if (controllers.sameGame) {
      controllers.sameGame.refresh();
      return;
    }

    const questions = [
      ["Perfect date tonight?", "Stay in", "Go out"],
      ["Pick the snack table.", "Sweet", "Salty"],
      ["Dream little escape?", "Beach", "City"],
      ["Movie mood?", "Comedy", "Romance"],
      ["Weekend alarm?", "Early adventure", "Sleep in"],
      ["Choose the weather.", "Sunny", "Rainy"],
      ["Road-trip soundtrack?", "Sing everything", "Quiet and cosy"],
      ["Surprise gift?", "Something useful", "Something sentimental"],
      ["Dinner plan?", "Cook together", "Order a favourite"],
      ["Pick a pet name style.", "Cute", "Silly"],
      ["Photo together?", "Perfect pose", "Candid moment"],
      ["Holiday energy?", "Plan everything", "Decide as we go"],
      ["Which message wins?", "Good morning text", "Goodnight call"],
      ["A free afternoon?", "Games together", "Long walk"],
      ["Dessert choice?", "Cake", "Ice cream"],
      ["Celebrate a win?", "Big outing", "Private little moment"]
    ];
    const defaultRound = { id: null, questionIndex: -1, startedAt: null };
    const defaultStats = { matches: 0, rounds: 0, lastScoredRound: null };
    let round = { ...defaultRound, ...shared.get("pf_same_round", defaultRound) };
    let stats = { ...defaultStats, ...shared.get("pf_same_stats", defaultStats) };
    let frogAnswer = shared.get("pf_same_answer_frog", null);
    let princessAnswer = shared.get("pf_same_answer_princess", null);

    function answerFor(player) {
      const answer = player === "frog" ? frogAnswer : princessAnswer;
      return answer?.roundId === round.id ? answer.choice : null;
    }

    async function scoreIfReady() {
      const frog = answerFor("frog");
      const princess = answerFor("princess");
      if (!round.id || !frog || !princess || stats.lastScoredRound === round.id) return;
      stats = {
        matches: Number(stats.matches || 0) + (frog === princess ? 1 : 0),
        rounds: Number(stats.rounds || 0) + 1,
        lastScoredRound: round.id
      };
      await shared.set("pf_same_stats", stats);
      render();
    }

    function render() {
      const hasIdentity = isGamePlayer(identity.value);
      const question = questions[Number(round.questionIndex)] || null;
      const frog = answerFor("frog");
      const princess = answerFor("princess");
      const mine = answerFor(identity.value);
      const bothAnswered = Boolean(frog && princess);

      document.getElementById("sameMatchScore").textContent = `${stats.matches || 0} / ${stats.rounds || 0}`;
      document.getElementById("sameRoundStatus").textContent = !question ? "Ready" : bothAnswered ? "Revealed" : "Choosing";
      document.getElementById("sameFrogStatus").textContent = !question ? "Waiting" : frog ? (bothAnswered ? frog : "Locked in") : "Thinking";
      document.getElementById("samePrincessStatus").textContent = !question ? "Waiting" : princess ? (bothAnswered ? princess : "Locked in") : "Thinking";
      questionEl.textContent = question ? question[0] : "Press “New question” to begin.";
      optionA.textContent = question ? question[1] : "Option A";
      optionB.textContent = question ? question[2] : "Option B";
      optionA.disabled = !hasIdentity || !question || Boolean(mine);
      optionB.disabled = !hasIdentity || !question || Boolean(mine);
      document.getElementById("nextSameQuestion").disabled = !hasIdentity;
      optionA.classList.toggle("selected", mine === "A");
      optionB.classList.toggle("selected", mine === "B");

      const result = document.getElementById("sameResult");
      if (!hasIdentity) result.textContent = "Choose Frog or Princess before answering.";
      else if (!question) result.textContent = "Your choices stay hidden until you have both answered.";
      else if (bothAnswered) {
        const frogChoice = frog === "A" ? question[1] : question[2];
        const princessChoice = princess === "A" ? question[1] : question[2];
        result.textContent = frog === princess
          ? `Same page 💕 You both chose ${frogChoice}.`
          : `Different this time: Frog chose ${frogChoice}; Princess chose ${princessChoice}.`;
      } else if (mine) {
        result.textContent = `Choice locked. Waiting for ${identity.value === "frog" ? "Princess" : "Frog"}…`;
      } else {
        result.textContent = "Choose one. Your answer stays hidden until both are locked in.";
      }
      scoreIfReady();
    }

    function refreshFromStore() {
      round = { ...defaultRound, ...shared.get("pf_same_round", defaultRound) };
      stats = { ...defaultStats, ...shared.get("pf_same_stats", defaultStats) };
      frogAnswer = shared.get("pf_same_answer_frog", null);
      princessAnswer = shared.get("pf_same_answer_princess", null);
      render();
    }

    async function choose(choice) {
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (!isGamePlayer(identity.value) || !round.id || answerFor(identity.value)) return;
      const answer = { roundId: round.id, choice, answeredAt: new Date().toISOString() };
      if (identity.value === "frog") frogAnswer = answer;
      else princessAnswer = answer;
      await shared.set(`pf_same_answer_${identity.value}`, answer);
      render();
    }

    optionA.addEventListener("click", () => choose("A"));
    optionB.addEventListener("click", () => choose("B"));
    document.getElementById("nextSameQuestion").addEventListener("click", async () => {
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (!isGamePlayer(identity.value)) return;
      let nextIndex = Math.floor(Math.random() * questions.length);
      if (questions.length > 1 && nextIndex === Number(round.questionIndex)) {
        nextIndex = (nextIndex + 1) % questions.length;
      }
      round = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        questionIndex: nextIndex,
        startedAt: new Date().toISOString()
      };
      await shared.set("pf_same_round", round);
      render();
      toast("New question ready 💕");
    });
    document.getElementById("resetSameGame").addEventListener("click", async () => {
      stats = { ...defaultStats };
      await shared.set("pf_same_stats", stats);
      render();
      toast("Match score reset");
    });

    controllers.sameGame = { refresh: refreshFromStore };
    refreshFromStore();
  }

  function initGame() {
    const roleEl = document.getElementById("gameIdentity");
    const rangeEl = document.getElementById("gameRange");
    const secretEl = document.getElementById("secretNumber");
    const guessEl = document.getElementById("guessNumber");
    const resultEl = document.getElementById("gameResult");
    const attemptsEl = document.getElementById("attemptsText");
    const secretStatus = document.getElementById("secretStatus");
    const guessHelp = document.getElementById("guessHelp");
    const roundStatus = document.getElementById("roundStatus");
    const hostStatus = document.getElementById("hostStatus");
    const guesserStatus = document.getElementById("guesserStatus");
    if (!rangeEl || !roleEl) return;
    if (controllers.numberGame) {
      controllers.numberGame.refresh();
      return;
    }

    const players = ["frog", "princess"];
    const playerLabels = { frog: "Frog 🐸", princess: "Princess 👑" };
    const roundKey = "pf_number_duel_round";
    const defaultRound = { id: null, range: 100, startedAt: null, winner: null, winnerAt: null };
    const defaultPlayerState = { roundId: null, attempts: 0, lastGuess: null, clue: "", correctAt: null };
    let round = { ...defaultRound, ...shared.get(roundKey, defaultRound) };
    let scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_game_scores", {}) };
    let secrets = { frog: null, princess: null };
    let playerStates = { frog: { ...defaultPlayerState }, princess: { ...defaultPlayerState } };
    const savedPlayer = sessionStorage.getItem("pf_game_player");
    roleEl.value = ["frog", "princess"].includes(savedPlayer) ? savedPlayer : "";

    function otherPlayer(player) {
      return player === "frog" ? "princess" : "frog";
    }

    function isOnline(player) {
      const seenAt = Date.parse(shared.get(`pf_presence_${player}`, ""));
      return Number.isFinite(seenAt) && Date.now() - seenAt < gamePresenceWindowMs;
    }

    function recordForRound(key, fallback = null) {
      const record = shared.get(key, fallback);
      return record?.roundId === round.id ? record : fallback;
    }

    function loadRoundRecords() {
      players.forEach((player) => {
        secrets[player] = recordForRound(`pf_number_duel_secret_${player}`);
        playerStates[player] = {
          ...defaultPlayerState,
          ...(recordForRound(`pf_number_duel_state_${player}`, defaultPlayerState) || defaultPlayerState)
        };
      });
    }

    function bothReady() {
      return Boolean(round.id && secrets.frog && secrets.princess);
    }

    function winnerFromStates() {
      return players
        .filter((player) => playerStates[player].correctAt)
        .sort((a, b) => Date.parse(playerStates[a].correctAt) - Date.parse(playerStates[b].correctAt))[0] || null;
    }

    function renderScores() {
      document.getElementById("frogScore").textContent = scores.frog || 0;
      document.getElementById("princessScore").textContent = scores.princess || 0;
    }

    function renderRound() {
      const me = roleEl.value;
      const hasIdentity = players.includes(me);
      const opponent = hasIdentity ? otherPlayer(me) : null;
      const ready = bothReady();
      const winner = round.winner || winnerFromStates();
      const mySecret = hasIdentity ? secrets[me] : null;
      const myState = hasIdentity ? playerStates[me] : defaultPlayerState;

      rangeEl.value = String(round.range || 100);
      secretEl.max = rangeEl.value;
      guessEl.max = rangeEl.value;
      attemptsEl.textContent = `${playerStates.frog.attempts || 0} / ${playerStates.princess.attempts || 0}`;

      function playerStatus(player) {
        const online = isOnline(player);
        if (!round.id) return online ? "Ready" : "Away";
        if (winner) return winner === player ? "Won 🎉" : "Round over";
        if (ready) return `${playerStates[player].attempts || 0} guesses${online ? "" : " · away"}`;
        if (secrets[player]) return `Number locked${online ? "" : " · away"}`;
        return online ? "Choosing" : "Away";
      }

      hostStatus.textContent = playerStatus("frog");
      guesserStatus.textContent = playerStatus("princess");
      roundStatus.textContent = !round.id
        ? "Start a new duel"
        : winner
          ? `${playerLabels[winner]} won`
          : ready
            ? `Live: 1 to ${round.range}`
            : "Locking numbers";

      if (!hasIdentity) secretStatus.textContent = "Choose Frog or Princess before joining the duel.";
      else if (!round.id) secretStatus.textContent = me === "frog"
        ? "Start the duel, then lock your secret number."
        : "Wait for Frog to start the duel, then lock your secret number.";
      else if (winner) secretStatus.textContent = "Start a new duel when you are ready to play again.";
      else if (mySecret) secretStatus.textContent = "Your number is locked. It stays hidden from your opponent.";
      else secretStatus.textContent = `Choose a secret number from 1 to ${round.range}, then lock it.`;

      if (!ready) guessHelp.textContent = "Both players must lock their numbers before guessing.";
      else if (winner) guessHelp.textContent = `${playerLabels[winner]} won this duel.`;
      else if (!hasIdentity) guessHelp.textContent = "Choose your player before guessing.";
      else guessHelp.textContent = `Guess ${playerLabels[opponent]}'s number from 1 to ${round.range}.`;

      const resetButton = document.getElementById("resetGame");
      if (me === "frog") {
        resetButton.textContent = round.id && !winner ? "Restart duel" : "Start new duel";
      } else {
        resetButton.textContent = round.id && !winner ? "Duel in progress" : "Waiting for Frog to start";
      }
      resetButton.disabled = !hasIdentity || me !== "frog";
      document.getElementById("setSecret").disabled = !hasIdentity || !round.id || Boolean(mySecret) || Boolean(winner);
      document.getElementById("checkGuess").disabled = !hasIdentity || !ready || Boolean(winner);
      rangeEl.disabled = Boolean(round.id && !winner);
      secretEl.disabled = !hasIdentity || !round.id || Boolean(mySecret) || Boolean(winner);
      guessEl.disabled = !hasIdentity || !ready || Boolean(winner);

      if (!hasIdentity) {
        resultEl.textContent = "Choose Frog or Princess to join the game.";
      } else if (winner) {
        resultEl.textContent = winner === me
          ? `You guessed ${playerLabels[opponent]}'s number first 🎉`
          : `${playerLabels[winner]} guessed your number first.`;
      } else if (myState.clue) {
        resultEl.textContent = myState.clue;
      } else if (!round.id) {
        resultEl.textContent = me === "frog" ? "Start a new duel when both players are ready." : "Waiting for Frog to start the duel.";
      } else if (ready) {
        resultEl.textContent = "The race is live. Make your first guess.";
      } else {
        resultEl.textContent = "Waiting for both secret numbers to be locked.";
      }
    }

    function refreshFromStore() {
      round = { ...defaultRound, ...shared.get(roundKey, defaultRound) };
      scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_game_scores", {}) };
      loadRoundRecords();
      renderRound();
      renderScores();
    }

    async function refreshBeforeNumberAction() {
      if (!["frog", "princess"].includes(roleEl.value)) {
        resultEl.textContent = "Choose Frog or Princess before joining the game.";
        return false;
      }
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      return true;
    }

    roleEl.addEventListener("change", () => {
      sessionStorage.setItem("pf_game_player", roleEl.value);
      renderRound();
    });

    rangeEl.addEventListener("change", () => {
      secretEl.max = rangeEl.value;
      guessEl.max = rangeEl.value;
    });

    document.getElementById("resetGame").addEventListener("click", async () => {
      if (roleEl.value !== "frog") return;
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (round.id && !round.winner && !window.confirm("Restart this duel? Both locked numbers will be cleared.")) {
        renderRound();
        return;
      }
      const range = Number(rangeEl.value);
      round = {
        ...defaultRound,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        range,
        startedAt: new Date().toISOString()
      };
      await shared.set(roundKey, round);
      secretEl.value = "";
      guessEl.value = "";
      refreshFromStore();
      toast("New duel ready 💕");
    });

    document.getElementById("setSecret").addEventListener("click", async () => {
      if (!(await refreshBeforeNumberAction()) || !round.id || round.winner) return;
      const max = Number(round.range);
      const value = Number(secretEl.value);
      if (!value || value < 1 || value > max) {
        resultEl.textContent = `Pick a secret from 1 to ${max}.`;
        return;
      }
      const me = roleEl.value;
      await shared.set(`pf_number_duel_secret_${me}`, {
        roundId: round.id,
        value,
        lockedAt: new Date().toISOString()
      });
      secretEl.value = "";
      refreshFromStore();
      toast("Your number is locked 💕");
    });

    document.getElementById("checkGuess").addEventListener("click", async () => {
      if (!(await refreshBeforeNumberAction()) || !bothReady()) return;
      const me = roleEl.value;
      const opponent = otherPlayer(me);
      const winner = round.winner || winnerFromStates();
      if (winner) return;
      const guess = Number(guessEl.value);
      if (!guess || guess < 1 || guess > Number(round.range)) {
        resultEl.textContent = `Guess from 1 to ${round.range}.`;
        return;
      }

      const target = Number(secrets[opponent].value);
      const attempts = Number(playerStates[me].attempts || 0) + 1;
      const correctAt = guess === target ? new Date().toISOString() : null;
      let clue = `Last guess: ${guess}. Too low, go higher ⬆️`;
      if (guess > target) clue = `Last guess: ${guess}. Too high, go lower ⬇️`;
      if (correctAt) clue = `Correct in ${attempts} attempt${attempts === 1 ? "" : "s"} 🎉`;
      await shared.set(`pf_number_duel_state_${me}`, {
        roundId: round.id,
        attempts,
        lastGuess: guess,
        clue,
        correctAt
      });
      guessEl.value = "";
      refreshFromStore();

      if (correctAt) {
        const wonBy = winnerFromStates() || me;
        round = { ...round, winner: wonBy, winnerAt: playerStates[wonBy].correctAt || correctAt };
        await shared.set(roundKey, round);
        scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_game_scores", {}) };
        if (scores.lastScoredRound !== round.id) {
          scores[wonBy] = Number(scores[wonBy] || 0) + 1;
          scores.lastScoredRound = round.id;
          await shared.set("pf_game_scores", scores);
        }
        refreshFromStore();
      }
    });

    document.getElementById("resetScores").addEventListener("click", async () => {
      scores.frog = 0;
      scores.princess = 0;
      await shared.set("pf_game_scores", scores);
      renderScores();
      toast("Scores reset");
    });

    controllers.numberGame = { refresh: refreshFromStore };
    refreshFromStore();
  }
  function initWordGame() {
    const roleEl = document.getElementById("gameIdentity");
    const lengthEl = document.getElementById("wordLength");
    const secretEl = document.getElementById("secretWord");
    const guessEl = document.getElementById("wordGuess");
    const resultEl = document.getElementById("wordGameResult");
    const historyEl = document.getElementById("wordHistory");
    const attemptsEl = document.getElementById("wordAttemptsText");
    const secretStatus = document.getElementById("wordSecretStatus");
    const guessHelp = document.getElementById("wordGuessHelp");
    const roundStatus = document.getElementById("wordRoundStatus");
    const hostStatus = document.getElementById("wordHostStatus");
    const guesserStatus = document.getElementById("wordGuesserStatus");
    if (!roleEl || !lengthEl) return;
    if (controllers.wordGame) {
      controllers.wordGame.refresh();
      return;
    }

    const playerLabels = {
      frog: "Frog 🐸",
      princess: "Princess 👑"
    };
    const defaultRound = {
      phase: "waiting",
      length: 3,
      secret: null,
      host: null,
      guesser: null,
      attempts: 0,
      guesses: [],
      lastClue: "Waiting for a host to start a word round.",
      winner: null,
      updatedAt: null
    };
    let round = { ...defaultRound, ...shared.get("pf_word_round", defaultRound) };
    let scores = { frog: 0, princess: 0, ...shared.get("pf_word_scores", { frog: 0, princess: 0 }) };

    function otherPlayer(player) {
      return player === "frog" ? "princess" : "frog";
    }

    function cleanWord(value) {
      return String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
    }

    function countCommonLetters(guess, secret) {
      const counts = {};
      for (const letter of secret) counts[letter] = (counts[letter] || 0) + 1;
      let common = 0;
      for (const letter of guess) {
        if (counts[letter] > 0) {
          common += 1;
          counts[letter] -= 1;
        }
      }
      return common;
    }

    function renderScores() {
      document.getElementById("frogWordScore").textContent = scores.frog || 0;
      document.getElementById("princessWordScore").textContent = scores.princess || 0;
    }

    function renderHistory() {
      const guesses = Array.isArray(round.guesses) ? round.guesses : [];
      if (!guesses.length) {
        historyEl.innerHTML = `<p class="game-secret">No word guesses yet.</p>`;
        return;
      }
      historyEl.innerHTML = guesses.map((item) => `
        <div class="word-history-row">
          <strong>${item.guess}</strong>
          <span>${item.common} / ${round.length} common letters</span>
        </div>
      `).join("");
    }

    function renderRound() {
      const me = roleEl.value;
      const hasIdentity = isGamePlayer(me);
      const isHost = round.host === me;
      const isGuesser = round.guesser === me;
      const isWaiting = round.phase === "waiting";
      const isGuessing = round.phase === "guessing";
      const isWon = round.phase === "won";

      lengthEl.value = String(round.length || 3);
      secretEl.maxLength = Number(lengthEl.value);
      guessEl.maxLength = Number(lengthEl.value);
      attemptsEl.textContent = String(round.attempts || 0);
      hostStatus.textContent = round.host ? playerLabels[round.host] : "Not chosen";
      guesserStatus.textContent = round.guesser ? playerLabels[round.guesser] : "Not chosen";

      if (isWaiting) roundStatus.textContent = "Waiting for host";
      if (isGuessing) roundStatus.textContent = `Live: ${round.length} letters`;
      if (isWon) roundStatus.textContent = `${playerLabels[round.winner]} won`;

      secretStatus.textContent = !hasIdentity
        ? "Choose Frog or Princess before starting a word round."
        : isHost && isGuessing
        ? `You are hosting. Your ${round.length}-letter word is set.`
        : "Choose 3 letters for a quicker game, or 4 letters for increased difficulty.";
      guessHelp.textContent = !hasIdentity
        ? "Choose your player before guessing."
        : isGuesser && isGuessing
        ? `Guess the ${round.length}-letter word.`
        : round.guesser
          ? `${playerLabels[round.guesser]} is the word guesser this round.`
          : "Wait for a host to start a word round.";

      document.getElementById("setSecretWord").disabled = !hasIdentity || isGuessing;
      document.getElementById("checkWordGuess").disabled = !isGuesser || !isGuessing;
      lengthEl.disabled = isGuessing;
      secretEl.disabled = isGuessing;
      guessEl.disabled = !isGuesser || !isGuessing;

      resultEl.textContent = round.lastClue || defaultRound.lastClue;
      renderHistory();
    }

    function refreshFromStore() {
      round = { ...defaultRound, ...shared.get("pf_word_round", defaultRound) };
      scores = { frog: 0, princess: 0, ...shared.get("pf_word_scores", { frog: 0, princess: 0 }) };
      renderRound();
      renderScores();
    }

    async function saveRound(nextRound) {
      round = { ...nextRound, updatedAt: new Date().toISOString() };
      await shared.set("pf_word_round", round);
      renderRound();
    }

    roleEl.addEventListener("change", () => {
      sessionStorage.setItem("pf_game_player", roleEl.value);
      renderRound();
    });

    lengthEl.addEventListener("change", () => {
      secretEl.maxLength = Number(lengthEl.value);
      guessEl.maxLength = Number(lengthEl.value);
      secretEl.value = cleanWord(secretEl.value).slice(0, Number(lengthEl.value));
      guessEl.value = cleanWord(guessEl.value).slice(0, Number(lengthEl.value));
    });

    secretEl.addEventListener("input", () => {
      secretEl.value = cleanWord(secretEl.value).slice(0, Number(lengthEl.value));
    });

    guessEl.addEventListener("input", () => {
      guessEl.value = cleanWord(guessEl.value).slice(0, Number(round.length || lengthEl.value));
    });

    document.getElementById("setSecretWord").addEventListener("click", async () => {
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      const length = Number(lengthEl.value);
      const secret = cleanWord(secretEl.value);
      const host = roleEl.value;
      if (!isGamePlayer(host)) {
        resultEl.textContent = "Choose Frog or Princess before starting a word round.";
        return;
      }
      if (secret.length !== length) {
        resultEl.textContent = `Pick a ${length}-letter secret word.`;
        return;
      }
      await saveRound({
        ...defaultRound,
        phase: "guessing",
        length,
        secret,
        host,
        guesser: otherPlayer(host),
        lastClue: `${playerLabels[host]} started a ${length}-letter word round. ${playerLabels[otherPlayer(host)]}, guess the word.`
      });
      secretEl.value = "";
      toast("Word round started 💕");
    });

    document.getElementById("checkWordGuess").addEventListener("click", async () => {
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (round.phase !== "guessing" || roleEl.value !== round.guesser) {
        resultEl.textContent = "Wait until it is your word guessing turn.";
        return;
      }
      const guess = cleanWord(guessEl.value);
      if (guess.length !== Number(round.length)) {
        resultEl.textContent = `Enter a ${round.length}-letter guess.`;
        return;
      }

      const common = countCommonLetters(guess, round.secret);
      const attempts = Number(round.attempts || 0) + 1;
      const guesses = [...(Array.isArray(round.guesses) ? round.guesses : []), { guess, common }];
      let phase = "guessing";
      let winner = null;
      let clue = `${guess} has ${common} / ${round.length} letters in common.`;

      if (guess === round.secret) {
        phase = "won";
        winner = round.guesser;
        scores[winner] = (scores[winner] || 0) + 1;
        await shared.set("pf_word_scores", scores);
        clue = `${playerLabels[winner]} got the word ${round.secret} in ${attempts} attempt${attempts === 1 ? "" : "s"} 🎉`;
      }

      guessEl.value = "";
      await saveRound({
        ...round,
        phase,
        attempts,
        guesses,
        lastClue: clue,
        winner
      });
      renderScores();
    });

    document.getElementById("resetWordGame").addEventListener("click", async () => {
      secretEl.value = "";
      guessEl.value = "";
      await saveRound(defaultRound);
      toast("New word round ready 💕");
    });

    document.getElementById("resetWordScores").addEventListener("click", async () => {
      scores.frog = 0;
      scores.princess = 0;
      await shared.set("pf_word_scores", scores);
      renderScores();
      toast("Word scores reset");
    });

    controllers.wordGame = { refresh: refreshFromStore };
    refreshFromStore();
  }
  function initGifts() {
    const gifts = ["Gift 1", "Gift 2", "Gift 3", "Flowers", "Surprise gift"];
    const grid = document.getElementById("giftGrid");
    if (!grid) return;
    grid.innerHTML = gifts.map((gift, index) => {
      const id = `gift_${index + 1}`;
      return `
        <article class="gift-card">
          <div class="gift-image">Image placeholder<br>${gift}</div>
          <div class="gift-fields">
            <label>Gift title
              <input type="text" data-key="pf_${id}_title" data-fallback="${gift}">
            </label>
            <label>Date
              <input type="text" data-key="pf_${id}_date" placeholder="Add date">
            </label>
            <label>Note
              <textarea data-key="pf_${id}_note" placeholder="Add a cute gift note"></textarea>
            </label>
          </div>
        </article>
      `;
    }).join("");

    grid.querySelectorAll("input, textarea").forEach((field) => {
      const fallback = field.dataset.fallback || "";
      field.value = shared.get(field.dataset.key, fallback);
      const save = debounce(async () => {
        await shared.set(field.dataset.key, field.value);
        toast("Saved 💕");
      });
      field.addEventListener("input", save);
    });
  }

  function initQuotes() {
    const defaults = ["You are so yum 🌝", "Princess and the Frog", "The frog knew he was lucky"];
    const list = document.getElementById("quoteList");
    const input = document.getElementById("quoteInput");
    if (!list) return;
    let quotes = shared.get("pf_quotes", defaults);

    function render() {
      list.innerHTML = quotes.map((quote, index) => `
        <article class="quote-bubble">
          <p>“${quote}”</p>
          <button class="delete-btn" type="button" data-index="${index}" aria-label="Delete quote">×</button>
        </article>
      `).join("");
      list.querySelectorAll(".delete-btn").forEach((button) => {
        button.addEventListener("click", async () => {
          quotes.splice(Number(button.dataset.index), 1);
          await shared.set("pf_quotes", quotes);
          render();
          toast("Deleted");
        });
      });
    }

    document.getElementById("addQuote").addEventListener("click", async () => {
      const quote = input.value.trim();
      if (!quote) return;
      quotes.unshift(quote);
      input.value = "";
      await shared.set("pf_quotes", quotes);
      render();
      toast("Saved 💕");
    });
    render();
  }

  function initLovePage() {
    const list = document.getElementById("loveNoteList");
    const input = document.getElementById("loveInput");
    if (!list) return;
    let notes = getLoveNotes();

    function render() {
      list.innerHTML = notes.map((note, index) => `
        <article class="note-item">
          <p>${note}</p>
          <button class="delete-btn" type="button" data-index="${index}" aria-label="Delete love note">×</button>
        </article>
      `).join("");
      list.querySelectorAll(".delete-btn").forEach((button) => {
        button.addEventListener("click", async () => {
          notes.splice(Number(button.dataset.index), 1);
          await setLoveNotes(notes);
          render();
          toast("Deleted");
        });
      });
    }

    document.getElementById("addLoveNote").addEventListener("click", async () => {
      const note = input.value.trim();
      if (!note) return;
      notes.unshift(note);
      input.value = "";
      await setLoveNotes(notes);
      render();
      toast("Saved 💕");
    });
    render();
  }

  function initMessages() {
    const form = document.getElementById("messageForm");
    const list = document.getElementById("messageList");
    const input = document.getElementById("messageInput");
    const sender = document.getElementById("messageSender");
    if (!form || !list || !input || !sender) return;
    if (controllers.messages) {
      controllers.messages.refresh();
      return;
    }

    let messages = shared.get("pf_messages", []);
    sender.value = sessionStorage.getItem("pf_message_sender") || sessionStorage.getItem("pf_game_player") || "frog";
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });

    function render() {
      messages = Array.isArray(messages) ? messages : [];
      if (!messages.length) {
        list.innerHTML = `
          <div class="message-empty">
            <span>💌</span>
            <h2>No messages yet</h2>
            <p>The first one gets to set the mood.</p>
          </div>
        `;
        return;
      }
      list.innerHTML = messages.map((message) => {
        const isFrog = message.sender === "frog";
        const date = new Date(message.createdAt);
        const timestamp = Number.isNaN(date.getTime()) ? "" : formatter.format(date);
        return `
          <article class="message-bubble ${isFrog ? "from-frog" : "from-princess"}">
            <div class="message-meta">
              <strong>${isFrog ? "Frog 🐸" : "Princess 👑"}</strong>
              <time datetime="${escapeHtml(message.createdAt)}">${escapeHtml(timestamp)}</time>
            </div>
            <p>${escapeHtml(message.text)}</p>
            <button class="delete-btn" type="button" data-message-id="${escapeHtml(message.id)}" aria-label="Delete message" title="Delete message">×</button>
          </article>
        `;
      }).join("");

      list.querySelectorAll("[data-message-id]").forEach((button) => {
        button.addEventListener("click", async () => {
          messages = shared.get("pf_messages", messages).filter((message) => message.id !== button.dataset.messageId);
          await shared.set("pf_messages", messages);
          render();
          toast("Message deleted");
        });
      });
    }

    function refreshFromStore() {
      messages = shared.get("pf_messages", []);
      render();
    }

    sender.addEventListener("change", () => {
      sessionStorage.setItem("pf_message_sender", sender.value);
      sessionStorage.setItem("pf_game_player", sender.value);
    });
    input.addEventListener("input", () => {
      document.getElementById("messageCount").textContent = String(input.value.length);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      messages = shared.get("pf_messages", messages);
      messages = [{
        id: window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        sender: sender.value,
        text,
        createdAt: new Date().toISOString()
      }, ...(Array.isArray(messages) ? messages : [])].slice(0, 100);
      input.value = "";
      document.getElementById("messageCount").textContent = "0";
      await shared.set("pf_messages", messages);
      render();
      toast("Message sent 💕");
    });
    document.getElementById("clearMessages").addEventListener("click", async () => {
      if (!messages.length || !window.confirm("Clear every message from the shared board?")) return;
      messages = [];
      await shared.set("pf_messages", messages);
      render();
      toast("Messages cleared");
    });

    controllers.messages = { refresh: refreshFromStore };
    refreshFromStore();
  }

  function makeItemId(prefix) {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
  }

  function getManagedItems(key, defaults) {
    const saved = shared.get(key, null);
    return Array.isArray(saved) ? saved.map((item) => ({ ...item })) : defaults.map((item) => ({ ...item }));
  }

  function initLetters() {
    const list = document.getElementById("lettersList");
    const addForm = document.getElementById("letterForm");
    const titleInput = document.getElementById("newLetterTitle");
    if (!list || !addForm) return;
    if (controllers.managedLetters) {
      controllers.managedLetters.refresh();
      return;
    }

    const collectionKey = "pf_letter_categories";
    const defaults = [
      { id: "sad", title: "Open when you are sad 🥺🫂" },
      { id: "happy", title: "Open when you are happy 😁🌸" },
      { id: "miss", title: "Open when you miss me 🥹💭" },
      { id: "mood", title: "Open when you are in the mood, wink 😉🌝" },
      { id: "stressed", title: "Open when you are stressed 😭📚" },
      { id: "love", title: "Open when you need love 💕🫶" }
    ];
    let categories = getManagedItems(collectionKey, defaults);

    function render() {
      if (!categories.length) {
        list.innerHTML = '<div class="collection-empty"><span>💌</span><h2>No letters yet</h2><p>Add your first Open When category above.</p></div>';
        return;
      }
      list.innerHTML = categories.map((item, index) =>
        '<article class="letter-card ' + (index === 0 ? "open" : "") + '" data-item-id="' + escapeHtml(item.id) + '">' +
          '<div class="letter-card-head">' +
            '<button class="letter-toggle" type="button"><strong>' + escapeHtml(item.title) + '</strong><span>⌄</span></button>' +
            '<div class="item-actions">' +
              '<button class="item-action edit-item" type="button" title="Rename letter" aria-label="Rename letter">✎</button>' +
              '<button class="item-action delete-item" type="button" title="Delete letter" aria-label="Delete letter">×</button>' +
            '</div>' +
          '</div>' +
          '<form class="inline-edit-form" hidden>' +
            '<input class="edit-title" type="text" maxlength="100" aria-label="Letter title" value="' + escapeHtml(item.title) + '" required>' +
            '<button class="btn primary" type="submit">Save</button>' +
            '<button class="btn cancel-edit" type="button">Cancel</button>' +
          '</form>' +
          '<div class="letter-content">' +
            '<div><label>Frog\'s note 🐸<textarea id="derek-' + escapeHtml(item.id) + '" data-key="openwhen_derek_' + escapeHtml(item.id) + '" placeholder="Write Frog\'s note..."></textarea></label>' +
            '<button class="btn clear-note" type="button" data-target="derek-' + escapeHtml(item.id) + '">Clear note</button></div>' +
            '<div><label>Princess\'s note 👑<textarea id="princess-' + escapeHtml(item.id) + '" data-key="openwhen_princess_' + escapeHtml(item.id) + '" placeholder="Write Princess\'s note..."></textarea></label>' +
            '<button class="btn clear-note" type="button" data-target="princess-' + escapeHtml(item.id) + '">Clear note</button></div>' +
          '</div>' +
        '</article>'
      ).join("");

      list.querySelectorAll(".letter-toggle").forEach((button) => {
        button.addEventListener("click", () => button.closest(".letter-card").classList.toggle("open"));
      });
      list.querySelectorAll("textarea").forEach((textarea) => saveOnInput(textarea, textarea.dataset.key));
      list.querySelectorAll(".clear-note").forEach((button) => {
        button.addEventListener("click", async () => {
          const target = document.getElementById(button.dataset.target);
          target.value = "";
          await shared.set(target.dataset.key, "");
          toast("Note cleared");
        });
      });
      list.querySelectorAll(".edit-item").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest(".letter-card");
          card.querySelector(".inline-edit-form").hidden = false;
          card.querySelector(".edit-title").focus();
        });
      });
      list.querySelectorAll(".cancel-edit").forEach((button) => {
        button.addEventListener("click", () => {
          button.closest(".inline-edit-form").hidden = true;
        });
      });
      list.querySelectorAll(".inline-edit-form").forEach((editForm) => {
        editForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const id = editForm.closest(".letter-card").dataset.itemId;
          const item = categories.find((entry) => entry.id === id);
          item.title = editForm.querySelector(".edit-title").value.trim();
          if (!item.title) return;
          await shared.set(collectionKey, categories);
          render();
          toast("Letter renamed 💌");
        });
      });
      list.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const card = button.closest(".letter-card");
          const item = categories.find((entry) => entry.id === card.dataset.itemId);
          if (!window.confirm('Delete "' + item.title + '"?')) return;
          categories = categories.filter((entry) => entry.id !== item.id);
          await shared.set(collectionKey, categories);
          render();
          toast("Letter deleted");
        });
      });
    }

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      if (!title) return;
      categories.unshift({ id: makeItemId("letter"), title });
      titleInput.value = "";
      await shared.set(collectionKey, categories);
      render();
      toast("Letter added 💌");
    });

    controllers.managedLetters = {
      refresh() {
        categories = getManagedItems(collectionKey, defaults);
        render();
      }
    };
    render();
  }

  function initBadges() {
    const grid = document.getElementById("badgeGrid");
    const addForm = document.getElementById("badgeForm");
    if (!grid || !addForm) return;
    if (controllers.managedBadges) {
      controllers.managedBadges.refresh();
      return;
    }

    const collectionKey = "pf_badge_items";
    const defaults = [
      { id: "first-date", title: "First Date Unlocked", emoji: "💕" },
      { id: "said-yes", title: "She Said Yes — 21 June", emoji: "💍" },
      { id: "flowers", title: "Flowers Delivered", emoji: "🌷" },
      { id: "gifts", title: "Gifts Given", emoji: "🎁" },
      { id: "go-ape", title: "Survived GO APE", emoji: "🌲" },
      { id: "birthday", title: "Her Birthday", emoji: "🎂" },
      { id: "f1", title: "F1 Moment", emoji: "🏎️" },
      { id: "train", title: "Train Ride Memories", emoji: "🚆" },
      { id: "museum", title: "Museum Day", emoji: "✨" },
      { id: "alton", title: "Alton Towers Done", emoji: "🎢" },
      { id: "hike", title: "The Hike", emoji: "🥾" },
      { id: "date-night", title: "Date Night", emoji: "❤️" }
    ];
    let items = getManagedItems(collectionKey, defaults);
    let unlocked = { ...shared.get("pf_badges", {}) };

    function renderProgress() {
      const count = items.filter((item) => unlocked[item.id]).length;
      document.getElementById("badgeProgressText").textContent = "Unlocked " + count + " / " + items.length + " badges";
      document.getElementById("badgeProgressBar").style.width = items.length ? ((count / items.length) * 100) + "%" : "0%";
    }

    function render() {
      if (!items.length) {
        grid.innerHTML = '<div class="collection-empty"><span>🏆</span><h2>No badges yet</h2><p>Create your first achievement above.</p></div>';
        renderProgress();
        return;
      }
      grid.innerHTML = items.map((item) =>
        '<article class="badge-card ' + (unlocked[item.id] ? "unlocked" : "locked") + '" data-item-id="' + escapeHtml(item.id) + '">' +
          '<button class="badge-main" type="button" title="Unlock or lock badge">' +
            '<span class="badge-emoji">' + escapeHtml(item.emoji || "🏆") + '</span>' +
            '<strong>' + escapeHtml(item.title) + '</strong>' +
            '<small>' + (unlocked[item.id] ? "Unlocked" : "Tap to unlock") + '</small>' +
          '</button>' +
          '<div class="item-actions">' +
            '<button class="item-action edit-item" type="button" title="Edit badge" aria-label="Edit badge">✎</button>' +
            '<button class="item-action delete-item" type="button" title="Delete badge" aria-label="Delete badge">×</button>' +
          '</div>' +
          '<form class="inline-edit-form badge-edit-form" hidden>' +
            '<input class="edit-emoji" type="text" maxlength="4" aria-label="Badge icon" value="' + escapeHtml(item.emoji || "🏆") + '" required>' +
            '<input class="edit-title" type="text" maxlength="80" aria-label="Badge title" value="' + escapeHtml(item.title) + '" required>' +
            '<button class="btn primary" type="submit">Save</button>' +
            '<button class="btn cancel-edit" type="button">Cancel</button>' +
          '</form>' +
        '</article>'
      ).join("");

      grid.querySelectorAll(".badge-main").forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.closest(".badge-card").dataset.itemId;
          unlocked[id] = !unlocked[id];
          await shared.set("pf_badges", unlocked);
          render();
          toast(unlocked[id] ? "Badge unlocked 💕" : "Badge locked");
        });
      });
      grid.querySelectorAll(".edit-item").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest(".badge-card");
          card.querySelector(".inline-edit-form").hidden = false;
          card.querySelector(".edit-title").focus();
        });
      });
      grid.querySelectorAll(".cancel-edit").forEach((button) => {
        button.addEventListener("click", () => button.closest(".inline-edit-form").hidden = true);
      });
      grid.querySelectorAll(".inline-edit-form").forEach((editForm) => {
        editForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const item = items.find((entry) => entry.id === editForm.closest(".badge-card").dataset.itemId);
          item.emoji = editForm.querySelector(".edit-emoji").value.trim() || "🏆";
          item.title = editForm.querySelector(".edit-title").value.trim();
          if (!item.title) return;
          await shared.set(collectionKey, items);
          render();
          toast("Badge updated");
        });
      });
      grid.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const id = button.closest(".badge-card").dataset.itemId;
          const item = items.find((entry) => entry.id === id);
          if (!window.confirm('Delete "' + item.title + '"?')) return;
          items = items.filter((entry) => entry.id !== id);
          delete unlocked[id];
          await shared.set(collectionKey, items);
          await shared.set("pf_badges", unlocked);
          render();
          toast("Badge deleted");
        });
      });
      renderProgress();
    }

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const emojiInput = document.getElementById("badgeEmoji");
      const titleInput = document.getElementById("badgeTitle");
      const title = titleInput.value.trim();
      if (!title) return;
      items.unshift({ id: makeItemId("badge"), title, emoji: emojiInput.value.trim() || "🏆" });
      emojiInput.value = "";
      titleInput.value = "";
      await shared.set(collectionKey, items);
      render();
      toast("Badge added 🏆");
    });

    controllers.managedBadges = {
      refresh() {
        items = getManagedItems(collectionKey, defaults);
        unlocked = { ...shared.get("pf_badges", {}) };
        render();
      }
    };
    render();
  }

  function initGifts() {
    const grid = document.getElementById("giftGrid");
    const addForm = document.getElementById("giftForm");
    if (!grid || !addForm) return;
    if (controllers.managedGifts) {
      controllers.managedGifts.refresh();
      return;
    }

    const collectionKey = "pf_gift_items";
    const giftNames = ["Gift 1", "Gift 2", "Gift 3", "Flowers", "Surprise gift"];
    const defaults = giftNames.map((fallbackTitle, index) => {
      const id = "gift_" + (index + 1);
      return {
        id,
        title: shared.get("pf_" + id + "_title", fallbackTitle),
        date: shared.get("pf_" + id + "_date", ""),
        note: shared.get("pf_" + id + "_note", ""),
        photo: shared.get("pf_" + id + "_photo", "")
      };
    });
    let items = getManagedItems(collectionKey, defaults);

    function render() {
      if (!items.length) {
        grid.innerHTML = '<div class="collection-empty"><span>🎁</span><h2>No gifts yet</h2><p>Add the first gift above.</p></div>';
        return;
      }
      grid.innerHTML = items.map((item) => {
        const hasPhoto = Boolean(item.photo);
        return '<article class="gift-card managed-card" data-item-id="' + escapeHtml(item.id) + '">' +
          '<div class="managed-photo">' +
            '<img src="' + (hasPhoto ? escapeHtml(item.photo) : "") + '" alt="' + escapeHtml(item.title) + '" ' + (hasPhoto ? "" : "hidden") + '>' +
            '<div class="gift-image" ' + (hasPhoto ? "hidden" : "") + '>Add a gift photo<br>' + escapeHtml(item.title) + '</div>' +
            '<label class="photo-upload-btn" title="Upload a gift photo"><span>📷 ' + (hasPhoto ? "Replace photo" : "Add photo") + '</span>' +
              '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">' +
            '</label>' +
          '</div>' +
          '<div class="managed-card-bar"><strong>Gift details</strong><div class="item-actions">' +
            '<button class="item-action delete-item" type="button" title="Delete gift" aria-label="Delete gift">×</button>' +
          '</div></div>' +
          '<div class="gift-fields">' +
            '<label>Gift title<input type="text" maxlength="100" data-field="title" value="' + escapeHtml(item.title) + '"></label>' +
            '<label>Date<input type="text" maxlength="50" data-field="date" value="' + escapeHtml(item.date || "") + '" placeholder="Add date"></label>' +
            '<label>Note<textarea data-field="note" placeholder="Add a cute gift note">' + escapeHtml(item.note || "") + '</textarea></label>' +
            '<small class="upload-state" aria-live="polite"></small>' +
          '</div>' +
        '</article>';
      }).join("");

      grid.querySelectorAll("[data-field]").forEach((field) => {
        const save = debounce(async () => {
          const card = field.closest(".gift-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          item[field.dataset.field] = field.value;
          await shared.set(collectionKey, items);
          toast("Gift saved 🎁");
        });
        field.addEventListener("input", save);
      });
      grid.querySelectorAll(".managed-photo img").forEach((img) => {
        const placeholder = img.nextElementSibling;
        img.addEventListener("load", () => {
          img.hidden = false;
          placeholder.hidden = true;
        });
        img.addEventListener("error", () => {
          img.hidden = true;
          placeholder.hidden = false;
        });
      });
      grid.querySelectorAll("input[type='file']").forEach((input) => {
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          const card = input.closest(".gift-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          const state = card.querySelector(".upload-state");
          if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
            state.textContent = "Choose an image under 8 MB.";
            input.value = "";
            return;
          }
          state.textContent = "Uploading photo…";
          input.closest(".photo-upload-btn").classList.add("uploading");
          const url = await shared.uploadPhoto(file, "gift-" + item.id);
          if (!url) {
            state.textContent = "Upload failed. Check the Supabase photo setup.";
            input.closest(".photo-upload-btn").classList.remove("uploading");
            return;
          }
          item.photo = url;
          await shared.set(collectionKey, items);
          render();
          toast("Gift photo shared 📸");
        });
      });
      grid.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const card = button.closest(".gift-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          if (!window.confirm('Delete "' + item.title + '"?')) return;
          items = items.filter((entry) => entry.id !== item.id);
          await shared.set(collectionKey, items);
          render();
          toast("Gift deleted");
        });
      });
    }

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const titleInput = document.getElementById("newGiftTitle");
      const dateInput = document.getElementById("newGiftDate");
      const title = titleInput.value.trim();
      if (!title) return;
      items.unshift({
        id: makeItemId("gift"),
        title,
        date: dateInput.value.trim(),
        note: "",
        photo: ""
      });
      titleInput.value = "";
      dateInput.value = "";
      await shared.set(collectionKey, items);
      render();
      toast("Gift added 🎁");
    });

    controllers.managedGifts = {
      refresh() {
        items = getManagedItems(collectionKey, defaults);
        render();
      }
    };
    render();
  }

  function initMemories() {
    const grid = document.getElementById("memoryGrid");
    const addForm = document.getElementById("memoryForm");
    if (!grid || !addForm) return;
    if (controllers.managedMemories) {
      controllers.managedMemories.refresh();
      return;
    }

    const collectionKey = "pf_memory_items";
    const memoryDefaults = [
      ["alton", "Alton Towers 🎢", "images/memory1.jpeg"],
      ["museum", "Museum of Illusions ✨", "images/memory2.jpeg"],
      ["train", "Train ride 🚆", "images/memory11.jpeg"],
      ["chill", "Chill day 🍦", "images/memory3.jpeg"],
      ["f1", "F1 🏎️", "images/memory4.jpeg"],
      ["flowers", "Flowers for my princess 🌷", "images/memory5.jpeg", true],
      ["hike", "The Hike 🏞️🥾", "images/memory6.jpeg"],
      ["date-night", "Date night ❤️", "images/memory7.jpeg"],
      ["birthday", "Her birthday 🎂", "images/memory8.jpeg"],
      ["go-ape", "Vals / GO APE 🌲", "images/memory9.jpeg"],
      ["first-date", "Our first date 💕", "images/memory10.jpeg"]
    ].map(([id, title, defaultSrc, featured]) => ({
      id,
      title,
      defaultSrc,
      featured: Boolean(featured),
      date: shared.get("pf_memory_" + id + "_date", ""),
      caption: shared.get("pf_memory_" + id + "_caption", ""),
      photo: shared.get("pf_memory_" + id + "_photo", "")
    }));
    let items = getManagedItems(collectionKey, memoryDefaults);

    function render() {
      if (!items.length) {
        grid.innerHTML = '<div class="collection-empty"><span>📸</span><h2>No memories yet</h2><p>Add your first memory above.</p></div>';
        return;
      }
      grid.innerHTML = items.map((item) => {
      const builtInSrc = item.id === "flowers"
        ? "images/flowers-for-my-princess.png"
        : item.defaultSrc;
      const src = item.photo || builtInSrc || "";
        return '<article class="memory-card managed-card ' + (item.featured ? "featured" : "") + '" data-item-id="' + escapeHtml(item.id) + '">' +
          '<div class="managed-photo memory-photo">' +
            '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(item.title) + '" ' + (src ? "" : "hidden") + '>' +
            '<div class="image-placeholder" ' + (src ? "hidden" : "") + '>Add a photo<br>' + escapeHtml(item.title) + '</div>' +
            '<label class="photo-upload-btn" title="Upload a memory photo"><span>📷 ' + (src ? "Replace photo" : "Add photo") + '</span>' +
              '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">' +
            '</label>' +
          '</div>' +
          '<div class="managed-card-bar"><strong>Memory details</strong><div class="item-actions">' +
            '<button class="item-action delete-item" type="button" title="Delete memory" aria-label="Delete memory">×</button>' +
          '</div></div>' +
          '<div class="memory-fields">' +
            '<label>Title<input type="text" maxlength="100" data-field="title" value="' + escapeHtml(item.title) + '"></label>' +
            '<label>Date<input type="text" maxlength="50" data-field="date" value="' + escapeHtml(item.date || "") + '" placeholder="Add date"></label>' +
            '<label>Caption<textarea data-field="caption" placeholder="Add a cute caption">' + escapeHtml(item.caption || "") + '</textarea></label>' +
            '<small class="upload-state" aria-live="polite"></small>' +
          '</div>' +
        '</article>';
      }).join("");

      grid.querySelectorAll("[data-field]").forEach((field) => {
        const save = debounce(async () => {
          const card = field.closest(".memory-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          item[field.dataset.field] = field.value;
          await shared.set(collectionKey, items);
          toast("Memory saved 💕");
        });
        field.addEventListener("input", save);
      });
      grid.querySelectorAll(".managed-photo img").forEach((img) => {
        const card = img.closest(".memory-card");
        const item = items.find((entry) => entry.id === card.dataset.itemId);
        const placeholder = img.nextElementSibling;
        img.addEventListener("load", () => {
          img.hidden = false;
          placeholder.hidden = true;
        });
        img.addEventListener("error", () => {
          img.hidden = true;
          placeholder.hidden = false;
        });
        img.addEventListener("click", () => openLightbox(img.src, item.title));
      });
      grid.querySelectorAll("input[type='file']").forEach((input) => {
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          const card = input.closest(".memory-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          const state = card.querySelector(".upload-state");
          if (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) {
            state.textContent = "Choose an image under 8 MB.";
            input.value = "";
            return;
          }
          state.textContent = "Uploading photo…";
          input.closest(".photo-upload-btn").classList.add("uploading");
          const url = await shared.uploadPhoto(file, "memory-" + item.id);
          if (!url) {
            state.textContent = "Upload failed. Check the Supabase photo setup.";
            input.closest(".photo-upload-btn").classList.remove("uploading");
            return;
          }
          item.photo = url;
          await shared.set(collectionKey, items);
          render();
          toast("Memory photo shared 📸");
        });
      });
      grid.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const card = button.closest(".memory-card");
          const item = items.find((entry) => entry.id === card.dataset.itemId);
          if (!window.confirm('Delete "' + item.title + '"?')) return;
          items = items.filter((entry) => entry.id !== item.id);
          await shared.set(collectionKey, items);
          render();
          toast("Memory deleted");
        });
      });
    }

    addForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const titleInput = document.getElementById("newMemoryTitle");
      const dateInput = document.getElementById("newMemoryDate");
      const title = titleInput.value.trim();
      if (!title) return;
      items.unshift({
        id: makeItemId("memory"),
        title,
        date: dateInput.value.trim(),
        caption: "",
        photo: "",
        defaultSrc: "",
        featured: false
      });
      titleInput.value = "";
      dateInput.value = "";
      await shared.set(collectionKey, items);
      render();
      toast("Memory added 📸");
    });

    setupLightbox();
    controllers.managedMemories = {
      refresh() {
        items = getManagedItems(collectionKey, memoryDefaults);
        render();
      }
    };
    render();
  }

  function initQuotes() {
    const list = document.getElementById("quoteList");
    const input = document.getElementById("quoteInput");
    const addButton = document.getElementById("addQuote");
    if (!list || !input || !addButton) return;
    if (controllers.managedQuotes) {
      controllers.managedQuotes.refresh();
      return;
    }

    const defaults = ["You are so yum 🌝", "Princess and the Frog", "The frog knew he was lucky"];
    let quotes = shared.get("pf_quotes", defaults);

    function render() {
      quotes = Array.isArray(quotes) ? quotes : [];
      if (!quotes.length) {
        list.innerHTML = '<div class="collection-empty"><span>🗣️</span><h2>No quotes yet</h2><p>Add the first unforgettable line above.</p></div>';
        return;
      }
      list.innerHTML = quotes.map((quote, index) =>
        '<article class="quote-bubble editable-list-item" data-index="' + index + '">' +
          '<div class="editable-copy"><p>“' + escapeHtml(quote) + '”</p>' +
            '<form class="inline-edit-form" hidden><input class="edit-value" type="text" maxlength="300" aria-label="Quote" value="' + escapeHtml(quote) + '" required>' +
              '<button class="btn primary" type="submit">Save</button><button class="btn cancel-edit" type="button">Cancel</button>' +
            '</form>' +
          '</div>' +
          '<div class="item-actions">' +
            '<button class="item-action edit-item" type="button" title="Edit quote" aria-label="Edit quote">✎</button>' +
            '<button class="item-action delete-item" type="button" title="Delete quote" aria-label="Delete quote">×</button>' +
          '</div>' +
        '</article>'
      ).join("");

      list.querySelectorAll(".edit-item").forEach((button) => {
        button.addEventListener("click", () => {
          const item = button.closest(".editable-list-item");
          item.querySelector(".inline-edit-form").hidden = false;
          item.querySelector(".edit-value").focus();
        });
      });
      list.querySelectorAll(".cancel-edit").forEach((button) => {
        button.addEventListener("click", () => button.closest(".inline-edit-form").hidden = true);
      });
      list.querySelectorAll(".inline-edit-form").forEach((editForm) => {
        editForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const index = Number(editForm.closest(".editable-list-item").dataset.index);
          const value = editForm.querySelector(".edit-value").value.trim();
          if (!value) return;
          quotes[index] = value;
          await shared.set("pf_quotes", quotes);
          render();
          toast("Quote updated");
        });
      });
      list.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const index = Number(button.closest(".editable-list-item").dataset.index);
          if (!window.confirm("Delete this quote?")) return;
          quotes.splice(index, 1);
          await shared.set("pf_quotes", quotes);
          render();
          toast("Quote deleted");
        });
      });
    }

    async function addQuote() {
      const value = input.value.trim();
      if (!value) return;
      quotes = shared.get("pf_quotes", quotes);
      quotes = [value, ...(Array.isArray(quotes) ? quotes : [])];
      input.value = "";
      await shared.set("pf_quotes", quotes);
      render();
      toast("Quote added 💕");
    }

    addButton.addEventListener("click", addQuote);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addQuote();
      }
    });
    controllers.managedQuotes = {
      refresh() {
        quotes = shared.get("pf_quotes", defaults);
        render();
      }
    };
    render();
  }

  function initLovePage() {
    const list = document.getElementById("loveNoteList");
    const input = document.getElementById("loveInput");
    const addButton = document.getElementById("addLoveNote");
    if (!list || !input || !addButton) return;
    if (controllers.managedLoveNotes) {
      controllers.managedLoveNotes.refresh();
      return;
    }

    let notes = getLoveNotes();

    function render() {
      notes = Array.isArray(notes) ? notes : [];
      if (!notes.length) {
        list.innerHTML = '<div class="collection-empty"><span>💕</span><h2>No love notes yet</h2><p>Add something soft above.</p></div>';
        return;
      }
      list.innerHTML = notes.map((note, index) =>
        '<article class="note-item editable-list-item" data-index="' + index + '">' +
          '<div class="editable-copy"><p>' + escapeHtml(note) + '</p>' +
            '<form class="inline-edit-form" hidden><input class="edit-value" type="text" maxlength="300" aria-label="Love note" value="' + escapeHtml(note) + '" required>' +
              '<button class="btn primary" type="submit">Save</button><button class="btn cancel-edit" type="button">Cancel</button>' +
            '</form>' +
          '</div>' +
          '<div class="item-actions">' +
            '<button class="item-action edit-item" type="button" title="Edit love note" aria-label="Edit love note">✎</button>' +
            '<button class="item-action delete-item" type="button" title="Delete love note" aria-label="Delete love note">×</button>' +
          '</div>' +
        '</article>'
      ).join("");

      list.querySelectorAll(".edit-item").forEach((button) => {
        button.addEventListener("click", () => {
          const item = button.closest(".editable-list-item");
          item.querySelector(".inline-edit-form").hidden = false;
          item.querySelector(".edit-value").focus();
        });
      });
      list.querySelectorAll(".cancel-edit").forEach((button) => {
        button.addEventListener("click", () => button.closest(".inline-edit-form").hidden = true);
      });
      list.querySelectorAll(".inline-edit-form").forEach((editForm) => {
        editForm.addEventListener("submit", async (event) => {
          event.preventDefault();
          const index = Number(editForm.closest(".editable-list-item").dataset.index);
          const value = editForm.querySelector(".edit-value").value.trim();
          if (!value) return;
          notes[index] = value;
          await setLoveNotes(notes);
          render();
          toast("Love note updated");
        });
      });
      list.querySelectorAll(".delete-item").forEach((button) => {
        button.addEventListener("click", async () => {
          const index = Number(button.closest(".editable-list-item").dataset.index);
          if (!window.confirm("Delete this love note?")) return;
          notes.splice(index, 1);
          await setLoveNotes(notes);
          render();
          toast("Love note deleted");
        });
      });
    }

    async function addNote() {
      const value = input.value.trim();
      if (!value) return;
      notes = getLoveNotes();
      notes = [value, ...(Array.isArray(notes) ? notes : [])];
      input.value = "";
      await setLoveNotes(notes);
      render();
      toast("Love note added 💕");
    }

    addButton.addEventListener("click", addNote);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addNote();
      }
    });
    controllers.managedLoveNotes = {
      refresh() {
        notes = getLoveNotes();
        render();
      }
    };
    render();
  }

  function initHomeGallery() {
    if (controllers.homeGallery) return;
    const images = document.querySelectorAll(".june21-photo img");
    if (!images.length) return;
    images.forEach((img) => {
      img.addEventListener("click", () => openLightbox(img.src, img.dataset.storyTitle || img.alt));
    });
    setupLightbox();
    controllers.homeGallery = { refresh() {} };
  }

  function refreshCurrentPage(forceFocused = true) {
    if (!["game", "messages"].includes(page) && !forceFocused && document.activeElement && ["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      return;
    }
    if (page === "home") initHomeGallery();
    if (page === "letters") initLetters();
    if (page === "memories") initMemories();
    if (page === "badges") initBadges();
    if (page === "game") {
      setupGameHub();
      initGame();
      initWordGame();
      initSameGame();
    }
    if (page === "gifts") initGifts();
    if (page === "quotes") initQuotes();
    if (page === "love") initLovePage();
    if (page === "messages") initMessages();
  }

  async function start() {
    markActiveNav();
    addStatusPill();
    await requirePasscode();
    await shared.init();
    setupRandomButtons();
    refreshCurrentPage();
  }

  start();
})();
