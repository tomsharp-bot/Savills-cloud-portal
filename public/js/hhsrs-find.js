(function () {
  function $(id) {
    return document.getElementById(id);
  }

  document.querySelectorAll("tr.find-result").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target.closest("a, button")) return;
      var href = row.getAttribute("data-href");
      if (href) window.location.href = href;
    });
  });

  var close = $("fr-close");
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && close && $("fr-drawer")) window.location.href = close.href;
  });

  var dataEl = $("fr-amend-data");
  if (!dataEl) return;
  var data = {};
  try { data = JSON.parse(dataEl.textContent || "{}"); } catch (err) { data = {}; }
  var previous = data.previous || {};
  var extras = Array.isArray(data.extras) ? data.extras : [];
  var prose = Array.isArray(data.prose) ? data.prose : [];
  var previousSubject = data.previousSubject || "";

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function val(id) {
    var el = $(id);
    return el ? String(el.value || "").replace(/\s+/g, " ").trim() : "";
  }

  function correctionSubject(subject) {
    var rest = String(subject || "").replace(/^(?:correction:\s*)+/i, "").trim();
    return rest ? "CORRECTION: " + rest : "CORRECTION:";
  }

  var fields = [
    ["f-address", "address", "Address"],
    ["f-uprn", "uprn", "UPRN"],
    ["f-hazard", "hazard", "Hazard"],
    ["f-rating", "rating", "Rating"],
    ["f-notes", "notes", "Site notes"],
    ["f-date", "surveyDate", "Survey date"]
  ];

  function keptPhotoNames() {
    var names = [];
    document.querySelectorAll("#fr-photo-list figure.amend-photo[data-photo-name]").forEach(function (card) {
      var name = String(card.getAttribute("data-photo-name") || "").trim();
      if (name) names.push(name);
    });
    return names;
  }

  function photoKeySet(list) {
    var set = {};
    (list || []).forEach(function (name) {
      var key = String(name || "").trim();
      if (key) set[key] = true;
    });
    return set;
  }

  var previousPhotos = keptPhotoNames();

  function photosChanged() {
    if (pending.length) return true;
    var before = photoKeySet(previousPhotos);
    var after = photoKeySet(keptPhotoNames());
    var beforeKeys = Object.keys(before);
    var afterKeys = Object.keys(after);
    if (beforeKeys.length !== afterKeys.length) return true;
    for (var i = 0; i < beforeKeys.length; i++) {
      if (!after[beforeKeys[i]]) return true;
    }
    return false;
  }

  function paint() {
    var subject = correctionSubject(previousSubject);
    var oldHead = String(previous.address || "").split(",")[0].trim();
    var newHead = val("f-address").split(",")[0].trim();
    if (oldHead && newHead && oldHead !== newHead && subject.indexOf(oldHead) !== -1) {
      subject = subject.replace(oldHead, newHead);
    }
    var title = $("fr-preview-subject");
    if (title) title.innerHTML = "<b>" + esc(subject) + "</b>";
    var intro = "Please disregard our previous email, due to an error. See correct details below.";
    var html = "<p>" + esc(intro) + "</p>";
    if (photosChanged()) html += "<p><b>The photo was incorrect.</b></p>";
    html += "<p>Hi all,</p>";
    prose.forEach(function (line) { html += "<p>" + esc(line) + "</p>"; });
    var items = "";
    fields.forEach(function (field) {
      var value = val(field[0]);
      var before = String(previous[field[1]] || "");
      if (!before && !value) return;
      var shown = value === before ? esc(value) : "<b>" + esc(value) + "</b>";
      items += "<li>" + esc(field[2]) + ": " + shown + "</li>";
    });
    extras.forEach(function (extra) {
      items += "<li>" + esc(extra.label) + ": " + esc(extra.value) + "</li>";
    });
    if (items) html += "<ul>" + items + "</ul>";
    var copy = $("fr-preview-copy");
    if (copy) copy.innerHTML = html;
  }

  var checked = $("fr-checked");
  var photoChecked = $("fr-photo-checked");
  var send = $("btn-send-correction");
  function bothTicked() {
    return Boolean(checked && checked.checked && photoChecked && photoChecked.checked);
  }
  function syncSend() {
    if (send) send.disabled = !bothTicked();
  }
  if (checked) checked.addEventListener("change", syncSend);
  if (photoChecked) photoChecked.addEventListener("change", syncSend);

  var pending = [];
  var nextNewId = 1;

  function refreshOpenPreview() {
    if (previewWrap && !previewWrap.hidden) paint();
  }
  var syncingFiles = false;
  var MAX_NEW_PHOTOS = 4;

  function setPhotoMsg(text) {
    var msg = $("fr-photo-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.hidden = !text;
  }

  function isPhotoFile(file) {
    var type = String((file && file.type) || "").toLowerCase();
    if (/^image\/(jpeg|jpg|png|webp|heic|heif)/.test(type)) return true;
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(String((file && file.name) || ""));
  }

  function syncPreviewPhotos() {
    var box = $("fr-preview-photos");
    if (!box) return;
    box.hidden = box.children.length === 0;
  }

  function previewFigure(attr, value, src) {
    var fig = document.createElement("figure");
    fig.className = "photo-zoom";
    fig.setAttribute(attr, value);
    var art = document.createElement("div");
    art.className = "art";
    var img = document.createElement("img");
    img.src = src;
    img.alt = "Photo";
    art.appendChild(img);
    fig.appendChild(art);
    return fig;
  }

  function removePreview(attr, value) {
    var box = $("fr-preview-photos");
    if (!box) return;
    Array.prototype.forEach.call(box.children, function (node) {
      if (node.getAttribute && node.getAttribute(attr) === value) node.remove();
    });
    syncPreviewPhotos();
  }

  function syncFiles() {
    var input = $("fr-photo-file");
    if (!input || typeof DataTransfer === "undefined") return;
    syncingFiles = true;
    try {
      var dt = new DataTransfer();
      pending.forEach(function (item) { dt.items.add(item.file); });
      input.files = dt.files;
    } catch (err) {
      // The browser keeps the last file the input already held.
    }
    syncingFiles = false;
  }

  function appendNewCard(id, url) {
    var list = $("fr-photo-list");
    if (!list) return;
    var fig = document.createElement("figure");
    fig.className = "amend-photo";
    fig.setAttribute("data-new-id", id);
    var rem = document.createElement("button");
    rem.type = "button";
    rem.className = "photo-remove";
    rem.setAttribute("data-remove-photo", "");
    rem.setAttribute("aria-label", "Remove photo");
    rem.textContent = "×";
    var art = document.createElement("div");
    art.className = "art";
    var img = document.createElement("img");
    img.src = url;
    img.alt = "Photo";
    art.appendChild(img);
    fig.appendChild(rem);
    fig.appendChild(art);
    list.appendChild(fig);
    var box = $("fr-preview-photos");
    if (box) box.appendChild(previewFigure("data-new-id", id, url));
    syncPreviewPhotos();
  }

  function addFiles(fileList) {
    if (!fileList || !fileList.length) return;
    var rejected = false;
    var capped = false;
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (!file) continue;
      if (pending.length >= MAX_NEW_PHOTOS) {
        capped = true;
        break;
      }
      if (!isPhotoFile(file)) {
        rejected = true;
        continue;
      }
      var id = "new-" + nextNewId;
      nextNewId += 1;
      var url = URL.createObjectURL(file);
      pending.push({ id: id, file: file, url: url });
      appendNewCard(id, url);
    }
    if (capped) setPhotoMsg("Add up to 4 photos.");
    else if (rejected) setPhotoMsg("Photos must be JPEG, PNG, WebP or HEIC.");
    else setPhotoMsg("");
    syncFiles();
    refreshOpenPreview();
  }

  var photoList = $("fr-photo-list");
  if (photoList) {
    photoList.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-remove-photo]");
      if (!btn || !photoList.contains(btn)) return;
      var card = btn.closest(".amend-photo");
      if (!card) return;
      var name = card.getAttribute("data-photo-name");
      var newId = card.getAttribute("data-new-id");
      if (newId) {
        var kept = [];
        pending.forEach(function (item) {
          if (item.id === newId) URL.revokeObjectURL(item.url);
          else kept.push(item);
        });
        pending = kept;
        syncFiles();
        removePreview("data-new-id", newId);
      }
      if (name) removePreview("data-photo-name", name);
      card.remove();
      setPhotoMsg("");
      refreshOpenPreview();
    });
  }

  var fileInput = $("fr-photo-file");
  if (fileInput) {
    fileInput.addEventListener("change", function () {
      if (syncingFiles) return;
      addFiles(fileInput.files);
    });
  }

  var dropzone = $("fr-photo-drop");
  if (dropzone) {
    dropzone.addEventListener("dragenter", function (event) {
      event.preventDefault();
      dropzone.classList.add("is-dragover");
    });
    dropzone.addEventListener("dragover", function (event) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      dropzone.classList.add("is-dragover");
    });
    dropzone.addEventListener("dragleave", function () {
      dropzone.classList.remove("is-dragover");
    });
    dropzone.addEventListener("drop", function (event) {
      event.preventDefault();
      dropzone.classList.remove("is-dragover");
      addFiles(event.dataTransfer && event.dataTransfer.files);
    });
  }
  var previewWrap = $("fr-preview-wrap");
  var generate = $("btn-generate-correction");
  function showPreview() {
    if (previewWrap) previewWrap.hidden = false;
    paint();
    if (previewWrap && previewWrap.scrollIntoView) previewWrap.scrollIntoView({ block: "start" });
  }
  if (generate) generate.addEventListener("click", showPreview);
  document.querySelectorAll("#fr-amend input, #fr-amend select").forEach(function (el) {
    if (el.id === "fr-checked" || el.id === "fr-photo-checked" || el.id === "fr-photo-file" || el.id === "btn-generate-correction") return;
    el.addEventListener("input", function () {
      if (previewWrap && !previewWrap.hidden) paint();
    });
    el.addEventListener("change", function () {
      if (previewWrap && !previewWrap.hidden) paint();
    });
  });
  var form = $("rv-send-form");
  if (form) {
    form.addEventListener("submit", function (event) {
      syncFiles();
      if (!bothTicked()) {
        event.preventDefault();
        syncSend();
      }
    });
  }
  syncSend();
})();
