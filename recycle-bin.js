(function () {
  let modal = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[character]);
  }

  function formatDeletedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Recently deleted";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    }).format(date);
  }

  function buildModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "recycle-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="recycle-backdrop" data-close-recycle></div>
      <section class="recycle-panel" role="dialog" aria-modal="true" aria-labelledby="recycleTitle">
        <header>
          <div><p class="eyebrow">A second chance</p><h2 id="recycleTitle">Recently deleted</h2></div>
          <button class="icon-btn" type="button" data-close-recycle aria-label="Close recycle bin" title="Close">&times;</button>
        </header>
        <p class="recycle-intro">Deleted letters and memories stay here until you decide to restore them.</p>
        <div class="recycle-list" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close-recycle]").forEach((button) => button.addEventListener("click", close));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !modal.hidden) close();
    });
    return modal;
  }

  async function render() {
    const list = buildModal().querySelector(".recycle-list");
    list.innerHTML = '<div class="recycle-loading"><i></i><span>Checking what can be restored...</span></div>';
    try {
      const entries = await window.CornerContentRepository.recycleBin();
      if (!entries.length) {
        list.innerHTML = '<div class="recycle-empty"><span aria-hidden="true">&#10003;</span><strong>Nothing waiting here</strong><p>Your letters and memories are all safely on their shelves.</p></div>';
        return;
      }
      list.innerHTML = entries.map((entry) => `
        <article class="recycle-item" data-kind="${escapeHtml(entry.kind)}" data-id="${escapeHtml(entry.id)}">
          <span class="recycle-kind" aria-hidden="true">${entry.kind === "letter" ? "PF" : "#"}</span>
          <div><small>${entry.kind === "letter" ? "Open When letter" : "Memory"} &middot; ${escapeHtml(formatDeletedAt(entry.deletedAt))}</small><strong>${escapeHtml(entry.title)}</strong><span>Revision ${escapeHtml(entry.revision)}</span></div>
          <button class="btn restore-content" type="button">Restore</button>
        </article>`).join("");
      list.querySelectorAll(".restore-content").forEach((button) => button.addEventListener("click", async () => {
        const row = button.closest(".recycle-item");
        button.disabled = true;
        button.textContent = "Restoring...";
        try {
          await window.CornerContentRepository.restore(row.dataset.kind, row.dataset.id);
          window.CornerRuntime?.toast?.(`${row.dataset.kind === "letter" ? "Letter" : "Memory"} restored`);
          await render();
        } catch (error) {
          console.warn("Restore failed.", error);
          button.disabled = false;
          button.textContent = "Try again";
        }
      }));
    } catch (error) {
      console.warn("Recycle bin could not load.", error);
      list.innerHTML = '<div class="recycle-empty"><strong>Recycle bin needs attention</strong><p>Check your connection and try again.</p></div>';
    }
  }

  function open() {
    const dialog = buildModal();
    dialog.hidden = false;
    document.body.classList.add("recycle-open");
    render();
    dialog.querySelector("[data-close-recycle]")?.focus();
  }

  function close() {
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove("recycle-open");
  }

  function mount() {
    if (!window.CornerContentRepository?.enabled) return;
    const page = document.body.dataset.page;
    if (!['letters', 'memories'].includes(page)) return;
    const anchor = document.getElementById(page === "letters" ? "letterEditToggle" : "memoryEditToggle");
    if (!anchor || document.querySelector(".recycle-trigger")) return;
    const button = document.createElement("button");
    button.className = "recycle-trigger";
    button.type = "button";
    button.innerHTML = '<span aria-hidden="true">&#8634;</span> Recently deleted';
    button.addEventListener("click", open);
    anchor.insertAdjacentElement("afterend", button);
  }

  if (window.CORNER_READY) mount();
  else document.addEventListener("corner:ready", mount, { once: true });
})();
