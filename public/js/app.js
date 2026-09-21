(function () {
  function appUrl(path) {
    var base = typeof window.APP_BASE_PATH === "string" ? window.APP_BASE_PATH : "";
    if (!path) return base || "/";
    if (path.charAt(0) !== "/") path = "/" + path;
    return base + path;
  }
  function show(el) { if (el) el.classList.remove("hidden"); }
  function hide(el) { if (el) el.classList.add("hidden"); }

  const createBtn = document.getElementById("btn-create");
  const createModal = document.getElementById("modal-create");
  const editModal = document.getElementById("modal-edit");
  const editForm = document.getElementById("edit-form");
  if (createBtn && createModal) {
    createBtn.onclick = () => show(createModal);
  }
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => hide(document.getElementById(btn.getAttribute("data-close"))));
  });
  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = JSON.parse(btn.getAttribute("data-edit"));
      editForm.action = appUrl("/projects/" + p.id + "/edit");
      document.getElementById("edit-name").value = p.name;
      document.getElementById("edit-pm").value = p.projectManager || "";
      document.getElementById("edit-stage").value = p.stage;
      const targetValue = document.getElementById("edit-target-value");
      const targetUnit = document.getElementById("edit-target-unit");
      if (targetValue) targetValue.value = p.projectTargetValue != null ? p.projectTargetValue : 75;
      if (targetUnit) targetUnit.value = p.projectTargetUnit || "percent";
      editForm.querySelectorAll('input[name="types"]').forEach((cb) => {
        cb.checked = !!p[cb.value];
      });
      show(editModal);
    });
  });

  const params = new URLSearchParams(location.search);
  const selected = params.get("selected");
  const copyForm = document.getElementById("form-copy");
  const deleteForm = document.getElementById("form-delete");
  if (copyForm) {
    copyForm.addEventListener("submit", (e) => {
      if (!selected) {
        e.preventDefault();
        alert("Select a project first (Select on a card).");
        return;
      }
      copyForm.action = appUrl("/projects/" + selected + "/copy");
    });
  }
  if (deleteForm) {
    deleteForm.addEventListener("submit", (e) => {
      if (!selected) {
        e.preventDefault();
        alert("Select a project first (Select on a card).");
        return;
      }
      if (!confirm("Delete this project completely?")) {
        e.preventDefault();
        return;
      }
      deleteForm.action = appUrl("/projects/" + selected + "/delete");
    });
  }

  async function patchAsset(projectId, assetId, body) {
    const res = await fetch(appUrl("/projects/" + projectId + "/assets/" + assetId), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Update failed");
      return null;
    }
    return res.json();
  }

  document.querySelectorAll("input[data-comment]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const table = inp.closest("table");
      const projectId = table && table.dataset.project;
      patchAsset(projectId, inp.dataset.comment, { siteComments: inp.value });
    });
  });
  document.querySelectorAll("input[data-omit]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const table = inp.closest("table");
      const projectId = table && table.dataset.project;
      const tr = inp.closest("tr");
      const ok = await patchAsset(projectId, inp.dataset.omit, { omitAsset: inp.checked });
      if (ok && tr) {
        tr.classList.toggle("row-omitted", inp.checked);
        tr.dataset.omit = inp.checked ? "1" : "0";
      }
    });
  });
  document.querySelectorAll("input[data-admin-field]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const table = inp.closest("table");
      const projectId = table && table.dataset.project;
      const body = {};
      body[inp.dataset.adminField] = inp.value;
      patchAsset(projectId, inp.dataset.asset, body);
    });
  });

  function applyStockFilters(table) {
    const kind = table.dataset.stock;
    const filters = {};
    document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter]').forEach((el) => {
      filters[el.dataset.filter] = (el.value || "").trim().toLowerCase();
    });
    const rows = [...table.tBodies[0].rows].filter((r) => r.dataset.asset);
    let shown = 0;
    rows.forEach((tr) => {
      let ok = true;
      Object.keys(filters).forEach((key) => {
        const q = filters[key];
        if (!q) return;
        if (key === "omitAsset") {
          const omitted = tr.dataset.omit === "1";
          if (q === "omitted" && !omitted) ok = false;
          if (q === "included" && omitted) ok = false;
          return;
        }
        const fieldInp = tr.querySelector('[data-admin-field="' + key + '"]');
        const cell = tr.querySelector('[data-col="' + key + '"]');
        const comment = tr.querySelector("[data-comment]");
        const text = fieldInp
          ? fieldInp.value
          : cell
            ? cell.textContent
            : comment
              ? comment.value
              : tr.textContent;
        if (!String(text || "").toLowerCase().includes(q)) ok = false;
      });
      tr.style.display = ok ? "" : "none";
      if (ok) shown += 1;
    });
    const count = document.querySelector('[data-stock-count="' + kind + '"]');
    if (count) count.textContent = shown + " of " + rows.length + " Assets Displayed";
  }
  document.querySelectorAll("table[data-stock]").forEach((table) => {
    const kind = table.dataset.stock;
    document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter]').forEach((el) => {
      el.addEventListener("input", () => applyStockFilters(table));
      el.addEventListener("change", () => applyStockFilters(table));
    });
  });

  const drop = document.getElementById("loader-drop");
  const fileInput = document.getElementById("loader-file");
  const applyBtn = document.getElementById("btn-loader-apply");
  const log = document.getElementById("loader-log");
  if (drop && fileInput) {
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("drag");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("drag");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        const dt = new DataTransfer();
        dt.items.add(f);
        fileInput.files = dt.files;
        if (applyBtn) applyBtn.disabled = false;
        if (log) log.textContent = "Ready: " + f.name + ". Click Apply to parse and append to the Visit Log.";
      }
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files[0]) {
        if (applyBtn) applyBtn.disabled = false;
        if (log) log.textContent = "Ready: " + fileInput.files[0].name + ". Click Apply to parse and append to the Visit Log.";
      }
    });
  }

  const loaderTarget = document.getElementById("loader-target");
  const stockTarget = document.getElementById("stock-refresh-target");
  if (loaderTarget && stockTarget) {
    const sync = () => { stockTarget.value = loaderTarget.value || "auto"; };
    loaderTarget.addEventListener("change", sync);
    sync();
  }

  const visitFilter = document.getElementById("visit-log-filter");
  const visitTable = document.getElementById("visit-log-table");
  if (visitFilter && visitTable) {
    visitFilter.addEventListener("input", () => {
      const q = visitFilter.value.trim().toLowerCase();
      [...visitTable.tBodies[0].rows].forEach((tr) => {
        tr.style.display = !q || tr.textContent.toLowerCase().includes(q) ? "" : "none";
      });
    });
  }

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "fetch" },
      body: JSON.stringify(body),
    });
    return res;
  }
  document.querySelectorAll("input[data-access]").forEach((cb) => {
    cb.addEventListener("change", () => {
      postJson(appUrl("/personnel/" + cb.dataset.access + "/access"), {
        projectId: cb.dataset.project,
        granted: cb.checked,
      });
    });
  });
  document.querySelectorAll("input[data-freeze]").forEach((cb) => {
    cb.addEventListener("change", () => {
      postJson(appUrl("/personnel/" + cb.dataset.freeze + "/freeze"), { frozen: cb.checked });
    });
  });
  document.querySelectorAll("input[data-initials]").forEach((inp) => {
    inp.addEventListener("change", async () => {
      const res = await postJson(appUrl("/personnel/" + inp.dataset.initials + "/initials"), { initials: inp.value });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Could not save initials");
        location.reload();
      } else if (data.initials) inp.value = data.initials;
    });
  });
  document.querySelectorAll("input[data-agency]").forEach((inp) => {
    inp.addEventListener("change", () => {
      postJson(appUrl("/personnel/" + inp.dataset.agency + "/agency"), { agency: inp.value });
    });
  });

  const clearModal = document.getElementById("modal-clear-stock");
  const clearStep1 = document.getElementById("clear-step-1");
  const clearStep2 = document.getElementById("clear-step-2");
  const clearTyped = document.getElementById("clear-stock-typed");
  function resetClearModal() {
    if (clearStep1) clearStep1.classList.remove("hidden");
    if (clearStep2) clearStep2.classList.add("hidden");
    if (clearTyped) clearTyped.value = "";
    const wipe = document.getElementById("clear-stock-wipe-log");
    if (wipe) wipe.checked = false;
  }
  document.querySelectorAll("[data-clear-stock]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetClearModal();
      show(clearModal);
    });
  });
  const clearNext = document.getElementById("clear-stock-next");
  if (clearNext) {
    clearNext.addEventListener("click", () => {
      if (clearStep1) clearStep1.classList.add("hidden");
      if (clearStep2) clearStep2.classList.remove("hidden");
      if (clearTyped) clearTyped.focus();
    });
  }
  const clearConfirm = document.getElementById("clear-stock-confirm");
  if (clearConfirm) {
    clearConfirm.addEventListener("click", () => {
      const typed = clearTyped ? clearTyped.value.trim() : "";
      if (typed !== "CLEAR") {
        alert("Type CLEAR to confirm.");
        return;
      }
      const form = document.getElementById("form-clear-stock");
      const confirmField = document.getElementById("clear-stock-confirm-field");
      const wipeField = document.getElementById("clear-stock-wipe-field");
      const wipe = document.getElementById("clear-stock-wipe-log");
      if (confirmField) confirmField.value = "CLEAR";
      if (wipeField) wipeField.value = wipe && wipe.checked ? "true" : "";
      if (form) form.submit();
    });
  }
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.getAttribute("data-close") === "modal-clear-stock") resetClearModal();
      if (btn.getAttribute("data-close") === "modal-purge-missing") resetPurgeModal();
    });
  });

  const purgeModal = document.getElementById("modal-purge-missing");
  const purgeStep1 = document.getElementById("purge-step-1");
  const purgeStep2 = document.getElementById("purge-step-2");
  function resetPurgeModal() {
    if (purgeStep1) purgeStep1.classList.remove("hidden");
    if (purgeStep2) purgeStep2.classList.add("hidden");
    const noChoice = document.querySelector('input[name="purge-completed-choice"][value="no"]');
    if (noChoice) noChoice.checked = true;
  }
  document.querySelectorAll("[data-purge-missing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      resetPurgeModal();
      show(purgeModal);
    });
  });
  const purgeNext = document.getElementById("purge-missing-next");
  if (purgeNext) {
    purgeNext.addEventListener("click", () => {
      if (purgeStep1) purgeStep1.classList.add("hidden");
      if (purgeStep2) purgeStep2.classList.remove("hidden");
    });
  }
  const purgeConfirm = document.getElementById("purge-missing-confirm");
  if (purgeConfirm) {
    purgeConfirm.addEventListener("click", () => {
      const form = document.getElementById("form-purge-missing");
      const confirmField = document.getElementById("purge-missing-confirm-field");
      const completedField = document.getElementById("purge-missing-completed-field");
      const yesChoice = document.querySelector('input[name="purge-completed-choice"][value="yes"]');
      if (confirmField) confirmField.value = "REMOVE";
      if (completedField) completedField.value = yesChoice && yesChoice.checked ? "true" : "";
      if (form) form.submit();
    });
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = btn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => { btn.textContent = old; }, 1500);
      } catch {
        window.prompt("Copy this temporary password:", text);
      }
    });
  });

  const changePwForm = document.getElementById("change-password-form");
  if (changePwForm) {
    changePwForm.addEventListener("submit", (e) => {
      const next = changePwForm.querySelector('[name="newPassword"]');
      const confirm = changePwForm.querySelector('[name="confirmPassword"]');
      const err = document.getElementById("pw-client-error");
      const nextVal = next && "value" in next ? String(next.value) : "";
      const confirmVal = confirm && "value" in confirm ? String(confirm.value) : "";
      let message = "";
      if (nextVal.length < 10) message = "New password must be at least 10 characters.";
      else if (nextVal !== confirmVal) message = "New password and confirmation do not match.";
      if (message) {
        e.preventDefault();
        if (err) err.textContent = message;
      }
    });
  }
})();
