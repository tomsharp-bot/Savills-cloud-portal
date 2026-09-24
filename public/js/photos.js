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
  let folderSelectId = null;
  const selectedFolderCodes = new Set();
  let poolSearchQuery = "";
  let expandedFolderId = null;
  let lightboxPhoto = null;
  let renameTarget = null;
  let deleteTarget = null;
  let mutateBusy = false;
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
    root.classList.toggle("pool-select-mode", poolSelectMode);
    if (btn) {
      btn.classList.toggle("active-select", poolSelectMode);
      btn.textContent = poolSelectMode ? "Cancel select" : "Select Images";
    }
    const n = selectedPoolCodes.size;
    if (hint) hint.hidden = !poolSelectMode;
    if (countEl) countEl.textContent = String(n);
    if (dl) dl.disabled = !poolSelectMode || n === 0;
    const del = document.getElementById("btnDeletePhotos");
    const rename = document.getElementById("btnRenamePhoto");
    if (del) del.disabled = !poolSelectMode || n === 0;
    // Rename stays disabled until exactly one image is selected.
    if (rename) {
      rename.disabled = !poolSelectMode || n !== 1;
      rename.title = n === 1 ? "Rename the selected photo" : "Select one photo to rename";
    }
  }

  function fileExtension(fileName) {
    const match = String(fileName || "").match(/(\.[A-Za-z0-9]{1,8})$/);
    return match ? match[1] : ".jpg";
  }

  function fileStem(fileName) {
    const ext = fileExtension(fileName);
    const name = String(fileName || "");
    return name.toLowerCase().endsWith(ext.toLowerCase()) ? name.slice(0, -ext.length) : name;
  }

  function deleteConfirmMessage(n) {
    const noun = n === 1 ? "photo" : "photos";
    return "Delete " + n + " " + noun + "? This cannot be undone.";
  }

  function normCode(code) {
    return String(code || "").trim().toUpperCase();
  }

  function poolMetaFor(code) {
    return pool.find((p) => normCode(p.code) === normCode(code)) || null;
  }

  function contentsLabelFor(folder) {
    if (folder.kind !== "folder") return folder.sizeLabel || "Zip pack";
    const n = Array.isArray(folder.photoCodes) ? folder.photoCodes.length : 0;
    return n + " photo" + (n === 1 ? "" : "s");
  }

  async function postJson(path, body) {
    const res = await fetch(url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    let json = {};
    try {
      json = await res.json();
    } catch (err) {
      json = {};
    }
    if (!res.ok || json.ok === false) {
      const error = new Error(json.error || "Request failed");
      error.payload = json;
      throw error;
    }
    return json;
  }

  function mutationApi(scope, action) {
    if (scope && scope.kind === "folder") {
      return data.clientAccessApiBase + "/" + scope.folderId + "/photos/" + action;
    }
    return action === "delete" ? data.poolDeleteApi : data.poolRenameApi;
  }

  function removeCodesEverywhere(codes) {
    const drop = new Set((codes || []).map(normCode));
    for (let i = pool.length - 1; i >= 0; i--) {
      if (drop.has(normCode(pool[i].code))) pool.splice(i, 1);
    }
    folders.forEach((f) => {
      if (!Array.isArray(f.photoCodes)) return;
      const next = f.photoCodes.filter((c) => !drop.has(normCode(c)));
      if (next.length !== f.photoCodes.length) {
        f.photoCodes = next;
        f.contentsLabel = contentsLabelFor(f);
      }
    });
    Array.from(selectedPoolCodes).forEach((c) => {
      if (drop.has(normCode(c))) selectedPoolCodes.delete(c);
    });
    Array.from(selectedFolderCodes).forEach((c) => {
      if (drop.has(normCode(c))) selectedFolderCodes.delete(c);
    });
  }

  function applyRename(previousCode, photo) {
    const key = normCode(previousCode);
    const idx = pool.findIndex((p) => normCode(p.code) === key);
    if (idx >= 0) pool[idx] = photo;
    else pool.push(photo);
    folders.forEach((f) => {
      if (!Array.isArray(f.photoCodes)) return;
      f.photoCodes = f.photoCodes.map((c) => (normCode(c) === key ? photo.code : c));
    });
    Array.from(selectedPoolCodes).forEach((c) => {
      if (normCode(c) === key) {
        selectedPoolCodes.delete(c);
        selectedPoolCodes.add(photo.code);
      }
    });
    Array.from(selectedFolderCodes).forEach((c) => {
      if (normCode(c) === key) {
        selectedFolderCodes.delete(c);
        selectedFolderCodes.add(photo.code);
      }
    });
    if (lightboxPhoto && normCode(lightboxPhoto.meta.code) === key) {
      lightboxPhoto.meta = photo;
      const title = document.getElementById("lightboxTitle");
      const sub = document.getElementById("lightboxSub");
      const img = document.getElementById("lightboxImg");
      if (title) title.textContent = photo.fileName;
      if (sub) sub.textContent = "UPRN " + photo.uprn + " · " + photo.code;
      if (img) {
        img.src = photo.thumbUrl;
        img.alt = photo.fileName;
      }
    }
  }

  function openRename(meta, scope) {
    if (!meta) return;
    renameTarget = { code: meta.code, fileName: meta.fileName, scope: scope || { kind: "pool" } };
    document.getElementById("renameExt").textContent = fileExtension(meta.fileName);
    const input = document.getElementById("renameInput");
    input.value = fileStem(meta.fileName);
    document.getElementById("renameErr").classList.remove("show");
    openModal("renameModal");
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);
  }

  function openDelete(codes, scope) {
    const list = (codes || []).filter(Boolean);
    if (!list.length) return;
    deleteTarget = { codes: list.slice(), scope: scope || { kind: "pool" } };
    document.getElementById("deleteConfirmText").textContent = deleteConfirmMessage(list.length);
    document.getElementById("deleteErr").classList.remove("show");
    openModal("deleteModal");
  }

  function openLightbox(meta, scope) {
    lightboxPhoto = { meta: meta, scope: scope || { kind: "pool" } };
    document.getElementById("lightboxTitle").textContent = meta.fileName;
    document.getElementById("lightboxSub").textContent = "UPRN " + meta.uprn + " · " + meta.code;
    const img = document.getElementById("lightboxImg");
    img.src = meta.thumbUrl || "";
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

  function folderPhotoMeta(code) {
    const meta = poolMetaFor(code);
    if (meta) return meta;
    return {
      code: code,
      fileName: code,
      uprn: String(code || "").split("-")[0] || "",
      thumbUrl: "",
      spacesKey: "",
    };
  }

  const UPLOAD_ACCEPT =
    "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
  const UPLOAD_CONCURRENCY = Math.min(6, Math.max(1, Number(data.uploadConcurrency) || 4));
  const UPLOAD_MAX_BYTES = Number(data.uploadMaxBytes) || 40 * 1024 * 1024;
  const UPLOAD_FAILURES_SHOWN = 100;

  function folderUploadHtml(folder) {
    return (
      '<label class="upload-zone folder-upload" data-upload-zone data-folder-id="' +
      escapeHtml(folder.id) +
      '">' +
      '<input type="file" class="upload-input visually-hidden" accept="' +
      UPLOAD_ACCEPT +
      '" multiple />' +
      '<span class="upload-zone-copy"><strong>Upload photos</strong>' +
      "<span>Drag and drop images here, or browse. They are added to this folder and the Photos Pool. A name already in this project is skipped.</span></span>" +
      "</label>"
    );
  }

  function folderPhotosHtml(folder) {
    const selecting = folderSelectId === folder.id;
    const n = selecting ? selectedFolderCodes.size : 0;
    const codes = Array.isArray(folder.photoCodes) ? folder.photoCodes : [];
    const cards = codes.length
      ? codes
          .map((code) => {
            const meta = folderPhotoMeta(code);
            const selected = selecting && selectedFolderCodes.has(code);
            return (
              '<button type="button" class="photo-card' +
              (selected ? " selected" : "") +
              '" data-folder-photo="' +
              escapeHtml(folder.id) +
              '" data-code="' +
              escapeHtml(code) +
              '">' +
              '<input type="checkbox" class="sel-check" tabindex="-1" aria-hidden="true"' +
              (selected ? " checked" : "") +
              " />" +
              (meta.thumbUrl
                ? '<img class="photo-thumb" src="' + meta.thumbUrl + '" alt="" loading="lazy" />'
                : '<div class="photo-thumb" aria-hidden="true"></div>') +
              '<div class="photo-name">' +
              escapeHtml(meta.fileName || code) +
              "</div>" +
              "</button>"
            );
          })
          .join("")
      : '<span class="hint-muted">Empty folder</span>';
    return (
      folderUploadHtml(folder) +
      '<div class="folder-photo-toolbar" data-folder-toolbar="' +
      escapeHtml(folder.id) +
      '">' +
      '<button type="button" class="btn btn-sm' +
      (selecting ? " active-select" : "") +
      '" data-folder-select>' +
      (selecting ? "Cancel select" : "Select Images") +
      "</button>" +
      '<button type="button" class="btn btn-sm btn-primary" data-folder-zip' +
      (selecting && n > 0 ? "" : " disabled") +
      ">Download zip</button>" +
      '<button type="button" class="btn btn-sm btn-danger" data-folder-delete' +
      (selecting && n > 0 ? "" : " disabled") +
      ">Delete</button>" +
      '<button type="button" class="btn btn-sm" data-folder-rename title="' +
      (n === 1 ? "Rename the selected photo" : "Select one photo to rename") +
      '"' +
      (selecting && n === 1 ? "" : " disabled") +
      ">Rename</button>" +
      '<p class="pool-select-hint" data-folder-hint' +
      (selecting ? "" : " hidden") +
      "><strong data-folder-count>" +
      n +
      "</strong> selected</p>" +
      "</div>" +
      '<div class="folder-photos' +
      (selecting ? " select-mode" : "") +
      '" data-folder="' +
      escapeHtml(folder.id) +
      '">' +
      cards +
      "</div>"
    );
  }

  function updateFolderSelectUi(folderId) {
    const bar = document.querySelector('[data-folder-toolbar="' + CSS.escape(folderId) + '"]');
    if (!bar) return;
    const on = folderSelectId === folderId;
    const n = on ? selectedFolderCodes.size : 0;
    const selectBtn = bar.querySelector("[data-folder-select]");
    const zipBtn = bar.querySelector("[data-folder-zip]");
    const delBtn = bar.querySelector("[data-folder-delete]");
    const renameBtn = bar.querySelector("[data-folder-rename]");
    const hint = bar.querySelector("[data-folder-hint]");
    const countEl = bar.querySelector("[data-folder-count]");
    if (selectBtn) {
      selectBtn.classList.toggle("active-select", on);
      selectBtn.textContent = on ? "Cancel select" : "Select Images";
    }
    if (zipBtn) zipBtn.disabled = !on || n === 0;
    if (delBtn) delBtn.disabled = !on || n === 0;
    if (renameBtn) {
      renameBtn.disabled = !on || n !== 1;
      renameBtn.title = n === 1 ? "Rename the selected photo" : "Select one photo to rename";
    }
    if (hint) hint.hidden = !on;
    if (countEl) countEl.textContent = String(n);
    const wrap = document.querySelector('.folder-photos[data-folder="' + CSS.escape(folderId) + '"]');
    if (wrap) wrap.classList.toggle("select-mode", on);
  }

  function setFolderSelectMode(folderId, on) {
    folderSelectId = on ? folderId : null;
    selectedFolderCodes.clear();
    const wrap = document.querySelector('.folder-photos[data-folder="' + CSS.escape(folderId) + '"]');
    if (wrap) {
      wrap.querySelectorAll(".photo-card").forEach((card) => {
        card.classList.remove("selected");
        const cb = card.querySelector(".sel-check");
        if (cb) cb.checked = false;
      });
    }
    updateFolderSelectUi(folderId);
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
              folderPhotosHtml(f) +
              "</td></tr>"
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
        if (folderSelectId && folderSelectId !== expandedFolderId) {
          folderSelectId = null;
          selectedFolderCodes.clear();
        }
        renderFolders();
      });
    });

    body.querySelectorAll("[data-folder-toolbar]").forEach((bar) => {
      const folderId = bar.getAttribute("data-folder-toolbar");
      const selectBtn = bar.querySelector("[data-folder-select]");
      const zipBtn = bar.querySelector("[data-folder-zip]");
      const delBtn = bar.querySelector("[data-folder-delete]");
      const renameBtn = bar.querySelector("[data-folder-rename]");
      if (selectBtn) {
        selectBtn.addEventListener("click", () => {
          setFolderSelectMode(folderId, folderSelectId !== folderId);
        });
      }
      if (zipBtn) {
        zipBtn.addEventListener("click", () => {
          if (!selectedFolderCodes.size || folderSelectId !== folderId) return;
          const codes = Array.from(selectedFolderCodes).map(encodeURIComponent).join(",");
          window.location.href = url(
            data.clientAccessApiBase + "/" + folderId + "/photos/download-zip?codes=" + codes
          );
        });
      }
      if (delBtn) {
        delBtn.addEventListener("click", () => {
          if (folderSelectId !== folderId || !selectedFolderCodes.size) return;
          openDelete(Array.from(selectedFolderCodes), { kind: "folder", folderId: folderId });
        });
      }
      if (renameBtn) {
        renameBtn.addEventListener("click", () => {
          if (folderSelectId !== folderId || selectedFolderCodes.size !== 1) return;
          const code = Array.from(selectedFolderCodes)[0];
          openRename(folderPhotoMeta(code), { kind: "folder", folderId: folderId });
        });
      }
    });

    body.querySelectorAll("[data-folder-photo]").forEach((card) => {
      card.addEventListener("click", (e) => {
        const folderId = card.getAttribute("data-folder-photo");
        const code = card.getAttribute("data-code");
        const meta = folderPhotoMeta(code);
        if (folderSelectId === folderId) {
          e.preventDefault();
          if (selectedFolderCodes.has(code)) selectedFolderCodes.delete(code);
          else selectedFolderCodes.add(code);
          card.classList.toggle("selected", selectedFolderCodes.has(code));
          const cb = card.querySelector(".sel-check");
          if (cb) cb.checked = selectedFolderCodes.has(code);
          updateFolderSelectUi(folderId);
          return;
        }
        openLightbox(meta, { kind: "folder", folderId: folderId });
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
  document.getElementById("btnDeletePhotos").addEventListener("click", () => {
    if (!poolSelectMode || !selectedPoolCodes.size) return;
    openDelete(Array.from(selectedPoolCodes), { kind: "pool" });
  });
  document.getElementById("btnRenamePhoto").addEventListener("click", () => {
    if (!poolSelectMode || selectedPoolCodes.size !== 1) return;
    const code = Array.from(selectedPoolCodes)[0];
    const meta = poolMetaFor(code);
    if (meta) openRename(meta, { kind: "pool" });
  });

  async function confirmRename() {
    if (!renameTarget || mutateBusy) return;
    const name = document.getElementById("renameInput").value.trim();
    const errEl = document.getElementById("renameErr");
    if (!name) {
      errEl.textContent = "Enter a file name.";
      errEl.classList.add("show");
      return;
    }
    errEl.classList.remove("show");
    mutateBusy = true;
    try {
      const json = await postJson(mutationApi(renameTarget.scope, "rename"), {
        code: renameTarget.code,
        name: name,
      });
      applyRename(json.previousCode, json.photo);
      renameTarget = null;
      closeModal("renameModal");
      renderPhotoPool();
      renderFolders();
      renderCompletions();
    } catch (err) {
      errEl.textContent = err.message || "Could not rename that photo.";
      errEl.classList.add("show");
    } finally {
      mutateBusy = false;
    }
  }

  async function confirmDelete() {
    if (!deleteTarget || mutateBusy) return;
    const errEl = document.getElementById("deleteErr");
    errEl.classList.remove("show");
    mutateBusy = true;
    const target = deleteTarget;
    try {
      const json = await postJson(mutationApi(target.scope, "delete"), { codes: target.codes });
      removeCodesEverywhere(json.deletedCodes || []);
      deleteTarget = null;
      closeModal("deleteModal");
      renderPhotoPool();
      renderFolders();
      renderCompletions();
    } catch (err) {
      const partial =
        err.payload && Array.isArray(err.payload.deletedCodes) ? err.payload.deletedCodes : [];
      if (partial.length) {
        removeCodesEverywhere(partial);
        target.codes = target.codes.filter((c) => !partial.some((d) => normCode(d) === normCode(c)));
        renderPhotoPool();
        renderFolders();
        renderCompletions();
      }
      if (!target.codes.length) {
        deleteTarget = null;
        closeModal("deleteModal");
        return;
      }
      errEl.textContent = err.message || "Could not delete those photos.";
      errEl.classList.add("show");
      document.getElementById("deleteConfirmText").textContent = deleteConfirmMessage(target.codes.length);
    } finally {
      mutateBusy = false;
    }
  }

  document.getElementById("btnConfirmRename").addEventListener("click", confirmRename);
  document.getElementById("btnCancelRename").addEventListener("click", () => {
    renameTarget = null;
    closeModal("renameModal");
  });
  document.getElementById("btnCloseRenameModal").addEventListener("click", () => {
    renameTarget = null;
    closeModal("renameModal");
  });
  document.getElementById("renameModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      renameTarget = null;
      closeModal("renameModal");
    }
  });
  document.getElementById("renameInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmRename();
    }
  });

  document.getElementById("btnConfirmDelete").addEventListener("click", confirmDelete);
  document.getElementById("btnCancelDelete").addEventListener("click", () => {
    deleteTarget = null;
    closeModal("deleteModal");
  });
  document.getElementById("btnCloseDeleteModal").addEventListener("click", () => {
    deleteTarget = null;
    closeModal("deleteModal");
  });
  document.getElementById("deleteModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
      deleteTarget = null;
      closeModal("deleteModal");
    }
  });

  function closeLb() {
    closeModal("photoLightbox");
  }
  document.getElementById("btnCloseLightbox").addEventListener("click", closeLb);
  document.getElementById("btnLightboxOk").addEventListener("click", closeLb);
  document.getElementById("btnLightboxRename").addEventListener("click", () => {
    if (!lightboxPhoto) return;
    openRename(lightboxPhoto.meta, lightboxPhoto.scope);
  });
  document.getElementById("photoLightbox").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLb();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModal("activityModal");
      closeLb();
      if (document.getElementById("renameModal").classList.contains("open")) {
        renameTarget = null;
        closeModal("renameModal");
      }
      if (document.getElementById("deleteModal").classList.contains("open")) {
        deleteTarget = null;
        closeModal("deleteModal");
      }
      if (document.getElementById("nameModal").classList.contains("open")) {
        pendingExtract = null;
        closeModal("nameModal");
      }
      closeDone();
    }
  });

  let uploadSession = null;
  let gridRefreshTimer = null;
  let lastUploadBatchKey = "";
  let lastUploadBatchAt = 0;

  function scopeKey(scope) {
    return scope && scope.kind === "folder" ? "folder:" + scope.folderId : "pool";
  }

  function uploadApi(scope) {
    if (scope && scope.kind === "folder") {
      return data.clientAccessApiBase + "/" + scope.folderId + "/photos/upload";
    }
    return data.poolUploadApi;
  }

  function uploadTargetLabel(scope) {
    if (scope && scope.kind === "folder") {
      const folder = folders.find((f) => f.id === scope.folderId);
      return folder ? folder.name : "Photo Folder";
    }
    return "Photos Pool";
  }

  function parseClientPhotoName(originalName) {
    const raw = String(originalName || "").trim();
    if (!raw) return { ok: false, error: "That file needs a name." };
    if (/[/\\]/.test(raw) || raw.indexOf("..") !== -1) {
      return { ok: false, error: "File name cannot include a path." };
    }
    const match = raw.match(/(\.[A-Za-z0-9]{1,8})$/);
    if (!match) return { ok: false, error: "Photos must be JPEG, PNG, WebP, or HEIC." };
    const ext = match[1].toLowerCase();
    if (!/^\.(jpe?g|png|webp|heic|heif)$/.test(ext)) {
      return { ok: false, error: "Photos must be JPEG, PNG, WebP, or HEIC." };
    }
    const code = raw.slice(0, -match[1].length).trim();
    if (!code || code === "." || code === "..") return { ok: false, error: "That file needs a name." };
    const storedExt = ext === ".jpeg" ? ".jpg" : ext;
    return { ok: true, code: code, fileName: code + storedExt, key: normCode(code) };
  }

  function photoNameTaken(parsed) {
    const fileName = parsed.fileName.toLowerCase();
    return pool.some(
      (p) => normCode(p.code) === parsed.key || String(p.fileName || "").toLowerCase() === fileName
    );
  }

  function claimedUploadKeys(session) {
    const keys = new Set();
    session.queue.forEach((item) => keys.add(item.key));
    session.inflight.forEach((key) => keys.add(key));
    return keys;
  }

  function scheduleGridRefresh() {
    if (gridRefreshTimer) return;
    renderPhotoPool();
    renderFolders();
    gridRefreshTimer = setTimeout(() => {
      gridRefreshTimer = null;
    }, 500);
  }

  function flushGridRefresh() {
    if (gridRefreshTimer) {
      clearTimeout(gridRefreshTimer);
      gridRefreshTimer = null;
    }
    renderPhotoPool();
    renderFolders();
  }

  function mergeFolderCodes(existing, incoming) {
    const next = Array.isArray(existing) ? existing.slice() : [];
    const have = new Set(next.map(normCode));
    (incoming || []).forEach((code) => {
      const key = normCode(code);
      if (!key || have.has(key)) return;
      next.push(code);
      have.add(key);
    });
    return next;
  }

  function applyUploadedPhoto(photo, scope, file) {
    const next = Object.assign({}, photo);
    if (file) next.thumbUrl = URL.createObjectURL(file);
    const idx = pool.findIndex((p) => normCode(p.code) === normCode(next.code));
    if (idx >= 0) pool[idx] = next;
    else pool.push(next);
    pool.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    if (scope && scope.kind === "folder") {
      const folder = folders.find((f) => f.id === scope.folderId);
      if (folder) {
        folder.photoCodes = mergeFolderCodes(folder.photoCodes, [next.code]);
        folder.contentsLabel = contentsLabelFor(folder);
      }
    }
  }

  function renderUploadStatus() {
    const host = document.getElementById("uploadStatus");
    const summary = document.getElementById("uploadStatusSummary");
    const note = document.getElementById("uploadStatusNote");
    const list = document.getElementById("uploadFailures");
    const retry = document.getElementById("btnUploadRetry");
    const cont = document.getElementById("btnUploadContinue");
    const stop = document.getElementById("btnUploadStop");
    if (!host || !summary || !list) return;
    const session = uploadSession;
    if (!session || (!session.running && !session.uploaded && !session.failed.length && !(session.held && session.held.length) && !session.notice)) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const remaining = session.queue.length + session.inflight.size;
    let text =
      uploadTargetLabel(session.scope) +
      " · " +
      session.uploaded +
      " uploaded · " +
      session.failed.length +
      " failed · " +
      remaining +
      " remaining";
    if (!session.running && session.stopped && session.held.length) text += " · stopped";
    summary.textContent = text;
    if (note) {
      note.hidden = !session.notice;
      note.textContent = session.notice || "";
    }
    if (retry) retry.hidden = session.running || session.failed.length === 0;
    if (cont) cont.hidden = session.running || session.held.length === 0;
    if (stop) stop.hidden = !session.running;
    const shown = session.failed.slice(0, UPLOAD_FAILURES_SHOWN);
    const more = session.failed.length - shown.length;
    list.innerHTML = shown
      .map((item) => "<li><strong>" + escapeHtml(item.name) + "</strong> — " + escapeHtml(item.error) + "</li>")
      .join("");
    if (more > 0) {
      list.innerHTML += "<li>" + more + " more failed. Retry still includes them.</li>";
    }
  }

  function enqueueUploads(session, files) {
    const claimed = claimedUploadKeys(session);
    Array.from(files || []).forEach((file) => {
      const name = file && file.name ? file.name : "Untitled";
      const parsed = parseClientPhotoName(name);
      if (!parsed.ok) {
        session.failed.push({ name: name, error: parsed.error, file: file || null });
        return;
      }
      if (!file.size) {
        session.failed.push({ name: name, error: "That file is empty.", file: file });
        return;
      }
      if (file.size > UPLOAD_MAX_BYTES) {
        const mb = Math.round(UPLOAD_MAX_BYTES / (1024 * 1024));
        session.failed.push({ name: name, error: "That photo is larger than " + mb + " MB.", file: file });
        return;
      }
      if (claimed.has(parsed.key)) {
        session.failed.push({ name: name, error: "That file name is already in this upload.", file: file });
        return;
      }
      if (photoNameTaken(parsed)) {
        session.failed.push({
          name: name,
          error: "A photo with that name already exists in this project.",
          file: file,
        });
        return;
      }
      claimed.add(parsed.key);
      session.queue.push({ file: file, name: name, key: parsed.key });
    });
  }

  function newUploadSession(scope) {
    return {
      scope: scope,
      running: true,
      stopped: false,
      uploaded: 0,
      failed: [],
      queue: [],
      held: [],
      inflight: new Set(),
      notice: "",
    };
  }

  async function uploadOne(session, item) {
    session.inflight.add(item.key);
    const body = new FormData();
    body.append("file", item.file, item.file.name);
    try {
      const res = await fetch(url(uploadApi(session.scope)), {
        method: "POST",
        headers: { Accept: "application/json" },
        body: body,
      });
      let json = {};
      try {
        json = await res.json();
      } catch (err) {
        json = {};
      }
      if (session !== uploadSession) return;
      if (!res.ok || json.ok === false) {
        const fallback = res.status === 403 ? "Admin only." : "Could not upload that photo.";
        session.failed.push({ name: item.name, error: json.error || fallback, file: item.file });
        return;
      }
      session.uploaded += 1;
      applyUploadedPhoto(json.photo, session.scope, item.file);
      if (json.folder && session.scope && session.scope.kind === "folder") {
        const folder = folders.find((f) => f.id === json.folder.id);
        if (folder && Array.isArray(json.folder.photoCodes)) {
          folder.photoCodes = mergeFolderCodes(folder.photoCodes, json.folder.photoCodes);
          folder.contentsLabel = contentsLabelFor(folder);
        }
      }
      scheduleGridRefresh();
    } catch (err) {
      if (session !== uploadSession) return;
      session.failed.push({
        name: item.name,
        error: "Could not upload that photo.",
        file: item.file,
      });
    } finally {
      session.inflight.delete(item.key);
    }
  }

  function settleUpload(session) {
    if (session !== uploadSession) return;
    if (session.inflight.size > 0) return;
    if (session.stopped) {
      session.held = session.held.concat(session.queue);
      session.queue = [];
    }
    if (session.queue.length && !session.stopped) return;
    session.running = false;
    flushGridRefresh();
    renderUploadStatus();
  }

  function pumpUploads(session) {
    if (session !== uploadSession || session.stopped) {
      settleUpload(session);
      return;
    }
    while (session.inflight.size < UPLOAD_CONCURRENCY && session.queue.length) {
      const item = session.queue.shift();
      uploadOne(session, item).then(() => {
        if (session !== uploadSession) return;
        renderUploadStatus();
        if (session.queue.length && !session.stopped) pumpUploads(session);
        else settleUpload(session);
      });
    }
    renderUploadStatus();
    if (!session.queue.length && session.inflight.size === 0) settleUpload(session);
  }

  function startUpload(fileList, scope) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const batchKey =
      scopeKey(scope) +
      ":" +
      files.length +
      ":" +
      files.reduce((sum, file) => sum + (file.size || 0), 0) +
      ":" +
      (files[0] && files[0].name) +
      ":" +
      (files[0] && files[0].lastModified);
    const now = Date.now();
    if (batchKey === lastUploadBatchKey && now - lastUploadBatchAt < 800) return;
    lastUploadBatchKey = batchKey;
    lastUploadBatchAt = now;

    const nextScope = scope && scope.kind === "folder" ? { kind: "folder", folderId: scope.folderId } : { kind: "pool" };
    if (uploadSession && uploadSession.running) {
      if (scopeKey(uploadSession.scope) !== scopeKey(nextScope)) {
        uploadSession.notice = "Finish or stop the current upload before uploading to a different place.";
        renderUploadStatus();
        return;
      }
      uploadSession.notice = "";
      enqueueUploads(uploadSession, files);
      pumpUploads(uploadSession);
      return;
    }
    const session = newUploadSession(nextScope);
    uploadSession = session;
    enqueueUploads(session, files);
    if (!session.queue.length) session.running = false;
    renderUploadStatus();
    const status = document.getElementById("uploadStatus");
    if (status && !status.hidden) status.scrollIntoView({ behavior: "smooth", block: "nearest" });
    pumpUploads(session);
  }

  function uploadScopeFromZone(zone) {
    const folderId = zone && zone.getAttribute("data-folder-id");
    return folderId ? { kind: "folder", folderId: folderId } : { kind: "pool" };
  }

  root.addEventListener("dragenter", (e) => {
    const zone = e.target.closest && e.target.closest("[data-upload-zone]");
    if (!zone || !root.contains(zone)) return;
    e.preventDefault();
    zone.classList.add("dragover");
  });
  root.addEventListener("dragover", (e) => {
    const zone = e.target.closest && e.target.closest("[data-upload-zone]");
    if (!zone || !root.contains(zone)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    zone.classList.add("dragover");
  });
  root.addEventListener("dragleave", (e) => {
    const zone = e.target.closest && e.target.closest("[data-upload-zone]");
    if (!zone || !root.contains(zone)) return;
    if (e.relatedTarget && zone.contains(e.relatedTarget)) return;
    zone.classList.remove("dragover");
  });
  root.addEventListener("drop", (e) => {
    const zone = e.target.closest && e.target.closest("[data-upload-zone]");
    if (!zone || !root.contains(zone)) return;
    e.preventDefault();
    zone.classList.remove("dragover");
    startUpload(e.dataTransfer && e.dataTransfer.files, uploadScopeFromZone(zone));
  });
  root.addEventListener("change", (e) => {
    const input = e.target;
    if (!input.classList || !input.classList.contains("upload-input")) return;
    const zone = input.closest("[data-upload-zone]");
    // Copy first. Clearing the input empties the live FileList.
    const files = Array.from(input.files || []);
    input.value = "";
    startUpload(files, uploadScopeFromZone(zone));
  });

  document.getElementById("btnUploadStop").addEventListener("click", () => {
    if (!uploadSession || !uploadSession.running) return;
    uploadSession.stopped = true;
    uploadSession.notice = "";
    renderUploadStatus();
  });
  document.getElementById("btnUploadContinue").addEventListener("click", () => {
    const session = uploadSession;
    if (!session || session.running || !session.held.length) return;
    session.stopped = false;
    session.running = true;
    session.notice = "";
    session.queue = session.held.slice();
    session.held = [];
    pumpUploads(session);
  });
  document.getElementById("btnUploadRetry").addEventListener("click", () => {
    const session = uploadSession;
    if (!session || session.running || !session.failed.length) return;
    const files = session.failed.map((item) => item.file).filter(Boolean);
    session.failed = [];
    session.stopped = false;
    session.running = true;
    session.notice = "";
    enqueueUploads(session, files);
    if (!session.queue.length) session.running = false;
    pumpUploads(session);
  });

  renderPhotoPool();
  renderFolders();
  renderCompletions();
})();
