(function () {
  if (document.body.dataset.page !== "game") return;

  const labels = {
    number: "Guess Number",
    word: "Secret Word",
    same: "Same Page",
    would: "Would You Rather",
    trivia: "Couple Trivia",
    truth: "Truth or Dare",
    memory: "Memory Match"
  };
  const controllers = {};
  let initialized = false;
  let lastReactionId = null;

  function runtime() {
    return window.CornerRuntime;
  }

  function shared() {
    return runtime().shared;
  }

  function role() {
    return window.CornerIdentity?.role?.() || document.getElementById("gameIdentity")?.value || "";
  }

  function validRole(value) {
    return value === "frog" || value === "princess";
  }

  function otherRole(value) {
    return value === "frog" ? "princess" : "frog";
  }

  function roleName(value) {
    return value === "frog" ? "Frog" : value === "princess" ? "Princess" : "Player";
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async function pull() {
    await shared().pull(true);
  }

  function selectGame(game) {
    const tab = document.querySelector(`[data-game-tab="${CSS.escape(game)}"]`);
    if (tab) tab.click();
  }

  async function recordMatch(entry) {
    const history = shared().get("pf_game_history", []);
    const items = Array.isArray(history) ? history : [];
    if (items.some((item) => item.id === entry.id)) return;
    const completedMatch = {
      id: entry.id,
      game: entry.game,
      label: entry.label || labels[entry.game] || "Game",
      winner: entry.winner || null,
      result: entry.result || "Completed",
      playedAt: entry.playedAt || new Date().toISOString()
    };
    await shared().set("pf_game_history", [completedMatch, ...items].slice(0, 60));
    renderLobby();
    window.CornerExperience?.celebrateMatch?.(completedMatch);
  }

  function renderLobby() {
    const history = shared().get("pf_game_history", []);
    const items = Array.isArray(history) ? history : [];
    const frogWins = items.filter((item) => item.winner === "frog").length;
    const princessWins = items.filter((item) => item.winner === "princess").length;
    document.getElementById("overallFrogScore").textContent = String(frogWins);
    document.getElementById("overallPrincessScore").textContent = String(princessWins);
    document.getElementById("overallGameCount").textContent = String(items.length);
    document.getElementById("matchHistoryCount").textContent = String(items.length);
    const list = document.getElementById("matchHistoryList");
    list.innerHTML = items.length ? items.slice(0, 12).map((item) => `
      <article class="match-history-row">
        <span>${escapeHtml(item.label)}</span>
        <strong>${item.winner ? `${roleName(item.winner)} won` : escapeHtml(item.result)}</strong>
        <time>${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.playedAt))}</time>
      </article>
    `).join("") : '<p class="game-secret">Finished games will be kept here.</p>';

    const invite = shared().get("pf_game_invite", null);
    const banner = document.getElementById("gameInviteBanner");
    const fresh = invite?.id && Date.now() - Date.parse(invite.createdAt) < 15 * 60 * 1000;
    if (!fresh || invite.status === "dismissed") {
      banner.hidden = true;
      banner.innerHTML = "";
    } else if (invite.to === role() && invite.status !== "accepted") {
      banner.hidden = false;
      banner.innerHTML = `<div><strong>${roleName(invite.from)} invited you to play ${escapeHtml(invite.label || labels[invite.game])}.</strong><small>Join when you are ready.</small></div><div class="button-row"><button class="btn primary accept-game-invite" type="button">Join game</button><button class="btn dismiss-game-invite" type="button">Dismiss</button></div>`;
      banner.querySelector(".accept-game-invite").addEventListener("click", async () => {
        selectGame(invite.game);
        await shared().set("pf_game_invite", { ...invite, status: "accepted", acceptedAt: new Date().toISOString() });
        renderLobby();
      });
      banner.querySelector(".dismiss-game-invite").addEventListener("click", async () => {
        await shared().set("pf_game_invite", { ...invite, status: "dismissed" });
        renderLobby();
      });
    } else if (invite.from === role() && invite.status !== "accepted") {
      banner.hidden = false;
      banner.innerHTML = `<div><strong>Invite sent to ${roleName(invite.to)}.</strong><small>${escapeHtml(invite.label || labels[invite.game])}</small></div>`;
    } else if (invite.status === "accepted") {
      banner.hidden = false;
      banner.innerHTML = `<div><strong>${roleName(invite.to)} joined ${escapeHtml(invite.label || labels[invite.game])}.</strong><small>You are both ready.</small></div>`;
    }

    const reaction = shared().get("pf_game_reaction", null);
    if (reaction?.id && reaction.id !== lastReactionId && Date.now() - Date.parse(reaction.createdAt) < 12000) {
      lastReactionId = reaction.id;
      const stage = document.getElementById("reactionStage");
      stage.textContent = `${reaction.emoji} ${roleName(reaction.from)}`;
      stage.classList.remove("reaction-pop");
      requestAnimationFrame(() => stage.classList.add("reaction-pop"));
      setTimeout(() => stage.classList.remove("reaction-pop"), 2200);
    }
  }

  function initializeLobby() {
    const identitySelect = document.getElementById("gameIdentity");
    const updateAccountName = () => {
      const me = role();
      document.getElementById("accountPlayerName").textContent = validRole(me) ? roleName(me) : "Choose a player";
    };
    updateAccountName();
    identitySelect?.addEventListener("change", () => {
      updateAccountName();
      refreshAll();
    });
    document.getElementById("sendGameInvite").addEventListener("click", async () => {
      const me = role();
      if (!validRole(me)) {
        runtime().toast("Choose Frog or Princess first");
        return;
      }
      const game = document.getElementById("inviteGame").value;
      await shared().set("pf_game_invite", {
        id: makeId("invite"),
        game,
        label: labels[game],
        from: me,
        to: otherRole(me),
        status: "sent",
        createdAt: new Date().toISOString()
      });
      renderLobby();
      runtime().toast(`Invite sent to ${roleName(otherRole(me))}`);
    });
    document.querySelectorAll("[data-game-reaction]").forEach((button) => {
      button.addEventListener("click", async () => {
        const me = role();
        if (!validRole(me)) return;
        await shared().set("pf_game_reaction", {
          id: makeId("reaction"),
          from: me,
          emoji: button.dataset.gameReaction,
          createdAt: new Date().toISOString()
        });
        renderLobby();
      });
    });
    const queryGame = new URLSearchParams(location.search).get("game");
    if (labels[queryGame]) selectGame(queryGame);
    renderLobby();
  }

  function initWouldYouRather() {
    const questions = [
      ["Plan every detail of a date", "Make it up as we go"],
      ["Relive our first date", "Skip ahead to our dream holiday"],
      ["Get one long love letter", "Get little love notes every day"],
      ["Cook a new meal together", "Order all our favourites"],
      ["Have a quiet weekend in", "Take a spontaneous trip"],
      ["Always know what I am thinking", "Always know how to cheer me up"],
      ["Dance together in the kitchen", "Sing together in the car"],
      ["Rewatch our favourite film", "Try something neither of us has seen"],
      ["Receive flowers", "Receive a surprise experience"],
      ["Take perfect photos", "Keep every funny candid"],
      ["Go somewhere warm", "Go somewhere snowy"],
      ["Stay up talking all night", "Wake up early for an adventure"],
      ["Share dessert", "Order one each"],
      ["Have a huge celebration", "Keep it private and meaningful"],
      ["Know every future plan", "Be surprised by the best moments"]
    ];
    const defaultRound = { id: null, index: -1 };
    const defaultStats = { matches: 0, rounds: 0, lastRound: null };
    let round = defaultRound;
    let stats = defaultStats;
    let answers = { frog: null, princess: null };

    function answerFor(player) {
      const answer = answers[player];
      return answer?.roundId === round.id ? answer.choice : null;
    }

    async function scoreIfReady() {
      const frog = answerFor("frog");
      const princess = answerFor("princess");
      if (!round.id || !frog || !princess || stats.lastRound === round.id) return;
      stats = {
        matches: Number(stats.matches || 0) + (frog === princess ? 1 : 0),
        rounds: Number(stats.rounds || 0) + 1,
        lastRound: round.id
      };
      await shared().set("pf_would_stats", stats);
      await recordMatch({ id: round.id, game: "would", result: frog === princess ? "Same choice" : "Different choices" });
      render();
    }

    function load() {
      round = { ...defaultRound, ...shared().get("pf_would_round", defaultRound) };
      stats = { ...defaultStats, ...shared().get("pf_would_stats", defaultStats) };
      answers = {
        frog: shared().get("pf_would_answer_frog", null),
        princess: shared().get("pf_would_answer_princess", null)
      };
    }

    function render() {
      const me = role();
      const question = questions[Number(round.index)] || null;
      const frog = answerFor("frog");
      const princess = answerFor("princess");
      const mine = answerFor(me);
      const complete = Boolean(frog && princess);
      document.getElementById("wouldRoundStatus").textContent = !question ? "Ready" : complete ? "Revealed" : "Choosing";
      document.getElementById("wouldFrogStatus").textContent = frog ? (complete ? (frog === "A" ? question[0] : question[1]) : "Locked in") : "Thinking";
      document.getElementById("wouldPrincessStatus").textContent = princess ? (complete ? (princess === "A" ? question[0] : question[1]) : "Locked in") : "Thinking";
      document.getElementById("wouldMatchScore").textContent = `${stats.matches || 0} / ${stats.rounds || 0}`;
      document.getElementById("wouldQuestion").textContent = question ? "Choose one" : "Start a question when you are ready.";
      const optionA = document.getElementById("wouldOptionA");
      const optionB = document.getElementById("wouldOptionB");
      optionA.textContent = question?.[0] || "Option A";
      optionB.textContent = question?.[1] || "Option B";
      optionA.disabled = !validRole(me) || !question || Boolean(mine);
      optionB.disabled = !validRole(me) || !question || Boolean(mine);
      optionA.classList.toggle("selected", mine === "A");
      optionB.classList.toggle("selected", mine === "B");
      const result = document.getElementById("wouldResult");
      if (!question) result.textContent = "Your choice stays private until both answers are locked.";
      else if (complete) result.textContent = frog === princess ? `Same answer: ${frog === "A" ? question[0] : question[1]}.` : `${roleName("frog")} chose ${frog === "A" ? question[0] : question[1]}; ${roleName("princess")} chose ${princess === "A" ? question[0] : question[1]}.`;
      else if (mine) result.textContent = `Locked in. Waiting for ${roleName(otherRole(me))}.`;
      else result.textContent = "Choose before the other answer is revealed.";
      scoreIfReady();
    }

    async function choose(choice) {
      const me = role();
      if (!validRole(me)) return;
      await pull();
      load();
      if (!round.id || answerFor(me)) return;
      await shared().set(`pf_would_answer_${me}`, { roundId: round.id, choice, answeredAt: new Date().toISOString() });
      load();
      render();
    }

    document.getElementById("wouldOptionA").addEventListener("click", () => choose("A"));
    document.getElementById("wouldOptionB").addEventListener("click", () => choose("B"));
    document.getElementById("nextWouldQuestion").addEventListener("click", async () => {
      let index = Math.floor(Math.random() * questions.length);
      if (index === Number(round.index)) index = (index + 1) % questions.length;
      round = { id: makeId("would"), index, startedBy: role(), startedAt: new Date().toISOString() };
      await shared().set("pf_would_round", round);
      load();
      render();
    });
    controllers.would = { refresh() { load(); render(); } };
    load();
    render();
  }

  function initTrivia() {
    const defaultRound = { id: null, asker: "frog", question: "", answer: "", hint: "", status: "ready", guess: "", correct: null };
    const defaultStats = { frog: 0, princess: 0, nextAsker: "frog", lastRound: null };
    let round = defaultRound;
    let stats = defaultStats;

    function normalize(value) {
      return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }

    function load() {
      round = { ...defaultRound, ...shared().get("pf_trivia_round", defaultRound) };
      stats = { ...defaultStats, ...shared().get("pf_trivia_stats", defaultStats) };
    }

    function render() {
      const me = role();
      const active = Boolean(round.id && round.question);
      const finished = round.status === "finished";
      const asker = active ? round.asker : stats.nextAsker;
      const guesser = otherRole(asker);
      document.getElementById("triviaRoundStatus").textContent = !active ? "Ready" : finished ? "Revealed" : "Live";
      document.getElementById("triviaAskerStatus").textContent = roleName(asker);
      document.getElementById("triviaGuesserStatus").textContent = finished ? "Answered" : roleName(guesser);
      document.getElementById("triviaScore").textContent = `${stats.frog || 0} / ${stats.princess || 0}`;
      const questionForm = document.getElementById("triviaQuestionForm");
      const guessForm = document.getElementById("triviaGuessForm");
      questionForm.hidden = active || me !== asker;
      guessForm.hidden = !active;
      document.getElementById("triviaQuestionText").textContent = active ? round.question : "Waiting for a question.";
      document.getElementById("triviaHintText").textContent = active && round.hint ? `Hint: ${round.hint}` : "";
      document.getElementById("triviaGuessInput").disabled = me !== guesser || finished;
      guessForm.querySelector("button").disabled = me !== guesser || finished;
      document.getElementById("nextTriviaRound").disabled = !finished;
      const result = document.getElementById("triviaResult");
      if (!validRole(me)) result.textContent = "Choose a player to join trivia.";
      else if (!active && me === asker) result.textContent = "Write a question only your partner should know.";
      else if (!active) result.textContent = `Waiting for ${roleName(asker)} to ask the next question.`;
      else if (!finished && me === asker) result.textContent = `${roleName(guesser)} is answering. Your correct answer stays hidden.`;
      else if (!finished) result.textContent = "Take your best guess.";
      else result.textContent = round.correct ? `Correct. The answer was ${round.answer}.` : `Not this time. ${roleName(round.asker)}'s answer was ${round.answer}.`;
    }

    document.getElementById("triviaQuestionForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await pull();
      load();
      const me = role();
      if (me !== stats.nextAsker || (round.id && round.status !== "finished")) return;
      const question = document.getElementById("triviaQuestionInput").value.trim();
      const answer = document.getElementById("triviaAnswerInput").value.trim();
      const hint = document.getElementById("triviaHintInput").value.trim();
      if (!question || !answer) return;
      round = { id: makeId("trivia"), asker: me, question, answer, hint, status: "live", guess: "", correct: null, createdAt: new Date().toISOString() };
      await shared().set("pf_trivia_round", round);
      form.reset();
      render();
    });
    document.getElementById("triviaGuessForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await pull();
      load();
      const me = role();
      if (!round.id || me !== otherRole(round.asker) || round.status === "finished") return;
      const guess = document.getElementById("triviaGuessInput").value.trim();
      if (!guess) return;
      const correct = normalize(guess) === normalize(round.answer);
      round = { ...round, guess, correct, status: "finished", guessedAt: new Date().toISOString() };
      await shared().set("pf_trivia_round", round);
      if (correct && stats.lastRound !== round.id) stats[me] = Number(stats[me] || 0) + 1;
      stats.lastRound = round.id;
      stats.nextAsker = otherRole(round.asker);
      await shared().set("pf_trivia_stats", stats);
      await recordMatch({ id: round.id, game: "trivia", winner: correct ? me : round.asker, result: correct ? "Correct answer" : "Answer revealed" });
      form.reset();
      render();
    });
    document.getElementById("nextTriviaRound").addEventListener("click", async () => {
      if (round.status !== "finished") return;
      round = { ...defaultRound, asker: stats.nextAsker };
      await shared().set("pf_trivia_round", round);
      render();
    });
    controllers.trivia = { refresh() { load(); render(); } };
    load();
    render();
  }

  function initTruthOrDare() {
    const prompts = {
      truth: [
        "What was the moment you first realised you really liked me?",
        "What tiny thing I do always makes you smile?",
        "Which memory of us would you relive exactly as it happened?",
        "What do you think we understand best about each other?",
        "What is one thing you want us to do this year?",
        "What is your favourite version of us?",
        "What compliment from me stayed with you?",
        "What is something you have wanted to ask me?",
        "Which ordinary moment with me feels special?",
        "What makes you feel most loved by me?"
      ],
      dare: [
        "Send the sweetest voice note you can make in 20 seconds.",
        "Recreate the face you made on our funniest date.",
        "Give your partner three very specific compliments.",
        "Choose a song and dance together for one minute.",
        "Plan a tiny surprise for your next date.",
        "Let your partner choose your phone wallpaper for a day.",
        "Act out your first impression of your partner.",
        "Give your partner a dramatic movie-style love confession.",
        "Find and share a photo of us you quietly love.",
        "Hold eye contact for 30 seconds without laughing."
      ]
    };
    const defaultState = { id: null, turn: "frog", type: null, prompt: "", status: "ready", completed: 0 };
    let state = defaultState;
    let selectedType = "truth";

    function load() {
      state = { ...defaultState, ...shared().get("pf_truth_state", defaultState) };
    }

    function render() {
      const me = role();
      document.getElementById("truthTurnStatus").textContent = roleName(state.turn);
      document.getElementById("truthModeStatus").textContent = state.type ? (state.type === "truth" ? "Truth" : "Dare") : "Choose";
      document.getElementById("truthRoundStatus").textContent = state.status === "drawn" ? "In progress" : "Ready";
      document.getElementById("truthCompletedCount").textContent = String(state.completed || 0);
      document.getElementById("truthPromptLabel").textContent = state.type ? state.type.toUpperCase() : "PICK A SIDE";
      document.getElementById("truthPrompt").textContent = state.prompt || "Your prompt will appear here.";
      document.querySelectorAll("[data-truth-type]").forEach((button) => button.classList.toggle("active", button.dataset.truthType === selectedType));
      document.getElementById("drawTruthPrompt").disabled = me !== state.turn || state.status === "drawn";
      document.getElementById("completeTruthPrompt").disabled = me !== state.turn || state.status !== "drawn";
      const result = document.getElementById("truthResult");
      if (!validRole(me)) result.textContent = "Choose a player to join.";
      else if (state.status === "drawn") result.textContent = me === state.turn ? "Complete it, then pass the turn." : `${roleName(state.turn)} is taking this one.`;
      else result.textContent = me === state.turn ? "Your turn to draw." : `Waiting for ${roleName(state.turn)}.`;
    }

    document.querySelectorAll("[data-truth-type]").forEach((button) => button.addEventListener("click", () => {
      selectedType = button.dataset.truthType;
      render();
    }));
    document.getElementById("drawTruthPrompt").addEventListener("click", async () => {
      await pull();
      load();
      if (role() !== state.turn || state.status === "drawn") return;
      const deck = prompts[selectedType];
      const prompt = deck[Math.floor(Math.random() * deck.length)];
      state = { ...state, id: makeId("truth"), type: selectedType, prompt, status: "drawn", drawnAt: new Date().toISOString() };
      await shared().set("pf_truth_state", state);
      render();
    });
    document.getElementById("completeTruthPrompt").addEventListener("click", async () => {
      await pull();
      load();
      if (role() !== state.turn || state.status !== "drawn") return;
      const completedRound = state.id;
      const completedBy = state.turn;
      state = { ...state, turn: otherRole(state.turn), status: "ready", prompt: "", type: null, completed: Number(state.completed || 0) + 1 };
      await shared().set("pf_truth_state", state);
      await recordMatch({ id: completedRound, game: "truth", result: `${roleName(completedBy)} completed a prompt` });
      render();
    });
    controllers.truth = { refresh() { load(); render(); } };
    load();
    render();
  }

  function initMemoryMatch() {
    const symbols = ["♥", "★", "☀", "♪", "◆", "✿", "☂", "☕"];
    const defaultState = { id: null, cards: [], revealed: [], matched: [], turn: "frog", scores: { frog: 0, princess: 0 }, status: "ready" };
    let state = defaultState;
    let resolving = false;

    function shuffle(values) {
      const result = [...values];
      for (let index = result.length - 1; index > 0; index -= 1) {
        const next = Math.floor(Math.random() * (index + 1));
        [result[index], result[next]] = [result[next], result[index]];
      }
      return result;
    }

    function load() {
      const saved = shared().get("pf_memory_match", defaultState);
      state = { ...defaultState, ...saved, scores: { ...defaultState.scores, ...(saved?.scores || {}) } };
    }

    function render() {
      const board = document.getElementById("memoryMatchBoard");
      document.getElementById("memoryTurnStatus").textContent = !state.id ? "Start a game" : state.status === "finished" ? "Finished" : roleName(state.turn);
      document.getElementById("memoryFrogScore").textContent = `${state.scores.frog || 0} pairs`;
      document.getElementById("memoryPrincessScore").textContent = `${state.scores.princess || 0} pairs`;
      document.getElementById("memoryPairsStatus").textContent = `${Math.floor((state.matched || []).length / 2)} / 8`;
      board.innerHTML = state.cards?.length ? state.cards.map((symbol, index) => {
        const open = state.revealed.includes(index) || state.matched.includes(index);
        return `<button class="memory-match-card ${open ? "revealed" : ""} ${state.matched.includes(index) ? "matched" : ""}" type="button" data-card-index="${index}" aria-label="${open ? `Card ${index + 1}: ${symbol}` : `Hidden card ${index + 1}`}" ${state.status === "finished" ? "disabled" : ""}><span>${open ? symbol : "PF"}</span></button>`;
      }).join("") : '<p class="game-secret">The cards will appear when a board is started.</p>';
      board.querySelectorAll("[data-card-index]").forEach((button) => button.addEventListener("click", () => revealCard(Number(button.dataset.cardIndex))));
      const result = document.getElementById("memoryMatchResult");
      if (!state.id) result.textContent = "Start a new board when you are both ready.";
      else if (state.status === "finished") {
        const frog = Number(state.scores.frog || 0);
        const princess = Number(state.scores.princess || 0);
        result.textContent = frog === princess ? "A perfect tie." : `${roleName(frog > princess ? "frog" : "princess")} found the most pairs.`;
      } else if (role() === state.turn) result.textContent = state.revealed.length === 1 ? "Choose one more card." : "Your turn. Find a pair.";
      else result.textContent = `${roleName(state.turn)} is choosing.`;
      document.getElementById("newMemoryMatch").textContent = state.id ? "Rematch" : "New board";
    }

    async function resolvePair(roundId, indices) {
      if (resolving) return;
      resolving = true;
      await new Promise((resolve) => setTimeout(resolve, 850));
      await pull();
      load();
      if (state.id !== roundId || state.revealed.length !== 2 || state.revealed.some((value, index) => value !== indices[index])) {
        resolving = false;
        render();
        return;
      }
      const [first, second] = indices;
      const matched = state.cards[first] === state.cards[second];
      if (matched) {
        state.matched = [...state.matched, first, second];
        state.scores[state.turn] = Number(state.scores[state.turn] || 0) + 1;
      } else {
        state.turn = otherRole(state.turn);
      }
      state.revealed = [];
      if (state.matched.length === state.cards.length) state.status = "finished";
      await shared().set("pf_memory_match", state);
      if (state.status === "finished") {
        const frog = Number(state.scores.frog || 0);
        const princess = Number(state.scores.princess || 0);
        await recordMatch({ id: state.id, game: "memory", winner: frog === princess ? null : (frog > princess ? "frog" : "princess"), result: frog === princess ? "Tie game" : `${frog}-${princess} pairs` });
      }
      resolving = false;
      render();
    }

    async function revealCard(index) {
      await pull();
      load();
      const me = role();
      if (!state.id || state.status !== "live" || me !== state.turn || state.revealed.length >= 2 || state.revealed.includes(index) || state.matched.includes(index)) return;
      state.revealed = [...state.revealed, index];
      await shared().set("pf_memory_match", state);
      render();
      if (state.revealed.length === 2) resolvePair(state.id, [...state.revealed]);
    }

    document.getElementById("newMemoryMatch").addEventListener("click", async () => {
      const me = role();
      if (!validRole(me)) return;
      if (state.id && state.status === "live" && !window.confirm("Start a fresh board?")) return;
      state = {
        ...defaultState,
        id: makeId("memory"),
        cards: shuffle([...symbols, ...symbols]),
        revealed: [],
        matched: [],
        turn: me,
        scores: { frog: 0, princess: 0 },
        status: "live",
        startedAt: new Date().toISOString()
      };
      await shared().set("pf_memory_match", state);
      render();
    });
    controllers.memory = { refresh() { load(); render(); } };
    load();
    render();
  }

  function refreshAll() {
    renderLobby();
    Object.values(controllers).forEach((controller) => controller.refresh());
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    initializeLobby();
    initWouldYouRather();
    initTrivia();
    initTruthOrDare();
    initMemoryMatch();
    document.addEventListener("corner:remote-change", refreshAll);
  }

  window.CornerGames = { recordMatch, selectGame, refresh: refreshAll };
  if (window.CORNER_READY) initialize();
  else document.addEventListener("corner:ready", initialize, { once: true });
})();
