(function () {
  const root = document.getElementById("screen-app");
  if (!root || !window.__PHOTOS__) return;

  const data = window.__PHOTOS__;
  const basePath = root.getAttribute("data-base-path") || "";
  function url(path) {
    if (!path) return basePath || "/";
    if (/^https?:/i.test(path)) return path;
    const p = path.startsWith("/") ? path : "/" + path;
    return (basePath || "") + p;
  }

  let folders = Array.isArray(data.folders) ? data.folders.slice() : [];
  const pool = Array.isArray(data.pool) ? data.pool.slice() : [];

  let poolSelectMode = false;
  const selectedPoolCodes = new Set();
  let poolSearchQuery = "";
  let expandedFolderId = null;
  let highlightFolderId = null;
  let pendingExtract = null;
  let clientStripVisible = false;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  function openModal(id) {
    const m = document.getElementById(id);
    m.hidden = false;
    m.classList.add("open");
  }
  function closeModal(id) {
    const m = document.getElementById(id);
    m.classList.remove("open");
    m.hidden = true;
  }

  function setTab(name) {
    document.querySelectorAll(".photos-page .tab").forEach((t) => {
      const on = t.getAttribute("data-tab") === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".photos-page .panel").forEach((p) => {
      p.classList.toggle("active", p.id === "panel-" + name);
    });
  }

  function matchesPoolSearch(meta, q) {
    if (!q) return true;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (
      meta.code.toLowerCase().indexOf(s) !== -1 ||
      meta.fileName.toLowerCase().indexOf(s) !== -1 ||
      meta.uprn.toLowerCase().indexOf(s) !== -1
    );
  }

  function updateSelectUi() {
    const btn = document.getElementById("btnSelectImages");
    const dl = document.getElementById("btnDownloadZip");
    const hint = document.getElementById("poolSelectHint");
    const countEl = document.getElementById("poolSelectCount");
    root.classList.toggle("select-mode", poolSelectMode);
    if (btn) {
      btn.classList.toggle("active-select", poolSelectMode);
      btn.textContent = poolSelectMode ? "Cancel select" : "Select Images";
    }
    const n = selectedPoolCodes.size;
    if (hint) hint.hidden = !poolSelectMode;
    if (countEl) countEl.textContent = String(n);
    if (dl) dl.disabled = !poolSelectMode || n === 0;
  }

  function openLightbox(meta) {
    document.getElementById("lightboxTitle").textContent = meta.fileName;
    document.getElementById("lightboxSub").textContent = "UPRN " + meta.uprn + " · " + meta.code;
    const img = document.getElementById("lightboxImg");
    img.src = meta.thumbUrl;
    img.alt = meta.fileName;
    openModal("photoLightbox");
  }

  function renderPhotoPool() {
    const host = document.getElementById("photoPool");
    const filtered = pool.filter((meta) => matchesPoolSearch(meta, poolSearchQuery));
    if (!pool.length) {
      host.innerHTML = '<p class="hint-muted">No photos in pool.</p>';
      updateSelectUi();
      return;
    }
    if (!filtered.length) {
      host.innerHTML = '<p class="hint-muted">No photos match that search.</p>';
      updateSelectUi();
      return;
    }
    host.innerHTML = filtered
      .map((meta) => {
        const checked = selectedPoolCodes.has(meta.code) ? " checked" : "";
        const selClass = selectedPoolCodes.has(meta.code) ? " selected" : "";
        return (
          '<button type="button" class="photo-card' +
          selClass +
          '" role="listitem" data-code="' +
          escapeHtml(meta.code) +
          '" aria-label="' +
          escapeHtml(meta.fileName) +
          '">' +
          '<input type="checkbox" class="sel-check" tabindex="-1" aria-hidden="true"' +
          checked +
          " />" +
          '<img class="photo-thumb" src="' +
          meta.thumbUrl +
          '" alt="" loading="lazy" />' +
          '<div class="photo-name">' +
          escapeHtml(meta.fileName) +
          "</div>" +
          '<div class="photo-meta">UPRN ' +
          escapeHtml(meta.uprn) +
          "</div>" +
          "</button>"
        );
      })
      .join("");

    host.querySelectorAll(".photo-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const code = card.getAttribute("data-code");
        const meta = pool.find((p) => p.code === code);
        if (poolSelectMode) {
          e.preventDefault();
          if (selectedPoolCodes.has(code)) selectedPoolCodes.delete(code);
          else selectedPoolCodes.add(code);
          card.classList.toggle("selected", selectedPoolCodes.has(code));
          const cb = card.querySelector(".sel-check");
          if (cb) cb.checked = selectedPoolCodes.has(code);
          updateSelectUi();
          return;
        }
        if (meta) openLightbox(meta);
      });
    });
    updateSelectUi();
  }

  function downloadSelectedZip() {
    if (!selectedPoolCodes.size) return;
    const codes = Array.from(selectedPoolCodes).map(encodeURIComponent).join(",");
    window.location.href = url(data.zipApi + "?codes=" + codes);
  }

  function renderFolders() {
    const body = document.getElementById("foldersBody");
    body.innerHTML = folders
      .map((f) => {
        const isFolder = f.kind === "folder";
        const nameCell = isFolder
          ? '<button type="button" class="folder-name-btn" data-expand="' +
            escapeHtml(f.id) +
            '">' +
            escapeHtml(f.name) +
            "</button>"
          : '<span class="zip-name">' + escapeHtml(f.name) + "</span>";
        const hl = highlightFolderId === f.id ? " folder-highlight" : "";
        const sel = expandedFolderId === f.id ? " folder-selected" : "";
        return (
          '<tr class="' +
          hl +
          sel +
          '" data-zip-id="' +
          escapeHtml(f.id) +
          '">' +
          "<td>" +
          nameCell +
          "</td>" +
          '<td class="zip-size">' +
          escapeHtml(f.contentsLabel) +
          "</td>" +
          '<td><label class="client-access">' +
          '<input type="checkbox" class="client-access-cb" data-zip-id="' +
          escapeHtml(f.id) +
          '"' +
          (f.clientAccess ? " checked" : "") +
          " />" +
          "<span>Client Access</span></label></td>" +
          "</tr>" +
          (isFolder
            ? '<tr class="folder-photos-row" data-for="' +
              escapeHtml(f.id) +
              '" style="display:' +
              (expandedFolderId === f.id ? "table-row" : "none") +
              '">' +
              '<td colspan="3" style="padding:0;border-bottom:1px solid var(--border);background:#fafbfc">' +
              '<div class="folder-photos">' +
              (f.photoCodes && f.photoCodes.length
                ? f.photoCodes
                    .map((code) => {
                      const meta = pool.find((p) => p.code === code);
                      const thumb = meta ? meta.thumbUrl : "";
                      return (
                        '<div class="photo-card" style="cursor:default">' +
                        (thumb
                          ? '<img class="photo-thumb" src="' + thumb + '" alt="" />'
                          : '<div class="photo-thumb" aria-hidden="true"></div>') +
                        '<div class="photo-name">' +
                        escapeHtml(code) +
                        "</div>" +
                        "</div>"
                      );
                    })
                    .join("")
                : '<span class="hint-muted">Empty folder</span>') +
              "</div></td></tr>"
            : "")
        );
      })
      .join("");

    body.querySelectorAll(".client-access-cb").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const id = cb.getAttribute("data-zip-id");
        const zip = folders.find((z) => z.id === id);
        if (!zip) return;
        const clientAccess = cb.checked;
        try {
          const res = await fetch(url(data.clientAccessApiBase + "/" + id + "/client-access"), {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ clientAccess }),
          });
          const json = await res.json();
          if (!res.ok || !json.ok) throw new Error(json.error || "Could not update Client Access");
          zip.clientAccess = clientAccess;
          renderCompletions();
        } catch (err) {
          cb.checked = !clientAccess;
          alert(err.message || "Could not update Client Access");
        }
      });
    });

    body.querySelectorAll("[data-expand]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-expand");
        expandedFolderId = expandedFolderId === id ? null : id;
        renderFolders();
      });
    });
  }

  function renderCompletions() {
    const list = document.getElementById("completionsList");
    const visible = folders.filter((f) => f.clientAccess);
    if (!visible.length) {
      list.innerHTML =
        '<div class="completion-empty">No Photo Folders have Client Access ticked yet. Tick a folder or zip above to preview it here.</div>';
      return;
    }
    list.innerHTML = visible
      .map((f) => {
        return (
          '<div class="completion-row" data-zip-id="' +
          escapeHtml(f.id) +
          '">' +
          '<div class="completion-name">' +
          escapeHtml(f.name) +
          ' <span class="photo-completion-meta">· ' +
          escapeHtml(f.contentsLabel) +
          "</span></div>" +
          '<div class="completion-actions">' +
          '<a class="btn btn-sm btn-primary" href="' +
          url(data.clientAccessApiBase + "/" + f.id + "/download") +
          '">Download</a>' +
          '<button type="button" class="btn btn-sm" data-activity="' +
          escapeHtml(f.id) +
          '">Activity</button>' +
          "</div></div>"
        );
      })
      .join("");

    list.querySelectorAll("[data-activity]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const zip = folders.find((z) => z.id === btn.getAttribute("data-activity"));
        if (zip) openActivityModal(zip);
      });
    });
  }

  function openActivityModal(zip) {
    document.getElementById("activityTitle").textContent = zip.name;
    const ul = document.getElementById("activityList");
    const rows =
      zip.activities && zip.activities.length
        ? zip.activities
        : [{ who: "Client portal · (no clients yet)", downloaded: false, when: null }];
    ul.innerHTML = rows
      .map((r) => {
        const status = r.downloaded ? "Downloaded " + (r.when || "") : "Not downloaded yet";
        return (
          '<li class="activity-item' +
          (r.downloaded ? " downloaded" : "") +
          '">' +
          '<div class="activity-who">' +
          escapeHtml(r.who) +
          "</div>" +
          '<div class="activity-status' +
          (r.downloaded ? " yes" : "") +
          '">' +
          escapeHtml(status) +
          "</div></li>"
        );
      })
      .join("");
    openModal("activityModal");
  }

  function nextFolderSequence() {
    let max = 0;
    folders.forEach((f) => {
      const m = String(f.name).match(/^(\d+)\.\s*/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return max + 1;
  }

  function updateNamePreview() {
    const seq = pendingExtract ? pendingExtract.seq : 1;
    const rest = document.getElementById("folderNameRest").value.trim();
    const prefix = seq + ". ";
    let finalName;
    if (!rest) finalName = prefix + "…";
    else if (/^\d+\.\s*/.test(rest)) finalName = prefix + rest.replace(/^\d+\.\s*/, "");
    else finalName = prefix + rest;
    document.getElementById("namePreview").textContent = "Final folder name: " + finalName;
    return finalName;
  }

  function openNameModal(seq) {
    document.getElementById("folderNamePrefix").textContent = seq + ". ";
    document.getElementById("folderNameRest").value = "Pictures Batch " + seq;
    document.getElementById("nameErr").classList.remove("show");
    updateNamePreview();
    openModal("nameModal");
    setTimeout(() => {
      const inp = document.getElementById("folderNameRest");
      inp.focus();
      inp.select();
    }, 50);
  }

  function showDoneModal(summary) {
    const ul = document.getElementById("doneSummary");
    ul.innerHTML =
      "<li>Found &amp; copied: <strong>" +
      summary.found +
      "</strong></li>" +
      "<li>Skipped (not in pool): <strong>" +
      summary.skipped +
      "</strong></li>" +
      "<li>Folder: <strong>" +
      escapeHtml(summary.folderName) +
      "</strong></li>";
    openModal("doneModal");
  }

  function runExtractParse() {
    const raw = document.getElementById("extractCodes").value;
    if (!String(raw || "").trim()) {
      alert("Paste at least one photo code to extract.");
      return;
    }
    const seq = nextFolderSequence();
    pendingExtract = { seq: seq, raw: raw };
    openNameModal(seq);
  }

  async function confirmCreateFolder() {
    if (!pendingExtract) return;
    const rest = document.getElementById("folderNameRest").value.trim();
    if (!rest) {
      document.getElementById("nameErr").classList.add("show");
      return;
    }
    document.getElementById("nameErr").classList.remove("show");
    try {
      const res = await fetch(url(data.extractApi), {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ codes: pendingExtract.raw, nameRest: rest }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || "Extract failed");
      folders.push(json.folder);
      highlightFolderId = json.folder.id;
      expandedFolderId = json.folder.id;
      pendingExtract = null;
      closeModal("nameModal");
      document.getElementById("extractCodes").value = "";
      renderFolders();
      renderCompletions();
      setTab("folders");
      showDoneModal({ found: json.found, skipped: json.skipped, folderName: json.folderName });
      setTimeout(() => {
        const row = document.querySelector('tr[data-zip-id="' + CSS.escape(json.folder.id) + '"]');
        if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err) {
      alert(err.message || "Could not create extract");
    }
  }

  // Demo extract hint
  const sampleExist = pool.slice(0, 3).concat(pool.slice(10, 12));
  const missing = "9999999-Kitchen-1";
  if (sampleExist.length) {
    document.getElementById("extractHint").textContent =
      "Demo: try " + sampleExist.slice(0, 4).map((p) => p.code).join(", ") + " and " + missing + " (skip).";
  }

  document.querySelectorAll(".photos-page .tab").forEach((tab) => {
    tab.addEventListener("click", () => setTab(tab.getAttribute("data-tab")));
  });

  document.getElementById("btnPreviewClient").addEventListener("click", () => {
    clientStripVisible = true;
    const strip = document.getElementById("clientStrip");
    strip.classList.remove("hidden");
    setTab("folders");
    strip.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  document.getElementById("btnHideClient").addEventListener("click", () => {
    clientStripVisible = false;
    document.getElementById("clientStrip").classList.add("hidden");
  });

  document.getElementById("btnCloseModal").addEventListener("click", () => closeModal("activityModal"));
  document.getElementById("activityModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeModal("activityModal");
  });

  document.getElementById("btnRunExtract").addEventListener("click", runExtractParse);
  document.getElementById("btnConfirmName").addEventListener("click", confirmCreateFolder);
  document.getElementById("btnCancelName").addEventListener("click", () => {
    pendingExtract = null;
    closeModal("nameModal");
  });
  document.getElementById("btnCloseNameModal").addEventListener("click", () => {
    pendingExtract = null;
    closeModal("nameModal");
  });
  document.getElementById("nameModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      pendingExtract = null;
      closeModal("nameModal");
    }
  });
  document.getElementById("folderNameRest").addEventListener("input", updateNamePreview);
  document.getElementById("folderNameRest").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmCreateFolder();
    }
  });

  function closeDone() {
    closeModal("doneModal");
  }
  document.getElementById("btnDoneOk").addEventListener("click", closeDone);
  document.getElementById("btnCloseDoneModal").addEventListener("click", closeDone);
  document.getElementById("doneModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeDone();
  });

  document.getElementById("poolSearch").addEventListener("input", (e) => {
    poolSearchQuery = e.target.value || "";
    renderPhotoPool();
  });
  document.getElementById("btnSelectImages").addEventListener("click", () => {
    poolSelectMode = !poolSelectMode;
    if (!poolSelectMode) selectedPoolCodes.clear();
    updateSelectUi();
    renderPhotoPool();
  });
  document.getElementById("btnDownloadZip").addEventListener("click", downloadSelectedZip);

  function closeLb() {
    closeModal("photoLightbox");
  }
  document.getElementById("btnCloseLightbox").addEventListener("click", closeLb);
  document.getElementById("btnLightboxOk").addEventListener("click", closeLb);
  document.getElementById("photoLightbox").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLb();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("activityModal");
      closeLb();
      if (document.getElementById("nameModal").classList.contains("open")) {
        pendingExtract = null;
        closeModal("nameModal");
      }
      closeDone();
    }
  });

  renderPhotoPool();
  renderFolders();
  renderCompletions();
})();
