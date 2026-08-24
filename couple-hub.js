(function () {
  const page = document.body.dataset.page || "home";
  const config = window.CORNER_CONFIG || {};
  const SITE_ID = config.siteId || "princess-frog-corner";
  const DEFAULT_PREFS = {
    enabled: {
      love: true,
      memory: true,
      letter: true,
      message: true,
      game: true,
      ritual: true,
      date: true,
      movie: true,
      nudge: true
    },
    quietStart: "22:30",
    quietEnd: "08:00",
    preview: true
  };
  let initialized = false;
  let dashboardTimer = null;
  let gameTimerInterval = null;
  let lastCelebrationId = null;

  const guides = {
    letters: {
      title: "Open When Letters",
      summary: "A private shelf of notes for the moments when one of you needs the right words.",
      steps: ["Choose an envelope that matches the moment.", "Open it to read both notes.", "Use Edit letters when you want to add, rename, write, or attach a voice note."],
      shared: "Letter text and optional recordings sync between both accounts."
    },
    memories: {
      title: "Memory Wall",
      summary: "A shared gallery for photos, dates, captions, and the stories behind them.",
      steps: ["Tap any photo for the full-screen viewer.", "Choose Edit memories to add, reorder, caption, or replace a photo.", "Video and voice controls stay tucked away until you enter edit mode."],
      shared: "Every saved memory appears on both devices."
    },
    game: {
      title: "Game Room",
      summary: "Meet here at the same time for invitations, live turns, reactions, rematches, and scores.",
      steps: ["Check that Frog and Princess both show as present.", "Send an invite or choose the same game tab.", "Follow the round status, lock private choices, then use Rematch when the result appears."],
      shared: "Secrets stay private; guesses, turns, reactions, and results update live."
    },
    movies: {
      title: "Movie Shelf",
      summary: "Your shared watchlist, collection rankings, ratings, and movie-night decision maker.",
      steps: ["Add films individually or work through the starter collections.", "Tick Watched after movie night and add a rating.", "Use Pick tonight's movie when neither of you wants to choose."],
      shared: "Ticks, ratings, rankings, and notes sync instantly."
    },
    messages: {
      title: "Our Chat",
      summary: "A calm private message space that belongs to this corner.",
      steps: ["Write your message and send it as your signed-in account.", "Your partner receives it here and through enabled notifications.", "Clear individual messages only when you both no longer need them."],
      shared: "Messages are visible only to your two linked accounts."
    },
    badges: {
      title: "Achievement Badges",
      summary: "A trophy shelf for milestones, date ideas, and little things completed together.",
      steps: ["Tap a badge when you complete it together.", "Use Edit badges to rename, reorder, add, or remove ideas.", "The progress bar shows how much of your shared list you have unlocked."],
      shared: "Unlocks and edits update for both of you."
    },
    gifts: {
      title: "Gifts Corner",
      summary: "Keep the thoughtful details behind gifts and surprises in one place.",
      steps: ["Open a gift to see its date, photo, and note.", "Use edit mode to add or change gift details.", "Write enough context that the memory still makes sense years later."],
      shared: "Gift entries are part of your private shared archive."
    },
    quotes: {
      title: "Things We Said",
      summary: "The funny, soft, strange, and unforgettable lines worth keeping.",
      steps: ["Add the exact words you want to remember.", "Include who said it or the moment if helpful.", "Edit or remove a line whenever the story needs correcting."],
      shared: "New lines appear for both Frog and Princess."
    },
    love: {
      title: "Love Notes",
      summary: "Short reminders of love that either of you can pull at random.",
      steps: ["Press Random love note whenever you need one.", "Add your own short note below.", "Use edit mode to correct or remove an old note."],
      shared: "Every note joins the same private shared jar."
    }
  };

  const ritualQuestions = [
    "What made you feel most cared for today?",
    "What is one thing you want us to make time for this week?",
    "What little moment made you smile today?",
    "What do you need more of from me right now?",
    "What memory of us has been on your mind lately?",
    "What is something you are proud of today?",
    "Where should our next spontaneous date take us?",
    "What is one thing I do that makes you feel chosen?",
    "What has felt heavy today, and how can I support you?",
    "What are you looking forward to doing together?",
    "Which part of our story would you happily relive?",
    "What is one tiny thing we should celebrate today?",
    "What song feels like us this week?",
    "What would make tomorrow softer for you?",
    "What have you learned about us recently?",
    "What is one compliment you have not said out loud yet?",
    "What does your ideal quiet evening together look like?",
    "What adventure should we put on our list next?",
    "When did you feel closest to me this week?",
    "What is one promise we should keep protecting?"
  ];

  const movieSeeds = [
    ["nolan-odyssey", "The Odyssey", "Christopher Nolan Watchlist"],
    ["nolan-interstellar", "Interstellar", "Christopher Nolan Watchlist"],
    ["nolan-prestige", "The Prestige", "Christopher Nolan Watchlist"],
    ["nolan-inception", "Inception", "Christopher Nolan Watchlist"],
    ["nolan-batman-begins", "Batman Begins", "Christopher Nolan Watchlist"],
    ["nolan-dark-knight", "The Dark Knight", "Christopher Nolan Watchlist"],
    ["nolan-dark-knight-rises", "The Dark Knight Rises", "Christopher Nolan Watchlist"],
    ["nolan-oppenheimer", "Oppenheimer", "Christopher Nolan Watchlist"],
    ["nolan-tenet", "Tenet", "Christopher Nolan Watchlist"],
    ["nolan-dunkirk", "Dunkirk", "Christopher Nolan Watchlist"],
    ["nolan-memento", "Memento", "Christopher Nolan Watchlist"],
    ["hunger-catching-fire", "Catching Fire", "The Hunger Games Ranking", 1],
    ["hunger-games", "The Hunger Games", "The Hunger Games Ranking", 2],
    ["hunger-ballad", "The Ballad of Songbirds & Snakes", "The Hunger Games Ranking", 3],
    ["hunger-mockingjay-2", "Mockingjay - Part 2", "The Hunger Games Ranking", 4],
    ["hunger-mockingjay-1", "Mockingjay - Part 1", "The Hunger Games Ranking", 5],
    ["gentlemen-prefer-blondes", "Gentlemen Prefer Blondes", "Classic Night"],
    ["mcu-journey", "The MCU: Iron Man to Spider-Man BND", "Movie Journeys"]
  ].map(([id, title, collection, rank]) => ({
    id,
    title,
    collection,
    rank: rank || null,
    pickedBy: "together",
    watched: false,
    rating: 0,
    note: "",
    watchedAt: ""
  }));

  function runtime() {
    return window.CornerRuntime;
  }

  function shared() {
    return runtime()?.shared;
  }

  function identity() {
    return window.CornerIdentity?.current || { mode: "preview", role: "frog", user: null };
  }

  function role() {
    return identity().role || sessionStorage.getItem("pf_game_player") || "frog";
  }

  function otherRole(value = role()) {
    return value === "frog" ? "princess" : "frog";
  }

  function roleName(value) {
    return value === "frog" ? "Frog" : value === "princess" ? "Princess" : "Partner";
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function todayKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatDate(value, options = { month: "short", day: "numeric" }) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, options).format(date) : "Date to decide";
  }

  function relativeTime(value) {
    const time = Date.parse(value || "");
    if (!Number.isFinite(time)) return "Recently";
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return formatDate(time);
  }

  function mergeSeeds(saved, seeds) {
    const items = Array.isArray(saved) ? saved.map((item) => ({ ...item })) : [];
    const ids = new Set(items.map((item) => item.id));
    seeds.forEach((seed) => {
      if (!ids.has(seed.id)) items.push({ ...seed });
    });
    return items;
  }

  function initPageGuide() {
    const guide = guides[page];
    if (!guide || document.querySelector(".section-guide")) return;
    const anchor = document.querySelector("main .page-title");
    if (!anchor) return;
    const section = document.createElement("details");
    section.className = "section-guide";
    section.innerHTML = `
      <summary><span class="guide-mark" aria-hidden="true">i</span><span><strong>How ${escapeHtml(guide.title)} works</strong><small>${escapeHtml(guide.summary)}</small></span><span class="guide-open-label">Open guide</span></summary>
      <div class="section-guide-body">
        <ol>${guide.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
        <p><strong>Shared:</strong> ${escapeHtml(guide.shared)}</p>
      </div>`;
    anchor.insertAdjacentElement("afterend", section);
  }

  function ritualAnswerKey(day, player) {
    return `pf_ritual_${day}_${player}`;
  }

  function ritualQuestion(day) {
    const number = Number(day.replaceAll("-", ""));
    return ritualQuestions[number % ritualQuestions.length];
  }

  function ritualStreak(days) {
    const completed = new Set(Array.isArray(days) ? days : []);
    let cursor = new Date();
    if (!completed.has(todayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let count = 0;
    while (completed.has(todayKey(cursor))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return count;
  }

  function initDailyRitual() {
    const form = document.getElementById("ritualForm");
    if (!form) return null;
    const day = todayKey();
    const me = role();
    const partner = otherRole(me);
    const completedKey = "pf_ritual_completed_days";
    let completionSaved = false;

    document.getElementById("ritualDate").textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
    document.getElementById("ritualQuestion").textContent = ritualQuestion(day);

    async function render() {
      const mine = shared().get(ritualAnswerKey(day, me), null);
      const theirs = shared().get(ritualAnswerKey(day, partner), null);
      const completed = shared().get(completedKey, []);
      const streak = ritualStreak(completed);
      document.getElementById("ritualStreak").textContent = `${streak} ${streak === 1 ? "day" : "days"}`;
      const reveal = document.getElementById("ritualReveal");
      const submit = form.querySelector("button[type='submit']");

      if (mine) {
        form.elements.mood.value = mine.mood || "";
        document.getElementById("ritualAnswer").value = mine.answer || "";
        document.getElementById("ritualGratitude").value = mine.gratitude || "";
        submit.textContent = "Update my check-in";
      }

      if (mine && theirs) {
        reveal.className = "ritual-reveal is-revealed";
        reveal.innerHTML = `
          <div class="ritual-reveal-heading"><span>Both answers are in</span><strong>Today&rsquo;s reveal</strong></div>
          <article><span>${roleName(me)} felt ${escapeHtml(mine.mood)}</span><p>${escapeHtml(mine.answer)}</p><small>Grateful for: ${escapeHtml(mine.gratitude)}</small></article>
          <article><span>${roleName(partner)} felt ${escapeHtml(theirs.mood)}</span><p>${escapeHtml(theirs.answer)}</p><small>Grateful for: ${escapeHtml(theirs.gratitude)}</small></article>`;
        if (!completionSaved && !completed.includes(day)) {
          completionSaved = true;
          await shared().set(completedKey, [...completed, day].slice(-400));
        }
      } else {
        reveal.className = "ritual-reveal is-waiting";
        reveal.innerHTML = mine
          ? `<div><span>Your check-in is sealed</span><strong>Waiting for ${roleName(partner)}</strong><p>The reveal opens automatically after both answers arrive.</p></div>`
          : `<div><span>Private until both submit</span><strong>Your answer goes here first</strong><p>${roleName(partner)} will never see it early.</p></div>`;
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const mood = new FormData(form).get("mood");
      const answer = document.getElementById("ritualAnswer").value.trim();
      const gratitude = document.getElementById("ritualGratitude").value.trim();
      if (!mood || !answer || !gratitude) return;
      await shared().set(ritualAnswerKey(day, me), { mood, answer, gratitude, submittedAt: new Date().toISOString() });
      document.getElementById("ritualFormStatus").textContent = "Your check-in is safely sealed.";
      runtime().toast("Today's ritual is saved");
      await render();
      renderDashboard();
    });

    render();
    return { render };
  }

  function initDatePlanner() {
    const form = document.getElementById("dateIdeaForm");
    if (!form) return null;
    const list = document.getElementById("dateIdeaList");
    const ideasKey = "pf_date_ideas";
    const selectedKey = "pf_date_selected";
    let ideas = [];

    function availabilityKey(player) {
      return `pf_date_availability_${player}`;
    }

    function renderAvailability() {
      const mine = shared().get(availabilityKey(role()), "");
      const theirs = shared().get(availabilityKey(otherRole()), "");
      document.getElementById("dateAvailability").value = mine || "";
      const summary = document.getElementById("availabilitySummary");
      summary.innerHTML = `<span>${roleName(role())}</span><strong>${mine ? formatDate(mine, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not added"}</strong><span>${roleName(otherRole())}</span><strong>${theirs ? formatDate(theirs, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Not added"}</strong>`;
    }

    function renderSelected() {
      const selected = shared().get(selectedKey, null);
      const item = selected && ideas.find((idea) => idea.id === selected.id);
      const banner = document.getElementById("selectedDateIdea");
      if (!item) {
        banner.innerHTML = "<span>No date chosen yet</span><strong>Vote on ideas or let the picker surprise you.</strong>";
        return;
      }
      banner.innerHTML = `<span>Chosen for your next date</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.location || "Location to decide")} &middot; ${escapeHtml(item.budget || "Budget to decide")}${item.when ? ` &middot; ${escapeHtml(formatDate(item.when, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}` : ""}</small>`;
    }

    function renderIdeas() {
      ideas = Array.isArray(shared().get(ideasKey, [])) ? shared().get(ideasKey, []).map((item) => ({ ...item, votes: { ...(item.votes || {}) } })) : [];
      if (!ideas.length) {
        list.innerHTML = '<div class="planner-empty"><span>Your shortlist is open</span><strong>Add the first date idea.</strong><p>Both of you can vote before the picker chooses.</p></div>';
        renderSelected();
        renderAvailability();
        return;
      }
      list.innerHTML = ideas.map((item) => {
        const votes = Object.values(item.votes || {}).filter(Boolean).length;
        const voted = Boolean(item.votes?.[role()]);
        return `<article class="date-idea ${item.status === "done" ? "is-done" : ""}" data-date-id="${escapeHtml(item.id)}">
          <div class="date-idea-top"><span>${escapeHtml(item.budget || "Flexible")}</span><time>${item.when ? escapeHtml(formatDate(item.when, { month: "short", day: "numeric" })) : "Anytime"}</time></div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.notes || "A little date waiting to happen.")}</p>
          <small>${escapeHtml(item.location || "Location to decide")} &middot; Added by ${roleName(item.createdBy)}</small>
          <div class="date-idea-actions">
            <button class="text-action vote-date ${voted ? "is-voted" : ""}" type="button">${voted ? "Voted" : "Vote"} <span>${votes}/2</span></button>
            <button class="text-action complete-date" type="button">${item.status === "done" ? "Completed" : "Mark complete"}</button>
            <button class="icon-btn delete-date" type="button" aria-label="Delete date idea" title="Delete date idea">&times;</button>
          </div>
        </article>`;
      }).join("");

      list.querySelectorAll(".vote-date").forEach((button) => button.addEventListener("click", async () => {
        const item = ideas.find((idea) => idea.id === button.closest(".date-idea").dataset.dateId);
        item.votes[role()] = !item.votes[role()];
        await shared().set(ideasKey, ideas);
        renderIdeas();
      }));
      list.querySelectorAll(".complete-date").forEach((button) => button.addEventListener("click", async () => {
        const item = ideas.find((idea) => idea.id === button.closest(".date-idea").dataset.dateId);
        item.status = item.status === "done" ? "idea" : "done";
        item.completedAt = item.status === "done" ? new Date().toISOString() : "";
        await shared().set(ideasKey, ideas);
        renderIdeas();
      }));
      list.querySelectorAll(".delete-date").forEach((button) => button.addEventListener("click", async () => {
        const item = ideas.find((idea) => idea.id === button.closest(".date-idea").dataset.dateId);
        if (!window.confirm(`Delete "${item.title}"?`)) return;
        ideas = ideas.filter((idea) => idea.id !== item.id);
        await shared().set(ideasKey, ideas);
        renderIdeas();
      }));
      renderSelected();
      renderAvailability();
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = document.getElementById("dateIdeaTitle").value.trim();
      if (!title) return;
      ideas.unshift({
        id: makeId("date"),
        title,
        when: document.getElementById("dateIdeaWhen").value,
        budget: document.getElementById("dateIdeaBudget").value,
        location: document.getElementById("dateIdeaLocation").value.trim(),
        notes: document.getElementById("dateIdeaNotes").value.trim(),
        createdBy: role(),
        createdAt: new Date().toISOString(),
        votes: { [role()]: true },
        status: "idea"
      });
      await shared().set(ideasKey, ideas);
      form.reset();
      document.getElementById("dateIdeaBudget").value = "Medium";
      runtime().toast("Date idea added");
      renderIdeas();
      renderDashboard();
    });

    document.getElementById("saveAvailability").addEventListener("click", async () => {
      const value = document.getElementById("dateAvailability").value;
      await shared().set(availabilityKey(role()), value);
      runtime().toast("Availability shared");
      renderAvailability();
    });

    document.getElementById("chooseDateIdea").addEventListener("click", async () => {
      ideas = Array.isArray(shared().get(ideasKey, [])) ? shared().get(ideasKey, []) : [];
      const active = ideas.filter((item) => item.status !== "done");
      const agreed = active.filter((item) => item.votes?.frog && item.votes?.princess);
      const pool = agreed.length ? agreed : active;
      if (!pool.length) {
        runtime().toast("Add a date idea first");
        return;
      }
      const item = pool[Math.floor(Math.random() * pool.length)];
      await shared().set(selectedKey, { id: item.id, selectedAt: new Date().toISOString(), selectedBy: role() });
      renderSelected();
      renderDashboard();
      runtime().toast("Tonight's date is chosen");
    });

    renderIdeas();
    return { render: renderIdeas };
  }

  function initMovieShelf() {
    const root = document.getElementById("movieCollections");
    if (!root) return null;
    const key = "pf_movie_items";
    const seedMarker = "pf_movie_seeds_added_v1";
    const form = document.getElementById("movieForm");
    const editToggle = document.getElementById("movieEditToggle");
    let filter = "all";
    let editing = false;
    const savedMovies = shared().get(key, null);
    const shouldSeed = !shared().get(seedMarker, false);
    let items = Array.isArray(savedMovies)
      ? (shouldSeed ? mergeSeeds(savedMovies, movieSeeds) : savedMovies.map((item) => ({ ...item })))
      : movieSeeds.map((item) => ({ ...item }));
    if (!Array.isArray(savedMovies) || shouldSeed) {
      shared().set(key, items);
      shared().set(seedMarker, true);
    }

    function setEditing(next) {
      editing = next;
      document.body.classList.toggle("is-editing-movies", editing);
      form.hidden = !editing;
      editToggle.setAttribute("aria-pressed", String(editing));
      editToggle.innerHTML = editing ? '<span aria-hidden="true">&times;</span> Finish managing' : '<span aria-hidden="true">+</span> Manage shelf';
    }

    function updateItem(id, updates) {
      const item = items.find((entry) => entry.id === id);
      Object.assign(item, updates);
      return shared().set(key, items);
    }

    function render() {
      const stored = shared().get(key, items);
      items = Array.isArray(stored) ? stored.map((item) => ({ ...item })) : items;
      const watched = items.filter((item) => item.watched);
      const ratings = watched.map((item) => Number(item.rating || 0)).filter(Boolean);
      document.getElementById("movieTotal").textContent = String(items.length);
      document.getElementById("movieWatched").textContent = String(watched.length);
      document.getElementById("movieAverage").textContent = ratings.length ? (ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1) : "-";

      const visible = items.filter((item) => filter === "all" || (filter === "watched" ? item.watched : !item.watched));
      const groups = visible.reduce((result, item) => {
        const collection = item.collection || "Our Watchlist";
        (result[collection] ||= []).push(item);
        return result;
      }, {});
      root.innerHTML = Object.entries(groups).map(([collection, collectionItems]) => `
        <section class="movie-collection" aria-labelledby="collection-${escapeHtml(collection).replace(/[^a-z0-9]/gi, "-")}">
          <header><div><p class="eyebrow">Collection</p><h2 id="collection-${escapeHtml(collection).replace(/[^a-z0-9]/gi, "-")}">${escapeHtml(collection)}</h2></div><span>${collectionItems.filter((item) => item.watched).length} / ${collectionItems.length} watched</span></header>
          <div class="movie-list">${collectionItems.sort((a, b) => (a.rank || 999) - (b.rank || 999)).map((item) => `
            <article class="movie-row ${item.watched ? "is-watched" : ""}" data-movie-id="${escapeHtml(item.id)}">
              <label class="movie-check"><input type="checkbox" ${item.watched ? "checked" : ""}><span aria-hidden="true"></span><span class="sr-only">Mark ${escapeHtml(item.title)} watched</span></label>
              <div class="movie-copy">
                <div class="movie-title-line">${item.rank ? `<span class="movie-rank">${escapeHtml(item.rank)}</span>` : ""}<strong>${escapeHtml(item.title)}</strong><input class="movie-title-input" type="text" maxlength="120" value="${escapeHtml(item.title)}" aria-label="Movie title"></div>
                <small>Picked by ${item.pickedBy === "together" ? "both of you" : roleName(item.pickedBy)}${item.watchedAt ? ` &middot; Watched ${escapeHtml(formatDate(item.watchedAt))}` : ""}</small>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </div>
              <label class="movie-rating">Rating<select aria-label="Rating for ${escapeHtml(item.title)}"><option value="0">Not rated</option>${[1, 2, 3, 4, 5].map((value) => `<option value="${value}" ${Number(item.rating) === value ? "selected" : ""}>${value} / 5</option>`).join("")}</select></label>
              <div class="movie-edit-fields">
                <input class="movie-collection-input" type="text" maxlength="80" value="${escapeHtml(item.collection || "")}" aria-label="Collection">
                <input class="movie-rank-input" type="number" min="1" max="99" value="${item.rank || ""}" aria-label="Collection rank" placeholder="Rank">
                <input class="movie-note-input" type="text" maxlength="180" value="${escapeHtml(item.note || "")}" aria-label="Movie note" placeholder="Note">
                <button class="icon-btn delete-movie" type="button" aria-label="Delete movie" title="Delete movie">&times;</button>
              </div>
            </article>`).join("")}</div>
        </section>`).join("") || '<div class="planner-empty"><strong>No films in this view.</strong><p>Change the filter or add another movie.</p></div>';

      root.querySelectorAll(".movie-row").forEach((row) => {
        const id = row.dataset.movieId;
        row.querySelector(".movie-check input").addEventListener("change", async (event) => {
          await updateItem(id, { watched: event.target.checked, watchedAt: event.target.checked ? new Date().toISOString() : "" });
          render();
        });
        row.querySelector(".movie-rating select").addEventListener("change", async (event) => {
          await updateItem(id, { rating: Number(event.target.value) });
          render();
        });
        const saveEdit = async () => {
          await updateItem(id, {
            title: row.querySelector(".movie-title-input").value.trim(),
            collection: row.querySelector(".movie-collection-input").value.trim() || "Our Watchlist",
            rank: Number(row.querySelector(".movie-rank-input").value) || null,
            note: row.querySelector(".movie-note-input").value.trim()
          });
        };
        row.querySelectorAll(".movie-title-input, .movie-collection-input, .movie-rank-input, .movie-note-input").forEach((input) => input.addEventListener("change", saveEdit));
        row.querySelector(".delete-movie").addEventListener("click", async () => {
          const item = items.find((entry) => entry.id === id);
          if (!window.confirm(`Delete "${item.title}" from the shelf?`)) return;
          items = items.filter((entry) => entry.id !== id);
          await shared().set(key, items);
          render();
        });
      });
      setEditing(editing);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = document.getElementById("movieTitle").value.trim();
      if (!title) return;
      items.unshift({
        id: makeId("movie"),
        title,
        collection: document.getElementById("movieCollection").value.trim() || "Our Watchlist",
        pickedBy: document.getElementById("moviePickedBy").value,
        note: document.getElementById("movieNote").value.trim(),
        rank: null,
        watched: false,
        rating: 0,
        watchedAt: ""
      });
      await shared().set(key, items);
      form.reset();
      runtime().toast("Movie added to the shelf");
      render();
    });
    editToggle.addEventListener("click", () => setEditing(!editing));
    document.querySelectorAll("[data-movie-filter]").forEach((button) => button.addEventListener("click", () => {
      filter = button.dataset.movieFilter;
      document.querySelectorAll("[data-movie-filter]").forEach((item) => item.classList.toggle("active", item === button));
      render();
    }));
    document.getElementById("pickMovie").addEventListener("click", () => {
      const waiting = items.filter((item) => !item.watched);
      const pool = waiting.length ? waiting : items;
      const item = pool[Math.floor(Math.random() * pool.length)];
      const output = document.getElementById("moviePick");
      output.innerHTML = item ? `<span>Tonight&rsquo;s pick</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.collection || "Our Watchlist")}</small>` : "<span>Add a movie first</span>";
    });
    render();
    return { render };
  }

  async function renderDashboard() {
    const root = document.getElementById("personalDashboard");
    if (!root || !shared()) return;
    const me = role();
    const partner = otherRole(me);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    document.getElementById("dashboardEyebrow").textContent = me === "princess" ? "Her Royal Highness is home" : "The keeper of our corner is home";
    document.getElementById("dashboardTitle").textContent = `${greeting}, ${roleName(me)}.`;
    const welcome = shared().get(`pf_welcome_message_${me}`, null);
    document.getElementById("dashboardGreeting").textContent = welcome?.text || (me === "princess" ? "Your soft, pink corner is ready with everything Frog has left for you." : "Your green-and-blue command corner is ready for the next chapter.");

    const seenAt = Date.parse(shared().get(`pf_presence_${partner}`, "") || "");
    const online = Number.isFinite(seenAt) && Date.now() - seenAt < 70000;
    document.getElementById("dashboardPartner").textContent = online ? `${roleName(partner)} is here now` : `${roleName(partner)} is away`;
    document.getElementById("dashboardPartnerDetail").textContent = online ? "You are sharing this moment live." : "Anything you leave will be waiting for them.";

    const day = todayKey();
    const mine = shared().get(ritualAnswerKey(day, me), null);
    const theirs = shared().get(ritualAnswerKey(day, partner), null);
    document.getElementById("dashboardRitual").textContent = mine && theirs ? "Revealed" : mine ? "Waiting" : "Not started";
    document.getElementById("dashboardRitualDetail").textContent = mine && theirs ? "Both answers are ready" : mine ? `Waiting for ${roleName(partner)}` : "Answer today's question";

    const ideas = shared().get("pf_date_ideas", []);
    const selected = shared().get("pf_date_selected", null);
    const chosen = Array.isArray(ideas) && selected ? ideas.find((item) => item.id === selected.id) : null;
    document.getElementById("dashboardDate").textContent = chosen?.title || "Not chosen";
    document.getElementById("dashboardDateDetail").textContent = chosen?.when ? formatDate(chosen.when, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : chosen?.location || "Build your shortlist below";

    const client = window.CornerIdentity?.client;
    if (!client || !window.CornerIdentity?.isAccount()) return;
    const { data } = await client.from("corner_notifications")
      .select("id,actor_role,recipient_role,title,body,created_at,read_by")
      .eq("site_id", SITE_ID)
      .order("created_at", { ascending: false })
      .limit(8);
    const visible = (data || []).filter((item) => !item.recipient_role || item.recipient_role === me);
    const unread = visible.filter((item) => !item.read_by?.includes(identity().user.id));
    document.getElementById("dashboardUnread").textContent = String(unread.length);
    const activity = document.getElementById("dashboardActivity");
    activity.innerHTML = visible.length ? visible.slice(0, 3).map((item) => `<article><span>${roleName(item.actor_role)}</span><strong>${escapeHtml(item.title)}</strong><time>${relativeTime(item.created_at)}</time></article>`).join("") : "<p>Nothing new yet.</p>";
  }

  function notificationPrefs(player = role()) {
    const saved = shared().get(`pf_notification_preferences_${player}`, null);
    return {
      ...DEFAULT_PREFS,
      ...(saved || {}),
      enabled: { ...DEFAULT_PREFS.enabled, ...(saved?.enabled || {}) }
    };
  }

  function initAccountTools() {
    const drawer = document.querySelector(".account-drawer");
    if (!drawer || drawer.querySelector(".notification-preferences")) return;
    const prefs = notificationPrefs();
    const section = document.createElement("section");
    section.className = "notification-preferences";
    section.innerHTML = `
      <div class="notification-heading"><div><p class="eyebrow">Your alerts</p><h3>Notification controls</h3></div></div>
      <div class="notification-toggle-grid">
        ${Object.entries({ love: "Love notes", memory: "Memories", letter: "Letters", message: "Messages", game: "Game invites", ritual: "Daily ritual", date: "Date plans", movie: "Movie Shelf", nudge: "Little nudges" }).map(([kind, label]) => `<label><input type="checkbox" data-notification-kind="${kind}" ${prefs.enabled[kind] ? "checked" : ""}><span>${label}</span></label>`).join("")}
      </div>
      <div class="quiet-hours">
        <label>Quiet from<input type="time" data-quiet-start value="${escapeHtml(prefs.quietStart)}"></label>
        <label>Until<input type="time" data-quiet-end value="${escapeHtml(prefs.quietEnd)}"></label>
      </div>
      <label class="preview-toggle"><input type="checkbox" data-notification-preview ${prefs.preview ? "checked" : ""}><span>Show message previews</span></label>
      <div class="button-row"><button class="btn primary" type="button" data-save-notification-prefs>Save alert settings</button><button class="btn" type="button" data-send-nudge>Send a little nudge</button></div>
      <p class="form-status" data-notification-status aria-live="polite"></p>`;
    drawer.querySelector(".account-commands")?.insertAdjacentElement("afterend", section);

    section.querySelector("[data-save-notification-prefs]").addEventListener("click", async () => {
      const enabled = {};
      section.querySelectorAll("[data-notification-kind]").forEach((input) => { enabled[input.dataset.notificationKind] = input.checked; });
      await shared().set(`pf_notification_preferences_${role()}`, {
        enabled,
        quietStart: section.querySelector("[data-quiet-start]").value,
        quietEnd: section.querySelector("[data-quiet-end]").value,
        preview: section.querySelector("[data-notification-preview]").checked,
        updatedAt: new Date().toISOString()
      });
      section.querySelector("[data-notification-status]").textContent = "Your notification choices are saved.";
      runtime().toast("Alert settings saved");
    });
    section.querySelector("[data-send-nudge]").addEventListener("click", async () => {
      await window.CornerNotifications?.create?.({ kind: "nudge", title: `${roleName(role())} is thinking of you`, body: "A little nudge from your favourite person is waiting.", url: "index.html" });
      section.querySelector("[data-notification-status]").textContent = `A gentle nudge was sent to ${roleName(otherRole())}.`;
      runtime().toast("Nudge sent");
    });

    const backup = document.createElement("section");
    backup.className = "backup-center";
    backup.innerHTML = `
      <p class="eyebrow">Safety copy</p><h3>Private backup</h3>
      <p>Download your notes, games, memories, captions, plans, movies, and shared settings as one JSON file.</p>
      <button class="btn" type="button" data-download-backup>Download backup</button>
      <small data-backup-status>Preparing an automatic browser copy...</small>`;
    section.insertAdjacentElement("afterend", backup);
    backup.querySelector("[data-download-backup]").addEventListener("click", downloadBackup);
    createAutomaticBackup(backup.querySelector("[data-backup-status]"));
  }

  async function collectBackup() {
    const client = window.CornerIdentity?.client;
    if (!client || !window.CornerIdentity?.isAccount()) throw new Error("Sign in to download your private backup.");
    const [{ data: values, error: valueError }, { data: notifications, error: notificationError }] = await Promise.all([
      client.from("corner_kv").select("key,value,updated_at").eq("site_id", SITE_ID).order("key"),
      client.from("corner_notifications").select("kind,title,body,url,actor_role,recipient_role,created_at,read_by").eq("site_id", SITE_ID).order("created_at")
    ]);
    if (valueError || notificationError) throw new Error("The shared data could not be read right now.");
    return { format: "princess-frog-backup-v1", siteId: SITE_ID, createdAt: new Date().toISOString(), createdBy: role(), values, notifications };
  }

  async function downloadBackup() {
    try {
      const backup = await collectBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `princess-frog-backup-${todayKey()}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      runtime().toast("Private backup downloaded");
    } catch (error) {
      runtime().toast(error.message);
    }
  }

  async function createAutomaticBackup(status) {
    const lastDay = localStorage.getItem("pf_auto_backup_day");
    if (lastDay === todayKey()) {
      status.textContent = "Automatic browser copy updated today.";
      return;
    }
    try {
      const backup = await collectBackup();
      localStorage.setItem("pf_auto_backup_snapshot", JSON.stringify(backup));
      localStorage.setItem("pf_auto_backup_day", todayKey());
      status.textContent = "Automatic browser copy updated today.";
    } catch {
      status.textContent = "Automatic copy will retry when shared mode reconnects.";
    }
  }

  function initGameNightConsole() {
    const lobby = document.querySelector(".game-lobby");
    if (!lobby || lobby.querySelector(".game-night-console")) return null;
    const consoleEl = document.createElement("section");
    consoleEl.className = "game-night-console";
    consoleEl.innerHTML = `
      <div class="turn-timer-panel">
        <p class="eyebrow">Live turn timer</p><strong id="gameTimerDisplay">Ready</strong><small id="gameTimerOwner">Start it when a timed round begins.</small>
        <div class="timer-actions"><button type="button" data-timer-seconds="30">30s</button><button type="button" data-timer-seconds="60">60s</button><button type="button" data-timer-seconds="90">90s</button><button type="button" data-timer-stop aria-label="Stop timer" title="Stop timer">&times;</button></div>
      </div>
      <div class="season-panel"><p class="eyebrow">Monthly tournament</p><strong id="seasonName">This month</strong><div id="seasonStandings"></div></div>
      <div class="game-achievement-panel"><p class="eyebrow">Game achievements</p><div id="gameAchievements"></div></div>
      <div class="rematch-panel"><p class="eyebrow">Keep playing</p><strong id="rematchLabel">Finish a match to unlock rematch.</strong><button class="btn primary" id="quickRematch" type="button">Play again</button></div>`;
    lobby.appendChild(consoleEl);

    consoleEl.querySelectorAll("[data-timer-seconds]").forEach((button) => button.addEventListener("click", async () => {
      const seconds = Number(button.dataset.timerSeconds);
      await shared().set("pf_game_timer", { id: makeId("timer"), seconds, deadline: Date.now() + seconds * 1000, startedBy: role(), game: localStorage.getItem("pf_active_game") || "number" });
      renderGameNightConsole();
    }));
    consoleEl.querySelector("[data-timer-stop]").addEventListener("click", async () => {
      await shared().set("pf_game_timer", null);
      renderGameNightConsole();
    });
    document.getElementById("quickRematch").addEventListener("click", () => {
      const history = shared().get("pf_game_history", []);
      const latest = Array.isArray(history) ? history[0] : null;
      if (!latest) return runtime().toast("Finish a match first");
      window.CornerGames?.selectGame?.(latest.game);
      const starters = { number: "resetGame", word: "resetWordGame", same: "nextSameQuestion", would: "nextWouldQuestion", trivia: "nextTriviaRound", truth: "drawTruthPrompt", memory: "newMemoryMatch" };
      window.setTimeout(() => document.getElementById(starters[latest.game])?.click(), 100);
    });
    gameTimerInterval = window.setInterval(renderGameNightConsole, 1000);
    renderGameNightConsole();
    return { render: renderGameNightConsole };
  }

  function renderGameNightConsole() {
    if (!document.querySelector(".game-night-console")) return;
    const timer = shared().get("pf_game_timer", null);
    const remaining = timer?.deadline ? Math.max(0, Math.ceil((Number(timer.deadline) - Date.now()) / 1000)) : 0;
    document.getElementById("gameTimerDisplay").textContent = timer ? `${remaining}s` : "Ready";
    document.getElementById("gameTimerOwner").textContent = timer ? `Started by ${roleName(timer.startedBy)} for ${timer.game || "this round"}.` : "Start it when a timed round begins.";
    document.querySelector(".turn-timer-panel")?.classList.toggle("timer-finished", Boolean(timer && remaining === 0));

    const history = Array.isArray(shared().get("pf_game_history", [])) ? shared().get("pf_game_history", []) : [];
    const now = new Date();
    const monthly = history.filter((item) => {
      const date = new Date(item.playedAt);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    });
    const frog = monthly.filter((item) => item.winner === "frog").length;
    const princess = monthly.filter((item) => item.winner === "princess").length;
    document.getElementById("seasonName").textContent = `${new Intl.DateTimeFormat(undefined, { month: "long" }).format(now)} Cup`;
    document.getElementById("seasonStandings").innerHTML = `<span>Frog <strong>${frog}</strong></span><span>Princess <strong>${princess}</strong></span><small>${monthly.length ? (frog === princess ? "The cup is level." : `${roleName(frog > princess ? "frog" : "princess")} leads.`) : "The first match opens the tournament."}</small>`;
    const uniqueGames = new Set(history.map((item) => item.game)).size;
    const achievements = [
      [history.length >= 1, "First match"],
      [history.length >= 5, "Five rounds"],
      [history.length >= 10, "Game-night regulars"],
      [uniqueGames >= 3, "Variety night"],
      [frog >= 3 || princess >= 3, "Three-win streak"]
    ];
    document.getElementById("gameAchievements").innerHTML = achievements.map(([done, label]) => `<span class="${done ? "unlocked" : ""}">${done ? "Unlocked" : "Locked"}<strong>${label}</strong></span>`).join("");
    const latest = history[0];
    document.getElementById("rematchLabel").textContent = latest ? `Replay ${latest.label || "the last game"}` : "Finish a match to unlock rematch.";
  }

  function celebrateMatch(entry) {
    if (!entry?.id || entry.id === lastCelebrationId) return;
    lastCelebrationId = entry.id;
    document.querySelectorAll(".winner-celebration").forEach((item) => item.remove());
    const overlay = document.createElement("div");
    overlay.className = "winner-celebration";
    overlay.innerHTML = `<div><span>Round complete</span><strong>${entry.winner ? `${roleName(entry.winner)} wins` : escapeHtml(entry.result || "Beautifully played")}</strong><small>${escapeHtml(entry.label || "Game night")}</small><button class="btn light" type="button">Back to the room</button></div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("button").addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) overlay.remove();
    });
    window.setTimeout(() => overlay.classList.add("show"), 30);
    window.setTimeout(() => overlay.remove(), 3200);
    renderGameNightConsole();
  }

  function refreshFeatures(event) {
    const key = event?.detail?.new?.key || event?.detail?.old?.key || "";
    if (page === "home" && (key.startsWith("pf_ritual_") || key.startsWith("pf_date_") || key.startsWith("pf_presence_") || key.startsWith("pf_welcome_"))) {
      document.dispatchEvent(new CustomEvent("corner:home-refresh"));
      renderDashboard();
    }
    if (page === "movies" && key === "pf_movie_items") document.dispatchEvent(new CustomEvent("corner:movie-refresh"));
    if (page === "game" && ["pf_game_timer", "pf_game_history"].includes(key)) renderGameNightConsole();
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    initPageGuide();
    const ritual = initDailyRitual();
    const planner = initDatePlanner();
    const movies = initMovieShelf();
    initAccountTools();
    initGameNightConsole();
    renderDashboard();
    if (page === "home") dashboardTimer = window.setInterval(renderDashboard, 20000);
    document.addEventListener("corner:remote-change", (event) => {
      refreshFeatures(event);
      ritual?.render?.();
      planner?.render?.();
      movies?.render?.();
    });
  }

  window.CornerExperience = { celebrateMatch, renderDashboard, downloadBackup, notificationPrefs };
  if (window.CORNER_READY) initialize();
  else document.addEventListener("corner:ready", initialize, { once: true });
})();
