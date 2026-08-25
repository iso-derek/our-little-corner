(function () {
  const GAME_TYPES = ["number", "word"];
  const PLAYER_LABELS = { frog: "Frog 🐸", princess: "Princess 👑" };
  const instances = new Map();
  const mountPromises = new Map();
  let capability = null;
  let gameChangesChannel = null;
  let refreshTimer = null;

  function identity() {
    return window.CornerIdentity?.current || { mode: "preview", role: "" };
  }

  function client() {
    return window.CornerIdentity?.client || window.CornerRuntime?.supabaseClient || null;
  }

  function siteId() {
    return window.CORNER_CONFIG?.siteId || "princess-frog-corner";
  }

  function validRole(role) {
    return role === "frog" || role === "princess";
  }

  function otherRole(role) {
    return role === "frog" ? "princess" : "frog";
  }

  function eligible() {
    return identity().mode === "account"
      && validRole(identity().role)
      && typeof client()?.rpc === "function"
      && capability !== false;
  }

  function missingBackend(error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "").toLowerCase();
    return ["PGRST202", "42883"].includes(code)
      || message.includes("game_get_state") && (message.includes("not find") || message.includes("does not exist"));
  }

  function errorMessage(error, fallback = "The secure game server could not complete that action.") {
    const message = String(error?.message || "");
    if (!message) return fallback;
    if (message.includes("not your turn")) return "It is your partner's turn.";
    if (message.includes("Both players")) return "Both players must lock their secrets first.";
    if (message.includes("wrong word length")) return "Use the selected number of letters.";
    if (message.includes("outside the selected range")) return "That number is outside this round's range.";
    if (message.includes("already over")) return "That round has finished. Start a fresh one.";
    if (message.includes("already in progress")) return "A round is already live. Request a restart together.";
    if (message.includes("already locked")) return "Your secret is already locked for this round.";
    if (message.includes("Secret locking has closed")) return "Secret locking has closed for this round.";
    return message;
  }

  async function fetchState(gameType) {
    const { data, error } = await client().rpc("game_get_state", { p_game_type: gameType });
    if (error) throw error;
    capability = true;
    return data;
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      instances.forEach((instance) => instance.refresh());
    }, 90);
  }

  function subscribeToGameChanges() {
    if (gameChangesChannel || !client()) return;
    gameChangesChannel = client()
      .channel(`game-state-v2-${siteId()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "game_sessions",
        filter: `site_id=eq.${siteId()}`
      }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_players" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_moves" }, scheduleRefresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "game_scores",
        filter: `site_id=eq.${siteId()}`
      }, scheduleRefresh)
      .subscribe();
  }

  function playerMap(state) {
    return Object.fromEntries((state?.players || []).map((player) => [player.role, player]));
  }

  function online(role, shared) {
    if (window.CornerRealtime?.connectionStatus?.() === "connected") {
      return window.CornerRealtime.isOnline(role);
    }
    const seenAt = Date.parse(shared?.get(`pf_presence_${role}`, "") || "");
    return Number.isFinite(seenAt) && Date.now() - seenAt < 90000;
  }

  function addBackendBadge(panel) {
    const heading = panel?.querySelector(".game-panel-heading");
    if (!heading || heading.querySelector(".game-backend-badge")) return;
    const badge = document.createElement("span");
    badge.className = "game-backend-badge";
    badge.innerHTML = '<i aria-hidden="true"></i> Server-verified play';
    badge.title = "Secrets and turn checks are handled privately by Supabase";
    heading.appendChild(badge);
  }

  function configFor(gameType) {
    if (gameType === "number") {
      return {
        panel: document.getElementById("numberGamePanel"),
        option: document.getElementById("gameRange"),
        secret: document.getElementById("secretNumber"),
        guess: document.getElementById("guessNumber"),
        start: document.getElementById("resetGame"),
        lock: document.getElementById("setSecret"),
        submit: document.getElementById("checkGuess"),
        resetScores: document.getElementById("resetScores"),
        result: document.getElementById("gameResult"),
        secretStatus: document.getElementById("secretStatus"),
        guessHelp: document.getElementById("guessHelp"),
        roundStatus: document.getElementById("roundStatus"),
        frogStatus: document.getElementById("hostStatus"),
        princessStatus: document.getElementById("guesserStatus"),
        attempts: document.getElementById("attemptsText"),
        history: document.getElementById("numberHistory"),
        frogScore: document.getElementById("frogScore"),
        princessScore: document.getElementById("princessScore")
      };
    }
    return {
      panel: document.getElementById("wordGamePanel"),
      option: document.getElementById("wordLength"),
      secret: document.getElementById("secretWord"),
      guess: document.getElementById("wordGuess"),
      start: document.getElementById("resetWordGame"),
      lock: document.getElementById("setSecretWord"),
      submit: document.getElementById("checkWordGuess"),
      resetScores: document.getElementById("resetWordScores"),
      result: document.getElementById("wordGameResult"),
      secretStatus: document.getElementById("wordSecretStatus"),
      guessHelp: document.getElementById("wordGuessHelp"),
      roundStatus: document.getElementById("wordRoundStatus"),
      frogStatus: document.getElementById("wordHostStatus"),
      princessStatus: document.getElementById("wordGuesserStatus"),
      attempts: document.getElementById("wordAttemptsText"),
      history: document.getElementById("wordHistory"),
      frogScore: document.getElementById("frogWordScore"),
      princessScore: document.getElementById("princessWordScore")
    };
  }

  function createInstance(gameType, tools, initialState) {
    const elements = configFor(gameType);
    const me = identity().role;
    let state = initialState;
    let busy = false;
    let loading = false;
    let failure = "";
    let recordedWinnerSession = null;

    elements.panel.dataset.backend = "v3";
    document.getElementById("gameIdentity").value = me;
    addBackendBadge(elements.panel);

    function session() {
      return state?.session || null;
    }

    function configValue() {
      const current = session()?.config || {};
      return Number(gameType === "number" ? current.range : current.length) || Number(elements.option.value);
    }

    function players() {
      return playerMap(state);
    }

    function bothReady() {
      const current = players();
      return Boolean(current.frog?.ready && current.princess?.ready);
    }

    function finished() {
      return session()?.status === "finished" || Boolean(session()?.winner);
    }

    function displayClue(move) {
      if (gameType === "word") return `${move.common_letters ?? 0} / ${configValue()} letters in common`;
      if (move.correct) return "Correct 🎉";
      if (String(move.clue).startsWith("Too low")) return "Too low - go higher ↑";
      if (String(move.clue).startsWith("Too high")) return "Too high - go lower ↓";
      return move.clue;
    }

    function renderHistory() {
      const moves = [...(state?.moves || [])].reverse();
      if (!moves.length) {
        elements.history.innerHTML = `<p class="game-secret">Every ${gameType === "word" ? "word and common-letter result" : "guess and clue"} appears here for both players.</p>`;
        return;
      }
      elements.history.innerHTML = moves.map((move) => `
        <div class="word-history-row ${gameType === "number" ? "number-history-row" : ""}">
          <span class="word-player">${PLAYER_LABELS[move.player_role]}</span>
          <strong>${tools.escapeHtml(move.guess)}</strong>
          <span class="common-result">
            <b>${tools.escapeHtml(displayClue(move))}</b>
            ${gameType === "word" ? `<span class="common-dots" aria-hidden="true">${Array.from({ length: configValue() }, (_, index) => `<i class="${index < Number(move.common_letters || 0) ? "matched" : ""}"></i>`).join("")}</span>` : ""}
          </span>
        </div>
      `).join("");
    }

    function playerStatus(role) {
      const currentSession = session();
      const currentPlayer = players()[role];
      const isHere = online(role, tools.shared);
      if (!currentSession) return isHere ? "Ready" : "Away";
      if (currentPlayer?.rematch_requested) return `Rematch requested${isHere ? "" : " · away"}`;
      if (finished()) return currentSession.winner === role ? "Won 🎉" : "Round over";
      if (bothReady()) {
        return `${currentSession.current_turn === role ? "Your move" : "Waiting"} · ${currentPlayer?.attempts || 0} guesses${isHere ? "" : " · away"}`;
      }
      if (currentPlayer?.ready) return `Secret locked${isHere ? "" : " · away"}`;
      return isHere ? "Choosing" : "Away";
    }

    function render() {
      const currentSession = session();
      const currentPlayers = players();
      const mine = currentPlayers[me];
      const partner = otherRole(me);
      const partnerPlayer = currentPlayers[partner];
      const mineRequested = Boolean(mine?.rematch_requested);
      const partnerRequested = Boolean(partnerPlayer?.rematch_requested);
      const ready = bothReady();
      const winner = currentSession?.winner || null;
      const turn = currentSession?.current_turn;
      const moves = state?.moves || [];
      const latestMove = moves[moves.length - 1] || null;
      const selectedValue = configValue();

      elements.option.value = String(selectedValue || (gameType === "number" ? 100 : 3));
      if (gameType === "number") {
        elements.secret.max = String(selectedValue);
        elements.guess.max = String(selectedValue);
      } else {
        elements.secret.maxLength = selectedValue;
        elements.guess.maxLength = selectedValue;
      }

      elements.frogStatus.textContent = playerStatus("frog");
      elements.princessStatus.textContent = playerStatus("princess");
      elements.attempts.textContent = `${currentPlayers.frog?.attempts || 0} / ${currentPlayers.princess?.attempts || 0}`;
      elements.frogScore.textContent = state?.scores?.frog || 0;
      elements.princessScore.textContent = state?.scores?.princess || 0;
      elements.roundStatus.textContent = !currentSession
        ? "Start a new duel"
        : winner
          ? `${PLAYER_LABELS[winner]} won`
          : ready
            ? `Live: ${PLAYER_LABELS[turn]}'s turn`
            : `Locking ${gameType === "number" ? "numbers" : "words"}`;

      elements.frogStatus.closest(".game-status-card")?.classList.toggle("current-turn", Boolean(ready && !winner && turn === "frog"));
      elements.princessStatus.closest(".game-status-card")?.classList.toggle("current-turn", Boolean(ready && !winner && turn === "princess"));

      elements.start.textContent = busy
        ? "Updating round..."
        : !currentSession
          ? `Start ${gameType === "number" ? "duel" : "word duel"}`
          : mineRequested
            ? "Waiting for partner"
            : partnerRequested
              ? "Accept rematch"
              : winner
                ? "Request rematch"
                : "Request restart";
      elements.start.disabled = busy || loading || mineRequested;
      elements.lock.disabled = busy || loading || !currentSession || Boolean(mine?.ready) || Boolean(winner);
      elements.submit.disabled = busy || loading || !ready || Boolean(winner) || turn !== me;
      elements.resetScores.disabled = busy || loading;
      elements.option.disabled = busy || loading || Boolean(currentSession && !winner);
      elements.secret.disabled = elements.lock.disabled;
      elements.guess.disabled = elements.submit.disabled;

      if (loading && !state) {
        elements.result.textContent = "Connecting to the secure game server...";
        elements.secretStatus.textContent = "Your secret will be stored privately by the database.";
        elements.guessHelp.textContent = "Checking the latest shared round.";
      } else if (failure) {
        elements.result.textContent = failure;
      } else if (!currentSession) {
        elements.result.textContent = "Either player can start a fresh duel.";
      } else if (mineRequested) {
        elements.result.textContent = `Rematch requested. Waiting for ${PLAYER_LABELS[partner]} to accept.`;
      } else if (partnerRequested) {
        elements.result.textContent = `${PLAYER_LABELS[partner]} wants a fresh round. Tap Accept rematch when you are ready.`;
      } else if (winner) {
        elements.result.textContent = winner === me
          ? `You guessed ${PLAYER_LABELS[partner]}'s ${gameType === "number" ? "number" : "word"} first. Request a rematch when you are ready 🎉`
          : `${PLAYER_LABELS[winner]} won this round. Request a rematch when you are ready.`;
      } else if (!ready) {
        elements.result.textContent = `Waiting for both secret ${gameType === "number" ? "numbers" : "words"} to be locked.`;
      } else if (latestMove) {
        elements.result.textContent = `${PLAYER_LABELS[latestMove.player_role]} guessed ${latestMove.guess}: ${displayClue(latestMove)}. ${turn === me ? "Your turn." : `${PLAYER_LABELS[turn]} is thinking.`}`;
      } else {
        elements.result.textContent = `${PLAYER_LABELS[turn]} takes the first turn.`;
      }

      if (!currentSession) {
        elements.secretStatus.textContent = `Start the duel, then choose a private ${gameType === "number" ? "number" : "word"}.`;
      } else if (winner) {
        elements.secretStatus.textContent = "This secret has expired. A rematch creates a completely fresh round.";
      } else if (mine?.ready) {
        elements.secretStatus.textContent = `Your ${gameType === "number" ? "number" : "word"} is locked in the private game vault.`;
      } else {
        elements.secretStatus.textContent = gameType === "number"
          ? `Choose from 1 to ${selectedValue}, then lock it.`
          : `Choose a ${selectedValue}-letter word, then lock it.`;
      }

      if (!currentSession || !ready) {
        elements.guessHelp.textContent = `Both players lock their ${gameType === "number" ? "numbers" : "words"} before guessing begins.`;
      } else if (winner) {
        elements.guessHelp.textContent = `${PLAYER_LABELS[winner]} won this round.`;
      } else if (turn === me) {
        elements.guessHelp.textContent = `Your turn: guess ${PLAYER_LABELS[partner]}'s ${gameType === "number" ? `number from 1 to ${selectedValue}` : `${selectedValue}-letter word`}.`;
      } else {
        elements.guessHelp.textContent = `Waiting for ${PLAYER_LABELS[turn]} to guess.`;
      }

      renderHistory();
    }

    async function setStateFromResponse(data, previousSessionId) {
      state = data;
      failure = "";
      render();
      const winner = state?.session?.winner;
      if (winner && state.session.id !== recordedWinnerSession) {
        recordedWinnerSession = state.session.id;
        if (previousSessionId === state.session.id || previousSessionId == null) {
          await window.CornerGames?.recordMatch?.({
            id: state.session.id,
            game: gameType,
            winner,
            result: `${players()[winner]?.attempts || 0} guesses`
          });
        }
      }
    }

    async function call(name, parameters, successMessage) {
      if (busy) return false;
      if (!navigator.onLine) {
        failure = "You are offline. Reconnect before making a game move so turns stay fair.";
        document.dispatchEvent(new CustomEvent("corner:sync-state", { detail: { state: "needs-attention", pending: 0 } }));
        render();
        return false;
      }
      busy = true;
      failure = "";
      render();
      const previousSessionId = session()?.id || null;
      try {
        const { data, error } = await client().rpc(name, parameters);
        if (error) throw error;
        await setStateFromResponse(data, previousSessionId);
        await window.CornerRealtime?.send?.("game-event", {
          game: gameType,
          action: name,
          sessionId: data?.session?.id,
          revision: data?.session?.revision
        });
        if (successMessage) tools.toast(successMessage);
        return true;
      } catch (error) {
        console.warn(`Secure ${gameType} game action failed.`, error);
        failure = errorMessage(error);
        render();
        return false;
      } finally {
        busy = false;
        render();
      }
    }

    async function refresh() {
      if (loading) return;
      loading = true;
      render();
      try {
        const nextState = await fetchState(gameType);
        await setStateFromResponse(nextState, session()?.id || null);
      } catch (error) {
        if (missingBackend(error)) {
          capability = false;
          document.dispatchEvent(new CustomEvent("corner:multiplayer-v2-missing"));
          return;
        }
        failure = navigator.onLine
          ? errorMessage(error, "The latest round could not be loaded.")
          : "You are offline. The latest completed game remains visible until you reconnect.";
      } finally {
        loading = false;
        render();
      }
    }

    elements.start.addEventListener("click", async () => {
      const currentSession = session();
      if (currentSession && !finished()) {
        const confirmed = window.confirm(`Request a restart for this ${gameType === "number" ? "number" : "word"} duel? The round changes only after your partner accepts.`);
        if (!confirmed) return;
      }
      const selected = Number(elements.option.value);
      await call(
        currentSession ? "request_game_rematch" : "start_game",
        currentSession
          ? { p_game_type: gameType }
          : { p_game_type: gameType, p_config: gameType === "number" ? { range: selected } : { length: selected } },
        currentSession ? "Rematch request updated" : "Fresh server-verified round ready"
      );
      elements.secret.value = "";
      elements.guess.value = "";
    });

    elements.lock.addEventListener("click", async () => {
      if (!session()) return;
      const value = gameType === "number"
        ? String(Number(elements.secret.value || 0))
        : String(elements.secret.value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
      if (gameType === "number" && (Number(value) < 1 || Number(value) > configValue())) {
        failure = `Choose a number from 1 to ${configValue()}.`;
        render();
        return;
      }
      if (gameType === "word" && value.length !== configValue()) {
        failure = `Choose exactly ${configValue()} letters.`;
        render();
        return;
      }
      if (await call("lock_game_secret", { p_session_id: session().id, p_secret: value }, `Your secret ${gameType === "number" ? "number" : "word"} is locked privately`)) {
        elements.secret.value = "";
      }
    });

    elements.submit.addEventListener("click", async () => {
      const value = gameType === "number"
        ? String(Number(elements.guess.value || 0))
        : String(elements.guess.value || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
      if (gameType === "number" && (Number(value) < 1 || Number(value) > configValue())) {
        failure = `Guess from 1 to ${configValue()}.`;
        render();
        return;
      }
      if (gameType === "word" && value.length !== configValue()) {
        failure = `Enter a ${configValue()}-letter guess.`;
        render();
        return;
      }
      if (await call("submit_game_guess", { p_session_id: session().id, p_guess: value })) {
        elements.guess.value = "";
      }
    });

    elements.resetScores.addEventListener("click", async () => {
      if (!window.confirm(`Reset the ${gameType === "number" ? "number" : "word"} scoreboard? Match history will stay intact.`)) return;
      await call("reset_game_scores", { p_game_type: gameType }, "Scoreboard reset");
    });

    [elements.secret, elements.guess].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (input === elements.secret && !elements.lock.disabled) elements.lock.click();
        if (input === elements.guess && !elements.submit.disabled) elements.submit.click();
      });
    });

    if (gameType === "word") {
      const clean = (input) => {
        input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, configValue());
      };
      elements.secret.addEventListener("input", () => clean(elements.secret));
      elements.guess.addEventListener("input", () => clean(elements.guess));
      elements.option.addEventListener("change", () => {
        elements.secret.maxLength = Number(elements.option.value);
        elements.guess.maxLength = Number(elements.option.value);
        clean(elements.secret);
        clean(elements.guess);
      });
    }

    document.addEventListener("corner:presence", render);
    document.addEventListener("corner:broadcast", (event) => {
      const detail = event.detail;
      if (detail?.event === "game-event" && detail.payload?.game === gameType) refresh();
    });

    render();
    return { refresh, render, backend: "v3" };
  }

  async function mount(gameType, tools) {
    if (!GAME_TYPES.includes(gameType) || !eligible()) return null;
    if (instances.has(gameType)) return instances.get(gameType);
    if (mountPromises.has(gameType)) return mountPromises.get(gameType);

    const promise = (async () => {
      let initialState;
      try {
        initialState = await fetchState(gameType);
      } catch (error) {
        if (missingBackend(error)) {
          capability = false;
          return null;
        }
        initialState = {
          backendVersion: 3,
          myRole: identity().role,
          session: null,
          players: [],
          moves: [],
          scores: { frog: 0, princess: 0 }
        };
      }
      capability = true;
      subscribeToGameChanges();
      const instance = createInstance(gameType, tools, initialState);
      instances.set(gameType, instance);
      return instance;
    })();
    mountPromises.set(gameType, promise);
    try {
      return await promise;
    } finally {
      mountPromises.delete(gameType);
    }
  }

  document.addEventListener("corner:broadcast", (event) => {
    if (event.detail?.event === "game-event") scheduleRefresh();
  });
  window.addEventListener("online", scheduleRefresh);
  window.addEventListener("pagehide", () => {
    if (gameChangesChannel && client()) client().removeChannel(gameChangesChannel);
  });

  window.CornerMultiplayerV2 = {
    eligible,
    mount,
    refreshAll: scheduleRefresh,
    get capability() {
      return capability;
    }
  };
})();
