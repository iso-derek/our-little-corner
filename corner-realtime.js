(function () {
  const presenceByRole = { frog: false, princess: false };
  const broadcastEvents = ["reaction", "game-invite", "game-event", "typing", "nudge", "content-event"];
  let channel = null;
  let client = null;
  let identity = null;
  let siteId = "";
  let status = "idle";
  let initPromise = null;
  let reconnectTimer = null;
  let reconnectAttempt = 0;
  let suspended = false;

  function validRole(role) {
    return role === "frog" || role === "princess";
  }

  function dispatchPresence() {
    const detail = { ...presenceByRole, status };
    document.dispatchEvent(new CustomEvent("corner:presence", { detail }));
    document.dispatchEvent(new CustomEvent("corner:game-presence", { detail }));
  }

  function clearPresence() {
    presenceByRole.frog = false;
    presenceByRole.princess = false;
  }

  function syncPresence() {
    if (!channel) return;
    const state = channel.presenceState();
    clearPresence();
    Object.values(state || {}).flat().forEach((entry) => {
      if (validRole(entry?.role) && entry.visible !== false && entry.online !== false) {
        presenceByRole[entry.role] = true;
      }
    });
    dispatchPresence();
  }

  async function track(extra = {}) {
    if (!channel || status !== "connected" || !validRole(identity?.role)) return false;
    try {
      const result = await channel.track({
        role: identity.role,
        userId: identity.user?.id,
        page: document.body.dataset.page || "unknown",
        visible: !document.hidden,
        online: navigator.onLine,
        onlineAt: new Date().toISOString(),
        ...extra
      });
      return result === "ok" || result?.status === "ok";
    } catch (error) {
      console.warn("Presence could not be updated.", error);
      scheduleReconnect();
      return false;
    }
  }

  function handleBroadcast(event, payload) {
    document.dispatchEvent(new CustomEvent("corner:broadcast", {
      detail: {
        event,
        payload: payload?.payload || payload || {},
        receivedAt: new Date().toISOString()
      }
    }));
  }

  async function cleanupChannel(untrack = false) {
    const staleChannel = channel;
    channel = null;
    if (!staleChannel) return;
    try {
      if (untrack && typeof staleChannel.untrack === "function") await staleChannel.untrack();
    } catch {
      // The channel may already be closed.
    }
    try {
      await client?.removeChannel?.(staleChannel);
    } catch {
      // Reconnection will create a clean channel even if removal fails.
    }
  }

  function scheduleReconnect() {
    if (suspended || !navigator.onLine || identity?.mode !== "account" || !validRole(identity?.role)) {
      status = navigator.onLine ? "unavailable" : "offline";
      clearPresence();
      dispatchPresence();
      return;
    }
    if (reconnectTimer) return;
    status = "reconnecting";
    clearPresence();
    dispatchPresence();
    const delay = Math.min(30000, 1000 * (2 ** Math.min(reconnectAttempt, 5))) + Math.floor(Math.random() * 350);
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      initialize({ force: true });
    }, delay);
  }

  async function initialize(options = {}) {
    if (status === "connected" && channel && !options.force) return true;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      identity = window.CornerIdentity?.current;
      client = window.CornerIdentity?.client || window.CornerRuntime?.supabaseClient;
      siteId = window.CORNER_CONFIG?.siteId || "princess-frog-corner";
      if (suspended) return false;
      if (!navigator.onLine) {
        status = "offline";
        clearPresence();
        dispatchPresence();
        return false;
      }
      if (!client || identity?.mode !== "account" || !validRole(identity.role)) {
        status = "unavailable";
        clearPresence();
        dispatchPresence();
        return false;
      }
      if (typeof client.channel !== "function" || typeof client.realtime?.setAuth !== "function") {
        status = "unavailable";
        clearPresence();
        dispatchPresence();
        return false;
      }

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await cleanupChannel(false);
      status = "connecting";
      dispatchPresence();
      try {
        await client.realtime.setAuth();
      } catch (error) {
        console.warn("Realtime authentication could not be refreshed.", error);
      }

      const nextChannel = client.channel(`corner:${siteId}`, {
        config: {
          private: true,
          broadcast: { self: true, ack: true },
          presence: { key: identity.user.id }
        }
      });
      channel = nextChannel;
      if (typeof channel?.track !== "function" || typeof channel?.presenceState !== "function") {
        status = "unavailable";
        channel = null;
        dispatchPresence();
        return false;
      }

      channel
        .on("presence", { event: "sync" }, syncPresence)
        .on("presence", { event: "join" }, syncPresence)
        .on("presence", { event: "leave" }, syncPresence);
      broadcastEvents.forEach((event) => {
        channel.on("broadcast", { event }, (payload) => handleBroadcast(event, payload));
      });

      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const timeout = window.setTimeout(async () => {
          if (channel !== nextChannel || status !== "connecting") return;
          console.warn("Private Realtime channel timed out and will reconnect.");
          await cleanupChannel(false);
          scheduleReconnect();
          finish(false);
        }, 9000);

        nextChannel.subscribe(async (nextStatus, error) => {
          if (channel !== nextChannel) return;
          if (nextStatus === "SUBSCRIBED") {
            clearTimeout(timeout);
            reconnectAttempt = 0;
            status = "connected";
            await track();
            syncPresence();
            finish(true);
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(nextStatus)) {
            clearTimeout(timeout);
            console.warn("Private Realtime channel disconnected.", error || nextStatus);
            await cleanupChannel(false);
            scheduleReconnect();
            finish(false);
          }
        });
      });
    })();

    try {
      return await initPromise;
    } finally {
      initPromise = null;
    }
  }

  async function send(event, payload = {}) {
    if (!broadcastEvents.includes(event)) return false;
    if (!channel || status !== "connected") {
      const connected = await initialize();
      if (!connected || !channel) return false;
    }
    try {
      const response = await channel.send({
        type: "broadcast",
        event,
        payload: {
          ...payload,
          from: payload.from || identity.role,
          sentAt: payload.sentAt || new Date().toISOString()
        }
      });
      return response === "ok" || response?.status === "ok";
    } catch (error) {
      console.warn("Realtime message could not be sent.", error);
      await cleanupChannel(false);
      scheduleReconnect();
      return false;
    }
  }

  function isOnline(role) {
    return Boolean(validRole(role) && presenceByRole[role]);
  }

  function connectionStatus() {
    return status;
  }

  document.addEventListener("corner:ready", () => initialize(), { once: true });
  if (window.CORNER_READY) initialize();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) track({ visible: false });
    else if (status === "connected") track({ visible: true });
    else initialize({ force: true });
  });
  window.addEventListener("focus", () => {
    if (status === "connected") track({ visible: true });
    else initialize({ force: true });
  });
  window.addEventListener("online", () => {
    suspended = false;
    initialize({ force: true });
  });
  window.addEventListener("offline", () => {
    status = "offline";
    clearPresence();
    dispatchPresence();
  });
  window.addEventListener("pagehide", () => {
    suspended = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    cleanupChannel(true);
  });
  window.addEventListener("pageshow", () => {
    suspended = false;
    initialize({ force: true });
  });

  window.CornerRealtime = {
    initialize,
    track,
    send,
    isOnline,
    connectionStatus,
    get presence() {
      return { ...presenceByRole };
    }
  };
})();
