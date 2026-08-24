(function () {
  const page = document.body.dataset.page;
  const toastEl = document.getElementById("toast");
  const config = window.CORNER_CONFIG || {};
  const hasSupabaseConfig = Boolean(config.supabaseUrl && config.supabaseAnonKey && window.supabase);
  const supabaseClient = hasSupabaseConfig
    ? (window.CORNER_SUPABASE_CLIENT || window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey))
    : null;
  if (supabaseClient) window.CORNER_SUPABASE_CLIENT = supabaseClient;
  const siteId = config.siteId || "princess-frog-corner";
  const passcode = config.passcode || "";
  const authKey = `pf_auth_${siteId}`;
  const remoteCache = {};
  const controllers = {};
  let remoteReady = false;
  let remotePullPromise = null;
  let syncStatusEl = null;
  let lightboxItems = [];
  let lightboxIndex = 0;
  let lightboxTrigger = null;
  let lightboxTouchStart = 0;
  const signedPhotoCache = new Map();

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
      const pollDelay = page === "game" ? 1000 : page === "messages" ? 4000 : 10000;
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
        window.CornerNotifications?.fromSharedChange?.(key, value);
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
      return `corner-photos:${path}`;
    },
    photoPath(value) {
      const source = String(value || "");
      if (source.startsWith("corner-photos:")) return source.slice("corner-photos:".length);
      const markers = [
        "/storage/v1/object/public/corner-photos/",
        "/storage/v1/object/sign/corner-photos/"
      ];
      const marker = markers.find((item) => source.includes(item));
      if (!marker) return "";
      return decodeURIComponent(source.split(marker)[1].split("?")[0]);
    },
    async resolvePhoto(value) {
      const path = this.photoPath(value);
      if (!path || !supabaseClient) return String(value || "");
      const cached = signedPhotoCache.get(path);
      if (cached && cached.expires > Date.now()) return cached.url;
      const { data, error } = await supabaseClient.storage.from("corner-photos").createSignedUrl(path, 3600);
      if (error || !data?.signedUrl) {
        console.warn("Private photo could not be opened.", error);
        return "";
      }
      signedPhotoCache.set(path, { url: data.signedUrl, expires: Date.now() + (50 * 60 * 1000) });
      return data.signedUrl;
    }
  };

  window.CornerRuntime = {
    shared,
    toast,
    config,
    supabaseClient,
    refresh() {
      refreshCurrentPage(false);
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
          document.dispatchEvent(new CustomEvent("corner:remote-change", { detail: payload }));
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

  function setupSiteChrome() {
    const header = document.querySelector(".site-header");
    const main = document.querySelector("main");
    if (!header || !main) return;

    if (!document.querySelector(".skip-link")) {
      const skipLink = document.createElement("a");
      skipLink.className = "skip-link";
      skipLink.href = "#mainContent";
      skipLink.textContent = "Skip to content";
      document.body.prepend(skipLink);
    }
    if (!main.id) main.id = "mainContent";

    const standardTitle = main.querySelector(".page-title:not(.archive-intro):not(.letters-intro)");
    if (standardTitle && !standardTitle.querySelector(".page-title-heading")) {
      const eyebrow = standardTitle.querySelector(":scope > .eyebrow");
      const heading = standardTitle.querySelector(":scope > h1");
      if (eyebrow && heading) {
        const group = document.createElement("div");
        group.className = "page-title-heading";
        standardTitle.insertBefore(group, standardTitle.firstChild);
        group.append(eyebrow, heading);
      }
    }

    const brand = header.querySelector(".brand");
    if (brand && !brand.querySelector(".brand-monogram")) {
      brand.innerHTML = '<span class="brand-monogram" aria-hidden="true">PF</span><span>Princess + Frog</span>';
      brand.setAttribute("aria-label", "Princess and Frog home");
    }

    const nav = header.querySelector(".nav");
    if (nav) {
      nav.id = "siteNav";
      nav.setAttribute("aria-label", "Main navigation");
      const primaryLinks = [
        ["index.html", "Home"],
        ["letters.html", "Letters"],
        ["memories.html", "Memories"],
        ["game.html", "Play"],
        ["movies.html", "Movies"],
        ["messages.html", "Chat"]
      ];
      const secondaryLinks = [
        ["badges.html", "Badges"],
        ["gifts.html", "Gifts"],
        ["quotes.html", "Things we said"],
        ["love.html", "Love notes"]
      ];
      const linkMarkup = ([href, label]) => `<a href="${href}">${label}</a>`;
      nav.innerHTML = `${primaryLinks.map(linkMarkup).join("")}
        <details class="nav-more">
          <summary><span>More</span><i aria-hidden="true"></i></summary>
          <div class="nav-more-menu">${secondaryLinks.map(linkMarkup).join("")}</div>
        </details>`;
      const more = nav.querySelector(".nav-more");
      document.addEventListener("click", (event) => {
        if (more?.open && !more.contains(event.target)) more.removeAttribute("open");
      });
    }

    let menuToggle = header.querySelector(".menu-toggle");
    if (!menuToggle) {
      menuToggle = document.createElement("button");
      menuToggle.className = "menu-toggle";
      menuToggle.type = "button";
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.setAttribute("aria-controls", "siteNav");
      menuToggle.innerHTML = '<span></span><span></span><span></span><span class="sr-only">Open menu</span>';
      header.insertBefore(menuToggle, nav);
    }

    const closeMenu = () => {
      document.body.classList.remove("menu-open");
      menuToggle.setAttribute("aria-expanded", "false");
      menuToggle.querySelector(".sr-only").textContent = "Open menu";
    };
    menuToggle.addEventListener("click", () => {
      const open = !document.body.classList.contains("menu-open");
      document.body.classList.toggle("menu-open", open);
      menuToggle.setAttribute("aria-expanded", String(open));
      menuToggle.querySelector(".sr-only").textContent = open ? "Close menu" : "Open menu";
    });
    nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("menu-open")) closeMenu();
    });

    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if (!document.querySelector(".site-footer")) {
      const footer = document.createElement("footer");
      footer.className = "site-footer";
      footer.innerHTML = '<span class="footer-mark" aria-hidden="true">PF</span><p>Our little corner, kept together.</p><a href="#mainContent">Back to top <span aria-hidden="true">&uarr;</span></a>';
      document.body.insertBefore(footer, document.getElementById("toast"));
    }
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
      if (link.getAttribute("href") === current) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
        link.closest(".nav-more")?.querySelector("summary")?.classList.add("active");
      }
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
    if (output) {
      output.classList.remove("note-reveal");
      output.textContent = note;
      requestAnimationFrame(() => output.classList.add("note-reveal"));
    }
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

  function collectLightboxItems() {
    return [...document.querySelectorAll(".june21-photo img, .us-photo img, .memory-photo img, .gift-card .managed-photo img")]
      .filter((img) => !img.hidden && img.getAttribute("src"))
      .map((img) => ({
        src: img.currentSrc || img.src,
        title: img.dataset.storyTitle || img.alt,
        trigger: img,
        rotate: img.dataset.rotate || ""
      }));
  }

  function renderLightboxItem() {
    const lightbox = document.getElementById("lightbox");
    const item = lightboxItems[lightboxIndex];
    if (!lightbox || !item) return;
    const image = lightbox.querySelector("img");
    image.src = item.src;
    image.alt = item.title;
    image.classList.toggle("is-rotated-photo", item.rotate === "90");
    lightbox.querySelector("p").textContent = item.title;
    const count = lightbox.querySelector(".lightbox-count");
    if (count) count.textContent = `${lightboxIndex + 1} / ${lightboxItems.length}`;
    lightbox.querySelectorAll(".lightbox-nav").forEach((button) => {
      button.hidden = lightboxItems.length < 2;
    });
  }

  function moveLightbox(direction) {
    if (lightboxItems.length < 2) return;
    lightboxIndex = (lightboxIndex + direction + lightboxItems.length) % lightboxItems.length;
    renderLightboxItem();
  }

  function openLightbox(src, title, trigger = document.activeElement) {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightboxItems = collectLightboxItems();
    let index = lightboxItems.findIndex((item) => item.src === src || item.trigger === trigger);
    if (index < 0) {
      lightboxItems.push({ src, title, trigger, rotate: trigger?.dataset?.rotate || "" });
      index = lightboxItems.length - 1;
    }
    lightboxIndex = index;
    lightboxTrigger = trigger;
    renderLightboxItem();
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("lightbox-open");
    lightbox.querySelector(".lightbox-close")?.focus({ preventScroll: true });
  }

  function closeLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox) return;
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lightbox-open");
    if (lightboxTrigger instanceof HTMLElement) lightboxTrigger.focus({ preventScroll: true });
  }

  function setupLightbox() {
    const lightbox = document.getElementById("lightbox");
    if (!lightbox || lightbox.dataset.ready === "true") return;
    lightbox.dataset.ready = "true";
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target.classList.contains("lightbox-close")) closeLightbox();
    });
    lightbox.querySelector(".lightbox-prev")?.addEventListener("click", () => moveLightbox(-1));
    lightbox.querySelector(".lightbox-next")?.addEventListener("click", () => moveLightbox(1));
    lightbox.addEventListener("touchstart", (event) => {
      lightboxTouchStart = event.changedTouches[0].clientX;
    }, { passive: true });
    lightbox.addEventListener("touchend", (event) => {
      const distance = event.changedTouches[0].clientX - lightboxTouchStart;
      if (Math.abs(distance) > 48) moveLightbox(distance > 0 ? -1 : 1);
    }, { passive: true });
    document.addEventListener("keydown", (event) => {
      if (!lightbox.classList.contains("open")) return;
      if (event.key === "Escape") closeLightbox();
      if (event.key === "ArrowLeft") moveLightbox(-1);
      if (event.key === "ArrowRight") moveLightbox(1);
      if (event.key === "Tab") {
        const controls = [...lightbox.querySelectorAll("button:not([hidden])")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
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
    const syncButton = document.getElementById("syncGameState");
    const tabs = [...document.querySelectorAll("[data-game-tab]")];
    if (!identity || !tabs.length) return;
    if (controllers.gameHub) {
      controllers.gameHub.refresh();
      return;
    }

    const panels = {
      number: document.getElementById("numberGamePanel"),
      word: document.getElementById("wordGamePanel"),
      same: document.getElementById("sameGamePanel"),
      would: document.getElementById("wouldGamePanel"),
      trivia: document.getElementById("triviaGamePanel"),
      truth: document.getElementById("truthGamePanel"),
      memory: document.getElementById("memoryGamePanel")
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
      const presence = {};
      ["frog", "princess"].forEach((player) => {
        const label = document.getElementById(`${player}Presence`);
        const seenAt = Date.parse(shared.get(`pf_presence_${player}`, ""));
        const online = Number.isFinite(seenAt) && now - seenAt < gamePresenceWindowMs;
        presence[player] = online;
        const displayName = player === "frog" ? "Frog" : "Princess";
        label.classList.toggle("online", online);
        label.lastChild.textContent = online ? ` ${displayName} is here` : ` ${displayName} is away`;
      });
      document.dispatchEvent(new CustomEvent("corner:game-presence", { detail: presence }));
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

    async function syncGameState(showConfirmation = false) {
      if (syncButton) syncButton.disabled = true;
      await heartbeat();
      const connected = await shared.pull(true);
      controllers.numberGame?.refresh();
      controllers.wordGame?.refresh();
      controllers.sameGame?.refresh();
      window.CornerGames?.refresh?.();
      if (syncButton) syncButton.disabled = false;
      if (showConfirmation) toast(connected ? "Game refreshed" : "Could not refresh shared game");
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => {
        selectGame(tab.dataset.gameTab);
        syncGameState();
      });
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
      await syncGameState();
    });

    const wakeHeartbeat = () => {
      if (!document.hidden) syncGameState();
    };
    syncButton?.addEventListener("click", () => syncGameState(true));
    controllers.gameHub = { refresh: renderPresence, heartbeat, sync: syncGameState };
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
      await window.CornerGames?.recordMatch?.({
        id: round.id,
        game: "same",
        result: frog === princess ? "Same answer" : "Different answers"
      });
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
      else if (!round.id) secretStatus.textContent = "Start the duel, then lock your secret number.";
      else if (winner) secretStatus.textContent = "Tap Play again, then choose a fresh secret number.";
      else if (mySecret) secretStatus.textContent = "Your number is locked. It stays hidden from your opponent.";
      else secretStatus.textContent = `Choose a secret number from 1 to ${round.range}, then lock it.`;

      if (!ready) guessHelp.textContent = "Both players must lock their numbers before guessing.";
      else if (winner) guessHelp.textContent = `${playerLabels[winner]} won this duel.`;
      else if (!hasIdentity) guessHelp.textContent = "Choose your player before guessing.";
      else guessHelp.textContent = `Guess ${playerLabels[opponent]}'s number from 1 to ${round.range}.`;

      const resetButton = document.getElementById("resetGame");
      if (winner) resetButton.textContent = "Play again";
      else if (!round.id) resetButton.textContent = "Start duel";
      else resetButton.textContent = me === "frog" ? "Restart round" : "Round in progress";
      resetButton.disabled = !hasIdentity || Boolean(round.id && !winner && me !== "frog");
      resetButton.classList.toggle("primary", Boolean(hasIdentity && (!round.id || winner)));
      document.getElementById("setSecret").disabled = !hasIdentity || Boolean(mySecret) || Boolean(winner);
      document.getElementById("checkGuess").disabled = !hasIdentity || !ready || Boolean(winner);
      rangeEl.disabled = Boolean(round.id && !winner);
      // Let either player prepare a number while a newly-started round is still syncing.
      secretEl.disabled = !hasIdentity || Boolean(mySecret) || Boolean(winner);
      guessEl.disabled = !hasIdentity || !ready || Boolean(winner);

      if (!hasIdentity) {
        resultEl.textContent = "Choose Frog or Princess to join the game.";
      } else if (winner) {
        resultEl.textContent = winner === me
          ? `You guessed ${playerLabels[opponent]}'s number first. Tap Play again for a fresh duel 🎉`
          : `${playerLabels[winner]} guessed your number first. Tap Play again for a fresh duel.`;
      } else if (myState.clue) {
        resultEl.textContent = myState.clue;
      } else if (!round.id) {
        resultEl.textContent = "Either player can start a new duel when you are ready.";
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
      if (!isGamePlayer(roleEl.value)) return;
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (round.id && !round.winner && roleEl.value !== "frog") {
        toast("This round is still in progress");
        return;
      }
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
      if (!(await refreshBeforeNumberAction()) || round.winner) return;
      if (!round.id) {
        resultEl.textContent = "Tap Start duel before locking your number. Your number will stay entered.";
        return;
      }
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
        await window.CornerGames?.recordMatch?.({
          id: round.id,
          game: "number",
          winner: wonBy,
          result: `${playerStates[wonBy].attempts || attempts} guesses`
        });
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

    const players = ["frog", "princess"];
    const playerLabels = { frog: "Frog 🐸", princess: "Princess 👑" };
    const defaultRound = { id: null, length: 3, startedAt: null, winner: null, winnerAt: null };
    const defaultPlayerState = { roundId: null, attempts: 0, guesses: [], correctAt: null };
    let round = { ...defaultRound, ...shared.get("pf_word_round", defaultRound) };
    let scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_word_scores", {}) };
    let secrets = { frog: null, princess: null };
    let playerStates = {
      frog: { ...defaultPlayerState },
      princess: { ...defaultPlayerState }
    };

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
        secrets[player] = recordForRound(`pf_word_duel_secret_${player}`);
        playerStates[player] = {
          ...defaultPlayerState,
          ...(recordForRound(`pf_word_duel_state_${player}`, defaultPlayerState) || defaultPlayerState)
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
      document.getElementById("frogWordScore").textContent = scores.frog || 0;
      document.getElementById("princessWordScore").textContent = scores.princess || 0;
    }

    function renderHistory() {
      const guesses = players
        .flatMap((player) => (Array.isArray(playerStates[player].guesses) ? playerStates[player].guesses : [])
          .map((guess) => ({ ...guess, player })))
        .sort((a, b) => Date.parse(b.guessedAt) - Date.parse(a.guessedAt));
      if (!guesses.length) {
        historyEl.innerHTML = `<p class="game-secret">Both players' guesses will appear here.</p>`;
        return;
      }
      historyEl.innerHTML = guesses.map((item) => `
        <div class="word-history-row">
          <span class="word-player">${playerLabels[item.player]}</span>
          <strong>${item.guess}</strong>
          <span class="common-result">
            <b>${item.common} / ${round.length} letters in common</b>
            <span class="common-dots" aria-hidden="true">${Array.from({ length: round.length }, (_, index) => `<i class="${index < item.common ? "matched" : ""}"></i>`).join("")}</span>
          </span>
        </div>
      `).join("");
    }

    function renderRound() {
      const me = roleEl.value;
      const hasIdentity = isGamePlayer(me);
      const opponent = hasIdentity ? otherPlayer(me) : null;
      const ready = bothReady();
      const winner = round.winner || winnerFromStates();
      const mySecret = hasIdentity ? secrets[me] : null;
      const myState = hasIdentity ? playerStates[me] : defaultPlayerState;
      const selectedLength = Number(round.id ? round.length : lengthEl.value || 3);

      lengthEl.value = String(selectedLength);
      secretEl.maxLength = selectedLength;
      guessEl.maxLength = selectedLength;
      attemptsEl.textContent = `${playerStates.frog.attempts || 0} / ${playerStates.princess.attempts || 0}`;

      function playerStatus(player) {
        const online = isOnline(player);
        if (!round.id) return online ? "Ready" : "Away";
        if (winner) return winner === player ? "Won 🎉" : "Round over";
        if (ready) return `${playerStates[player].attempts || 0} guesses${online ? "" : " · away"}`;
        if (secrets[player]) return `Word locked${online ? "" : " · away"}`;
        return online ? "Choosing" : "Away";
      }

      hostStatus.textContent = playerStatus("frog");
      guesserStatus.textContent = playerStatus("princess");
      roundStatus.textContent = !round.id
        ? "Start a new duel"
        : winner
          ? `${playerLabels[winner]} won`
          : ready
            ? `Live: ${round.length} letters`
            : "Locking words";

      if (!hasIdentity) secretStatus.textContent = "Choose Frog or Princess before joining the word duel.";
      else if (!round.id) secretStatus.textContent = "Choose the difficulty, start the duel, then lock your word.";
      else if (winner) secretStatus.textContent = "Tap Play again, then choose a fresh secret word.";
      else if (mySecret) secretStatus.textContent = "Your word is locked and hidden from your opponent.";
      else secretStatus.textContent = `Choose a ${round.length}-letter secret word, then lock it.`;

      if (!ready) guessHelp.textContent = "Both players must lock their secret words before guessing.";
      else if (winner) guessHelp.textContent = `${playerLabels[winner]} won this word duel.`;
      else if (!hasIdentity) guessHelp.textContent = "Choose your player before guessing.";
      else guessHelp.textContent = `Guess ${playerLabels[opponent]}'s ${round.length}-letter word.`;

      const resetButton = document.getElementById("resetWordGame");
      if (winner) resetButton.textContent = "Play again";
      else if (!round.id) resetButton.textContent = "Start word duel";
      else resetButton.textContent = me === "frog" ? "Restart round" : "Round in progress";
      resetButton.disabled = !hasIdentity || Boolean(round.id && !winner && me !== "frog");
      resetButton.classList.toggle("primary", Boolean(hasIdentity && (!round.id || winner)));
      document.getElementById("setSecretWord").disabled = !hasIdentity || Boolean(mySecret) || Boolean(winner);
      document.getElementById("checkWordGuess").disabled = !hasIdentity || Boolean(winner);
      lengthEl.disabled = Boolean(round.id && !winner);
      secretEl.disabled = !hasIdentity || Boolean(mySecret) || Boolean(winner);
      guessEl.disabled = !hasIdentity || Boolean(winner);

      const latestGuess = Array.isArray(myState.guesses) ? myState.guesses.at(-1) : null;
      if (!hasIdentity) resultEl.textContent = "Choose Frog or Princess to join the word duel.";
      else if (winner) {
        resultEl.textContent = winner === me
          ? `You guessed ${playerLabels[opponent]}'s word first. Their word was ${secrets[opponent]?.value}. Tap Play again for a fresh duel.`
          : `${playerLabels[winner]} guessed your word first. Their word was ${secrets[opponent]?.value}. Tap Play again for a fresh duel.`;
      } else if (latestGuess) {
        resultEl.textContent = `${latestGuess.guess} has ${latestGuess.common} / ${round.length} letters in common.`;
      } else if (!round.id) {
        resultEl.textContent = "Either player can start a new word duel.";
      } else if (ready) {
        resultEl.textContent = "Both words are locked. Start guessing.";
      } else {
        resultEl.textContent = "Waiting for both secret words to be locked.";
      }
      renderHistory();
    }

    function refreshFromStore() {
      round = { ...defaultRound, ...shared.get("pf_word_round", defaultRound) };
      scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_word_scores", {}) };
      loadRoundRecords();
      renderRound();
      renderScores();
    }

    async function refreshBeforeWordAction() {
      if (!isGamePlayer(roleEl.value)) {
        resultEl.textContent = "Choose Frog or Princess before joining the word duel.";
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

    lengthEl.addEventListener("change", () => {
      secretEl.maxLength = Number(lengthEl.value);
      guessEl.maxLength = Number(lengthEl.value);
      secretEl.value = cleanWord(secretEl.value).slice(0, Number(lengthEl.value));
      guessEl.value = cleanWord(guessEl.value).slice(0, Number(lengthEl.value));
    });

    secretEl.addEventListener("input", () => {
      secretEl.value = cleanWord(secretEl.value).slice(0, Number(round.id ? round.length : lengthEl.value));
    });

    guessEl.addEventListener("input", () => {
      guessEl.value = cleanWord(guessEl.value).slice(0, Number(round.length || lengthEl.value));
    });

    document.getElementById("resetWordGame").addEventListener("click", async () => {
      if (!isGamePlayer(roleEl.value)) return;
      await controllers.gameHub?.heartbeat?.();
      await shared.pull(true);
      refreshFromStore();
      if (round.id && !round.winner && roleEl.value !== "frog") {
        toast("This round is still in progress");
        return;
      }
      if (round.id && !round.winner && !window.confirm("Restart this word duel? Both secret words and all guesses will be cleared.")) {
        renderRound();
        return;
      }
      round = {
        ...defaultRound,
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        length: Number(lengthEl.value),
        startedAt: new Date().toISOString()
      };
      await shared.set("pf_word_round", round);
      secretEl.value = "";
      guessEl.value = "";
      refreshFromStore();
      toast("New word duel ready 💕");
    });

    document.getElementById("setSecretWord").addEventListener("click", async () => {
      if (!(await refreshBeforeWordAction()) || round.winner) return;
      if (!round.id) {
        resultEl.textContent = "Tap Start word duel before locking your word. Your word will stay entered.";
        return;
      }
      const secret = cleanWord(secretEl.value);
      if (secret.length !== Number(round.length)) {
        resultEl.textContent = `Pick a ${round.length}-letter secret word.`;
        return;
      }
      const me = roleEl.value;
      await shared.set(`pf_word_duel_secret_${me}`, {
        roundId: round.id,
        value: secret,
        lockedAt: new Date().toISOString()
      });
      secretEl.value = "";
      refreshFromStore();
      toast("Your secret word is locked 💕");
    });

    document.getElementById("checkWordGuess").addEventListener("click", async () => {
      if (!(await refreshBeforeWordAction()) || !bothReady()) {
        resultEl.textContent = "Both players must lock their secret words before guessing.";
        return;
      }
      const me = roleEl.value;
      const opponent = otherPlayer(me);
      const winner = round.winner || winnerFromStates();
      if (winner) return;
      const guess = cleanWord(guessEl.value);
      if (guess.length !== Number(round.length)) {
        resultEl.textContent = `Enter a ${round.length}-letter guess.`;
        return;
      }

      const target = secrets[opponent].value;
      const common = countCommonLetters(guess, target);
      const attempts = Number(playerStates[me].attempts || 0) + 1;
      const correctAt = guess === target ? new Date().toISOString() : null;
      const guesses = [
        ...(Array.isArray(playerStates[me].guesses) ? playerStates[me].guesses : []),
        { guess, common, guessedAt: new Date().toISOString(), correct: Boolean(correctAt) }
      ];
      await shared.set(`pf_word_duel_state_${me}`, {
        roundId: round.id,
        attempts,
        guesses,
        correctAt
      });
      guessEl.value = "";
      refreshFromStore();

      if (correctAt) {
        const wonBy = winnerFromStates() || me;
        round = { ...round, winner: wonBy, winnerAt: playerStates[wonBy].correctAt || correctAt };
        await shared.set("pf_word_round", round);
        scores = { frog: 0, princess: 0, lastScoredRound: null, ...shared.get("pf_word_scores", {}) };
        if (scores.lastScoredRound !== round.id) {
          scores[wonBy] = Number(scores[wonBy] || 0) + 1;
          scores.lastScoredRound = round.id;
          await shared.set("pf_word_scores", scores);
        }
        await window.CornerGames?.recordMatch?.({
          id: round.id,
          game: "word",
          winner: wonBy,
          result: `${playerStates[wonBy].attempts || attempts} guesses`
        });
        refreshFromStore();
      }
    });

    document.getElementById("resetWordScores").addEventListener("click", async () => {
      scores = { frog: 0, princess: 0, lastScoredRound: null };
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
    const editToggle = document.getElementById("letterEditToggle");
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
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-letters", editing);
      addForm.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit letters';
      list.querySelectorAll("textarea").forEach((textarea) => {
        textarea.readOnly = !editing;
      });
    }

    function render() {
      if (!categories.length) {
        list.innerHTML = '<div class="collection-empty"><span>💌</span><h2>No letters yet</h2><p>Add your first Open When category above.</p></div>';
        return;
      }
      list.innerHTML = categories.map((item, index) =>
        '<article class="letter-card envelope-card" data-item-id="' + escapeHtml(item.id) + '">' +
          '<div class="letter-card-head envelope-front">' +
            '<button class="letter-toggle" type="button" aria-expanded="false">' +
              '<span class="letter-index">' + String(index + 1).padStart(2, "0") + '</span>' +
              '<strong>' + escapeHtml(item.title) + '</strong>' +
              '<span class="envelope-seal" aria-hidden="true">PF</span>' +
              '<span class="letter-open-label">Open <span aria-hidden="true">&darr;</span></span>' +
            '</button>' +
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
          '<div class="letter-content"><div class="letter-paper">' +
            '<div class="letter-note"><label><span>From Frog</span><textarea id="derek-' + escapeHtml(item.id) + '" data-key="openwhen_derek_' + escapeHtml(item.id) + '" placeholder="Frog\'s note will be kept here."></textarea></label>' +
            '<button class="btn clear-note" type="button" data-target="derek-' + escapeHtml(item.id) + '">Clear note</button></div>' +
            '<div class="letter-note"><label><span>From Princess</span><textarea id="princess-' + escapeHtml(item.id) + '" data-key="openwhen_princess_' + escapeHtml(item.id) + '" placeholder="Princess\'s note will be kept here."></textarea></label>' +
            '<button class="btn clear-note" type="button" data-target="princess-' + escapeHtml(item.id) + '">Clear note</button></div>' +
          '</div></div>' +
        '</article>'
      ).join("");

      list.querySelectorAll(".letter-toggle").forEach((button) => {
        button.addEventListener("click", () => {
          const card = button.closest(".letter-card");
          const open = !card.classList.contains("open");
          card.classList.toggle("open", open);
          button.setAttribute("aria-expanded", String(open));
        });
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
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));

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
    const editToggle = document.getElementById("badgeEditToggle");
    if (!grid || !addForm) return;
    if (controllers.managedBadges) {
      controllers.managedBadges.refresh();
      return;
    }

    const collectionKey = "pf_badge_items";
    const originalBadges = [
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
    const dateBadgeSeeds = [
      { id: "date-tennis", title: "Tennis Date", emoji: "🎾" },
      { id: "date-quad-biking", title: "Quad Biking", emoji: "🏍️" },
      { id: "date-cruise", title: "Cruise Together", emoji: "🛳️" },
      { id: "date-paint", title: "Paint Date", emoji: "🎨" },
      { id: "date-karting", title: "Go-Karting", emoji: "🏁" },
      { id: "date-camden", title: "London Camden Market", emoji: "🛍️" },
      { id: "date-flicks", title: "Take Cool Ass Flicks", emoji: "📸" },
      { id: "date-photobooth", title: "Photo Booth", emoji: "🎞️" },
      { id: "date-winter-wonderland", title: "Winter Wonderland", emoji: "❄️" },
      { id: "date-faaaah", title: "Faaaah", emoji: "✨" },
      { id: "date-build-a-bear", title: "Build-A-Bear", emoji: "🧸" }
    ];
    const defaults = [...originalBadges, ...dateBadgeSeeds];
    const seedMarker = "pf_date_badges_seeded_v1";

    function withStarterBadges(saved, shouldSeedDates) {
      const merged = Array.isArray(saved) ? saved.map((item) => ({ ...item })) : defaults.map((item) => ({ ...item }));
      const existingIds = new Set(merged.map((item) => item.id));
      if (!shouldSeedDates) return merged;
      dateBadgeSeeds.forEach((item) => {
        if (!existingIds.has(item.id)) merged.push({ ...item });
      });
      return merged;
    }

    const savedBadges = shared.get(collectionKey, null);
    const shouldSeedDates = !shared.get(seedMarker, false);
    let items = withStarterBadges(savedBadges, shouldSeedDates);
    if (!Array.isArray(savedBadges) || shouldSeedDates) {
      shared.set(collectionKey, items);
      shared.set(seedMarker, true);
    }
    let unlocked = { ...shared.get("pf_badges", {}) };
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-badges", editing);
      addForm.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit badges';
    }

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
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));

    controllers.managedBadges = {
      refresh() {
        const saved = shared.get(collectionKey, null);
        const addStarterDates = !shared.get(seedMarker, false);
        items = withStarterBadges(saved, addStarterDates);
        if (!Array.isArray(saved) || addStarterDates) {
          shared.set(collectionKey, items);
          shared.set(seedMarker, true);
        }
        unlocked = { ...shared.get("pf_badges", {}) };
        render();
      }
    };
    render();
  }

  function initGifts() {
    const grid = document.getElementById("giftGrid");
    const addForm = document.getElementById("giftForm");
    const editToggle = document.getElementById("giftEditToggle");
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
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-gifts", editing);
      addForm.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit gifts';
    }

    function render() {
      if (!items.length) {
        grid.innerHTML = '<div class="collection-empty"><span>🎁</span><h2>No gifts yet</h2><p>Add the first gift above.</p></div>';
        return;
      }
      grid.innerHTML = items.map((item, index) => {
        const hasPhoto = Boolean(item.photo);
        const needsSignedPhoto = Boolean(shared.photoPath(item.photo));
        const initialPhoto = needsSignedPhoto ? "" : item.photo;
        return '<article class="gift-card managed-card" data-item-id="' + escapeHtml(item.id) + '">' +
          '<span class="gift-number">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<div class="managed-photo">' +
            '<img loading="lazy" decoding="async" src="' + escapeHtml(initialPhoto || "") + '" alt="' + escapeHtml(item.title) + '" ' + (initialPhoto ? "" : "hidden") + '>' +
            '<div class="gift-image" ' + (initialPhoto ? "hidden" : "") + '>' + (hasPhoto ? "Opening private photo..." : "Add a gift photo<br>" + escapeHtml(item.title)) + '</div>' +
            '<label class="photo-upload-btn" title="Upload a gift photo"><span>' + (hasPhoto ? "Replace photo" : "Add photo") + '</span>' +
              '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">' +
            '</label>' +
          '</div>' +
          '<div class="gift-copy"><p class="gift-date">' + escapeHtml(item.date || "Kept with us") + '</p><h2>' + escapeHtml(item.title) + '</h2>' +
            (item.note ? '<p>' + escapeHtml(item.note) + '</p>' : '') + '</div>' +
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
        const card = img.closest(".gift-card");
        const item = items.find((entry) => entry.id === card.dataset.itemId);
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", `Open ${item.title} in photo viewer`);
        img.addEventListener("click", () => openLightbox(img.currentSrc || img.src, item.title, img));
        img.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox(img.currentSrc || img.src, item.title, img);
          }
        });
        if (item.photo && shared.photoPath(item.photo)) {
          shared.resolvePhoto(item.photo).then((url) => {
            if (!url || !img.isConnected) return;
            img.src = url;
          });
        }
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
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));
    setupLightbox();

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
    const editToggle = document.getElementById("memoryEditToggle");
    if (!grid || !addForm) return;
    if (controllers.managedMemories) {
      controllers.managedMemories.refresh();
      return;
    }

    const collectionKey = "pf_memory_items";
    const memoryDefaults = [
      ["us-bike", "Two wheels, one playlist", "images/us-bike.jpg", true, "", "Us, lately", "Outside, together, and making a day of it.", false, true],
      ["us-mirror", "Right where I want to be", "images/us-mirror.jpg", false, "", "Us, lately", "A quiet mirror moment worth keeping.", false, true],
      ["us-food-date", "A date served in two halves", "images/us-food-date.jpg", false, "", "Us, lately", "Good food, better company.", false, true],
      ["us-neon", "Caught in neon", "images/us-neon-mirror.jpg", false, "", "Us, lately", "One more reflection of us.", true, true],
      ["alton", "Alton Towers 🎢", "images/memory1.jpeg"],
      ["museum", "Museum of Illusions ✨", "images/memory2.jpeg"],
      ["train", "Train ride 🚆", "images/memory11.jpeg"],
      ["chill", "Chill day 🍦", "images/memory3.jpeg"],
      ["f1", "F1 🏎️", "images/memory4.jpeg"],
      ["flower-days", "Flowers, again and again 🌷", "images/memory5.jpeg", false, "memory5"],
      ["flowers", "Flowers for my princess 🌷", "images/flowers-for-my-princess.png", true, "flowers-for-my-princess"],
      ["june21-flowers", "Flowers and the best yes 💐", "images/june21-flowers.png", false, "june21-flowers"],
      ["hike", "The Hike 🏞️🥾", "images/memory6.jpeg"],
      ["date-night", "Date night ❤️", "images/memory7.jpeg"],
      ["birthday", "Her birthday 🎂", "images/memory8.jpeg"],
      ["go-ape", "Vals / GO APE 🌲", "images/memory9.jpeg"],
      ["first-date", "Our first date 💕", "images/memory10.jpeg"]
    ].map(([id, title, defaultSrc, featured, assetKey, defaultDate, defaultCaption, rotate, directSrc]) => ({
      id,
      title,
      defaultSrc,
      assetKey: assetKey || defaultSrc.split("/").pop()?.replace(/\.[^.]+$/, ""),
      featured: Boolean(featured),
      date: shared.get("pf_memory_" + id + "_date", defaultDate || ""),
      caption: shared.get("pf_memory_" + id + "_caption", defaultCaption || ""),
      photo: shared.get("pf_memory_" + id + "_photo", ""),
      rotate: Boolean(rotate),
      directSrc: Boolean(directSrc)
    }));
    let items = getManagedItems(collectionKey, memoryDefaults);
    const couplePhotoIds = ["us-bike", "us-mirror", "us-food-date", "us-neon"];
    if (!shared.get("pf_couple_photos_seeded_v1", false)) {
      const existingIds = new Set(items.map((item) => item.id));
      const missingCouplePhotos = memoryDefaults.filter((item) => couplePhotoIds.includes(item.id) && !existingIds.has(item.id));
      if (missingCouplePhotos.length) {
        items = [...missingCouplePhotos, ...items];
        Promise.resolve(shared.set(collectionKey, items))
          .then(() => shared.set("pf_couple_photos_seeded_v1", true));
      } else {
        shared.set("pf_couple_photos_seeded_v1", true);
      }
    }
    const flowerIds = ["flower-days", "flowers", "june21-flowers"];
    const missingFlowers = flowerIds.some((id) => !items.some((item) => item.id === id));
    if (missingFlowers) {
      const currentFlowers = new Map(items.filter((item) => flowerIds.includes(item.id)).map((item) => [item.id, item]));
      const firstFlowerIndex = items.findIndex((item) => flowerIds.includes(item.id));
      const insertAt = firstFlowerIndex >= 0 ? firstFlowerIndex : Math.min(5, items.length);
      const flowerGroup = flowerIds.map((id) => {
        const fallback = memoryDefaults.find((item) => item.id === id);
        return { ...fallback, ...(currentFlowers.get(id) || {}) };
      });
      items = items.filter((item) => !flowerIds.includes(item.id));
      items.splice(insertAt, 0, ...flowerGroup);
      shared.set(collectionKey, items);
    }
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-memories", editing);
      addForm.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit memories';
    }

    function builtInSources(item) {
      if (item.photo) return { src: shared.photoPath(item.photo) ? "" : item.photo, srcset: "" };
      if (item.directSrc && item.defaultSrc) return { src: item.defaultSrc, srcset: "" };
      const source = item.assetKey || (item.defaultSrc || "").split("/").pop()?.replace(/\.[^.]+$/, "");
      if (!source) return { src: "", srcset: "" };
      return {
        src: `images/optimized/${source}-1200.webp`,
        srcset: `images/optimized/${source}-640.webp 640w, images/optimized/${source}-1200.webp 1200w`
      };
    }

    function render() {
      if (!items.length) {
        grid.innerHTML = '<div class="collection-empty"><span>📸</span><h2>No memories yet</h2><p>Add your first memory above.</p></div>';
        return;
      }
      grid.innerHTML = items.map((item, index) => {
        const sources = builtInSources(item);
        const layout = item.featured ? "featured" : `memory-layout-${index % 4}`;
        return '<article class="memory-card managed-card ' + layout + (item.rotate ? " is-rotated" : "") + '" data-item-id="' + escapeHtml(item.id) + '">' +
          '<span class="memory-sequence" aria-hidden="true">' + String(index + 1).padStart(2, "0") + '</span>' +
          '<div class="managed-photo memory-photo">' +
            '<img loading="' + (index < 4 ? "eager" : "lazy") + '" decoding="async" src="' + escapeHtml(sources.src) + '" ' + (sources.srcset ? 'srcset="' + escapeHtml(sources.srcset) + '" sizes="(max-width: 760px) 92vw, 54vw" ' : '') + 'alt="' + escapeHtml(item.title) + '" ' + (item.rotate ? 'data-rotate="90" ' : '') + (sources.src ? "" : "hidden") + '>' +
            '<div class="image-placeholder" ' + (sources.src ? "hidden" : "") + '>Add a photo<br>' + escapeHtml(item.title) + '</div>' +
            '<label class="photo-upload-btn" title="Upload a memory photo"><span>' + (sources.src ? "Replace photo" : "Add photo") + '</span>' +
              '<input type="file" accept="image/jpeg,image/png,image/webp,image/gif">' +
            '</label>' +
          '</div>' +
          '<div class="memory-copy">' +
            '<p class="memory-date">' + escapeHtml(item.date || "Kept with us") + '</p>' +
            '<h2>' + escapeHtml(item.title) + '</h2>' +
            (item.caption ? '<p class="memory-caption">' + escapeHtml(item.caption) + '</p>' : '') +
          '</div>' +
          '<div class="managed-card-bar"><strong>Edit memory</strong><div class="item-actions">' +
            '<button class="item-action move-up" type="button" title="Move memory up" aria-label="Move memory up" ' + (index === 0 ? "disabled" : "") + '>&uarr;</button>' +
            '<button class="item-action move-down" type="button" title="Move memory down" aria-label="Move memory down" ' + (index === items.length - 1 ? "disabled" : "") + '>&darr;</button>' +
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

      const count = document.querySelector(".archive-count");
      if (count) count.textContent = String(items.length).padStart(2, "0");

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
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", `Open ${item.title} in photo viewer`);
        img.addEventListener("click", () => openLightbox(img.currentSrc || img.src, item.title, img));
        img.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox(img.currentSrc || img.src, item.title, img);
          }
        });
        if (item.photo && shared.photoPath(item.photo)) {
          shared.resolvePhoto(item.photo).then((url) => {
            if (!url || !img.isConnected) return;
            img.src = url;
          });
        }
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
      grid.querySelectorAll(".move-up, .move-down").forEach((button) => {
        button.addEventListener("click", async () => {
          const card = button.closest(".memory-card");
          const index = items.findIndex((entry) => entry.id === card.dataset.itemId);
          const nextIndex = button.classList.contains("move-up") ? index - 1 : index + 1;
          if (nextIndex < 0 || nextIndex >= items.length) return;
          [items[index], items[nextIndex]] = [items[nextIndex], items[index]];
          await shared.set(collectionKey, items);
          render();
          toast("Memory order updated");
        });
      });
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));

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
    const addPanel = document.getElementById("quoteAddPanel");
    const editToggle = document.getElementById("quoteEditToggle");
    if (!list || !input || !addButton) return;
    if (controllers.managedQuotes) {
      controllers.managedQuotes.refresh();
      return;
    }

    const defaults = ["You are so yum 🌝", "Princess and the Frog", "The frog knew he was lucky"];
    let quotes = shared.get("pf_quotes", defaults);
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-quotes", editing);
      if (addPanel) addPanel.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit quotes';
    }

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
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));
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
    const addPanel = document.getElementById("loveAddPanel");
    const editToggle = document.getElementById("loveEditToggle");
    if (!list || !input || !addButton) return;
    if (controllers.managedLoveNotes) {
      controllers.managedLoveNotes.refresh();
      return;
    }

    let notes = getLoveNotes();
    let editing = false;

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-love", editing);
      if (addPanel) addPanel.hidden = !editing;
      editToggle?.setAttribute("aria-pressed", String(editing));
      if (editToggle) editToggle.innerHTML = editing
        ? '<span aria-hidden="true">&times;</span> Finish editing'
        : '<span aria-hidden="true">+</span> Edit love notes';
    }

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
      setEditing(editing);
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
    editToggle?.addEventListener("click", () => setEditing(!editing));
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
    const images = document.querySelectorAll(".june21-photo img, .us-photo img");
    if (!images.length) return;
    images.forEach((img) => {
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      img.setAttribute("aria-label", `Open ${img.dataset.storyTitle || img.alt} in photo viewer`);
      img.addEventListener("click", () => openLightbox(img.currentSrc || img.src, img.dataset.storyTitle || img.alt, img));
      img.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openLightbox(img.currentSrc || img.src, img.dataset.storyTitle || img.alt, img);
        }
      });
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
      window.CornerGames?.refresh?.();
    }
    if (page === "gifts") initGifts();
    if (page === "quotes") initQuotes();
    if (page === "love") initLovePage();
    if (page === "messages") initMessages();
  }

  async function start() {
    setupSiteChrome();
    markActiveNav();
    addStatusPill();
    const identity = await window.CornerIdentity?.init?.();
    if (!identity || identity.mode !== "account") await requirePasscode();
    await shared.init();
    setupRandomButtons();
    refreshCurrentPage();
    window.CORNER_READY = { identity };
    document.dispatchEvent(new CustomEvent("corner:ready", { detail: window.CORNER_READY }));
  }

  start();
})();
