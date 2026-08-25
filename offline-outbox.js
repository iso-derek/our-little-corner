(function () {
  const DB_NAME = "princess-frog-outbox";
  const STORE_NAME = "operations";
  const DB_VERSION = 1;
  let configuredClient = null;
  let configuredSiteId = "";
  let flushPromise = null;
  let lastState = "saved";

  function emit(state, detail = {}) {
    lastState = state;
    document.dispatchEvent(new CustomEvent("corner:sync-state", {
      detail: { state, ...detail }
    }));
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is unavailable"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("siteId", "siteId", { unique: false });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open the offline outbox"));
    });
  }

  async function withStore(mode, callback) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const store = transaction.objectStore(STORE_NAME);
        let result;
        try {
          result = callback(store);
        } catch (error) {
          reject(error);
          return;
        }
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error("Offline outbox transaction failed"));
        transaction.onabort = () => reject(transaction.error || new Error("Offline outbox transaction was cancelled"));
      });
    } finally {
      database.close();
    }
  }

  async function allOperations() {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error("Could not read pending changes"));
      });
    } finally {
      database.close();
    }
  }

  async function pendingCount() {
    try {
      return (await allOperations()).filter((operation) => !configuredSiteId || operation.siteId === configuredSiteId).length;
    } catch {
      return 0;
    }
  }

  async function queueKeyValue(siteId, key, value, reason = "offline") {
    const operation = {
      id: `kv:${siteId}:${key}`,
      type: "corner-kv-upsert",
      siteId,
      key,
      value,
      reason,
      attempts: 0,
      lastError: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      await withStore("readwrite", (store) => store.put(operation));
      const count = await pendingCount();
      emit(navigator.onLine ? "syncing" : "offline", { pending: count });
      return true;
    } catch (error) {
      console.warn("The offline outbox could not save this change.", error);
      emit("needs-attention", { pending: 0, error: error.message });
      return false;
    }
  }

  async function queueContent(siteId, key, value, reason = "offline") {
    const operation = {
      id: `content:${siteId}:${key}`,
      type: "normalized-content-write",
      siteId,
      key,
      value,
      reason,
      attempts: 0,
      lastError: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    try {
      await withStore("readwrite", (store) => store.put(operation));
      const count = await pendingCount();
      emit(navigator.onLine ? "syncing" : "offline", { pending: count });
      return true;
    } catch (error) {
      console.warn("The offline outbox could not save this content change.", error);
      emit("needs-attention", { pending: 0, error: error.message });
      return false;
    }
  }

  async function removeOperation(id) {
    await withStore("readwrite", (store) => store.delete(id));
  }

  async function updateOperation(operation, error) {
    await withStore("readwrite", (store) => store.put({
      ...operation,
      attempts: Number(operation.attempts || 0) + 1,
      lastError: error?.message || String(error || "Sync failed"),
      updatedAt: new Date().toISOString()
    }));
  }

  async function flush(client = configuredClient) {
    if (flushPromise) return flushPromise;
    if (!client || !navigator.onLine) {
      const pending = await pendingCount();
      emit(pending ? "offline" : "saved", { pending });
      return false;
    }

    flushPromise = (async () => {
      const operations = (await allOperations())
        .filter((operation) => !configuredSiteId || operation.siteId === configuredSiteId)
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      if (!operations.length) {
        emit("saved", { pending: 0 });
        return true;
      }

      emit("syncing", { pending: operations.length });
      let failed = 0;
      for (const operation of operations) {
        try {
          if (operation.type === "corner-kv-upsert") {
            const { error } = await client.from("corner_kv").upsert({
              site_id: operation.siteId,
              key: operation.key,
              value: operation.value,
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
          } else if (operation.type === "normalized-content-write") {
            if (!window.CornerContentRepository?.enabled) throw new Error("Normalized content backend is unavailable");
            await window.CornerContentRepository.write(operation.key, operation.value, { fromOutbox: true });
          } else {
            throw new Error("Unsupported queued operation");
          }
          await removeOperation(operation.id);
          document.dispatchEvent(new CustomEvent("corner:outbox-synced", { detail: operation }));
        } catch (error) {
          failed += 1;
          await updateOperation(operation, error);
          console.warn("A queued change still needs attention.", error);
        }
      }

      const pending = await pendingCount();
      emit(failed ? "needs-attention" : "saved", { pending, failed });
      return failed === 0;
    })();

    try {
      return await flushPromise;
    } catch (error) {
      const pending = await pendingCount();
      emit("needs-attention", { pending, error: error.message });
      return false;
    } finally {
      flushPromise = null;
    }
  }

  async function configure({ client, siteId }) {
    configuredClient = client || null;
    configuredSiteId = siteId || "";
    const pending = await pendingCount();
    emit(pending ? (navigator.onLine ? "syncing" : "offline") : "saved", { pending });
    if (pending && navigator.onLine) flush();
  }

  window.addEventListener("online", () => flush());
  window.addEventListener("offline", async () => emit("offline", { pending: await pendingCount() }));

  window.CornerOutbox = {
    configure,
    queueKeyValue,
    queueContent,
    flush,
    pendingCount,
    get state() {
      return lastState;
    }
  };
})();
