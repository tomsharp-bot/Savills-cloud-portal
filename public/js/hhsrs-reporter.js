(function () {
  var cfg = window.HHSRS_REPORTER || {};
  var DEMO = {};
  (cfg.demoProjects || []).forEach(function (p) {
    DEMO[p.name] = p;
  });
  var RATING_OPTIONS = cfg.ratingOptions || {
    NEW: ["Low", "Medium", "High", "High – emergency risk", "High – severe risk"],
    OLD: ["Slight", "Moderate", "Severe", "Severe – emergency risk", "Severe"],
  };

  function $(id) {
    return document.getElementById(id);
  }

  function copyText(text, btn) {
    var done = function () {
      if (!btn) return;
      var prev = btn.textContent;
      btn.textContent = "Copied";
      setTimeout(function () {
        btn.textContent = prev;
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  document.querySelectorAll(".btn-copy[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = $(btn.getAttribute("data-copy"));
      if (!el) return;
      copyText(el.value || "", btn);
      el.dataset.userEdited = "1";
    });
  });

  var siteBtn = $("btn-copy-site-form-link");
  if (siteBtn) {
    siteBtn.addEventListener("click", function () {
      var input = $("admin-site-form-url");
      var status = $("copy-site-form-status");
      if (!input) return;
      copyText(input.value, siteBtn);
      if (status) status.textContent = "Copied — paste into email or WhatsApp.";
    });
  }

  function matchProject(name) {
    if (!name) return null;
    if (DEMO[name]) return DEMO[name];
    var aliases = cfg.projectAliases || {};
    var alias = aliases[name];
    if (!alias) {
      var aliasKeys = Object.keys(aliases);
      for (var a = 0; a < aliasKeys.length; a++) {
        if (aliasKeys[a].toLowerCase() === String(name).toLowerCase()) {
          alias = aliases[aliasKeys[a]];
          break;
        }
      }
    }
    if (alias && DEMO[alias]) return DEMO[alias];
    var lower = name.toLowerCase();
    var keys = Object.keys(DEMO);
    for (var i = 0; i < keys.length; i++) {
      var p = DEMO[keys[i]];
      if (keys[i].toLowerCase() === lower) return p;
      if (lower.indexOf("onward") === 0 && p.template === "Onward") return p;
      if (/^vico\b/i.test(name) && p.template === "Vico Homes") return p;
      if (lower.indexOf("cornwall") === 0 && p.template === "Cornwall") return p;
      if (lower.indexOf("bpha") === 0 && p.template === "BPHA") return p;
      if (lower.indexOf("mtvh") !== -1 && p.name === "MTVH Pilot 2026") return p;
    }
    return null;
  }

  function fillRatingOptions(scheme, preferred) {
    var sel = $("rv-rating");
    if (!sel) return;
    var opts = RATING_OPTIONS[scheme] || RATING_OPTIONS.NEW;
    var cur = preferred != null ? preferred : sel.value;
    sel.innerHTML = '<option value="">Select…</option>';
    opts.forEach(function (r) {
      var opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      sel.appendChild(opt);
    });
    if (cur && opts.indexOf(cur) < 0) {
      var extra = document.createElement("option");
      extra.value = cur;
      extra.textContent = cur;
      sel.appendChild(extra);
    }
    if (cur) sel.value = cur;
  }

  function setExtraVisibility(projectCfg) {
    var extras = (projectCfg && projectCfg.extras) || {};
    var nodes = document.querySelectorAll("#rv-case-form .project-extra");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-extra");
      nodes[i].hidden = !extras[key];
    }
    var vulnRule = $("rv-vuln-rule");
    var includeVuln = $("rv-include-vuln");
    if (vulnRule && includeVuln) {
      if (extras.vulnerabilities) {
        includeVuln.checked = true;
        includeVuln.disabled = true;
        vulnRule.textContent = "Included for Vico.";
      } else {
        includeVuln.disabled = false;
        vulnRule.textContent = "";
      }
    }
    var note = $("rv-online-form-note");
    if (note && extras.online_form) {
      var haz = (($("rv-hazard") && $("rv-hazard").value) || "").toLowerCase();
      if (/damp|mould|mold/.test(haz)) {
        note.innerHTML =
          "<strong>Cornwall online form:</strong> damp / mould on this case — Tom’s separate online form is required. Keep the action open until completed.";
      } else {
        note.innerHTML =
          "<strong>Cornwall online form:</strong> for damp / mould, Tom’s separate online form may still be required after this email. Track that action until completed.";
      }
    }
  }

  var MAX_CASE_PHOTOS = 4;
  var casePhotos = [];
  var photoSeq = 0;
  var emailGenerated = false;
  var caseLocked = false;
  var DRAG_HINT = "Drag a photo into your email draft. If that doesn’t work, download the photo.";

  function clearEmailDraft() {
    ["rv-email-to", "rv-email-cc", "rv-email-bcc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.value = "";
      delete el.dataset.userEdited;
    });
    emailGenerated = false;
    caseLocked = false;
    var hint = $("rv-email-empty-hint");
    if (hint) hint.hidden = false;
    var badge = $("rv-email-badge");
    if (badge) badge.textContent = "Draft";
    var note = $("rv-generate-note");
    if (note) note.textContent = "Choose a project, complete the case details, then generate the email.";
    syncCaseLock();
  }

  function applyProjectChange(opts) {
    opts = opts || {};
    var name = ($("rv-project") && $("rv-project").value) || "";
    var projectCfg = matchProject(name);
    var fields = $("rv-case-fields");
    var hint = $("rv-project-hint");
    var generateBtn = $("btn-generate-email");
    if (fields) {
      if (!name && cfg.mode !== "filled") fields.setAttribute("disabled", "disabled");
      else fields.removeAttribute("disabled");
    }
    if (generateBtn) generateBtn.disabled = !name;
    if (hint) {
      hint.textContent = projectCfg
        ? projectCfg.hint
        : "Choose the project first. Extra fields and the email draft follow its rules.";
    }
    fillRatingOptions(projectCfg ? projectCfg.ratingScheme : "NEW", opts.keepRating);
    setExtraVisibility(projectCfg);
    if (!(opts.skipDraft || opts.keepEmail)) clearEmailDraft();
  }

  function nextPhotoId() {
    photoSeq += 1;
    return "ph-" + photoSeq;
  }

  function revokePhotoUrl(photo) {
    if (photo && photo.blobUrl && String(photo.blobUrl).indexOf("blob:") === 0) {
      try { URL.revokeObjectURL(photo.blobUrl); } catch (e) {}
    }
  }

  function photoDragFilename(photo) {
    var base = (photo && (photo.name || photo.caption) || "photo").replace(/\.[^.]+$/, "");
    base = String(base).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "photo";
    var ext = "png";
    if (photo && photo.name && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(photo.name)) {
      ext = photo.name.split(".").pop().toLowerCase();
      if (ext === "jpeg") ext = "jpg";
    } else if (photo && photo.mime && /jpeg|jpg/i.test(photo.mime)) {
      ext = "jpg";
    }
    return base + "." + ext;
  }

  function photoMime(photo) {
    if (photo && photo.mime) return photo.mime;
    var name = (photo && photo.name) || "";
    if (/\.jpe?g$/i.test(name)) return "image/jpeg";
    if (/\.gif$/i.test(name)) return "image/gif";
    if (/\.webp$/i.test(name)) return "image/webp";
    if (/\.heic$/i.test(name)) return "image/heic";
    if (/\.heif$/i.test(name)) return "image/heif";
    return "image/png";
  }

  function absolutePhotoUrl(photo) {
    if (photo && photo.blobUrl) return photo.blobUrl;
    if (!photo || !photo.url) return "";
    try { return new URL(photo.url, window.location.href).href; } catch (e) { return photo.url; }
  }

  function prefetchPhoto(photo) {
    if (!photo || !photo.url || photo.blob) return;
    fetch(photo.url, { credentials: "same-origin" })
      .then(function (res) { return res.ok ? res.blob() : null; })
      .then(function (blob) {
        if (!blob) return;
        photo.blob = blob;
        photo.mime = blob.type || photo.mime;
        if (!photo.blobUrl) photo.blobUrl = URL.createObjectURL(blob);
      })
      .catch(function () {});
  }

  function findCasePhoto(id) {
    for (var i = 0; i < casePhotos.length; i++) {
      if (casePhotos[i].id === id) return casePhotos[i];
    }
    return null;
  }

  function updatePhotosModeUi() {
    var block = $("rv-photos-block");
    var addRow = $("rv-photos-add-row");
    var isBlank = cfg.mode !== "filled";
    if (block) block.classList.toggle("is-blank-mode", isBlank);
    if (addRow) addRow.hidden = !isBlank;
    var drop = $("rv-photos-dropzone");
    if (drop) drop.classList.toggle("is-disabled", casePhotos.length >= MAX_CASE_PHOTOS);
    var countEl = $("rv-photos-count");
    if (countEl) countEl.textContent = casePhotos.length + " / " + MAX_CASE_PHOTOS;
  }

  function appendThumb(grid, photo, opts) {
    var card = document.createElement("div");
    card.className = "photo-thumb " + (opts.email ? "email-photo-thumb" : "case-photo-thumb");
    card.setAttribute("data-photo-id", photo.id);
    if (opts.email) {
      card.draggable = true;
      card.tabIndex = 0;
      card.title = "Drag into your email draft to attach";
    }
    if (opts.removable) {
      var rem = document.createElement("button");
      rem.type = "button";
      rem.className = "photo-remove";
      rem.setAttribute("data-remove-photo", photo.id);
      rem.setAttribute("aria-label", "Remove photo");
      rem.textContent = "×";
      card.appendChild(rem);
    }
    var img = document.createElement("img");
    img.src = photo.blobUrl || photo.url || "";
    img.alt = photo.caption || photo.name || "Photo";
    img.draggable = false;
    card.appendChild(img);
    var cap = document.createElement("span");
    cap.className = "photo-caption";
    cap.textContent = photo.caption || photo.name || "Photo";
    card.appendChild(cap);
    grid.appendChild(card);
  }

  function photoPreviewEl() {
    var preview = $("rv-photo-preview");
    if (preview) return preview;
    preview = document.createElement("div");
    preview.id = "rv-photo-preview";
    preview.className = "photo-float-preview";
    preview.hidden = true;
    preview.setAttribute("aria-hidden", "true");
    var img = document.createElement("img");
    img.alt = "";
    preview.appendChild(img);
    document.body.appendChild(preview);
    return preview;
  }

  function hidePhotoPreview() {
    var preview = $("rv-photo-preview");
    if (preview) preview.hidden = true;
  }

  function showPhotoPreview(card) {
    if (!card) return;
    var source = card.querySelector("img");
    if (!source || !source.getAttribute("src")) {
      hidePhotoPreview();
      return;
    }
    var preview = photoPreviewEl();
    var img = preview.querySelector("img");
    if (img.getAttribute("src") !== source.src) img.src = source.src;
    var rect = card.getBoundingClientRect();
    preview.hidden = false;
    preview.style.left = Math.round(rect.right + 8) + "px";
    preview.style.top = Math.round(rect.top) + "px";
  }

  function thumbFromEvent(target) {
    return target && target.closest ? target.closest(".case-photo-thumb, .email-photo-thumb") : null;
  }

  function wirePhotoPreview(root) {
    if (!root || root.dataset.previewWired === "1") return;
    root.dataset.previewWired = "1";
    root.addEventListener("pointerover", function (e) {
      var card = thumbFromEvent(e.target);
      if (card && root.contains(card)) showPhotoPreview(card);
    });
    root.addEventListener("pointerout", function (e) {
      var card = thumbFromEvent(e.target);
      if (!card || !root.contains(card)) return;
      var next = thumbFromEvent(e.relatedTarget);
      if (next && root.contains(next)) {
        showPhotoPreview(next);
        return;
      }
      hidePhotoPreview();
    });
    root.addEventListener("focusin", function (e) {
      var card = thumbFromEvent(e.target);
      if (card && root.contains(card)) showPhotoPreview(card);
    });
    root.addEventListener("focusout", function (e) {
      var card = thumbFromEvent(e.target);
      if (!card) return;
      var next = thumbFromEvent(e.relatedTarget);
      if (next) showPhotoPreview(next);
      else hidePhotoPreview();
    });
  }

  function renderCaseThumbs() {
    hidePhotoPreview();
    var grid = $("rv-photo-thumbs");
    updatePhotosModeUi();
    if (!grid) return;
    grid.innerHTML = "";
    var canRemove = cfg.mode !== "filled";
    casePhotos.forEach(function (photo) {
      appendThumb(grid, photo, { email: false, removable: canRemove });
    });
    if (caseLocked) setEmailPhotoTools(true);
  }

  function syncCaseLock() {
    var panel = $("rv-case-panel");
    if (panel) panel.classList.toggle("is-drafted", caseLocked);
    var photos = $("rv-photos-block");
    if (photos) photos.hidden = caseLocked;
    var amend = $("btn-amend-case");
    if (amend) amend.hidden = !caseLocked;
    setEmailPhotoTools(caseLocked);
  }

  function amendCaseDetails() {
    caseLocked = false;
    syncCaseLock();
    var note = $("rv-generate-note");
    if (note) note.textContent = "Case details unlocked. Edit them, then Generate email again to refresh the draft.";
    scheduleReviewDraftSave();
  }

  function renderEmailThumbs() {
    hidePhotoPreview();
    var grid = $("rv-email-photo-thumbs");
    if (!grid) return;
    grid.innerHTML = "";
    casePhotos.forEach(function (photo) {
      appendThumb(grid, photo, { email: true, removable: false });
    });
  }

  function setEmailPhotoTools(show) {
    var box = $("rv-email-photos");
    if (!box) return;
    var visible = Boolean(show) && casePhotos.length > 0;
    box.hidden = !visible;
    var dl = $("btn-download-photos");
    if (dl) dl.disabled = !visible;
    if (visible) renderEmailThumbs();
    else {
      var grid = $("rv-email-photo-thumbs");
      if (grid) grid.innerHTML = "";
    }
  }

  function resetCasePhotos(list) {
    casePhotos.forEach(revokePhotoUrl);
    casePhotos = [];
    (list || []).forEach(function (p, i) {
      if (casePhotos.length >= MAX_CASE_PHOTOS) return;
      var photo = {
        id: (p && p.id) || ("surveyor-" + (i + 1)),
        name: (p && p.name) || ("photo-" + (i + 1)),
        caption: (p && (p.caption || p.name)) || "Photo",
        url: (p && p.url) || "",
        mime: "",
        blob: null,
        blobUrl: "",
      };
      casePhotos.push(photo);
      prefetchPhoto(photo);
    });
    renderCaseThumbs();
  }

  function addCasePhoto(photo) {
    if (casePhotos.length >= MAX_CASE_PHOTOS) return false;
    casePhotos.push(photo);
    renderCaseThumbs();
    return true;
  }

  function removeCasePhoto(id) {
    var kept = [];
    casePhotos.forEach(function (photo) {
      if (photo.id === id) revokePhotoUrl(photo);
      else kept.push(photo);
    });
    casePhotos = kept;
    renderCaseThumbs();
  }

  function readImageFiles(fileList) {
    if (cfg.mode === "filled" || !fileList || !fileList.length) return;
    var remaining = MAX_CASE_PHOTOS - casePhotos.length;
    if (remaining <= 0) return;
    var files = [];
    for (var i = 0; i < fileList.length && files.length < remaining; i++) {
      if (fileList[i] && /^image\//.test(fileList[i].type || "")) files.push(fileList[i]);
    }
    files.forEach(function (file) {
      var url = URL.createObjectURL(file);
      var base = (file.name || "photo").replace(/\.[^.]+$/, "");
      addCasePhoto({
        id: nextPhotoId(),
        name: file.name || "photo.png",
        caption: base || "Photo",
        mime: file.type || "image/png",
        blob: file,
        blobUrl: url,
        url: url,
      });
    });
  }

  function setPhotoDragData(dt, photo) {
    if (!dt || !photo) return;
    var url = absolutePhotoUrl(photo);
    var fname = photoDragFilename(photo);
    var mime = photoMime(photo);
    dt.effectAllowed = "copy";
    try { dt.setData("DownloadURL", mime + ":" + fname + ":" + url); } catch (e1) {}
    try { dt.setData("text/uri-list", url); } catch (e2) {}
    try { dt.setData("text/plain", url); } catch (e3) {}
    try { dt.setData(mime, url); } catch (e4) {}
    if (photo.blob && dt.items && dt.items.add) {
      try {
        dt.items.add(new File([photo.blob], fname, { type: mime }));
      } catch (e5) {}
    }
  }

  function downloadCasePhotos() {
    if (!casePhotos.length) return;
    casePhotos.forEach(function (p, idx) {
      var url = absolutePhotoUrl(p);
      if (!url) return;
      var a = document.createElement("a");
      a.href = url;
      a.download = photoDragFilename(p);
      a.style.display = "none";
      document.body.appendChild(a);
      setTimeout(function () {
        a.click();
        setTimeout(function () {
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 500);
      }, idx * 180);
    });
  }

  function wirePhotoInteractions() {
    var caseGrid = $("rv-photo-thumbs");
    var emailGrid = $("rv-email-photo-thumbs");
    var fileInput = $("rv-photo-file");
    var dropzone = $("rv-photos-dropzone");
    var dlBtn = $("btn-download-photos");
    wirePhotoPreview(caseGrid);
    wirePhotoPreview(emailGrid);
    if (caseGrid) {
      caseGrid.addEventListener("click", function (e) {
        var rem = e.target.closest("[data-remove-photo]");
        if (!rem) return;
        removeCasePhoto(rem.getAttribute("data-remove-photo"));
      });
    }
    if (emailGrid) {
      emailGrid.addEventListener("dragstart", function (e) {
        var card = e.target.closest(".email-photo-thumb[data-photo-id]");
        if (!card || !e.dataTransfer) return;
        var photo = findCasePhoto(card.getAttribute("data-photo-id"));
        if (!photo) return;
        setPhotoDragData(e.dataTransfer, photo);
        try {
          var img = card.querySelector("img");
          if (img) e.dataTransfer.setDragImage(img, 40, 30);
        } catch (e6) {}
      });
    }
    if (dlBtn) dlBtn.addEventListener("click", downloadCasePhotos);
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        readImageFiles(fileInput.files);
        fileInput.value = "";
      });
    }
    if (dropzone) {
      dropzone.addEventListener("dragenter", function (e) {
        e.preventDefault();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragover", function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", function () {
        dropzone.classList.remove("is-dragover");
      });
      dropzone.addEventListener("drop", function (e) {
        e.preventDefault();
        dropzone.classList.remove("is-dragover");
        if (casePhotos.length >= MAX_CASE_PHOTOS) return;
        readImageFiles(e.dataTransfer && e.dataTransfer.files);
      });
    }
  }

  function collectDraftPayload() {
    return {
      caseId: cfg.caseId || "",
      projectName: ($("rv-project") && $("rv-project").value) || "",
      address: ($("rv-address") && $("rv-address").value) || "",
      uprn: ($("rv-uprn") && $("rv-uprn").value) || "",
      surveyDate: ($("rv-survey-date") && $("rv-survey-date").value) || "",
      hazard: ($("rv-hazard") && $("rv-hazard").value) || "",
      rating: ($("rv-rating") && $("rv-rating").value) || "",
      notes: ($("rv-notes") && $("rv-notes").value) || "",
      callOutcome: ($("rv-call-status") && $("rv-call-status").value) || "",
      clientCallReference: ($("rv-call-ref") && $("rv-call-ref").value) || "",
      callNotes: ($("rv-call-notes") && $("rv-call-notes").value) || "",
      suspectedCause: ($("rv-cause") && $("rv-cause").value) || "",
      includeCause: !!($("rv-include-cause") && $("rv-include-cause").checked),
      vulnerabilities: ($("rv-vulnerabilities") && $("rv-vulnerabilities").value) || "",
      escalation: ($("rv-escalation") && $("rv-escalation").value) || "",
      onwardTopic: ($("rv-onward-topic") && $("rv-onward-topic").value) || "",
      cat1Confirmed: !!($("rv-cat1") && $("rv-cat1").checked),
      workOrder: ($("rv-work-order") && $("rv-work-order").value) || "",
      photoCount: casePhotos.length,
    };
  }

  function fillDraftFields(draft) {
    var toEl = $("rv-email-to");
    var ccEl = $("rv-email-cc");
    var bccEl = $("rv-email-bcc");
    var subEl = $("rv-email-subject");
    var bodyEl = $("rv-email-body");
    if (toEl) toEl.value = draft.to || "";
    if (ccEl) ccEl.value = draft.cc || "";
    if (bccEl) bccEl.value = draft.bcc || "";
    if (subEl) subEl.value = draft.subject || "";
    if (bodyEl) bodyEl.value = draft.body || "";
    var hint = $("rv-email-empty-hint");
    if (hint) hint.hidden = true;
    var badge = $("rv-email-badge");
    if (badge) badge.textContent = "Generated";
    emailGenerated = true;
    caseLocked = true;
    syncCaseLock();
  }

  function generateEmail() {
    var name = ($("rv-project") && $("rv-project").value) || "";
    var note = $("rv-generate-note");
    var btn = $("btn-generate-email");
    if (!name) {
      if (note) note.textContent = "Choose a project, complete the case details, then generate the email.";
      return;
    }
    if (btn) btn.disabled = true;
    fetch((cfg.base || "/HHSRSreporter") + "/draft.json", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(collectDraftPayload()),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        }).catch(function () {
          return { ok: false, data: null };
        });
      })
      .then(function (result) {
        var data = result && result.data;
        if (!result.ok || !data || !data.ok) {
          if (note) note.textContent = (data && data.error) || "Could not prepare the client email.";
          return;
        }
        ["rv-email-to", "rv-email-cc", "rv-email-bcc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
          var el = $(id);
          if (el) delete el.dataset.userEdited;
        });
        fillDraftFields(data);
        if (note) note.textContent = "Email generated. Case details are locked — Amend case details to edit, then Generate email again.";
        saveReviewDraftNow();
      })
      .catch(function () {
        if (note) note.textContent = "Could not prepare the client email. Check the case details and try again.";
      })
      .then(function () {
        if (btn) btn.disabled = !(($("rv-project") && $("rv-project").value) || "");
      });
  }

  function clearBlankReview() {
    ["rv-uprn", "rv-surveyor", "rv-address", "rv-hazard", "rv-notes", "rv-call-ref", "rv-call-notes", "rv-cause", "rv-vulnerabilities", "rv-escalation", "rv-work-order", "rv-online-action", "rv-internal-notes"].forEach(function (id) {
      var el = $(id);
      if (el && !el.readOnly) el.value = "";
    });
    if ($("rv-call-status")) $("rv-call-status").value = "";
    if ($("rv-onward-topic")) $("rv-onward-topic").value = "";
    if ($("rv-survey-date") && $("rv-survey-date").type !== "text") $("rv-survey-date").value = "";
    if ($("rv-cat1")) $("rv-cat1").checked = false;
    if ($("rv-include-cause")) $("rv-include-cause").checked = true;
    if ($("rv-rating")) $("rv-rating").value = "";
    if ($("rv-project")) $("rv-project").value = "";
    var badge = $("review-mode-badge");
    if (badge) {
      badge.textContent = "New case";
      badge.classList.remove("is-filled");
    }
    var caseBadge = $("rv-case-badge");
    if (caseBadge) caseBadge.textContent = "Blank";
    var sub = $("review-subtitle");
    if (sub) {
      sub.hidden = true;
      sub.textContent = "";
    }
    cfg.mode = "blank";
    cfg.caseId = "";
    resetCasePhotos([]);
    applyProjectChange();
  }

  function pingCaseDetailsToTop() {
    var details = $("rv-also-details");
    if (details) details.open = false;
    setTimeout(function () {
      var anchor = $("rv-project-block") || $("review-workspace");
      if (!anchor) return;
      function stickyTopOffset() {
        var topbar = document.querySelector(".topbar");
        if (!topbar) return 0;
        var cs = window.getComputedStyle(topbar);
        if (cs.position !== "sticky" && cs.position !== "fixed") return 0;
        return Math.ceil(topbar.getBoundingClientRect().height);
      }
      function park() {
        var offset = stickyTopOffset();
        var rect = anchor.getBoundingClientRect();
        var delta = rect.top - offset;
        if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      }
      anchor.scrollIntoView({ behavior: "auto", block: "start" });
      park();
      requestAnimationFrame(park);
    }, 60);
  }

  /* Assigned before resume/restore. Those calls sit above the function
     declarations, and var initialisers are not hoisted with their values. */
  var REVIEW_DRAFTS_KEY = "hhsrs-review-drafts-v1";
  var REVIEW_LAST_KEY = "hhsrs-review-last-key-v1";
  var REVIEW_CASE_FIELD_IDS = ["rv-uprn", "rv-surveyor", "rv-address", "rv-hazard", "rv-rating", "rv-notes", "rv-call-status", "rv-call-ref", "rv-call-notes", "rv-survey-date", "rv-onward-topic", "rv-cat1", "rv-cause", "rv-include-cause", "rv-vulnerabilities", "rv-escalation", "rv-work-order", "rv-online-action", "rv-internal-notes"];
  var REVIEW_EMAIL_FIELD_IDS = ["rv-email-to", "rv-email-cc", "rv-email-bcc", "rv-email-subject", "rv-email-body"];
  var reviewDraftSaveTimer = null;
  var resumeCleared = false;
  var skipDraftSave = false;

  ["rv-email-to", "rv-email-cc", "rv-email-bcc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("input", function () {
      el.dataset.userEdited = "1";
      scheduleReviewDraftSave();
    });
    el.addEventListener("change", scheduleReviewDraftSave);
  });

  var reviewLeavingForResume = initReviewResume();

  var projectSel = $("rv-project");
  if (projectSel && !reviewLeavingForResume) {
    projectSel.addEventListener("change", function () {
      ["rv-email-to", "rv-email-cc", "rv-email-bcc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
        var el = $(id);
        if (el) delete el.dataset.userEdited;
      });
      applyProjectChange();
      scheduleReviewDraftSave();
    });
    var keep = ($("rv-rating") && $("rv-rating").value) || undefined;
    if (cfg.initialProject && !projectSel.value) ensureProjectSelectValue(cfg.initialProject);
    applyProjectChange({ keepRating: keep, skipDraft: true });
  }

  var hazardEl = $("rv-hazard");
  if (hazardEl) {
    var refreshExtras = function () {
      var name = ($("rv-project") && $("rv-project").value) || "";
      setExtraVisibility(matchProject(name));
    };
    hazardEl.addEventListener("change", refreshExtras);
    hazardEl.addEventListener("input", refreshExtras);
  }

  if ($("rv-photo-thumbs") || $("rv-email-photos")) {
    wirePhotoInteractions();
    resetCasePhotos(Array.isArray(cfg.casePhotos) ? cfg.casePhotos : []);
    caseLocked = false;
    syncCaseLock();
  }
  if (!reviewLeavingForResume && $("rv-email-body")) restoreReviewDraft(reviewDraftKey());

  var generateBtn = $("btn-generate-email");
  if (generateBtn) generateBtn.addEventListener("click", generateEmail);
  var amendBtn = $("btn-amend-case");
  if (amendBtn) amendBtn.addEventListener("click", amendCaseDetails);

  var createBtn = $("btn-create-plain-email");
  if (createBtn) {
    createBtn.addEventListener("click", function (e) {
      if (cfg.mode !== "filled" && $("rv-project")) {
        e.preventDefault();
        clearBlankReview();
        pingCaseDetailsToTop();
        return;
      }
      try { sessionStorage.setItem("hhsrs-reporter-ping-project", "1"); } catch (err) {}
    });
  }

  if ($("rv-project-block")) {
    var ping = cfg.mode === "filled";
    var compose = /(?:\?|&)compose=1(?:&|$)/.test(window.location.search);
    try {
      if (sessionStorage.getItem("hhsrs-reporter-ping-project") === "1") {
        ping = true;
        sessionStorage.removeItem("hhsrs-reporter-ping-project");
      }
    } catch (err) {}
    if (compose) ping = true;
    if (ping) {
      pingCaseDetailsToTop();
      if (compose && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", window.location.pathname);
      }
    }
  }

  var hintEl = $("rv-photos-hint");
  if (hintEl && !hintEl.textContent) hintEl.textContent = DRAG_HINT;

  /* Live new-hazard toast. Baseline is the pending ids rendered with this page
     (plus ids already seen in this tab). Later polls toast anything new.
     The in-page toast always shows. OS notifications only fire when allowed. */
  var SEEN_KEY = "hhsrs-reporter-seen-pending-ids";
  var POLL_MS = Number(cfg.alertsPollMs) || 30000;
  var seen = {};
  var seeded = false;
  var pollInFlight = false;
  var lastPollAt = 0;

  function rememberId(id) {
    if (typeof id === "string" && id) seen[id] = true;
  }

  function loadSeen() {
    try {
      var raw = sessionStorage.getItem(SEEN_KEY);
      if (raw == null) return;
      var ids = JSON.parse(raw);
      if (!Array.isArray(ids)) return;
      ids.forEach(rememberId);
      seeded = true;
    } catch (e) {
      /* ignore private-mode storage failures */
    }
  }

  function saveSeen() {
    var ids = Object.keys(seen);
    if (ids.length > 300) ids = ids.slice(ids.length - 300);
    try {
      sessionStorage.setItem(SEEN_KEY, JSON.stringify(ids));
    } catch (e) {
      /* ignore */
    }
  }

  function seedFromTable() {
    document.querySelectorAll("#waiting-table a.btn-review-create").forEach(function (link) {
      var href = link.getAttribute("href") || "";
      var match = href.match(/\/review\/([^/?#]+)/);
      if (match) rememberId(decodeURIComponent(match[1]));
    });
  }

  function bootstrapSeen() {
    loadSeen();
    if (Array.isArray(cfg.initialPendingIds)) {
      cfg.initialPendingIds.forEach(rememberId);
      seeded = true;
      saveSeen();
      return;
    }
    if (cfg.mode === "pending") {
      seedFromTable();
      seeded = true;
      saveSeen();
    }
  }

  function hideToast() {
    var toast = $("hhsrs-alert-toast");
    if (toast) toast.classList.remove("is-visible");
  }

  function reviewUrl(id) {
    return (cfg.base || "/HHSRSreporter") + "/review/" + encodeURIComponent(id);
  }

  var alertAudio = null;

  function alertAudioContext() {
    if (alertAudio) return alertAudio;
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      alertAudio = new AudioCtx();
    } catch (e) {
      return null;
    }
    return alertAudio;
  }

  /* Browsers block audio until a gesture. Resume during that click so later
     polls can chime. If resume fails, the toast still shows with no sound. */
  function unlockAlertSound() {
    var ctx = alertAudioContext();
    if (!ctx || typeof ctx.resume !== "function") return;
    try {
      var pending = ctx.resume();
      if (pending && typeof pending.catch === "function") pending.catch(function () {});
    } catch (e) {
      /* toast still shows */
    }
  }

  function playTone(ctx, frequency, startAt, duration) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.04, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function playAlertChime() {
    var ctx = alertAudioContext();
    if (!ctx || ctx.state !== "running") return;
    try {
      var startAt = ctx.currentTime + 0.01;
      playTone(ctx, 523.25, startAt, 0.16);
      playTone(ctx, 659.25, startAt + 0.11, 0.2);
    } catch (e) {
      /* toast still shows */
    }
  }

  function showToast(fresh) {
    var toast = $("hhsrs-alert-toast");
    if (!toast || !fresh.length) return;
    var item = fresh[0];
    var extra = fresh.length - 1;
    var kicker = $("hhsrs-toast-kicker");
    var title = $("hhsrs-toast-title");
    var body = $("hhsrs-toast-body");
    var open = $("hhsrs-toast-open");
    if (kicker) kicker.textContent = fresh.length === 1 ? "New hazard" : fresh.length + " new hazards";
    if (title) title.textContent = item.fullAddress || "New pending issue";
    var summary = item.summary || [item.category, item.rating].filter(Boolean).join(" · ");
    var text = [item.projectName, summary].filter(Boolean).join(" — ");
    if (extra === 1) text += " + 1 more new hazard is waiting.";
    else if (extra > 1) text += " + " + extra + " more new hazards are waiting.";
    if (body) body.textContent = text;
    if (open) open.href = reviewUrl(item.id);
    toast.classList.add("is-visible");
    playAlertChime();
  }

  function desktopNotify(item) {
    if (!desktopAlertsOn()) return;
    var summary = item.summary || [item.category, item.rating].filter(Boolean).join(" · ");
    var body = [item.projectName, item.fullAddress, summary].filter(Boolean).join(" — ");
    try {
      var note = new Notification("New HHSRS hazard", {
        body: body,
        tag: "hhsrs-" + item.id,
        requireInteraction: true,
      });
      note.onclick = function () {
        window.focus();
        window.location.href = reviewUrl(item.id);
        note.close();
      };
    } catch (e) {
      /* in-page toast already shown */
    }
  }

  function applyPending(pending) {
    var fresh = [];
    for (var i = 0; i < pending.length; i++) {
      var item = pending[i];
      if (!item || !item.id || seen[item.id]) continue;
      fresh.push(item);
    }
    if (!seeded) {
      pending.forEach(function (item) {
        if (item) rememberId(item.id);
      });
      seeded = true;
      saveSeen();
      return;
    }
    if (!fresh.length) return;
    var loud = [];
    fresh.forEach(function (item) {
      rememberId(item.id);
      if (item.claimStatus === "claimed" || item.claimStatus === "stale") return;
      loud.push(item);
    });
    saveSeen();
    if (!loud.length) return;
    showToast(loud);
    var limit = Math.min(loud.length, 3);
    for (var n = 0; n < limit; n++) desktopNotify(loud[n]);
  }

  function pollPending() {
    if (pollInFlight) return;
    pollInFlight = true;
    lastPollAt = Date.now();
    var url = (cfg.base || "/HHSRSreporter") + "/pending-alerts.json";
    fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        if (!res.ok) return null;
        var ct = res.headers.get("content-type") || "";
        if (ct.indexOf("json") === -1) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data || !Array.isArray(data.pending)) return;
        applyPending(data.pending);
      })
      .catch(function () {})
      .then(function () {
        pollInFlight = false;
      });
  }

  function notificationState() {
    if (typeof Notification === "undefined") return "unsupported";
    return Notification.permission;
  }

  var DA_ON_KEY = "hhsrsDesktopAlertsOn";
  var DA_DECISION_KEY = "hhsrsDesktopAlertsDecision";

  function clearLegacyDesktopAlertsDismiss() {
    try {
      localStorage.removeItem("hhsrs-desktop-alerts-dismissed");
    } catch (e) {
      /* ignore private-mode storage failures */
    }
  }

  function alertsSimulatedOff() {
    try {
      return localStorage.getItem(DA_ON_KEY) === "0";
    } catch (e) {
      return false;
    }
  }

  function desktopAlertsDecision() {
    try {
      return localStorage.getItem(DA_DECISION_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function desktopAlertsOn() {
    return notificationState() === "granted" && !alertsSimulatedOff();
  }

  function markDesktopAlertsOn() {
    try {
      localStorage.setItem(DA_ON_KEY, "1");
      localStorage.setItem(DA_DECISION_KEY, "enabled");
      localStorage.removeItem("hhsrs-desktop-alerts-dismissed");
    } catch (e) {
      /* permission can still be granted without storage */
    }
  }

  function markDesktopAlertsSimulatedOff() {
    try {
      localStorage.setItem(DA_ON_KEY, "0");
      localStorage.setItem(DA_DECISION_KEY, "enabled");
      localStorage.removeItem("hhsrs-desktop-alerts-dismissed");
    } catch (e) {
      /* banner still follows the in-memory paint below */
    }
  }

  function paintNotifStatus() {
    var on = desktopAlertsOn();
    var perm = notificationState();
    var banner = $("desktop-alerts-banner");
    var status = $("notif-status");
    var btn = $("btn-enable-desktop-alerts");
    if (banner) banner.hidden = on;
    if (status) {
      status.classList.remove("granted", "denied");
      if (!on && perm === "denied") {
        status.hidden = false;
        status.textContent = "Desktop alerts blocked. On-screen alerts still show.";
        status.classList.add("denied");
      } else if (!on && perm === "unsupported") {
        status.hidden = false;
        status.textContent = "Desktop alerts are unavailable in this browser. On-screen alerts still show.";
      } else {
        status.hidden = true;
        status.textContent = "";
      }
    }
    if (btn) {
      btn.textContent = "Enable desktop alerts";
      btn.disabled = perm === "unsupported";
    }

    var dot = $("admin-alerts-dot");
    var label = $("admin-alerts-status-text");
    var badge = $("admin-alerts-badge");
    var adminEnable = $("btn-admin-enable-desktop-alerts");
    var simNote = $("admin-alerts-sim-note");
    var hint = $("admin-alerts-hint");
    if (dot) {
      dot.classList.toggle("is-on", on);
      dot.classList.toggle("is-off", !on);
    }
    if (label) label.textContent = on ? "Desktop alerts are on" : "Desktop alerts are off";
    if (badge) badge.textContent = on ? "On" : "Off";
    if (adminEnable) {
      adminEnable.hidden = on;
      adminEnable.disabled = perm === "unsupported";
    }
    if (simNote) simNote.hidden = !on;
    if (hint) {
      if (on) {
        hint.textContent = "You'll get a Windows-style notification when a new site issue lands.";
      } else if (perm === "denied") {
        hint.textContent = "Desktop alerts are blocked in this browser. On-screen alerts still show. Allow notifications for this site, then enable again.";
      } else if (perm === "unsupported") {
        hint.textContent = "This browser cannot show desktop alerts. On-screen alerts still show while HHSRS Reporter is open.";
      } else if (alertsSimulatedOff() || desktopAlertsDecision() === "enabled") {
        hint.textContent = "Alerts were turned off. Enable again — the prompt stays on Pending until you do.";
      } else {
        hint.textContent = "Desktop alerts are required. Enable here or from the prompt on Pending.";
      }
    }
  }

  function askNotificationPermission() {
    if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
      paintNotifStatus();
      return;
    }
    var settled = false;
    function finish() {
      if (settled) return;
      settled = true;
      if (notificationState() === "granted") markDesktopAlertsOn();
      paintNotifStatus();
    }
    try {
      var result = Notification.requestPermission(finish);
      if (result && typeof result.then === "function") {
        result.then(finish).catch(finish);
      }
    } catch (e) {
      finish();
    }
  }

  function enableDesktopAlerts() {
    unlockAlertSound();
    if (notificationState() === "granted") {
      markDesktopAlertsOn();
      paintNotifStatus();
      return;
    }
    askNotificationPermission();
  }

  var dismissBtn = $("hhsrs-toast-dismiss");
  if (dismissBtn) dismissBtn.addEventListener("click", hideToast);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hideToast();
  });

  clearLegacyDesktopAlertsDismiss();
  var enableBtn = $("btn-enable-desktop-alerts");
  if (enableBtn) enableBtn.addEventListener("click", enableDesktopAlerts);
  var adminEnableBtn = $("btn-admin-enable-desktop-alerts");
  if (adminEnableBtn) adminEnableBtn.addEventListener("click", enableDesktopAlerts);
  var simOffBtn = $("btn-admin-simulate-alerts-off");
  if (simOffBtn) {
    simOffBtn.addEventListener("click", function () {
      markDesktopAlertsSimulatedOff();
      paintNotifStatus();
    });
  }
  document.addEventListener("pointerdown", unlockAlertSound, true);
  document.addEventListener("keydown", unlockAlertSound, true);
  paintNotifStatus();

  bootstrapSeen();
  pollPending();
  setInterval(pollPending, POLL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastPollAt < 15000) return;
    pollPending();
  });

  /* Project overview: Total / By project, archive confirm, restore. */
  var poRoot = document.getElementById("po-overview");
  if (poRoot && !poRoot.dataset.poWired) {
    poRoot.dataset.poWired = "1";
    var poMode = "total";
    var pendingArchiveName = "";

    function poToast(msg) {
      var el = document.getElementById("po-toast");
      if (!el) return;
      el.hidden = false;
      el.textContent = msg;
      clearTimeout(poToast._t);
      poToast._t = setTimeout(function () {
        el.hidden = true;
      }, 3500);
    }

    function syncPoMode() {
      var pick = document.getElementById("po-project-pick");
      var panelTotal = document.getElementById("po-panel-total");
      var panelProject = document.getElementById("po-panel-project");
      var labels = poRoot.querySelectorAll("#po-mode label");
      for (var i = 0; i < labels.length; i++) {
        var inp = labels[i].querySelector('input[name="po-view-mode"]');
        var on = !!(inp && inp.checked && inp.value === poMode);
        labels[i].classList.toggle("is-on", on);
      }
      if (pick) pick.hidden = poMode !== "project";
      if (panelTotal) panelTotal.hidden = poMode !== "total";
      if (panelProject) panelProject.hidden = poMode !== "project";
    }

    function showByProject(name) {
      var blocks = poRoot.querySelectorAll(".po-by-block");
      for (var i = 0; i < blocks.length; i++) {
        blocks[i].hidden = blocks[i].getAttribute("data-project") !== name;
      }
    }

    function closeArchiveConfirm() {
      pendingArchiveName = "";
      var modal = document.getElementById("po-archive-confirm");
      if (modal) modal.hidden = true;
    }

    function openArchiveConfirm(name) {
      pendingArchiveName = name;
      var modal = document.getElementById("po-archive-confirm");
      var textEl = document.getElementById("po-archive-confirm-text");
      if (textEl) {
        textEl.textContent =
          "Archive “" + name + "”? It moves out of the active list. You can restore it later from Archived.";
      }
      if (modal) modal.hidden = false;
    }

    var modeInputs = poRoot.querySelectorAll('input[name="po-view-mode"]');
    for (var mi = 0; mi < modeInputs.length; mi++) {
      modeInputs[mi].addEventListener("change", function () {
        poMode = this.value === "project" ? "project" : "total";
        syncPoMode();
      });
    }

    var poSelect = document.getElementById("po-project-select");
    if (poSelect) {
      poSelect.addEventListener("change", function () {
        showByProject(poSelect.value || "");
      });
    }

    var okBtn = document.getElementById("po-archive-ok");
    var cancelBtn = document.getElementById("po-archive-cancel");
    var modal = document.getElementById("po-archive-confirm");
    if (okBtn) {
      okBtn.addEventListener("click", function () {
        var name = pendingArchiveName;
        var form = document.getElementById("po-archive-form");
        var input = document.getElementById("po-archive-project-name");
        closeArchiveConfirm();
        if (!name || !form || !input) return;
        input.value = name;
        form.submit();
      });
    }
    if (cancelBtn) cancelBtn.addEventListener("click", closeArchiveConfirm);
    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target === modal) closeArchiveConfirm();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") closeArchiveConfirm();
    });

    poRoot.addEventListener("click", function (e) {
      var arch = e.target.closest("[data-archive-project]");
      if (arch) {
        if (arch.disabled) {
          poToast("Project isn’t complete yet — archive when it is complete.");
          return;
        }
        var name = arch.getAttribute("data-archive-project");
        if (name) openArchiveConfirm(name);
        return;
      }
      var rest = e.target.closest("[data-restore-project]");
      if (!rest) return;
      var restoreName = rest.getAttribute("data-restore-project");
      var restoreForm = document.getElementById("po-restore-form");
      var restoreInput = document.getElementById("po-restore-project-name");
      if (!restoreName || !restoreForm || !restoreInput) return;
      restoreInput.value = restoreName;
      restoreForm.submit();
    });

    var existingToast = document.getElementById("po-toast");
    if (existingToast && !existingToast.hidden && existingToast.textContent) {
      setTimeout(function () {
        existingToast.hidden = true;
      }, 3500);
    }
    syncPoMode();
  }

  /* Review email draft stays in this browser until sent or abandoned. */
  function reviewDraftKey() {
    return cfg.caseId ? String(cfg.caseId) : "blank";
  }

  function getReviewLastKey() {
    try {
      var v = window.localStorage.getItem(REVIEW_LAST_KEY);
      return v == null ? "" : String(v);
    } catch (e) {
      return "";
    }
  }

  function setReviewLastKey(key) {
    try {
      window.localStorage.setItem(REVIEW_LAST_KEY, key == null || key === "" ? "blank" : String(key));
    } catch (e) {}
  }

  function clearResumeKey() {
    resumeCleared = true;
    setReviewLastKey("blank");
  }

  function readReviewDrafts() {
    try {
      var raw = window.localStorage.getItem(REVIEW_DRAFTS_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeReviewDrafts(drafts) {
    try {
      window.localStorage.setItem(REVIEW_DRAFTS_KEY, JSON.stringify(drafts));
      return true;
    } catch (e) {
      return false;
    }
  }

  function setReviewDraftStatus(saved) {
    var el = $("rv-draft-status");
    if (!el) return;
    el.hidden = !saved;
    el.textContent = saved ? "Draft kept — come back anytime until sent or abandoned." : "";
  }

  function readReviewValue(id) {
    var el = $(id);
    if (!el) return "";
    return el.type === "checkbox" ? !!el.checked : (el.value || "");
  }

  function reviewDraftHasContent(draft) {
    if (!draft) return false;
    if (draft.project || draft.caseDetailsLocked) return true;
    var groups = [draft.fields || {}, draft.email || {}];
    for (var g = 0; g < groups.length; g++) {
      var vals = groups[g];
      for (var key in vals) {
        if (key === "rv-include-cause") continue;
        if (Object.prototype.hasOwnProperty.call(vals, key) && vals[key] !== "" && vals[key] !== false && vals[key] !== null && vals[key] !== undefined) return true;
      }
    }
    return false;
  }

  function collectReviewDraft() {
    var fields = {};
    var email = {};
    REVIEW_CASE_FIELD_IDS.forEach(function (id) { fields[id] = readReviewValue(id); });
    REVIEW_EMAIL_FIELD_IDS.forEach(function (id) { email[id] = readReviewValue(id); });
    return {
      project: ($("rv-project") && $("rv-project").value) || "",
      fields: fields,
      email: email,
      caseDetailsLocked: !!caseLocked,
      savedAt: new Date().toISOString()
    };
  }

  function saveReviewDraftNow() {
    reviewDraftSaveTimer = null;
    if (skipDraftSave || !$("rv-email-body")) return;
    var key = reviewDraftKey();
    if (!resumeCleared) setReviewLastKey(key);
    var draft = collectReviewDraft();
    var drafts = readReviewDrafts();
    if (!reviewDraftHasContent(draft)) {
      delete drafts[key];
      writeReviewDrafts(drafts);
      setReviewDraftStatus(false);
      return;
    }
    drafts[key] = draft;
    if (writeReviewDrafts(drafts)) setReviewDraftStatus(true);
  }

  function scheduleReviewDraftSave() {
    if (!$("rv-email-body") || resumeCleared) return;
    if (reviewDraftSaveTimer) clearTimeout(reviewDraftSaveTimer);
    reviewDraftSaveTimer = setTimeout(saveReviewDraftNow, 180);
  }

  function clearReviewDraft(key) {
    if (reviewDraftSaveTimer) clearTimeout(reviewDraftSaveTimer);
    reviewDraftSaveTimer = null;
    var drafts = readReviewDrafts();
    delete drafts[key || reviewDraftKey()];
    writeReviewDrafts(drafts);
    setReviewDraftStatus(false);
  }

  function ensureProjectSelectValue(name) {
    var sel = $("rv-project");
    if (!sel || !name) return;
    var exists = false;
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === name) { exists = true; break; }
    }
    if (!exists) {
      var opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }
    sel.value = name;
  }

  function restoreReviewDraft(key) {
    var draft = readReviewDrafts()[key];
    if (!draft || !$("rv-email-body")) {
      setReviewDraftStatus(false);
      return false;
    }
    var project = draft.project || "";
    if (project) ensureProjectSelectValue(project);
    else if ($("rv-project")) $("rv-project").value = "";
    applyProjectChange({ keepRating: draft.fields && draft.fields["rv-rating"], skipDraft: true, keepEmail: true });
    var fields = draft.fields || {};
    REVIEW_CASE_FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el || el.readOnly || !Object.prototype.hasOwnProperty.call(fields, id)) return;
      if (el.type === "checkbox") el.checked = !!fields[id];
      else el.value = fields[id] == null ? "" : fields[id];
    });
    setExtraVisibility(matchProject(($("rv-project") && $("rv-project").value) || ""));
    var email = draft.email || {};
    REVIEW_EMAIL_FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el || !Object.prototype.hasOwnProperty.call(email, id)) return;
      el.value = email[id] == null ? "" : email[id];
      if (el.value) el.dataset.userEdited = "1";
    });
    var hasEmail = REVIEW_EMAIL_FIELD_IDS.some(function (id) { return !!readReviewValue(id); });
    var emptyHint = $("rv-email-empty-hint");
    if (emptyHint) emptyHint.hidden = hasEmail;
    var emailBadge = $("rv-email-badge");
    if (emailBadge) emailBadge.textContent = hasEmail ? "Generated" : "Draft";
    caseLocked = !!draft.caseDetailsLocked;
    syncCaseLock();
    setReviewDraftStatus(true);
    return true;
  }

  function initReviewResume() {
    if (!$("rv-email-body")) return false;
    var compose = /(?:\?|&)compose=1(?:&|$)/.test(window.location.search);
    if (compose) {
      clearResumeKey();
      clearReviewDraft("blank");
      resumeCleared = false;
      skipDraftSave = false;
      return false;
    }
    if (!cfg.caseId) {
      var last = getReviewLastKey();
      var ids = Array.isArray(cfg.waitingIds) ? cfg.waitingIds : [];
      if (last && last !== "blank" && ids.indexOf(last) >= 0) {
        window.location.replace((cfg.base || "/HHSRSreporter") + "/review/" + encodeURIComponent(last));
        return true;
      }
      if (last && last !== "blank") setReviewLastKey("blank");
      return false;
    }
    setReviewLastKey(cfg.caseId);
    return false;
  }

  function wireReviewDraftPersistence() {
    if (!$("rv-email-body")) return;
    REVIEW_CASE_FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var evt = (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") ? "change" : "input";
      el.addEventListener(evt, scheduleReviewDraftSave);
    });
    window.addEventListener("pagehide", saveReviewDraftNow);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveReviewDraftNow();
    });
    var markForm = $("mark-actioned-form");
    if (markForm) {
      markForm.addEventListener("submit", function (ev) {
        if (!window.confirm("Confirm you have copied this draft and are ready to send (or have already sent) from Outlook?")) {
          ev.preventDefault();
          return;
        }
        skipDraftSave = true;
        clearReviewDraft(cfg.caseId || "blank");
        clearResumeKey();
      });
    }
    var abandonForm = $("abandon-claim-form");
    if (abandonForm) {
      abandonForm.addEventListener("submit", function () {
        skipDraftSave = true;
        clearReviewDraft(cfg.caseId || "blank");
        clearResumeKey();
      });
    }
    var createBtn = $("btn-create-plain-email");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        clearResumeKey();
        if (!cfg.caseId) clearReviewDraft("blank");
      });
    }
  }

  /* Camera icon → Review-style rounded photo thumbs. */
  var attPopEl = null;
  var attPopThumbs = null;
  var attPopAnchor = null;
  var attPopPinned = false;
  var attPopHideTimer = null;

  function ensureAttPhotoPop() {
    if (attPopEl) return attPopEl;
    attPopEl = document.createElement("div");
    attPopEl.className = "photo-att-pop";
    attPopEl.id = "photo-att-pop";
    attPopEl.setAttribute("role", "dialog");
    attPopEl.setAttribute("aria-label", "Case photos");
    attPopEl.setAttribute("aria-hidden", "true");
    attPopEl.innerHTML = '<div class="photo-thumbs" aria-label="Case photo thumbnails"></div>';
    document.body.appendChild(attPopEl);
    attPopThumbs = attPopEl.querySelector(".photo-thumbs");
    attPopEl.addEventListener("mouseenter", function () {
      if (attPopHideTimer) {
        clearTimeout(attPopHideTimer);
        attPopHideTimer = null;
      }
    });
    attPopEl.addEventListener("mouseleave", function (e) {
      if (attPopPinned) return;
      var related = e.relatedTarget;
      if (related && attPopAnchor && (attPopAnchor === related || attPopAnchor.contains(related))) return;
      scheduleHideAttPop();
    });
    return attPopEl;
  }

  function photosFromButton(btn) {
    var raw = btn.getAttribute("data-photos") || "";
    try {
      var parsed = JSON.parse(decodeURIComponent(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function renderAttPopThumbs(photos) {
    ensureAttPhotoPop();
    if (!attPopThumbs) return;
    var html = "";
    for (var i = 0; i < photos.length; i++) {
      var p = photos[i] || {};
      var src = p.url || "";
      var cap = p.caption || "Photo";
      var safe = function (value) {
        return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
      };
      html += '<div class="photo-thumb" title="' + safe(cap) + '">' +
        '<img src="' + safe(src) + '" alt="' + safe(cap) + '" draggable="false" />' +
        '<span class="photo-caption">' + safe(cap) + "</span></div>";
    }
    attPopThumbs.innerHTML = html;
  }

  function positionAttPop(anchor) {
    var pop = ensureAttPhotoPop();
    if (!anchor || !pop) return;
    pop.style.left = "-9999px";
    pop.style.top = "0px";
    pop.classList.add("is-visible");
    var popW = pop.offsetWidth || 220;
    var popH = pop.offsetHeight || 110;
    var rect = anchor.getBoundingClientRect();
    var gap = 8;
    var left = rect.left + (rect.width / 2) - (popW / 2);
    var top = rect.bottom + gap;
    if (left < 8) left = 8;
    if (left + popW > window.innerWidth - 8) left = Math.max(8, window.innerWidth - popW - 8);
    if (top + popH > window.innerHeight - 8) top = rect.top - popH - gap;
    if (top < 8) top = 8;
    pop.style.left = Math.round(left) + "px";
    pop.style.top = Math.round(top) + "px";
  }

  function scheduleHideAttPop() {
    if (attPopHideTimer) clearTimeout(attPopHideTimer);
    attPopHideTimer = setTimeout(function () {
      attPopHideTimer = null;
      if (!attPopPinned) hideAttPop(false);
    }, 160);
  }

  function hideAttPop(immediate) {
    if (attPopHideTimer) {
      clearTimeout(attPopHideTimer);
      attPopHideTimer = null;
    }
    if (attPopAnchor) attPopAnchor.classList.remove("is-pop-open");
    attPopAnchor = null;
    attPopPinned = false;
    var pop = attPopEl || document.getElementById("photo-att-pop");
    if (!pop) return;
    pop.setAttribute("aria-hidden", "true");
    pop.classList.remove("is-visible");
    if (immediate) pop.style.transition = "";
  }

  function showAttPop(anchor, pinned) {
    if (!anchor) return;
    var photos = photosFromButton(anchor);
    if (!photos.length) return;
    if (attPopHideTimer) {
      clearTimeout(attPopHideTimer);
      attPopHideTimer = null;
    }
    if (attPopAnchor && attPopAnchor !== anchor) attPopAnchor.classList.remove("is-pop-open");
    attPopAnchor = anchor;
    attPopPinned = !!pinned;
    anchor.classList.add("is-pop-open");
    ensureAttPhotoPop();
    attPopEl.setAttribute("aria-hidden", "false");
    renderAttPopThumbs(photos);
    positionAttPop(anchor);
  }

  function wireAttPhotoPopovers() {
    document.addEventListener("mouseover", function (e) {
      var btn = e.target.closest && e.target.closest(".photo-att-icon");
      if (!btn) return;
      if (attPopPinned && attPopAnchor === btn) return;
      showAttPop(btn, false);
    });
    document.addEventListener("mouseout", function (e) {
      var btn = e.target.closest && e.target.closest(".photo-att-icon");
      if (!btn) return;
      if (attPopPinned) return;
      var related = e.relatedTarget;
      if (related && (btn.contains(related) || (attPopEl && attPopEl.contains(related)))) return;
      scheduleHideAttPop();
    });
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest(".photo-att-icon");
      if (btn) {
        e.preventDefault();
        e.stopPropagation();
        if (attPopPinned && attPopAnchor === btn && attPopEl && attPopEl.classList.contains("is-visible")) {
          hideAttPop(true);
          return;
        }
        showAttPop(btn, true);
        return;
      }
      if (!attPopEl || !attPopEl.classList.contains("is-visible")) return;
      if (e.target.closest && e.target.closest("#photo-att-pop")) return;
      hideAttPop(true);
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") hideAttPop(true);
    });
    window.addEventListener("scroll", function () {
      if (attPopEl && attPopEl.classList.contains("is-visible")) hideAttPop(true);
    }, true);
    window.addEventListener("resize", function () {
      if (attPopEl && attPopEl.classList.contains("is-visible")) hideAttPop(true);
    });
  }

  if (!reviewLeavingForResume) wireReviewDraftPersistence();
  wireAttPhotoPopovers();
})();
