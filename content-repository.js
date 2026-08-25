(function () {
  const SUPPORTED_KEYS = [
    "pf_letter_categories",
    "pf_memory_items",
    "pf_messages",
    "pf_date_ideas",
    "pf_date_selected",
    "pf_movie_items",
    "pf_ritual_completed_days"
  ];
  const FLOWER_KEY = "pf_flower_gifts";
  const SUPPORTED_PATTERNS = [
    /^openwhen_(?:derek|princess)_.+$/,
    /^pf_memory_.+_(?:date|caption|photo)$/,
    /^pf_date_availability_(?:frog|princess)$/,
    /^pf_ritual_\d{4}-\d{2}-\d{2}_(?:frog|princess)$/
  ];
  const REALTIME_TABLES = [
    "corner_letters",
    "corner_memories",
    "corner_messages",
    "corner_dates",
    "corner_date_availability",
    "corner_movies",
    "corner_ratings"
  ];

  let client = null;
  let siteId = "";
  let enabled = false;
  let snapshot = {};
  let channel = null;
  let pullPromise = null;
  let refreshTimer = null;
  let flowerBackendEnabled = false;

  function supports(key) {
    return SUPPORTED_KEYS.includes(key)
      || (key === FLOWER_KEY && flowerBackendEnabled)
      || SUPPORTED_PATTERNS.some((pattern) => pattern.test(key));
  }

  function emit(values, source = "server") {
    snapshot = values && typeof values === "object" && !Array.isArray(values) ? values : {};
    document.dispatchEvent(new CustomEvent("corner:content-snapshot", {
      detail: { values: snapshot, source }
    }));
    return snapshot;
  }

  function isMissingBackend(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return ["42883", "42P01", "PGRST202", "PGRST205"].includes(code)
      || message.includes("content_snapshot")
      || message.includes("could not find the function");
  }

  async function pull(source = "pull") {
    if (!enabled || !client) return { enabled: false, values: {} };
    if (pullPromise) return pullPromise;
    pullPromise = (async () => {
      const { data, error } = await client.rpc("content_snapshot");
      if (error) {
        if (isMissingBackend(error)) enabled = false;
        throw error;
      }
      const values = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
      const flowerResponse = await client.rpc("flower_archive_snapshot");
      if (!flowerResponse.error) {
        flowerBackendEnabled = true;
        values[FLOWER_KEY] = Array.isArray(flowerResponse.data) ? flowerResponse.data : [];
      } else if (isMissingBackend(flowerResponse.error)) {
        flowerBackendEnabled = false;
      } else {
        console.warn("Flower archive refresh failed.", flowerResponse.error);
      }
      return { enabled: true, values: emit(values, source) };
    })();
    try {
      return await pullPromise;
    } finally {
      pullPromise = null;
    }
  }

  async function write(key, value, options = {}) {
    if (!enabled || !client || !supports(key)) throw new Error("Normalized content backend is unavailable");
    if (key === FLOWER_KEY) {
      const { data, error } = await client.rpc("flower_archive_replace", { p_items: value });
      if (error) throw error;
      const values = { ...snapshot, [FLOWER_KEY]: Array.isArray(data) ? data : [] };
      emit(values, options.fromOutbox ? "outbox" : "write");
      if (!options.fromOutbox) window.CornerRealtime?.send?.("content-event", { key });
      return values;
    }
    const { data, error } = await client.rpc("content_write", { p_key: key, p_value: value });
    if (error) throw error;
    emit(data || {}, options.fromOutbox ? "outbox" : "write");
    if (!options.fromOutbox) window.CornerRealtime?.send?.("content-event", { key });
    return data;
  }

  async function recycleBin() {
    if (!enabled || !client) return [];
    const { data, error } = await client.rpc("content_recycle_bin");
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function restore(kind, id) {
    if (!enabled || !client) throw new Error("Normalized content backend is unavailable");
    const { data, error } = await client.rpc("content_restore", { p_kind: kind, p_id: id });
    if (error) throw error;
    emit(data || {}, "restore");
    window.CornerRealtime?.send?.("content-event", { key: kind === "letter" ? "pf_letter_categories" : "pf_memory_items" });
    return data;
  }

  async function operationsStatus() {
    if (!enabled || !client) return null;
    const { data, error } = await client.rpc("content_operations_status");
    if (error) throw error;
    return data || null;
  }

  function scheduleRefresh(source) {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      pull(source).catch((error) => console.warn("Normalized content refresh failed.", error));
    }, 120);
  }

  function subscribe() {
    if (!enabled || !client?.channel || channel) return;
    channel = client.channel(`corner-content-${siteId}`);
    REALTIME_TABLES.forEach((table) => {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter: `site_id=eq.${siteId}`
      }, () => scheduleRefresh("realtime"));
    });
    if (flowerBackendEnabled) {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "corner_flower_gifts",
        filter: `site_id=eq.${siteId}`
      }, () => scheduleRefresh("realtime"));
    }
    channel.subscribe();
  }

  async function configure(options = {}) {
    client = options.client || null;
    siteId = options.siteId || "";
    const accountMode = window.CornerIdentity?.current?.mode === "account";
    if (!client || !siteId || !accountMode || typeof client.rpc !== "function") {
      enabled = false;
      return false;
    }
    try {
      enabled = true;
      await pull("configure");
      subscribe();
      return true;
    } catch (error) {
      enabled = false;
      if (!isMissingBackend(error)) console.warn("Normalized content backend could not start.", error);
      return false;
    }
  }

  document.addEventListener("corner:broadcast", (event) => {
    if (!enabled || event.detail?.event !== "content-event") return;
    scheduleRefresh("broadcast");
  });

  window.CornerContentRepository = {
    configure,
    pull,
    write,
    supports,
    recycleBin,
    restore,
    operationsStatus,
    get enabled() {
      return enabled;
    },
    get snapshot() {
      return snapshot;
    }
  };
})();
