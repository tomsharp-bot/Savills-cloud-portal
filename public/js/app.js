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

  function stockTableFrom(el) {
    return el && el.closest ? el.closest("table[data-stock]") : null;
  }

  document.addEventListener("change", async (e) => {
    const inp = e.target;
    if (!inp || !inp.closest) return;
    const table = stockTableFrom(inp);
    if (!table) return;
    const projectId = table.dataset.project;
    if (inp.matches("input[data-comment]")) {
      patchAsset(projectId, inp.dataset.comment, { siteComments: inp.value });
      return;
    }
    if (inp.matches("input[data-admin-field]")) {
      const body = {};
      body[inp.dataset.adminField] = inp.value;
      patchAsset(projectId, inp.dataset.asset, body);
      return;
    }
    if (inp.matches("input[data-omit]")) {
      const ok = await patchAsset(projectId, inp.dataset.omit, { omitAsset: inp.checked });
      if (ok) loadStockWindow(table, { offset: table.dataset.offset || "0" });
      return;
    }
    if (inp.matches("input[data-epc]")) {
      const ok = await patchAsset(projectId, inp.dataset.epc, { epcRequired: inp.checked });
      if (ok) loadStockWindow(table, { offset: table.dataset.offset || "0" });
    }
  });

  function markFilterActive(el) {
    el.classList.toggle("filter-active", String(el.value || "").trim() !== "");
  }

  function stockQuery(table, overrides) {
    const kind = table.dataset.stock;
    const params = new URLSearchParams();
    const presence = new Set(["__nonblank__", "__blank__"]);
    params.set("kind", kind);
    params.set("offset", String(overrides && overrides.offset != null ? overrides.offset : (table.dataset.offset || "0")));
    params.set("limit", String(table.dataset.limit || "100"));
    params.set("sort", (overrides && overrides.sort) || table.dataset.sort || "uprn");
    params.set("dir", (overrides && overrides.dir) || table.dataset.dir || "asc");
    document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter-presence]').forEach((el) => {
      markFilterActive(el);
      const value = String(el.value || "").trim();
      if (presence.has(value)) params.set("f_" + el.dataset.filterPresence, value);
    });
    document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter]').forEach((el) => {
      markFilterActive(el);
      const value = String(el.value || "").trim();
      if (!value) return;
      const key = "f_" + el.dataset.filter;
      const chosen = params.get(key);
      if (chosen && presence.has(chosen)) return;
      params.set("f_" + el.dataset.filter, value);
    });
    return params;
  }

  const stockLoads = new WeakMap();

  function paintSort(table, sort, dir) {
    table.querySelectorAll("[data-sort-col]").forEach((btn) => {
      const on = btn.dataset.sortCol === sort;
      btn.classList.toggle("active", on);
      const label = btn.dataset.sortLabel || btn.textContent || "";
      btn.textContent = label + (on ? (dir === "asc" ? " ↑" : " ↓") : "");
    });
  }

  function formatStockCount(n) {
    return Number(n || 0).toLocaleString("en-GB");
  }

  function stockVisibleLabel(table, wrap) {
    const matched = Number(table.dataset.matched || 0);
    const total = Number(table.dataset.total || 0);
    const height = Number(table.dataset.rowHeight) || 40;
    if (matched === 0) return "0 of " + formatStockCount(total) + " Assets Displayed";
    const start = Math.floor(Math.max(0, wrap ? wrap.scrollTop : 0) / height);
    const visible = Math.max(1, wrap ? Math.ceil(wrap.clientHeight / height) : 1);
    const from = Math.min(matched, start + 1);
    const to = Math.min(matched, start + visible);
    const range = formatStockCount(from) + "–" + formatStockCount(to);
    if (matched !== total) {
      return "Showing " + range + " of " + formatStockCount(matched) + " Assets (" + formatStockCount(total) + " in this tab)";
    }
    return "Showing " + range + " of " + formatStockCount(matched) + " Assets";
  }

  function paintStockLabel(table) {
    const kind = table.dataset.stock;
    const count = document.querySelector('[data-stock-count="' + kind + '"]');
    const wrap = table.closest(".stock-table-wrap");
    if (count) count.textContent = stockVisibleLabel(table, wrap);
  }

  function syncStockUrl(table, params) {
    const url = new URL(window.location.href);
    const kind = table.dataset.stock;
    const tab = kind === "block" ? "blocks" : kind === "garage" ? "garages" : "dwellings";
    url.searchParams.set("tab", tab);
    [...url.searchParams.keys()].forEach((key) => {
      if (key === "page" || key === "offset" || key === "limit" || key === "sort" || key === "dir" || key.indexOf("f_") === 0) {
        url.searchParams.delete(key);
      }
    });
    params.forEach((value, key) => {
      if (key === "kind" || key === "limit") return;
      if (key === "offset" && (value === "0" || value === "")) return;
      url.searchParams.set(key, value);
    });
    history.replaceState(null, "", url);
  }

  function flushStockEdits(table) {
    const active = document.activeElement;
    const tbody = table.tBodies[0];
    if (!active || !tbody || !tbody.contains(active) || !active.matches) return;
    if (active.matches("input[data-comment], input[data-admin-field]")) {
      active.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function ensurePads(table) {
    const tbody = table.tBodies[0];
    if (!tbody) return null;
    const cols = table.querySelectorAll("thead tr.stock-head th").length || 1;
    let top = tbody.querySelector('[data-pad="top"]');
    let bottom = tbody.querySelector('[data-pad="bottom"]');
    function pad(which) {
      const tr = document.createElement("tr");
      tr.className = "stock-virtual-pad";
      tr.setAttribute("data-pad", which);
      tr.setAttribute("aria-hidden", "true");
      const td = document.createElement("td");
      td.colSpan = cols;
      tr.appendChild(td);
      return tr;
    }
    if (!top) {
      top = pad("top");
      tbody.insertBefore(top, tbody.firstChild);
    }
    if (!bottom) {
      bottom = pad("bottom");
      tbody.appendChild(bottom);
    }
    return { tbody, top, bottom };
  }

  function applyPads(table, offset, shown, matched) {
    const pads = ensurePads(table);
    if (!pads) return pads;
    const height = Number(table.dataset.rowHeight) || 40;
    const topPx = Math.max(0, offset) * height;
    const bottomPx = Math.max(0, matched - offset - shown) * height;
    const topTd = pads.top.querySelector("td");
    const bottomTd = pads.bottom.querySelector("td");
    if (topTd) topTd.style.height = topPx + "px";
    if (bottomTd) bottomTd.style.height = bottomPx + "px";
    return pads;
  }

  function countAssetRows(html) {
    const matched = String(html || "").match(/data-asset=/g);
    return matched ? matched.length : 0;
  }

  async function loadStockWindow(table, overrides) {
    const projectId = table.dataset.project;
    const params = stockQuery(table, overrides);
    const seq = (stockLoads.get(table) || 0) + 1;
    stockLoads.set(table, seq);
    table.setAttribute("aria-busy", "true");
    let data = null;
    try {
      const res = await fetch(appUrl("/projects/" + projectId + "/stock/page?" + params.toString()), {
        headers: { Accept: "application/json" },
      });
      data = await res.json().catch(() => null);
      if (stockLoads.get(table) !== seq) return;
      if (!res.ok || !data) {
        const count = document.querySelector('[data-stock-count="' + table.dataset.stock + '"]');
        if (count) count.textContent = (data && data.error) || "Could not load stock rows.";
        return;
      }
    } catch (err) {
      if (stockLoads.get(table) !== seq) return;
      const count = document.querySelector('[data-stock-count="' + table.dataset.stock + '"]');
      if (count) count.textContent = "Could not load stock rows.";
      return;
    } finally {
      if (stockLoads.get(table) === seq) table.removeAttribute("aria-busy");
    }
    if (stockLoads.get(table) !== seq) return;
    flushStockEdits(table);
    const pads = ensurePads(table);
    if (!pads) return;
    let node = pads.top.nextSibling;
    while (node && node !== pads.bottom) {
      const next = node.nextSibling;
      node.parentNode.removeChild(node);
      node = next;
    }
    const empty = !data.html || !countAssetRows(data.html);
    if (data.html && !empty) pads.bottom.insertAdjacentHTML("beforebegin", data.html);
    else if (empty) {
      const cols = table.querySelectorAll("thead tr.stock-head th").length || 1;
      const tr = document.createElement("tr");
      tr.className = "stock-empty";
      const td = document.createElement("td");
      td.colSpan = cols;
      td.className = "empty";
      td.textContent = data.label && String(data.matched) === "0" ? "No assets match these filters." : "No assets in this tab yet.";
      if (data.html && /No assets/.test(data.html)) {
        const found = data.html.match(/<td[^>]*>([^<]*)<\/td>/);
        if (found) td.textContent = found[1];
      }
      tr.appendChild(td);
      pads.bottom.parentNode.insertBefore(tr, pads.bottom);
    }
    const shown = table.querySelectorAll("tbody tr[data-asset]").length;
    table.dataset.offset = String(data.offset || 0);
    table.dataset.matched = String(data.matched || 0);
    table.dataset.total = String(data.total || 0);
    table.dataset.sort = data.sort || "uprn";
    table.dataset.dir = data.dir || "asc";
    if (data.rowHeight) table.dataset.rowHeight = String(data.rowHeight);
    applyPads(table, Number(data.offset || 0), shown, Number(data.matched || 0));
    const wrap = table.closest(".stock-table-wrap");
    if (overrides && overrides.scrollTop && wrap) wrap.scrollTop = 0;
    paintStockLabel(table);
    paintSort(table, table.dataset.sort, table.dataset.dir);
    syncStockUrl(table, params);
    if (wrap) maybeVirtualFetch(table, wrap);
  }

  function maybeVirtualFetch(table, wrap) {
    if (table.getAttribute("aria-busy") === "true") return;
    const matched = Number(table.dataset.matched || 0);
    if (matched <= 0) return;
    const height = Number(table.dataset.rowHeight) || 40;
    const offset = Number(table.dataset.offset || 0);
    const shown = table.querySelectorAll("tbody tr[data-asset]").length;
    const start = Math.floor(Math.max(0, wrap.scrollTop) / height);
    const visible = Math.max(1, Math.ceil(wrap.clientHeight / height) + 1);
    const viewFrom = Math.max(0, start - 8);
    const viewTo = Math.min(matched, start + visible + 8);
    if (shown > 0 && viewFrom >= offset && viewTo <= offset + shown) return;
    let next = Math.max(0, start - 30);
    const maxOffset = Math.max(0, matched - 1);
    if (next > maxOffset) next = maxOffset;
    if (String(next) === String(offset)) return;
    loadStockWindow(table, { offset: String(next) });
  }

  document.querySelectorAll("table[data-stock]").forEach((table) => {
    const kind = table.dataset.stock;
    const wrap = table.closest(".stock-table-wrap");
    const filterRoot = document.querySelector('[data-stock-filters="' + kind + '"]');
    document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter], [data-stock-filters="' + kind + '"] [data-filter-presence]').forEach((el) => {
      markFilterActive(el);
      let timer = 0;
      const run = () => loadStockWindow(table, { offset: "0", scrollTop: true });
      el.addEventListener("input", () => {
        if (filterRoot && el.matches("input[data-filter]") && el.value.trim()) {
          const presenceEl = filterRoot.querySelector('[data-filter-presence="' + el.dataset.filter + '"]');
          if (presenceEl) {
            presenceEl.value = "";
            markFilterActive(presenceEl);
          }
        }
        markFilterActive(el);
        if (el.tagName === "SELECT") return;
        clearTimeout(timer);
        timer = setTimeout(run, 250);
      });
      el.addEventListener("change", () => {
        if (filterRoot && el.matches("[data-filter-presence]") && el.value.trim()) {
          const text = filterRoot.querySelector('input[data-filter="' + el.dataset.filterPresence + '"]');
          if (text) {
            text.value = "";
            markFilterActive(text);
          }
        }
        markFilterActive(el);
        clearTimeout(timer);
        run();
      });
    });
    if (!wrap) return;
    const offset = Number(table.dataset.offset || 0);
    const height = Number(table.dataset.rowHeight) || 40;
    if (offset > 0) wrap.scrollTop = offset * height;
    paintStockLabel(table);
    let frame = 0;
    wrap.addEventListener("scroll", () => {
      paintStockLabel(table);
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        maybeVirtualFetch(table, wrap);
      });
    }, { passive: true });
  });

  document.querySelectorAll("[data-clear-filters]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const kind = btn.getAttribute("data-clear-filters");
      document.querySelectorAll('[data-stock-filters="' + kind + '"] [data-filter], [data-stock-filters="' + kind + '"] [data-filter-presence]').forEach((el) => {
        el.value = "";
        markFilterActive(el);
      });
      const table = document.querySelector('table[data-stock="' + kind + '"]');
      if (table) loadStockWindow(table, { offset: "0", scrollTop: true });
    });
  });

  document.querySelectorAll("table[data-stock] [data-sort-col]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const table = stockTableFrom(btn);
      if (!table) return;
      const col = btn.dataset.sortCol;
      const dir = table.dataset.sort === col && table.dataset.dir !== "desc" ? "desc" : "asc";
      loadStockWindow(table, { offset: "0", scrollTop: true, sort: col, dir: dir });
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

  function copyFallback(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (!ok) window.prompt("Copy this text:", text);
  }

  function markCopied(btn) {
    var old = btn.getAttribute("data-copy-label") || btn.textContent;
    btn.setAttribute("data-copy-label", old);
    btn.textContent = "Copied";
    setTimeout(function () { btn.textContent = old; }, 1500);
  }

  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy") || "";
      var done = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard"));
      done.then(function () { markCopied(btn); }).catch(function () {
        copyFallback(text);
        markCopied(btn);
      });
    });
  });

  document.querySelectorAll("[data-copy-from]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sel = btn.getAttribute("data-copy-from") || "";
      const el = sel ? document.querySelector(sel) : null;
      const text = el && "value" in el ? String(el.value || "") : "";
      if (!text) return;
      var done = navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("no clipboard"));
      done.then(function () { markCopied(btn); }).catch(function () {
        copyFallback(text);
        markCopied(btn);
      });
    });
  });

  const sampleRoot = document.getElementById("sample-analysis");
  if (sampleRoot && sampleRoot.dataset.canEdit === "1") {
    const projectId = sampleRoot.dataset.project;
    const statusEl = document.getElementById("surv-status");
    function showSampleStatus(message) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.classList.remove("empty");
    }
    function reloadSample(message) {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "sample-analysis");
      url.searchParams.set("notice", message);
      window.location.assign(url.toString());
    }
    async function saveSample(path, body) {
      const res = await fetch(appUrl("/projects/" + projectId + path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Could not save");
        return null;
      }
      return data;
    }
    sampleRoot.querySelectorAll(".surv-input").forEach((inp) => {
      inp.addEventListener("input", () => {
        inp.value = inp.value.toUpperCase();
        inp.classList.toggle("has-value", inp.value.trim() !== "");
      });
    });
    sampleRoot.querySelectorAll("[data-sa-field]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const field = inp.getAttribute("data-sa-field");
        const patch = inp.getAttribute("data-sa-patch");
        const body = { patch: patch };
        body[field] = inp.value;
        const data = await saveSample("/sample-analysis/patch", body);
        if (!data) return;
        if (field === "surveyorInitials") {
          const who = data.surveyorInitials || "blank";
          reloadSample(
            "Set Surveyor = " + who + " on " + data.updatedAssets + " stock row(s) for " + data.patch + "."
          );
        } else {
          showSampleStatus("Saved area name for " + data.patch + ".");
        }
      });
    });
    sampleRoot.querySelectorAll("[data-sa-date]").forEach((inp) => {
      inp.addEventListener("change", async () => {
        const field = inp.getAttribute("data-sa-date");
        const body = {};
        body[field] = inp.value;
        const data = await saveSample("/sample-analysis/schedule", body);
        if (!data) return;
        showSampleStatus(field === "sampleStartDate" ? "Saved Start Date." : "Saved Target End Date.");
      });
    });
  }

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
