(function () {
  const presenceByRole = { frog: false, princess: false };
  let channel = null;
  let client = null;
  let identity = null;
  let siteId = "";
  let status = "idle";
  let initPromise = null;

  function validRole(role) {
    return role === "frog" || role === "princess";
  }

  function dispatchPresence() {
    const detail = { ...presenceByRole, status };
    document.dispatchEvent(new CustomEvent("corner:presence", { detail }));
    document.dispatchEvent(new CustomEvent("corner:game-presence", { detail }));
  }

  function syncPresence() {
    if (!channel) return;
    const state = channel.presenceState();
    presenceByRole.frog = false;
    presenceByRole.princess = false;
    Object.values(state || {}).flat().forEach((entry) => {
      if (validRole(entry?.role)) presenceByRole[entry.role] = true;
    });
    dispatchPresence();
  }

  async function track(extra = {}) {
    if (!channel || status !== "connected" || !validRole(identity?.role)) return false;
    const result = await channel.track({
      role: identity.role,
      userId: identity.user?.id,
      page: document.body.dataset.page || "unknown",
      visible: !document.hidden,
      onlineAt: new Date().toISOString(),
      ...extra
    });
    return result === "ok" || result?.status === "ok";
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

  async function initialize() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      identity = window.CornerIdentity?.current;
      client = window.CornerIdentity?.client || window.CornerRuntime?.supabaseClient;
      siteId = window.CORNER_CONFIG?.siteId || "princess-frog-corner";
      if (!client || identity?.mode !== "account" || !validRole(identity.role)) {
        status = "unavailable";
        dispatchPresence();
        return false;
      }
      if (typeof client.channel !== "function" || typeof client.realtime?.setAuth !== "function") {
        status = "unavailable";
        dispatchPresence();
        return false;
      }

      status = "connecting";
      dispatchPresence();
      try {
        await client.realtime.setAuth();
      } catch (error) {
        console.warn("Realtime authentication could not be refreshed.", error);
      }

      const topic = `corner:${siteId}`;
      channel = client.channel(topic, {
        config: {
          private: true,
          broadcast: { self: true, ack: true },
          presence: { key: identity.user.id }
        }
      });
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

      ["reaction", "game-invite", "game-event", "typing", "nudge"].forEach((event) => {
        channel.on("broadcast", { event }, (payload) => handleBroadcast(event, payload));
      });

      return await new Promise((resolve) => {
        const timeout = window.setTimeout(() => {
          if (status === "connecting") {
            status = "unavailable";
            dispatchPresence();
            resolve(false);
          }
        }, 8000);
        channel.subscribe(async (nextStatus, error) => {
          if (nextStatus === "SUBSCRIBED") {
            clearTimeout(timeout);
            status = "connected";
            await track();
            syncPresence();
            resolve(true);
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(nextStatus)) {
            status = "unavailable";
            console.warn("Private Realtime channel is unavailable.", error || nextStatus);
            dispatchPresence();
          }
        });
      });
    })();
    return initPromise;
  }

  async function send(event, payload = {}) {
    if (!channel || status !== "connected") {
      const connected = await initialize();
      if (!connected || !channel) return false;
    }
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
  }

  function isOnline(role) {
    return Boolean(validRole(role) && presenceByRole[role]);
  }

  function connectionStatus() {
    return status;
  }

  document.addEventListener("corner:ready", initialize, { once: true });
  if (window.CORNER_READY) initialize();
  document.addEventListener("visibilitychange", () => {
    if (status === "connected") track();
  });
  window.addEventListener("focus", () => {
    if (status === "connected") track();
  });
  window.addEventListener("online", () => {
    if (status === "connected") track();
  });
  window.addEventListener("pagehide", () => channel?.untrack());

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
