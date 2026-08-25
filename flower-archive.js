(function () {
  const COLLECTION_KEY = "pf_flower_gifts";
  const SEED_KEY = "pf_flower_archive_seed_v1";
  const SIGNATURE_FLOWERS = ["rose", "peony", "tulip", "lily", "sunflower", "orchid", "baby's breath", "hydrangea"];
  const DEFAULT_ENTRIES = [
    {
      id: "flower-june21",
      title: "The best yes",
      date: "2026-06-21",
      occasion: "A big question",
      flowerTypes: "Pink roses and mixed blooms",
      palette: "Pink",
      note: "Flowers, rushed planning, one very important question, and the best yes I have ever heard.",
      photo: "images/june21-flowers.png",
      createdBy: "frog",
      createdAt: "2026-06-21T12:00:00.000Z",
      updatedAt: "2026-06-21T12:00:00.000Z"
    },
    {
      id: "flower-for-my-princess",
      title: "Flowers for my Princess",
      date: "",
      occasion: "Just because",
      flowerTypes: "Mixed roses",
      palette: "Mixed",
      note: "A bright bouquet for the person who makes ordinary days feel worth celebrating.",
      photo: "images/flowers-for-my-princess.png",
      createdBy: "frog",
      createdAt: "2026-06-20T12:00:00.000Z",
      updatedAt: "2026-06-20T12:00:00.000Z"
    },
    {
      id: "flower-again-and-again",
      title: "Flowers, again and again",
      date: "",
      occasion: "Just because",
      flowerTypes: "Tulips, peonies and roses",
      palette: "Mixed",
      note: "Not one grand gesture, but a growing collection of small reminders.",
      photo: "images/memory5.jpeg",
      createdBy: "frog",
      createdAt: "2026-06-19T12:00:00.000Z",
      updatedAt: "2026-06-19T12:00:00.000Z"
    }
  ];

  const FLOWER_GUIDE = [
    {
      id: "rose",
      name: "Rose",
      latin: "Rosa",
      meaning: "Devotion, romance and a love worth choosing again.",
      story: "The classic love flower changes its voice with colour: red is bold devotion, pink is admiration, white is sincerity, and yellow often carries warmth and friendship.",
      season: "Early summer",
      care: "Trim the stems, refresh the water often, and keep the vase away from direct heat.",
      palette: "Red · pink · white · yellow",
      source: "https://www.rhs.org.uk/plants/roses/",
      image: "images/june21-flowers.png",
      imageAlt: "A pink rose bouquet held by Princess"
    },
    {
      id: "peony",
      name: "Peony",
      latin: "Paeonia",
      meaning: "Affection, good fortune and a full-hearted kind of happiness.",
      story: "Soft, layered and dramatic, peonies feel generous before a single word is said. They are often chosen for celebrations and promises of a happy life together.",
      season: "Late spring · early summer",
      care: "Give the blooms room to open and remove leaves that would sit below the waterline.",
      palette: "Blush · coral · white · burgundy",
      source: "https://www.rhs.org.uk/plants/peony/herbaceous/growing-guide",
      image: "images/memory5.jpeg",
      imageAlt: "A collection of romantic bouquets including peonies"
    },
    {
      id: "tulip",
      name: "Tulip",
      latin: "Tulipa",
      meaning: "A clear declaration: simple, certain love.",
      story: "Tulips make romance feel modern and effortless. Their clean silhouettes work beautifully alone, while mixed colours turn a bouquet into a playful little celebration.",
      season: "Spring",
      care: "Use cool water, recut the stems, and rotate the vase as tulips naturally lean toward light.",
      palette: "Almost every colour",
      source: "https://www.rhs.org.uk/plants/tulip/growing-guide",
      image: "images/memory5.jpeg",
      imageAlt: "Pink tulips arranged among other bouquets"
    },
    {
      id: "lily",
      name: "Lily",
      latin: "Lilium",
      meaning: "Purity, admiration and a love with presence.",
      story: "Lilies bring height, fragrance and theatre. White lilies are often linked with sincerity, while pink varieties can express admiration and tenderness.",
      season: "Summer",
      care: "Remove spent pollen carefully and keep lilies completely away from cats; every part is highly toxic to them.",
      palette: "White · pink · orange · yellow",
      source: "https://www.rhs.org.uk/plants/lilies/how-to-grow-lilies",
      image: "images/flower-theatre-hero.png",
      imageAlt: "A white lily in a dramatic flower display"
    },
    {
      id: "sunflower",
      name: "Sunflower",
      latin: "Helianthus",
      meaning: "Loyalty, warmth and joy that turns toward the light.",
      story: "A sunflower is difficult to receive without smiling. It feels optimistic and direct: a bright way to say that somebody makes the whole day better.",
      season: "Summer · early autumn",
      care: "Use a sturdy vase, plenty of fresh water, and remove any leaves below the waterline.",
      palette: "Gold · amber · deep brown",
      source: "https://www.rhs.org.uk/plants/sunflowers/growing-guide",
      image: "images/flower-theatre-hero.png",
      imageAlt: "A sunflower in a premium botanical display"
    },
    {
      id: "orchid",
      name: "Orchid",
      latin: "Orchidaceae",
      meaning: "Rare beauty, thoughtfulness and lasting admiration.",
      story: "Orchids feel considered. Their sculptural flowers and long display life make them a strong choice when the message is: you are singular, and I notice you.",
      season: "Year-round indoors",
      care: "Keep cut stems in clean water and potted orchids in bright, indirect light without overwatering.",
      palette: "White · purple · pink · green",
      source: "https://www.rhs.org.uk/plants/orchids",
      image: "images/flower-theatre-hero.png",
      imageAlt: "A purple orchid in a dramatic flower display"
    },
    {
      id: "baby-breath",
      name: "Baby's Breath",
      latin: "Gypsophila",
      meaning: "Tenderness, sincerity and love in the little details.",
      story: "Often used to support larger blooms, baby's breath has its own quiet beauty. It makes a bouquet feel airy and turns small gestures into something soft and complete.",
      season: "Summer",
      care: "Keep the fine stems dry above the waterline and remove any pieces that begin to brown.",
      palette: "White · blush",
      source: "https://www.rhs.org.uk/plants/gypsophila",
      image: "images/flower-theatre-hero.png",
      imageAlt: "White baby's breath surrounding a botanical display"
    },
    {
      id: "hydrangea",
      name: "Hydrangea",
      latin: "Hydrangea",
      meaning: "Gratitude, abundance and feelings too full for one small bloom.",
      story: "One hydrangea head is already a bouquet of tiny flowers. It carries a sense of abundance and works beautifully when the feeling you want to express is generous and grateful.",
      season: "Summer · autumn",
      care: "Hydrangeas drink heavily: recut the stem, use a clean full vase, and mist the flower head lightly.",
      palette: "Blue · pink · white · green",
      source: "https://www.rhs.org.uk/plants/hydrangea",
      image: "images/flower-theatre-hero.png",
      imageAlt: "A blue hydrangea in a dramatic botanical display"
    }
  ];

  let initialized = false;
  let shared = null;
  let notify = () => {};
  let items = [];
  let editingId = "";
  let activeGuide = FLOWER_GUIDE[0].id;

  const byId = (id) => document.getElementById(id);
  const escapeHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

  function identityRole() {
    const direct = window.CornerIdentity?.role?.();
    return direct || window.CornerIdentity?.current?.role || "frog";
  }

  function makeId() {
    return `flower-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeEntry(item, index) {
    const now = new Date().toISOString();
    return {
      id: String(item?.id || makeId()),
      title: String(item?.title || `Bouquet ${index + 1}`),
      date: String(item?.date || ""),
      occasion: String(item?.occasion || "Just because"),
      flowerTypes: String(item?.flowerTypes || item?.types || "Mixed blooms"),
      palette: String(item?.palette || "Mixed"),
      note: String(item?.note || ""),
      photo: String(item?.photo || ""),
      createdBy: item?.createdBy === "princess" ? "princess" : "frog",
      createdAt: String(item?.createdAt || now),
      updatedAt: String(item?.updatedAt || item?.createdAt || now),
      _revision: item?._revision
    };
  }

  function formatDate(value) {
    if (!value) return "Date still to be added";
    const date = new Date(`${value}T12:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
  }

  function sortTime(item) {
    const value = item.date || item.createdAt;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  function flowerWords(entry) {
    return entry.flowerTypes.toLowerCase().split(/[,/&]+/).map((part) => part.trim()).filter(Boolean);
  }

  function discoveredFlowers() {
    const allWords = items.flatMap(flowerWords).join(" ");
    return SIGNATURE_FLOWERS.filter((name) => {
      const variants = name === "baby's breath" ? ["baby's breath", "babys breath", "gypsophila"] : [name];
      return variants.some((variant) => allWords.includes(variant));
    });
  }

  function safePhoto(entry) {
    const signed = shared?.photoPath?.(entry.photo);
    return signed ? "" : entry.photo;
  }

  async function resolvePrivatePhotos(root = document) {
    const images = [...root.querySelectorAll("img[data-photo-ref]")];
    await Promise.all(images.map(async (img) => {
      const ref = img.dataset.photoRef;
      if (!ref || !shared?.photoPath?.(ref)) return;
      const url = await shared.resolvePhoto(ref);
      if (url && img.isConnected) img.src = url;
    }));
  }

  function renderGuide() {
    const tabs = byId("flowerGuideTabs");
    const spotlight = byId("flowerSpotlight");
    if (!tabs || !spotlight) return;
    tabs.innerHTML = FLOWER_GUIDE.map((flower, index) => `
      <button type="button" role="tab" aria-selected="${flower.id === activeGuide}" data-guide-id="${flower.id}">
        <span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(flower.name)}</strong>
      </button>`).join("");
    const flower = FLOWER_GUIDE.find((entry) => entry.id === activeGuide) || FLOWER_GUIDE[0];
    spotlight.innerHTML = `
      <div class="flower-spotlight-image">
        <img src="${escapeHtml(flower.image)}" alt="${escapeHtml(flower.imageAlt)}">
        <span>${escapeHtml(flower.latin)}</span>
      </div>
      <div class="flower-spotlight-copy">
        <p class="flower-spotlight-index">Botanical note · ${String(FLOWER_GUIDE.indexOf(flower) + 1).padStart(2, "0")}</p>
        <h3>${escapeHtml(flower.name)}</h3>
        <blockquote>${escapeHtml(flower.meaning)}</blockquote>
        <p>${escapeHtml(flower.story)}</p>
        <dl>
          <div><dt>Best season</dt><dd>${escapeHtml(flower.season)}</dd></div>
          <div><dt>Colour language</dt><dd>${escapeHtml(flower.palette)}</dd></div>
          <div><dt>Keep it beautiful</dt><dd>${escapeHtml(flower.care)}</dd></div>
        </dl>
        <a href="${escapeHtml(flower.source)}" target="_blank" rel="noreferrer">Botanical care reference <span aria-hidden="true">↗</span></a>
      </div>`;
    tabs.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        activeGuide = button.dataset.guideId;
        renderGuide();
      });
    });
  }

  function renderSummary() {
    const varieties = new Set(items.flatMap(flowerWords).map((word) => word.replace(/\s+and\s+/g, " ")));
    const newest = [...items].sort((a, b) => sortTime(b) - sortTime(a))[0];
    if (byId("flowerTotal")) byId("flowerTotal").textContent = String(items.length).padStart(2, "0");
    if (byId("flowerVarieties")) byId("flowerVarieties").textContent = String(varieties.size).padStart(2, "0");
    if (byId("flowerLatest")) byId("flowerLatest").textContent = newest?.date
      ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" }).format(new Date(`${newest.date}T12:00:00`))
      : "OURS";

    const discovered = discoveredFlowers();
    if (byId("flowerPassport")) byId("flowerPassport").textContent = `${discovered.length} of ${SIGNATURE_FLOWERS.length}`;
    if (byId("flowerPassportBar")) byId("flowerPassportBar").style.width = `${(discovered.length / SIGNATURE_FLOWERS.length) * 100}%`;
    if (byId("flowerPassportStamps")) {
      byId("flowerPassportStamps").innerHTML = SIGNATURE_FLOWERS.map((name) => `
        <span class="${discovered.includes(name) ? "is-found" : ""}" title="${discovered.includes(name) ? "Discovered" : "Not in the archive yet"}">
          ${discovered.includes(name) ? "●" : "○"} ${escapeHtml(name)}
        </span>`).join("");
    }
  }

  function filteredItems() {
    const query = byId("flowerSearch")?.value.trim().toLowerCase() || "";
    const palette = byId("flowerPaletteFilter")?.value || "all";
    const sort = byId("flowerSort")?.value || "newest";
    const visible = items.filter((item) => {
      const haystack = `${item.title} ${item.flowerTypes} ${item.occasion} ${item.note}`.toLowerCase();
      return (!query || haystack.includes(query)) && (palette === "all" || item.palette === palette);
    });
    visible.sort((a, b) => {
      if (sort === "oldest") return sortTime(a) - sortTime(b);
      if (sort === "name") return a.title.localeCompare(b.title);
      return sortTime(b) - sortTime(a);
    });
    return visible;
  }

  function renderCollection() {
    const grid = byId("giftGrid");
    if (!grid) return;
    const visible = filteredItems();
    if (!visible.length) {
      grid.innerHTML = `<div class="flower-empty"><span aria-hidden="true">✿</span><h3>No bouquets match this view.</h3><p>Clear the search, choose another colour, or add a new flower memory.</p></div>`;
      renderSummary();
      return;
    }
    grid.innerHTML = visible.map((entry, index) => {
      const photo = safePhoto(entry);
      const archiveNumber = String(items.indexOf(entry) + 1).padStart(2, "0");
      const photoMarkup = entry.photo
        ? `<img src="${escapeHtml(photo || "images/flower-theatre-hero.png")}" data-photo-ref="${escapeHtml(entry.photo)}" alt="${escapeHtml(entry.title)}">`
        : `<span class="flower-entry-placeholder" aria-hidden="true"><b>Photograph</b><small>to be added</small></span>`;
      return `
        <article class="flower-entry" data-flower-id="${escapeHtml(entry.id)}">
          <button class="flower-entry-photo" type="button" aria-label="${entry.photo ? `Open photo for ${escapeHtml(entry.title)}` : `No photo added for ${escapeHtml(entry.title)}`}" ${entry.photo ? "" : "disabled"}>
            ${photoMarkup}
            ${entry.photo ? `<span>View photograph <b aria-hidden="true">↗</b></span>` : ""}
          </button>
          <div class="flower-entry-copy">
            <p class="flower-entry-number">Archive ${archiveNumber} · ${escapeHtml(entry.palette)}</p>
            <h3>${escapeHtml(entry.title)}</h3>
            <p class="flower-entry-date">${escapeHtml(formatDate(entry.date))} <span>·</span> ${escapeHtml(entry.occasion)}</p>
            <p class="flower-entry-types">${escapeHtml(entry.flowerTypes)}</p>
            ${entry.note ? `<blockquote>${escapeHtml(entry.note)}</blockquote>` : ""}
            <div class="flower-entry-footer">
              <span>Added by ${entry.createdBy === "princess" ? "Princess" : "Frog"}</span>
              <div>
                <button class="flower-icon-button flower-edit" type="button" title="Edit bouquet" aria-label="Edit ${escapeHtml(entry.title)}">✎</button>
                <button class="flower-icon-button flower-delete" type="button" title="Delete bouquet" aria-label="Delete ${escapeHtml(entry.title)}">×</button>
              </div>
            </div>
          </div>
        </article>`;
    }).join("");
    grid.querySelectorAll(".flower-entry").forEach((article) => {
      const entry = items.find((item) => item.id === article.dataset.flowerId);
      if (entry?.photo) article.querySelector(".flower-entry-photo")?.addEventListener("click", () => openPhoto(entry, article.querySelector("img")));
      article.querySelector(".flower-edit")?.addEventListener("click", () => openForm(entry));
      article.querySelector(".flower-delete")?.addEventListener("click", () => deleteEntry(entry));
    });
    resolvePrivatePhotos(grid);
    renderSummary();
  }

  function resetForm() {
    editingId = "";
    byId("giftForm")?.reset();
    if (byId("flowerEditingId")) byId("flowerEditingId").value = "";
    if (byId("flowerFormTitle")) byId("flowerFormTitle").textContent = "Add a bouquet";
    if (byId("flowerFormState")) byId("flowerFormState").textContent = "";
  }

  function openForm(entry = null) {
    const form = byId("giftForm");
    if (!form) return;
    resetForm();
    editingId = entry?.id || "";
    byId("flowerEditingId").value = editingId;
    if (entry) {
      byId("flowerFormTitle").textContent = "Edit this bouquet";
      byId("newGiftTitle").value = entry.title;
      byId("newGiftDate").value = entry.date;
      byId("newGiftOccasion").value = [...byId("newGiftOccasion").options].some((option) => option.value === entry.occasion) ? entry.occasion : "Other";
      byId("newGiftTypes").value = entry.flowerTypes;
      byId("newGiftPalette").value = entry.palette;
      byId("newGiftNote").value = entry.note;
    }
    form.hidden = false;
    byId("giftEditToggle")?.setAttribute("aria-expanded", "true");
    window.setTimeout(() => byId("newGiftTitle")?.focus(), 30);
    form.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function closeForm() {
    const form = byId("giftForm");
    if (form) form.hidden = true;
    byId("giftEditToggle")?.setAttribute("aria-expanded", "false");
    resetForm();
  }

  async function saveEntries(message) {
    await shared.set(COLLECTION_KEY, items);
    renderCollection();
    notify(message);
  }

  async function submitEntry(event) {
    event.preventDefault();
    const title = byId("newGiftTitle").value.trim();
    if (!title) return;
    const state = byId("flowerFormState");
    const file = byId("newGiftPhoto").files?.[0];
    if (file && (!file.type.startsWith("image/") || file.size > 8 * 1024 * 1024)) {
      state.textContent = "Choose a JPG, PNG, WebP or GIF under 8 MB.";
      return;
    }
    state.textContent = file ? "Uploading the bouquet photograph…" : "Saving this flower memory…";
    const existing = items.find((item) => item.id === editingId);
    const now = new Date().toISOString();
    const entry = normalizeEntry({
      ...(existing || {}),
      id: existing?.id || makeId(),
      title,
      date: byId("newGiftDate").value,
      occasion: byId("newGiftOccasion").value,
      flowerTypes: byId("newGiftTypes").value.trim() || "Mixed blooms",
      palette: byId("newGiftPalette").value,
      note: byId("newGiftNote").value.trim(),
      createdBy: existing?.createdBy || identityRole(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    }, 0);
    if (file) {
      const ref = await shared.uploadPhoto(file, `flower-${entry.id}`);
      if (!ref) {
        state.textContent = "The photo could not upload. Try again when the connection is steady.";
        return;
      }
      entry.photo = ref;
    }
    if (existing) items = items.map((item) => item.id === entry.id ? entry : item);
    else items = [entry, ...items];
    await saveEntries(existing ? "Bouquet updated" : "Bouquet added to her archive");
    closeForm();
  }

  async function deleteEntry(entry) {
    if (!entry || !window.confirm(`Remove “${entry.title}” from the flower archive?`)) return;
    items = items.filter((item) => item.id !== entry.id);
    await saveEntries("Bouquet removed");
  }

  function openPhoto(entry, sourceImage) {
    const dialog = byId("flowerPhotoDialog");
    if (!dialog || !entry || !sourceImage) return;
    const image = dialog.querySelector("img");
    image.src = sourceImage.currentSrc || sourceImage.src;
    image.alt = entry.title;
    dialog.querySelector("p").textContent = formatDate(entry.date);
    dialog.querySelector("h2").textContent = entry.title;
    dialog.querySelector("span").textContent = entry.flowerTypes;
    dialog.showModal();
  }

  async function loadEntries() {
    const saved = shared.get(COLLECTION_KEY, null);
    const seeded = shared.get(SEED_KEY, false);
    if (Array.isArray(saved) && (saved.length || seeded)) {
      items = saved.map(normalizeEntry);
    } else {
      items = DEFAULT_ENTRIES.map(normalizeEntry);
      await shared.set(COLLECTION_KEY, items);
    }
    if (!seeded) await shared.set(SEED_KEY, true);
  }

  function bindEvents() {
    byId("giftEditToggle")?.addEventListener("click", () => openForm());
    byId("flowerFormClose")?.addEventListener("click", closeForm);
    byId("flowerFormCancel")?.addEventListener("click", closeForm);
    byId("giftForm")?.addEventListener("submit", submitEntry);
    ["flowerSearch", "flowerPaletteFilter", "flowerSort"].forEach((id) => {
      byId(id)?.addEventListener(id === "flowerSearch" ? "input" : "change", renderCollection);
    });
    const dialog = byId("flowerPhotoDialog");
    dialog?.querySelector(".flower-dialog-close")?.addEventListener("click", () => dialog.close());
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    document.addEventListener("corner:content-snapshot", (event) => {
      const remote = event.detail?.values?.[COLLECTION_KEY];
      if (!initialized || !Array.isArray(remote)) return;
      items = remote.map(normalizeEntry);
      renderCollection();
    });
  }

  async function init(options = {}) {
    shared = options.shared || shared;
    notify = options.toast || notify;
    if (!shared) return;
    if (initialized) {
      const saved = shared.get(COLLECTION_KEY, items);
      if (Array.isArray(saved)) items = saved.map(normalizeEntry);
      renderCollection();
      return;
    }
    initialized = true;
    renderGuide();
    bindEvents();
    await loadEntries();
    renderCollection();
  }

  window.PFCornerFlowerArchive = { init, refresh: renderCollection };
})();
