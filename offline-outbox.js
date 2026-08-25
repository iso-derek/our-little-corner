(function () {
  const DB_NAME = "princess-frog-outbox";
  const STORE_NAME = "operations";
  const DB_VERSION = 1;
  const TIME_FIELDS = ["updatedAt", "createdAt", "playedAt", "givenOn", "date"];
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

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function equal(left, right) {
    if (left === right) return true;
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  function objectValue(value) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
  }

  function entityId(value) {
    if (!objectValue(value)) return "";
    return String(value.id ?? value.key ?? value.movieId ?? value.movie_id ?? "");
  }

  function conflict(path) {
    return { conflict: true, path: path || "shared value" };
  }

  function mergeObject(base, local, remote, path) {
    const result = {};
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {}), ...Object.keys(remote || {})]);
    for (const key of keys) {
      const keyPath = path ? `${path}.${key}` : key;
      const hasBase = Object.prototype.hasOwnProperty.call(base || {}, key);
      const hasLocal = Object.prototype.hasOwnProperty.call(local || {}, key);
      const hasRemote = Object.prototype.hasOwnProperty.call(remote || {}, key);
      if (!hasLocal && !hasRemote) continue;
      if (!hasBase) {
        if (hasLocal && !hasRemote) result[key] = clone(local[key]);
        else if (!hasLocal && hasRemote) result[key] = clone(remote[key]);
        else {
          const merged = mergeNode(undefined, local[key], remote[key], keyPath);
          if (merged.conflict) return merged;
          result[key] = merged.value;
        }
        continue;
      }
      if (!hasLocal) {
        if (equal(remote[key], base[key])) continue;
        return conflict(keyPath);
      }
      if (!hasRemote) {
        if (equal(local[key], base[key])) continue;
        return conflict(keyPath);
      }
      const merged = mergeNode(base[key], local[key], remote[key], keyPath);
      if (merged.conflict) return merged;
      result[key] = merged.value;
    }
    return { conflict: false, value: result };
  }

  function mergeEntityArrays(base, local, remote, path) {
    const baseMap = new Map(base.map((item) => [entityId(item), item]));
    const localMap = new Map(local.map((item) => [entityId(item), item]));
    const remoteMap = new Map(remote.map((item) => [entityId(item), item]));
    const order = [...new Set([...local.map(entityId), ...remote.map(entityId), ...base.map(entityId)])];
    const result = [];

    for (const id of order) {
      const hadBase = baseMap.has(id);
      const hasLocal = localMap.has(id);
      const hasRemote = remoteMap.has(id);
      const itemPath = `${path || "items"}[${id}]`;
      if (!hadBase) {
        if (hasLocal && !hasRemote) result.push(clone(localMap.get(id)));
        else if (!hasLocal && hasRemote) result.push(clone(remoteMap.get(id)));
        else if (hasLocal && hasRemote) {
          const merged = mergeNode({}, localMap.get(id), remoteMap.get(id), itemPath);
          if (merged.conflict) return merged;
          result.push(merged.value);
        }
        continue;
      }
      if (!hasLocal && !hasRemote) continue;
      if (!hasLocal) {
        if (equal(remoteMap.get(id), baseMap.get(id))) continue;
        return conflict(itemPath);
      }
      if (!hasRemote) {
        if (equal(localMap.get(id), baseMap.get(id))) continue;
        return conflict(itemPath);
      }
      const merged = mergeNode(baseMap.get(id), localMap.get(id), remoteMap.get(id), itemPath);
      if (merged.conflict) return merged;
      result.push(merged.value);
    }

    if (result.some((item) => TIME_FIELDS.some((field) => item?.[field]))) {
      result.sort((left, right) => {
        const leftTime = TIME_FIELDS.map((field) => Date.parse(left?.[field])).find(Number.isFinite) || 0;
        const rightTime = TIME_FIELDS.map((field) => Date.parse(right?.[field])).find(Number.isFinite) || 0;
        return rightTime - leftTime;
      });
    }
    return { conflict: false, value: result };
  }

  function mergeArrays(base, local, remote, path) {
    const all = [...base, ...local, ...remote];
    const hasEntityIds = all.length > 0 && all.every((item) => objectValue(item) && entityId(item));
    if (hasEntityIds) return mergeEntityArrays(base, local, remote, path);
    const primitiveOnly = all.every((item) => item == null || ["string", "number", "boolean"].includes(typeof item));
    if (primitiveOnly) return { conflict: false, value: [...new Set([...local, ...remote])] };
    return conflict(path);
  }

  function mergeNode(base, local, remote, path = "shared value") {
    if (equal(local, remote)) return { conflict: false, value: clone(local) };
    if (equal(local, base)) return { conflict: false, value: clone(remote) };
    if (equal(remote, base)) return { conflict: false, value: clone(local) };
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)) {
      return mergeArrays(base, local, remote, path);
    }
    if (objectValue(local) && objectValue(remote) && (base === undefined || objectValue(base))) {
      return mergeObject(objectValue(base) ? base : {}, local, remote, path);
    }
    return conflict(path);
  }

  function mergeOfflineValue(base, local, remote) {
    return mergeNode(base, local, remote);
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

  async function readOperation(id) {
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error || new Error("Could not read a pending change"));
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

  async function queueOperation(type, siteId, key, value, reason, options = {}) {
    const id = `${type === "normalized-content-write" ? "content" : "kv"}:${siteId}:${key}`;
    const previous = await readOperation(id).catch(() => null);
    const hasBase = previous?.hasBase || Object.prototype.hasOwnProperty.call(options, "baseValue");
    const operation = {
      id,
      type,
      siteId,
      key,
      value: clone(value),
      baseValue: previous?.hasBase ? previous.baseValue : clone(options.baseValue),
      hasBase,
      reason,
      attempts: 0,
      lastError: "",
      createdAt: previous?.createdAt || new Date().toISOString(),
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

  function queueKeyValue(siteId, key, value, reason = "offline", options = {}) {
    return queueOperation("corner-kv-upsert", siteId, key, value, reason, options);
  }

  function queueContent(siteId, key, value, reason = "offline", options = {}) {
    return queueOperation("normalized-content-write", siteId, key, value, reason, options);
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

  function mergeOrThrow(operation, remoteValue) {
    if (!operation.hasBase) return operation.value;
    const merged = mergeOfflineValue(operation.baseValue, operation.value, remoteValue);
    if (!merged.conflict) return merged.value;
    const error = new Error(`Both of you changed ${operation.key} while this device was offline. Review this change before syncing.`);
    error.code = "OUTBOX_CONFLICT";
    error.path = merged.path;
    throw error;
  }

  async function currentKeyValue(client, operation) {
    const table = client.from("corner_kv");
    if (typeof table.select !== "function") return operation.baseValue;
    const query = table
      .select("value,updated_at")
      .eq("site_id", operation.siteId)
      .eq("key", operation.key);
    const response = typeof query.maybeSingle === "function" ? await query.maybeSingle() : await query;
    if (response?.error) throw response.error;
    return response?.data?.value;
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
            const remoteValue = await currentKeyValue(client, operation);
            const value = mergeOrThrow(operation, remoteValue);
            const { error } = await client.from("corner_kv").upsert({
              site_id: operation.siteId,
              key: operation.key,
              value,
              updated_at: new Date().toISOString()
            });
            if (error) throw error;
          } else if (operation.type === "normalized-content-write") {
            if (!window.CornerContentRepository?.enabled) throw new Error("Normalized content backend is unavailable");
            const pulled = await window.CornerContentRepository.pull("outbox-merge");
            const value = mergeOrThrow(operation, pulled.values?.[operation.key]);
            await window.CornerContentRepository.write(operation.key, value, { fromOutbox: true });
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
    mergeOfflineValue,
    get state() {
      return lastState;
    }
  };
})();
