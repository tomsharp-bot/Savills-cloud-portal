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

  // Blob and data URIs are already displayable. App paths need the portal prefix.
  function thumbSrc(thumbUrl) {
    const raw = String(thumbUrl || "");
    if (!raw || /^(https?:|data:|blob:)/i.test(raw)) return raw;
    return url(raw);
  }

  let folders = Array.isArray(data.folders) ? data.folders.slice() : [];
  let pool = [];
  const knownPhotos = new Map();
  let poolShowAll = false;
  let poolNextCursor = null;
  let poolTotal = 0;
  let poolMatched = 0;
  let poolWindow = "recent";
  let poolLoading = false;
  let poolLoadError = "";
  let poolRequestId = 0;
  let poolSearchTimer = null;
  let blurMode = false;

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
  let photoShare = data.photoShare || { active: false, activeCount: 0 };
  const folderReplaceText = {};

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

  function poolReplaceTargets() {
    if (poolSelectMode && selectedPoolCodes.size) {
      return { codes: Array.from(selectedPoolCodes), scope: "selected" };
    }
    if (poolSearchQuery.trim()) return { codes: [], scope: "filtered" };
    return { codes: [], scope: "all" };
  }

  function updatePoolReplaceScope() {
    const el = document.getElementById("poolReplaceScope");
    if (!el) return;
    const targets = poolReplaceTargets();
    if (targets.scope === "selected") {
      const n = targets.codes.length;
      const noun = n === 1 ? "photo" : "photos";
      el.textContent =
        "Scope: " + n + " selected " + noun + ". The search box is ignored while photos are selected.";
      return;
    }
    if (targets.scope === "filtered") {
      const n = poolMatched;
      const noun = n === 1 ? "photo" : "photos";
      el.textContent =
        "Scope: " + n + " " + noun + " matching the search. Nothing is selected, so only these are changed.";
      return;
    }
    const n = poolTotal;
    const noun = n === 1 ? "photo" : "photos";
    el.textContent =
      "Scope: all " + n + " " + noun + " in the Photos Pool. Nothing is selected, so every pool photo is included.";
  }

  function folderReplaceTargets(folder) {
    const codes = Array.isArray(folder.photoCodes) ? folder.photoCodes.slice() : [];
    if (folderSelectId === folder.id && selectedFolderCodes.size) {
      return { codes: Array.from(selectedFolderCodes), scope: "selected" };
    }
    return { codes: codes, scope: "all" };
  }

  function folderReplaceScopeLabel(folder) {
    const targets = folderReplaceTargets(folder);
    const n = targets.codes.length;
    const noun = n === 1 ? "photo" : "photos";
    if (targets.scope === "selected") return "Scope: " + n + " selected " + noun + " in this folder.";
    return (
      "Scope: all " +
      n +
      " " +
      noun +
      " in this folder. Nothing is selected, so every photo in the folder is included."
    );
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
    updatePoolReplaceScope();
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

  function codeFieldValue(value) {
    return String(value || "").replace(/\r?\n/g, "");
  }

  function sizeCodeField(field) {
    if (!field || field.tagName !== "TEXTAREA") return;
    if (!field.getClientRects().length) return;
    field.style.overflowY = "hidden";
    field.style.height = "auto";
    const style = window.getComputedStyle(field);
    const line = parseFloat(style.lineHeight) || 16;
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const max = Math.ceil(line * 3 + pad + border);
    const min = Math.ceil(line + pad + border);
    let next = Math.max(field.scrollHeight, min);
    field.style.height = next + "px";
    if (field.scrollHeight > field.clientHeight) {
      next += field.offsetHeight - field.clientHeight;
      field.style.height = next + "px";
    }
    if (next > max) {
      field.style.height = max + "px";
      field.style.overflowY = field.scrollHeight > field.clientHeight + 1 ? "auto" : "hidden";
    }
  }

  function deleteConfirmMessage(n) {
    const noun = n === 1 ? "photo" : "photos";
    return "Delete " + n + " " + noun + "? This cannot be undone.";
  }

  function normCode(code) {
    return String(code || "").trim().toUpperCase();
  }

  function rememberPhoto(photo) {
    if (!photo || !photo.code) return photo;
    knownPhotos.set(normCode(photo.code), photo);
    return photo;
  }

  function poolMetaFor(code) {
    return knownPhotos.get(normCode(code)) || pool.find((p) => normCode(p.code) === normCode(code)) || null;
  }

  function poolImagePath(code) {
    return (
      "/photos/projects/" +
      encodeURIComponent(data.projectId) +
      "/pool/" +
      encodeURIComponent(code) +
      "/image"
    );
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
    if (action === "delete") return data.poolDeleteApi;
    if (action === "replace") return data.poolReplaceApi;
    return data.poolRenameApi;
  }

  function removeCodesEverywhere(codes) {
    const drop = new Set((codes || []).map(normCode));
    let removedVisible = 0;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (drop.has(normCode(pool[i].code))) {
        pool.splice(i, 1);
        removedVisible += 1;
      }
    }
    drop.forEach((key) => knownPhotos.delete(key));
    if (removedVisible) {
      poolTotal = Math.max(0, poolTotal - removedVisible);
      poolMatched = Math.max(0, poolMatched - removedVisible);
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
    knownPhotos.delete(key);
    rememberPhoto(photo);
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
        img.src = thumbSrc(photo.thumbUrl);
        img.alt = photo.fileName;
      }
      const renameInput = document.getElementById("lightboxRenameInput");
      const renameExt = document.getElementById("lightboxRenameExt");
      const renameErr = document.getElementById("lightboxRenameErr");
      if (renameInput) renameInput.value = fileStem(photo.fileName);
      if (renameExt) renameExt.textContent = fileExtension(photo.fileName);
      if (renameErr) renameErr.classList.remove("show");
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
    img.src = thumbSrc(meta.thumbUrl || "");
    img.alt = meta.fileName;
    const renameInput = document.getElementById("lightboxRenameInput");
    const renameExt = document.getElementById("lightboxRenameExt");
    const renameErr = document.getElementById("lightboxRenameErr");
    if (renameInput) renameInput.value = fileStem(meta.fileName || meta.code);
    if (renameExt) renameExt.textContent = fileExtension(meta.fileName || meta.code);
    if (renameErr) renameErr.classList.remove("show");
    resetBlur();
    openModal("photoLightbox");
  }

  function photoCardHtml(meta, options) {
    const selected = !!options.selected;
    const code = options.code || meta.code;
    const fileName = meta.fileName || meta.code;
    const stem = escapeHtml(fileStem(fileName));
    const ext = escapeHtml(fileExtension(fileName));
    const thumb = meta.thumbUrl
      ? '<img class="photo-thumb" src="' + escapeHtml(thumbSrc(meta.thumbUrl)) + '" alt="" loading="lazy" />'
      : '<div class="photo-thumb" aria-hidden="true"></div>';
    const uprn = options.showUprn
      ? '<div class="photo-meta">UPRN ' + escapeHtml(meta.uprn || "") + "</div>"
      : "";
    return (
      '<div class="photo-card' +
      (selected ? " selected" : "") +
      '" role="listitem" data-code="' +
      escapeHtml(code) +
      '"' +
      (options.folderId ? ' data-folder-photo="' + escapeHtml(options.folderId) + '"' : "") +
      ">" +
      '<input type="checkbox" class="sel-check" tabindex="-1" aria-hidden="true"' +
      (selected ? " checked" : "") +
      " />" +
      '<button type="button" class="photo-open" aria-label="' +
      escapeHtml(fileName) +
      '">' +
      thumb +
      "</button>" +
      '<label class="photo-name-edit">' +
      '<span class="visually-hidden">Photo code</span>' +
      '<textarea class="photo-code-input" rows="1" maxlength="140" autocomplete="off" spellcheck="false">' +
      stem +
      "</textarea>" +
      '<span class="photo-code-ext">' +
      ext +
      "</span></label>" +
      uprn +
      "</div>"
    );
  }

  function bindPhotoCard(card, scope) {
    const code = card.getAttribute("data-code");
    const openBtn = card.querySelector(".photo-open");
    const input = card.querySelector(".photo-code-input");
    function activate(e) {
      if (scope.kind === "folder") {
        if (folderSelectId === scope.folderId) {
          e.preventDefault();
          if (selectedFolderCodes.has(code)) selectedFolderCodes.delete(code);
          else selectedFolderCodes.add(code);
          card.classList.toggle("selected", selectedFolderCodes.has(code));
          const cb = card.querySelector(".sel-check");
          if (cb) cb.checked = selectedFolderCodes.has(code);
          updateFolderSelectUi(scope.folderId);
          return;
        }
        openLightbox(folderPhotoMeta(code), scope);
        return;
      }
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
      if (meta) openLightbox(meta, scope);
    }
    if (openBtn) openBtn.addEventListener("click", activate);
    card.addEventListener("click", (e) => {
      if (e.target.closest(".photo-name-edit, .photo-open")) return;
      activate(e);
    });
    if (!input) return;
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    input.addEventListener("click", (e) => e.stopPropagation());
    input.addEventListener("focus", () => {
      input.classList.remove("is-invalid");
      input.removeAttribute("title");
    });
    input.addEventListener("input", () => {
      const clean = codeFieldValue(input.value);
      if (clean !== input.value) {
        const at = input.selectionStart || clean.length;
        input.value = clean;
        const pos = Math.min(at, clean.length);
        input.setSelectionRange(pos, pos);
      }
      sizeCodeField(input);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitCodeEdit(input, code, scope);
      } else if (e.key === "Escape") {
        e.preventDefault();
        const meta = scope.kind === "folder" ? folderPhotoMeta(code) : poolMetaFor(code);
        input.value = meta ? fileStem(meta.fileName || meta.code) : input.value;
        sizeCodeField(input);
        input.dataset.skipCommit = "1";
        input.blur();
      }
    });
    input.addEventListener("blur", () => {
      if (input.dataset.skipCommit === "1") {
        delete input.dataset.skipCommit;
        return;
      }
      commitCodeEdit(input, code, scope);
    });
    sizeCodeField(input);
  }

  async function commitCodeEdit(input, code, scope) {
    if (!input || input.dataset.committing === "1" || mutateBusy) return;
    const meta = scope.kind === "folder" ? folderPhotoMeta(code) : poolMetaFor(code);
    if (!meta) return;
    const stem = fileStem(meta.fileName || meta.code);
    const next = codeFieldValue(input.value).trim();
    if (!next || next === stem) {
      input.value = stem;
      input.classList.remove("is-invalid");
      sizeCodeField(input);
      return;
    }
    input.dataset.committing = "1";
    mutateBusy = true;
    try {
      const json = await postJson(mutationApi(scope, "rename"), { code: meta.code, name: next });
      applyRename(json.previousCode, json.photo);
      renderPhotoPool();
      renderFolders();
      renderCompletions();
    } catch (err) {
      input.value = stem;
      input.classList.add("is-invalid");
      input.title = err.message || "Could not rename that photo.";
      sizeCodeField(input);
    } finally {
      input.dataset.committing = "0";
      mutateBusy = false;
    }
  }

  function renderPhotoPool() {
    const host = document.getElementById("photoPool");
    updatePoolWindowUi();
    if (!host) return;
    if (poolLoading && !pool.length) {
      host.innerHTML = '<p class="hint-muted">Loading photos…</p>';
      updateSelectUi();
      return;
    }
    if (poolLoadError && !pool.length) {
      host.innerHTML = '<p class="hint-muted">' + escapeHtml(poolLoadError) + "</p>";
      updateSelectUi();
      return;
    }
    if (!pool.length) {
      if (poolSearchQuery.trim()) host.innerHTML = '<p class="hint-muted">No photos match that search.</p>';
      else if (!poolShowAll && poolTotal > 0) {
        host.innerHTML = '<p class="hint-muted">No photos added in the last 7 days.</p>';
      } else host.innerHTML = '<p class="hint-muted">No photos in pool.</p>';
      updateSelectUi();
      return;
    }
    host.innerHTML = pool
      .map((meta) =>
        photoCardHtml(meta, {
          selected: selectedPoolCodes.has(meta.code),
          code: meta.code,
          showUprn: true,
        })
      )
      .join("");

    host.querySelectorAll(".photo-card").forEach((card) => {
      bindPhotoCard(card, { kind: "pool" });
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
      thumbUrl: poolImagePath(code),
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
            return photoCardHtml(meta, {
              selected: selecting && selectedFolderCodes.has(code),
              code: code,
              folderId: folder.id,
              showUprn: false,
            });
          })
          .join("")
      : '<span class="hint-muted">Empty folder</span>';
    const savedReplace = folderReplaceText[folder.id] || { find: "", replace: "" };
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
      '<div class="replace-bar folder-replace" data-folder-replace="' +
      escapeHtml(folder.id) +
      '">' +
      '<p class="replace-title">Find and replace in photo codes</p>' +
      '<div class="replace-fields">' +
      '<label>Find this <input type="text" data-folder-find maxlength="120" autocomplete="off" spellcheck="false" placeholder="e.g. 224466" value="' +
      escapeHtml(savedReplace.find) +
      '" /></label>' +
      '<label>Replace with <input type="text" data-folder-replace-with maxlength="120" autocomplete="off" spellcheck="false" placeholder="e.g. 113355" value="' +
      escapeHtml(savedReplace.replace) +
      '" /></label>' +
      '<button type="button" class="btn btn-sm" data-folder-replace-confirm>Confirm</button>' +
      "</div>" +
      '<p class="replace-scope" data-folder-replace-scope>' +
      escapeHtml(folderReplaceScopeLabel(folder)) +
      "</p></div>" +
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
    const folder = folders.find((f) => f.id === folderId);
    const scopeText = document.querySelector(
      '[data-folder-replace="' + CSS.escape(folderId) + '"] [data-folder-replace-scope]'
    );
    if (scopeText && folder) scopeText.textContent = folderReplaceScopeLabel(folder);
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
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-expand");
        expandedFolderId = expandedFolderId === id ? null : id;
        if (folderSelectId && folderSelectId !== expandedFolderId) {
          folderSelectId = null;
          selectedFolderCodes.clear();
        }
        if (expandedFolderId) {
          const folder = folders.find((f) => f.id === expandedFolderId);
          if (folder) await ensureKnownPhotos(folder.photoCodes);
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
      const folderId = card.getAttribute("data-folder-photo");
      bindPhotoCard(card, { kind: "folder", folderId: folderId });
    });

    body.querySelectorAll("[data-folder-replace]").forEach((bar) => {
      const folderId = bar.getAttribute("data-folder-replace");
      const findInput = bar.querySelector("[data-folder-find]");
      const replaceInput = bar.querySelector("[data-folder-replace-with]");
      const confirmBtn = bar.querySelector("[data-folder-replace-confirm]");
      function remember() {
        folderReplaceText[folderId] = {
          find: findInput ? findInput.value : "",
          replace: replaceInput ? replaceInput.value : "",
        };
      }
      if (findInput) findInput.addEventListener("input", remember);
      if (replaceInput) replaceInput.addEventListener("input", remember);
      if (confirmBtn) {
        confirmBtn.addEventListener("click", () => {
          remember();
          const folder = folders.find((f) => f.id === folderId);
          if (!folder) return;
          const targets = folderReplaceTargets(folder);
          runReplace(
            { kind: "folder", folderId: folderId },
            targets.codes,
            folderReplaceScopeLabel(folder),
            folderReplaceText[folderId].find,
            folderReplaceText[folderId].replace
          );
        });
      }
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
    updatePoolReplaceScope();
    if (poolSearchTimer) clearTimeout(poolSearchTimer);
    poolSearchTimer = setTimeout(() => {
      poolSearchTimer = null;
      loadPool(true);
    }, 250);
  });
  const showAllBtn = document.getElementById("btnPoolShowAll");
  if (showAllBtn) {
    showAllBtn.addEventListener("click", () => {
      if (poolSearchQuery.trim()) return;
      poolShowAll = !poolShowAll;
      loadPool(true);
    });
  }
  const loadMoreBtn = document.getElementById("btnPoolLoadMore");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      if (!poolNextCursor || poolLoading) return;
      loadPool(false);
    });
  }
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
    resetBlur();
    closeModal("photoLightbox");
  }
  document.getElementById("btnCloseLightbox").addEventListener("click", closeLb);
  document.getElementById("btnLightboxOk").addEventListener("click", closeLb);
  document.getElementById("btnLightboxRename").addEventListener("click", () => {
    const input = document.getElementById("lightboxRenameInput");
    if (!input) return;
    input.focus();
    input.select();
  });
  document.getElementById("lightboxRenameForm").addEventListener("submit", (e) => {
    e.preventDefault();
    confirmLightboxRename();
  });

  async function confirmLightboxRename() {
    if (!lightboxPhoto || mutateBusy) return;
    const input = document.getElementById("lightboxRenameInput");
    const errEl = document.getElementById("lightboxRenameErr");
    const name = input ? input.value.trim() : "";
    if (!name) {
      errEl.textContent = "Enter a file name.";
      errEl.classList.add("show");
      return;
    }
    errEl.classList.remove("show");
    mutateBusy = true;
    try {
      const json = await postJson(mutationApi(lightboxPhoto.scope, "rename"), {
        code: lightboxPhoto.meta.code,
        name: name,
      });
      applyRename(json.previousCode, json.photo);
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

  async function runReplace(scope, codes, scopeLabel, find, replaceWith) {
    const findText = String(find || "").trim();
    const replaceText = String(replaceWith || "").trim();
    if (!findText) {
      window.alert("Enter the text to find.");
      return;
    }
    if (!codes.length) {
      window.alert("No photos to change.");
      return;
    }
    const noun = codes.length === 1 ? "photo" : "photos";
    const withText = replaceText ? '"' + replaceText + '"' : "(nothing)";
    const ok = window.confirm(
      'Replace "' +
        findText +
        '" with ' +
        withText +
        " in " +
        codes.length +
        " " +
        noun +
        "?\n\n" +
        scopeLabel +
        "\n\nPhotos that would clash with an existing name are skipped."
    );
    if (!ok || mutateBusy) return;
    mutateBusy = true;
    try {
      const json = await postJson(mutationApi(scope, "replace"), {
        find: findText,
        replace: replaceText,
        codes: codes,
      });
      (json.renamed || []).forEach((row) => {
        if (row && row.photo) applyRename(row.from, row.photo);
      });
      renderPhotoPool();
      renderFolders();
      renderCompletions();
      showReplaceResult(json);
    } catch (err) {
      window.alert(err.message || "Could not replace those photo codes.");
    } finally {
      mutateBusy = false;
    }
  }

  function showReplaceResult(json) {
    const renamed = Number(json.renamedCount || (json.renamed || []).length || 0);
    const skipped = Array.isArray(json.skipped) ? json.skipped : [];
    const summary = document.getElementById("replaceResultSummary");
    const list = document.getElementById("replaceResultSkipped");
    const noun = renamed === 1 ? "photo" : "photos";
    if (summary) summary.textContent = "Renamed " + renamed + " " + noun + ".";
    if (list) {
      const shown = skipped.slice(0, 8);
      list.innerHTML = shown
        .map((row) => "<li>" + escapeHtml(row.code) + " — " + escapeHtml(row.reason) + "</li>")
        .join("");
      if (skipped.length > shown.length) {
        list.innerHTML += "<li>and " + (skipped.length - shown.length) + " more.</li>";
      }
      if (!skipped.length) list.innerHTML = "";
    }
    openModal("replaceResultModal");
  }

  function formatShareDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function updateShareUi() {
    const status = document.getElementById("photoShareStatus");
    const btn = document.getElementById("btnPhotoShare");
    const revoke = document.getElementById("btnPhotoShareRevoke");
    const active = !!(photoShare && photoShare.active);
    if (btn) btn.textContent = active ? "Copy a new photo sharing code" : "Get photo sharing code";
    if (revoke) revoke.hidden = !active;
    if (!status) return;
    if (!active) {
      status.textContent = "No photo sharing code is active.";
      return;
    }
    const when = formatShareDate(photoShare.expiresAt);
    const n = photoShare.activeCount || 1;
    status.textContent =
      n > 1
        ? n +
          " codes are active. The latest runs until " +
          when +
          ". Revoke stops every current code. Copy a new code if you need to paste one again — the old code is not stored."
        : "A code is active until " +
          when +
          ". The code itself was shown once. Copy a new code if you need to paste it again — that stops the current one.";
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      return false;
    }
    return false;
  }

  async function showShareAddress(address, byCodeExample) {
    const input = document.getElementById("shareAddress");
    const hint = document.getElementById("shareByCodeHint");
    const note = document.getElementById("shareCopyNote");
    if (input) input.value = address;
    if (hint) {
      hint.textContent = byCodeExample
        ? "Excel calls " + byCodeExample + " for that photo code."
        : "Excel adds /by-code/ and the photo code to this address.";
    }
    const copied = await copyText(address);
    if (note) {
      note.textContent = copied
        ? "Copied. Paste it into Data Horizontal DW!F1."
        : "Select the address and copy it into Data Horizontal DW!F1.";
    }
    openModal("shareModal");
    if (input) {
      input.focus();
      input.select();
    }
  }

  async function issueShare(replaceExisting) {
    if (mutateBusy) return;
    if (replaceExisting) {
      const ok = window.confirm(
        "This issues a new photo sharing code and stops the current one. Excel workbooks still using the old code will no longer load photos. Continue?"
      );
      if (!ok) return;
    }
    mutateBusy = true;
    try {
      const json = await postJson(data.photoShareApi + (replaceExisting ? "/renew" : ""), {});
      photoShare = { active: true, activeCount: 1, expiresAt: json.expiresAt };
      updateShareUi();
      await showShareAddress(json.address, json.byCodeExample);
    } catch (err) {
      window.alert(err.message || "Could not create a photo sharing code.");
    } finally {
      mutateBusy = false;
    }
  }

  async function revokeShare() {
    if (mutateBusy) return;
    const ok = window.confirm("Revoke the photo sharing code? Excel will no longer be able to load photos with it.");
    if (!ok) return;
    mutateBusy = true;
    try {
      await postJson(data.photoShareApi + "/revoke", {});
      photoShare = { active: false, activeCount: 0 };
      updateShareUi();
    } catch (err) {
      window.alert(err.message || "Could not revoke the photo sharing code.");
    } finally {
      mutateBusy = false;
    }
  }

  function closeShareModal() {
    closeModal("shareModal");
  }
  document.getElementById("btnPhotoShare").addEventListener("click", () => {
    issueShare(!!(photoShare && photoShare.active));
  });
  document.getElementById("btnPhotoShareRevoke").addEventListener("click", revokeShare);
  document.getElementById("btnShareClose").addEventListener("click", closeShareModal);
  document.getElementById("btnCloseShareModal").addEventListener("click", closeShareModal);
  document.getElementById("btnShareCopyAgain").addEventListener("click", async () => {
    const input = document.getElementById("shareAddress");
    const note = document.getElementById("shareCopyNote");
    const address = input ? input.value : "";
    const copied = await copyText(address);
    if (note) note.textContent = copied ? "Copied." : "Select the address and copy it.";
    if (input) input.select();
  });
  document.getElementById("shareModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeShareModal();
  });

  document.getElementById("btnPoolReplace").addEventListener("click", async () => {
    const targets = poolReplaceTargets();
    const scopeEl = document.getElementById("poolReplaceScope");
    let codes = targets.codes;
    if (targets.scope !== "selected") {
      try {
        const listed = await fetchReplaceCodes();
        if (listed.truncated) {
          window.alert("Too many photos to change at once. Select the photos, or search to narrow the list.");
          return;
        }
        codes = listed.codes || [];
      } catch (err) {
        window.alert(err.message || "Could not list those photos.");
        return;
      }
    }
    runReplace(
      { kind: "pool" },
      codes,
      scopeEl ? scopeEl.textContent : "",
      document.getElementById("poolFind").value,
      document.getElementById("poolReplaceWith").value
    );
  });

  function closeReplaceResult() {
    closeModal("replaceResultModal");
  }
  document.getElementById("btnReplaceResultOk").addEventListener("click", closeReplaceResult);
  document.getElementById("btnCloseReplaceResult").addEventListener("click", closeReplaceResult);
  document.getElementById("replaceResultModal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeReplaceResult();
  });

  updateShareUi();
  document.getElementById("photoLightbox").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeLb();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (blurMode) {
        cancelBlur();
        return;
      }
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
      closeShareModal();
      closeReplaceResult();
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
    if (knownPhotos.has(parsed.key)) return true;
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

  function photoBelongsInView(photo) {
    if (poolSearchQuery.trim()) return matchesPoolSearch(photo, poolSearchQuery);
    return true;
  }

  function applyUploadedPhoto(photo, scope, file) {
    const next = Object.assign({}, photo);
    if (file) next.thumbUrl = URL.createObjectURL(file);
    rememberPhoto(next);
    const idx = pool.findIndex((p) => normCode(p.code) === normCode(next.code));
    if (idx >= 0) pool[idx] = next;
    else if (photoBelongsInView(next)) {
      pool.push(next);
      pool.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
      poolTotal += 1;
      poolMatched += 1;
    } else {
      poolTotal += 1;
    }
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

  function updatePoolWindowUi() {
    const status = document.getElementById("poolWindowStatus");
    const toggle = document.getElementById("btnPoolShowAll");
    const more = document.getElementById("btnPoolLoadMore");
    const searching = !!poolSearchQuery.trim();
    if (status) {
      if (searching) {
        const noun = poolMatched === 1 ? "photo" : "photos";
        status.textContent = "Showing " + poolMatched + " " + noun + " matching the search in the whole pool";
      } else if (poolShowAll) {
        status.textContent = "Showing all photos — " + poolTotal;
      } else {
        status.textContent =
          "Showing photos added in the last 7 days — " + poolMatched + " of " + poolTotal;
      }
    }
    if (toggle) {
      toggle.disabled = searching && !!poolSearchQuery.trim();
      toggle.setAttribute("aria-pressed", poolShowAll && !poolSearchQuery.trim() ? "true" : "false");
      toggle.textContent = poolShowAll && !poolSearchQuery.trim() ? "Show last 7 days" : "Show all";
      toggle.title = poolSearchQuery.trim() ? "Search already covers the whole Photos Pool." : "";
    }
    if (more) {
      more.hidden = !poolNextCursor;
      more.disabled = poolLoading;
    }
  }

  function poolFetchParams(extra) {
    const params = new URLSearchParams();
    if (extra && extra.codes) {
      params.set("codes", extra.codes);
      return params;
    }
    if (extra && extra.view) params.set("view", extra.view);
    const q = poolSearchQuery.trim();
    if (q) params.set("q", q);
    else params.set("window", poolShowAll ? "all" : "recent");
    if (extra && extra.cursor) params.set("cursor", extra.cursor);
    return params;
  }

  async function loadPool(reset) {
    if (!data.poolQueryApi) return;
    const id = ++poolRequestId;
    poolLoading = true;
    poolLoadError = "";
    const cursor = reset ? "" : poolNextCursor || "";
    if (reset) poolNextCursor = null;
    updatePoolWindowUi();
    const params = poolFetchParams(cursor ? { cursor: cursor } : null);
    try {
      const res = await fetch(url(data.poolQueryApi + "?" + params.toString()), {
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => ({}));
      if (id !== poolRequestId) return;
      if (!res.ok) throw new Error(json.error || "Could not load photos.");
      const photos = Array.isArray(json.photos) ? json.photos : [];
      photos.forEach(rememberPhoto);
      if (reset) pool = photos.slice();
      else {
        const have = new Set(pool.map((p) => normCode(p.code)));
        photos.forEach((p) => {
          if (!have.has(normCode(p.code))) pool.push(p);
        });
      }
      poolTotal = Number(json.total) || 0;
      poolMatched = Number(json.matched) || 0;
      poolWindow = json.window || (poolSearchQuery.trim() ? "search" : poolShowAll ? "all" : "recent");
      poolNextCursor = json.nextCursor || null;
    } catch (err) {
      if (id !== poolRequestId) return;
      poolNextCursor = null;
      poolLoadError = err.message || "Could not load photos.";
      if (reset) pool = [];
    } finally {
      if (id === poolRequestId) {
        poolLoading = false;
        renderPhotoPool();
      }
    }
  }

  async function fetchReplaceCodes() {
    const params = new URLSearchParams();
    params.set("view", "codes");
    if (poolSearchQuery.trim()) params.set("q", poolSearchQuery.trim());
    else params.set("window", "all");
    const res = await fetch(url(data.poolQueryApi + "?" + params.toString()), {
      headers: { Accept: "application/json" },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Could not list those photos.");
    return json;
  }

  async function ensureKnownPhotos(codes) {
    const missing = (codes || []).filter((code) => code && !poolMetaFor(code));
    if (!missing.length || !data.poolQueryApi) return;
    const params = new URLSearchParams();
    params.set("codes", missing.slice(0, 200).join(","));
    try {
      const res = await fetch(url(data.poolQueryApi + "?" + params.toString()), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      (json.photos || []).forEach(rememberPhoto);
    } catch (err) {
      return;
    }
  }

  let blurRects = [];
  let blurDrag = null;
  let blurSource = null;
  let blurBusy = false;

  function showBlurError(message) {
    const errEl = document.getElementById("lightboxBlurErr");
    if (!errEl) return;
    errEl.textContent = message || "Could not blur that photo.";
    errEl.classList.add("show");
  }

  function updateBlurButtons() {
    const start = document.getElementById("btnBlurStart");
    const undo = document.getElementById("btnBlurUndo");
    const cancel = document.getElementById("btnBlurCancel");
    const save = document.getElementById("btnBlurSave");
    if (start) start.hidden = blurMode;
    if (undo) undo.hidden = !blurMode;
    if (cancel) cancel.hidden = !blurMode;
    if (save) {
      save.hidden = !blurMode;
      save.disabled = blurBusy || blurRects.length === 0;
    }
  }

  function cancelBlur() {
    blurMode = false;
    blurRects = [];
    blurDrag = null;
    blurSource = null;
    const canvas = document.getElementById("lightboxBlurCanvas");
    const frame = document.getElementById("lightboxFrame");
    if (frame) frame.classList.remove("is-blurring");
    if (canvas) {
      canvas.hidden = true;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    updateBlurButtons();
  }

  function resetBlur() {
    const errEl = document.getElementById("lightboxBlurErr");
    if (errEl) errEl.classList.remove("show");
    cancelBlur();
  }

  function blurExportType(fileName) {
    const ext = fileExtension(fileName).toLowerCase();
    if (ext === ".png") return { type: "image/png" };
    if (ext === ".webp") return { type: "image/webp", quality: 0.95 };
    if (ext === ".jpg" || ext === ".jpeg") return { type: "image/jpeg", quality: 0.95 };
    return null;
  }

  function blurBlockSize(width, height) {
    return Math.max(18, Math.round(Math.min(width, height) / 32));
  }

  function normalizeRect(rect) {
    const w = rect.w || 0;
    const h = rect.h || 0;
    return {
      x: w < 0 ? rect.x + w : rect.x,
      y: h < 0 ? rect.y + h : rect.y,
      w: Math.abs(w),
      h: Math.abs(h),
    };
  }

  function pixelateRect(ctx, source, rect) {
    const box = normalizeRect(rect);
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const w = Math.min(source.width - x, Math.ceil(box.w));
    const h = Math.min(source.height - y, Math.ceil(box.h));
    if (w < 2 || h < 2) return;
    const block = blurBlockSize(source.width, source.height);
    const tw = Math.max(1, Math.floor(w / block));
    const th = Math.max(1, Math.floor(h / block));
    const tmp = document.createElement("canvas");
    tmp.width = tw;
    tmp.height = th;
    const tctx = tmp.getContext("2d");
    if (!tctx) return;
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(source, x, y, w, h, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  function strokeBlurRect(ctx, rect) {
    const box = normalizeRect(rect);
    ctx.save();
    ctx.strokeStyle = "#f4c400";
    ctx.lineWidth = Math.max(2, Math.round(Math.min(ctx.canvas.width, ctx.canvas.height) / 400));
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  }

  function redrawBlur() {
    const canvas = document.getElementById("lightboxBlurCanvas");
    if (!canvas || !blurSource) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(blurSource, 0, 0);
    blurRects.forEach((rect) => pixelateRect(ctx, blurSource, rect));
    if (blurDrag) {
      pixelateRect(ctx, blurSource, blurDrag);
      strokeBlurRect(ctx, blurDrag);
    }
  }

  function blurPoint(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / (rect.width || 1),
      y: ((event.clientY - rect.top) * canvas.height) / (rect.height || 1),
    };
  }

  async function orientedBitmap(blob) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(blob, { imageOrientation: "from-image" });
      } catch (err) {
        try {
          return await createImageBitmap(blob);
        } catch (err2) {
          /* draw via an Image element, which also respects EXIF in current browsers */
        }
      }
    }
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read that photo."));
      };
      img.src = objectUrl;
    });
  }

  async function startBlur() {
    if (!lightboxPhoto || blurBusy || blurMode) return;
    const meta = lightboxPhoto.meta;
    const errEl = document.getElementById("lightboxBlurErr");
    if (errEl) errEl.classList.remove("show");
    if (!meta.spacesKey) {
      showBlurError("This photo has no stored image to blur.");
      return;
    }
    if (!blurExportType(meta.fileName || meta.code)) {
      showBlurError("This photo format cannot be blurred in the browser.");
      return;
    }
    blurBusy = true;
    updateBlurButtons();
    try {
      const src = thumbSrc(meta.thumbUrl || poolImagePath(meta.code));
      const res = await fetch(src, { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) throw new Error("Could not load that photo.");
      const blob = await res.blob();
      const bitmap = await orientedBitmap(blob);
      const source = document.createElement("canvas");
      source.width = bitmap.width || bitmap.naturalWidth;
      source.height = bitmap.height || bitmap.naturalHeight;
      if (!source.width || !source.height) throw new Error("Could not read that photo.");
      const sourceCtx = source.getContext("2d");
      if (!sourceCtx) throw new Error("Could not blur that photo.");
      sourceCtx.drawImage(bitmap, 0, 0);
      if (typeof bitmap.close === "function") bitmap.close();
      blurSource = source;
      const canvas = document.getElementById("lightboxBlurCanvas");
      canvas.width = source.width;
      canvas.height = source.height;
      canvas.hidden = false;
      const frame = document.getElementById("lightboxFrame");
      if (frame) frame.classList.add("is-blurring");
      blurMode = true;
      blurRects = [];
      blurDrag = null;
      redrawBlur();
    } catch (err) {
      showBlurError(err.message || "Could not load that photo.");
      cancelBlur();
    } finally {
      blurBusy = false;
      updateBlurButtons();
    }
  }

  async function saveBlur() {
    if (!lightboxPhoto || !blurMode || blurBusy || !blurRects.length) return;
    const confirmed = window.confirm("This replaces the stored photo; the unblurred version will not be kept");
    if (!confirmed) return;
    const meta = lightboxPhoto.meta;
    const exportType = blurExportType(meta.fileName || meta.code);
    const canvas = document.getElementById("lightboxBlurCanvas");
    if (!exportType || !canvas) {
      showBlurError("This photo format cannot be blurred in the browser.");
      return;
    }
    blurBusy = true;
    updateBlurButtons();
    try {
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (out) => (out ? resolve(out) : reject(new Error("Could not blur that photo."))),
          exportType.type,
          exportType.quality
        );
      });
      const body = new FormData();
      body.append("file", blob, meta.fileName || "photo.jpg");
      const res = await fetch(url(data.poolQueryApi + "/" + encodeURIComponent(meta.code) + "/blur"), {
        method: "POST",
        headers: { Accept: "application/json" },
        body: body,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Could not save that blur.");
      const photo = json.photo || meta;
      if (photo.thumbUrl && String(photo.thumbUrl).indexOf("v=") === -1) {
        photo.thumbUrl += (String(photo.thumbUrl).indexOf("?") === -1 ? "?" : "&") + "v=" + Date.now();
      }
      applyRename(meta.code, photo);
      const img = document.getElementById("lightboxImg");
      if (img && photo.thumbUrl) img.src = thumbSrc(photo.thumbUrl);
      cancelBlur();
      renderPhotoPool();
      renderFolders();
    } catch (err) {
      showBlurError(err.message || "Could not save that blur.");
    } finally {
      blurBusy = false;
      updateBlurButtons();
    }
  }

  const blurStartBtn = document.getElementById("btnBlurStart");
  if (blurStartBtn) blurStartBtn.addEventListener("click", () => startBlur());
  const blurUndoBtn = document.getElementById("btnBlurUndo");
  if (blurUndoBtn) {
    blurUndoBtn.addEventListener("click", () => {
      if (!blurMode || blurBusy) return;
      blurRects.pop();
      redrawBlur();
      updateBlurButtons();
    });
  }
  const blurCancelBtn = document.getElementById("btnBlurCancel");
  if (blurCancelBtn) blurCancelBtn.addEventListener("click", () => cancelBlur());
  const blurSaveBtn = document.getElementById("btnBlurSave");
  if (blurSaveBtn) blurSaveBtn.addEventListener("click", () => saveBlur());

  const blurCanvas = document.getElementById("lightboxBlurCanvas");
  if (blurCanvas) {
    blurCanvas.addEventListener("pointerdown", (event) => {
      if (!blurMode || blurBusy) return;
      try {
        blurCanvas.setPointerCapture(event.pointerId);
      } catch (err) {
        /* A pointer that is already gone should still start the rectangle. */
      }
      const point = blurPoint(event, blurCanvas);
      blurDrag = { x: point.x, y: point.y, w: 0, h: 0 };
    });
    blurCanvas.addEventListener("pointermove", (event) => {
      if (!blurDrag) return;
      const point = blurPoint(event, blurCanvas);
      blurDrag.w = point.x - blurDrag.x;
      blurDrag.h = point.y - blurDrag.y;
      redrawBlur();
    });
    function finishBlurDrag() {
      if (!blurDrag) return;
      const box = normalizeRect(blurDrag);
      blurDrag = null;
      if (box.w >= 8 && box.h >= 8) blurRects.push(box);
      redrawBlur();
      updateBlurButtons();
    }
    blurCanvas.addEventListener("pointerup", finishBlurDrag);
    blurCanvas.addEventListener("pointercancel", () => {
      blurDrag = null;
      redrawBlur();
    });
  }

  loadPool(true);
  renderFolders();
  renderCompletions();
})();
