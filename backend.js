/* Persistence adapter: guest journals remain local; account journals use authenticated APIs. */
const journalStore = (() => {
  const LOCAL_KEY = "little-feelings-memories";
  let user = null,
    csrf = "",
    online = false,
    registering = false,
    busy = false,
    editingId = null,
    sessionExpired = false;
  const el = (id) => document.getElementById(id);
  const localMemories = () => {
    try {
      const data = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  };
  async function request(path, { method = "GET", value } = {}) {
    let response;
    try {
      response = await fetch(path, {
        method,
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),
        headers: {
          ...(value !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
        },
        ...(value !== undefined ? { body: JSON.stringify(value) } : {}),
      });
    } catch {
      throw new Error(
        "Cannot reach your journal server. Your draft is still here. Please try again.",
      );
    }
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The journal server is unavailable.");
    }
    if (response.status === 401 && user) {
      sessionExpired = true;
      updateAccountUI();
    }
    if (!response.ok)
      throw new Error(data.error || "Could not complete that request.");
    return data;
  }
  function updateAccountUI() {
    // Without the server (e.g. GitHub Pages or a local file) this is a guest-only journal.
    el("account-trigger").hidden = !online && !user;
    el("account-trigger").textContent = sessionExpired
      ? "Sign in again"
      : user
        ? "Your account"
        : "Sign in";
    el("storage-label").textContent = user
      ? "Saved in your private account."
      : "Saved only in this browser.";
    el("photo-storage-label").textContent = user
      ? "Stored in your private account."
      : "Stored in this browser.";
    el("account-form").hidden = !!user && !sessionExpired;
    el("account-signed-in").hidden = !user || sessionExpired;
    el("account-intro").textContent = user
      ? "Your memories and photos belong to this account."
      : "Sign in to keep your memories and photos in your account.";
    el("account-email-display").textContent = user?.email || "";
    const canImport = !!user && localMemories().length > 0;
    el("import-browser").hidden = !canImport;
    el("import-help").hidden = !canImport;
    el("import-browser").textContent =
      `Import ${localMemories().length} browser ${localMemories().length === 1 ? "memory" : "memories"}`;
  }
  async function loadAllMemories() {
    const result = [];
    let cursor = null;
    do {
      const data = await request(
        "/api/memories?limit=200" +
          (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      );
      result.push(...data.memories);
      cursor = data.nextCursor;
    } while (cursor);
    return result;
  }
  async function refresh() {
    memories = await loadAllMemories();
    drawHomeShelves();
  }
  async function establish(data) {
    csrf = data.csrfToken;
    user = data.user;
    sessionExpired = false;
    memories = [];
    updateAccountUI();
    drawHomeShelves();
    const loaded = await loadAllMemories();
    memories = loaded;
    editingId = null;
    setRegistering(false);
    if (!el("memory-detail").hidden) await closeHomeMemory();
    updateAccountUI();
    drawHomeShelves();
    el("account-password").value = "";
  }
  function download(value) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `little-feelings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function bootstrap() {
    if (!/^https?:$/.test(location.protocol)) {
      updateAccountUI();
      return;
    }
    try {
      const data = await request("/api/auth/me");
      online = true;
      if (data.user) await establish(data);
      else updateAccountUI();
    } catch (error) {
      el("shelf-status").textContent = user
        ? "Could not load your account journal. Reload to try again; your memories are still on the server."
        : "";
      updateAccountUI();
    }
  }
  const ready = bootstrap();
  el("account-trigger").onclick = async () => {
    await ready;
    el("account-status").textContent = online
      ? ""
      : "Start the app with npm start to use private accounts.";
    updateAccountUI();
    el("account-dialog").showModal();
    if (!user) el("account-email").focus();
  };
  el("account-close").onclick = () => el("account-dialog").close();
  function setRegistering(value) {
    registering = value;
    el("account-submit").textContent = registering
      ? "Create account"
      : "Sign in";
    el("account-switch").textContent = registering
      ? "I already have an account"
      : "Create an account";
    el("account-password").autocomplete = registering
      ? "new-password"
      : "current-password";
    el("account-password").minLength = registering ? 12 : 1;
    el("password-help").hidden = !registering;
  }
  el("account-switch").onclick = () => {
    setRegistering(!registering);
    el("account-status").textContent = "";
  };
  el("account-form").onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    el("account-submit").disabled = true;
    el("account-status").textContent = registering
      ? "Creating your journal…"
      : "Opening your journal…";
    try {
      const data = await request(
        `/api/auth/${registering ? "register" : "login"}`,
        {
          method: "POST",
          value: {
            email: el("account-email").value,
            password: el("account-password").value,
          },
        },
      );
      online = true;
      await establish(data);
      el("account-status").textContent = localMemories().length
        ? "Signed in. You can import your browser memories below."
        : "Your private journal is ready.";
    } catch (error) {
      el("account-status").textContent = error.message;
    } finally {
      busy = false;
      el("account-submit").disabled = false;
    }
  };
  el("account-logout").onclick = async () => {
    if (busy || savingMemory || readingPhotos) return;
    busy = true;
    try {
      await request("/api/auth/logout", { method: "POST" });
      if (!el("memory-detail").hidden) await closeHomeMemory();
      user = null;
      csrf = "";
      editingId = null;
      sessionExpired = false;
      drafts.clear();
      draftPhotos = [];
      el("note").value = "";
      renderPhotos();
      memories = localMemories();
      backToWheel();
      updateAccountUI();
      el("account-status").textContent =
        "Signed out. Your account memories are safely stored on the server.";
    } catch (error) {
      el("account-status").textContent = error.message;
    } finally {
      busy = false;
    }
  };
  async function importMemories(items) {
    if (!Array.isArray(items) || items.length > 10000)
      throw new Error(
        "Choose a valid memory backup with at most 10,000 entries.",
      );
    let imported = 0,
      skipped = 0;
    // Each entry has its own atomic transaction and retry-safe source fingerprint.
    for (let i = 0; i < items.length; i++) {
      el("account-status").textContent =
        `Importing ${i + 1} of ${items.length}…`;
      const result = await request("/api/memories/import", {
        method: "POST",
        value: { memories: [items[i]] },
      });
      imported += result.imported;
      skipped += result.skipped;
    }
    await refresh();
    el("account-status").textContent =
      `Imported ${imported} ${imported === 1 ? "memory" : "memories"}; ${skipped} already present. Your original backup was kept.`;
  }
  async function runImport(items) {
    if (busy) return;
    busy = true;
    el("import-browser").disabled = true;
    el("backup-import").disabled = true;
    try {
      await importMemories(items);
    } catch (error) {
      el("account-status").textContent =
        `${error.message} You can retry; completed entries will be skipped.`;
      await refresh().catch(() => {});
    } finally {
      busy = false;
      el("import-browser").disabled = false;
      el("backup-import").disabled = false;
    }
  }
  el("import-browser").onclick = () => runImport(localMemories());
  el("backup-import").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 150 * 1024 * 1024) {
      el("account-status").textContent = "Choose a backup under 150 MB.";
      return;
    }
    try {
      const value = JSON.parse(await file.text());
      await runImport(Array.isArray(value) ? value : value.memories);
    } catch {
      el("account-status").textContent =
        "That file is not a valid JSON backup.";
    }
  };
  el("account-delete").onclick = async () => {
    if (
      busy ||
      !confirm(
        "Permanently delete your account, memories, and photos? Download a backup first if you want to keep them.",
      )
    )
      return;
    busy = true;
    try {
      await request("/api/account", { method: "DELETE" });
      if (!el("memory-detail").hidden) await closeHomeMemory();
      user = null;
      csrf = "";
      editingId = null;
      sessionExpired = false;
      drafts.clear();
      draftPhotos = [];
      el("note").value = "";
      renderPhotos();
      memories = localMemories();
      backToWheel();
      updateAccountUI();
      el("account-status").textContent =
        "Your account and its memories were deleted.";
    } catch (error) {
      el("account-status").textContent = error.message;
    } finally {
      busy = false;
    }
  };
  el("edit-memory").onclick = async () => {
    const memory = memories.find((m) => m.id === openMemoryId);
    if (!memory) return;
    await closeHomeMemory();
    index = Math.max(
      0,
      emotions.findIndex((e) => e.name === memory.feelings[0]),
    );
    editingId = memory.id;
    drafts.set(index, {
      note: memory.note,
      photos: [...(memory.images || [])],
    });
    render();
    await openReflection();
    el("reflection-title").textContent =
      "Revisit your " + emotions[index].name.toLowerCase();
    el("save").innerHTML = 'Save changes <span aria-hidden="true">→</span>';
    el("note").focus();
  };
  el("delete-memory").onclick = async () => {
    const id = openMemoryId;
    if (
      busy ||
      !id ||
      !confirm("Delete this memory and its photos? This cannot be undone.")
    )
      return;
    busy = true;
    el("delete-memory").disabled = true;
    try {
      if (user) await request(`/api/memories/${id}`, { method: "DELETE" });
      else
        localStorage.setItem(
          LOCAL_KEY,
          JSON.stringify(memories.filter((m) => m.id !== id)),
        );
      await closeHomeMemory();
      memories = memories.filter((m) => m.id !== id);
      drawHomeShelves();
      el("shelf-status").textContent = "Memory deleted.";
    } catch (error) {
      el("memory-action-status").textContent = error.message;
    } finally {
      busy = false;
      el("delete-memory").disabled = false;
    }
  };
  el("back-wheel").addEventListener("click", () => {
    editingId = null;
  });
  addEventListener("popstate", () => {
    if (!location.hash.startsWith("#reflect/")) editingId = null;
  });
  return {
    async save(entry) {
      await ready;
      const existing = editingId && memories.find((m) => m.id === editingId);
      if (existing) entry = { ...entry, id: existing.id, date: existing.date };
      let result;
      if (user) {
        const response = await request(
          existing ? `/api/memories/${existing.id}` : "/api/memories",
          { method: existing ? "PATCH" : "POST", value: entry },
        );
        result = existing ? response.memory : response;
      } else {
        result = entry;
        try {
          localStorage.setItem(
            LOCAL_KEY,
            JSON.stringify([
              entry,
              ...memories.filter((m) => m.id !== entry.id),
            ]),
          );
        } catch {
          throw new Error(
            "Browser storage is full or unavailable. Remove an image and try again. Your draft is still here.",
          );
        }
      }
      editingId = null;
      return result;
    },
    async exportMemories() {
      await ready;
      try {
        download(
          user
            ? await request("/api/memories/export")
            : { version: 1, exportedAt: new Date().toISOString(), memories },
        );
      } catch (error) {
        el("shelf-status").textContent = error.message;
      }
    },
  };
})();
