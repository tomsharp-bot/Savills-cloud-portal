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

  function portalProjectName(name) {
    var raw = String(name || "").trim();
    if (!raw) return "";
    var aliases = cfg.projectAliases || {};
    var direct = aliases[raw] || aliases[raw.toLowerCase()];
    return direct || raw;
  }

  function matchProject(name) {
    var key = portalProjectName(name);
    if (!key) return null;
    if (DEMO[key]) return DEMO[key];
    var lower = key.toLowerCase();
    var keys = Object.keys(DEMO);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === lower) return DEMO[keys[i]];
    }
    return null;
  }

  function caseRatingList(scheme) {
    if (cfg.mode === "filled" && scheme !== "OLD") {
      return ["Low", "Medium", "High - Emergency risk", "High - Significant risk"];
    }
    return (RATING_OPTIONS[scheme] || RATING_OPTIONS.NEW).slice();
  }

  function fillRatingOptions(scheme, preferred) {
    var sel = $("rv-rating");
    if (!sel) return;
    var opts = caseRatingList(scheme);
    var cur = preferred != null ? preferred : sel.value;
    sel.innerHTML = '<option value="">Select…</option>';
    opts.forEach(function (r) {
      var opt = document.createElement("option");
      opt.value = r;
      opt.textContent = r;
      sel.appendChild(opt);
    });
    if (cfg.mode === "filled" && cur && opts.indexOf(cur) < 0) {
      var extra = document.createElement("option");
      extra.value = cur;
      extra.textContent = cur;
      sel.appendChild(extra);
    }
    if (cur) sel.value = cur;
  }

  function fieldText(id) {
    var el = $(id);
    return el ? String(el.value || "").replace(/^\s+|\s+$/g, "") : "";
  }

  function officeRatingNow() {
    return {
      rating: fieldText("rv-rating"),
      baseline: surveyorValue("rating"),
      project: matchProject(($("rv-project") && $("rv-project").value) || ""),
    };
  }

  function officeDroppedNow() {
    var now = officeRatingNow();
    return officeDropped(now.project, now.baseline, now.rating);
  }

  /** Clear or restore before visibility is read, so a drop hides the extras and switching back shows the surveyor's answers. */
  function applyOfficeRestrictorValues() {
    if (cfg.mode !== "filled" || !cfg.surveyorCheck || sentStage()) return;
    if (officeDroppedNow()) clearHighExtras();
    else if (officeClearedExtras) restoreSurveyorExtras();
  }

  function setExtraVisibility(projectCfg) {
    applyOfficeRestrictorValues();
    var extras = (projectCfg && projectCfg.extras) || {};
    var site = (projectCfg && projectCfg.siteForm) || {};
    var nodes = document.querySelectorAll("#rv-case-form .project-extra");
    var hazard = fieldText("rv-hazard");
    var rating = fieldText("rv-rating");
    var causeValue = fieldText("rv-cause");
    var callStored = fieldText("rv-call-ref") || fieldText("rv-call-reason") || fieldText("rv-call-notes");
    var restrictorStored = fieldText("rv-restrictor-count") || fieldText("rv-restrictor-locations") || fieldText("rv-restrictor-material");
    var damp = /damp/i.test(hazard) && /mould|mold/i.test(hazard);
    var show = {
      calls: !!(extras.calls || (site.mtvh && (rating === "High - Emergency risk" || callStored))),
      survey_date: !!(extras.survey_date || fieldText("rv-survey-date")),
      onward: !!extras.onward,
      cause: !!(site.vulnerabilities && (damp || causeValue)),
      vulnerabilities: !!extras.vulnerabilities,
      work_order: !!extras.work_order,
      online_form: !!extras.online_form,
      other_details: !!projectCfg,
      restrictors: !!(site.mtvh && (hazard === "Falling Between Levels" || restrictorStored))
    };
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-extra");
      var visible = !!show[key];
      nodes[i].hidden = !visible;
      var inputs = nodes[i].querySelectorAll("input, select, textarea");
      for (var j = 0; j < inputs.length; j++) {
        if (inputs[j].type === "hidden") continue;
        inputs[j].disabled = !visible;
      }
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
    syncCallRefFields();
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
    syncOfficeCheck();
  }

  var officeHoldMessage = "";
  var officeRatingSeen = null;
  var officeClearedExtras = false;
  var HIGH_ONLY_LINE = /^•\s*(?:how many window restrictors are missing|number of window restrictors missing|window restrictors missing|window material|locations?)\s*:/i;

  function ratingText(rating) {
    return String(rating || "").replace(/^\s+|\s+$/g, "").toLowerCase();
  }

  function usesSevereScale(projectCfg) {
    return !!(projectCfg && projectCfg.ratingScheme === "OLD");
  }

  function isNewHigh(rating) {
    var text = ratingText(rating);
    return text === "high - emergency risk" || text === "high - significant risk";
  }

  function isNewLower(rating) {
    var text = ratingText(rating);
    return text === "low" || text === "medium";
  }

  function officeDropped(projectCfg, fromRating, toRating) {
    if (isNewHigh(fromRating) && isNewLower(toRating)) return true;
    return usesSevereScale(projectCfg) && ratingText(fromRating) === "severe" && (ratingText(toRating) === "slight" || ratingText(toRating) === "moderate");
  }

  function officeRaised(projectCfg, fromRating, toRating) {
    if (isNewLower(fromRating) && isNewHigh(toRating)) return true;
    return usesSevereScale(projectCfg) && (ratingText(fromRating) === "slight" || ratingText(fromRating) === "moderate") && ratingText(toRating) === "severe";
  }

  function officeHighNow(projectCfg, rating) {
    if (isNewHigh(rating)) return true;
    return usesSevereScale(projectCfg) && ratingText(rating) === "severe";
  }

  function raiseWord(projectCfg, rating) {
    return usesSevereScale(projectCfg) && ratingText(rating) === "severe" ? "Severe" : "High";
  }

  function surveyorValue(key) {
    var check = cfg.surveyorCheck || {};
    return String(check[key] || "").replace(/^\s+|\s+$/g, "");
  }

  function projectCollectsCallReference(projectCfg, rating) {
    if (!projectCfg) return false;
    var extras = projectCfg.extras || {};
    var site = projectCfg.siteForm || {};
    if (extras.calls || site.calls) return true;
    return !!(site.mtvh && String(rating || "").replace(/^\s+|\s+$/g, "").toLowerCase() === "high - emergency risk");
  }

  function surveyorCompletedCall() {
    return !!(surveyorValue("clientCallReference") || surveyorValue("callOutcome") || surveyorValue("callNotes"));
  }

  function setExtraInputs(node, disabled) {
    if (!node) return;
    var inputs = node.querySelectorAll("input, select, textarea");
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].type === "hidden") continue;
      inputs[i].disabled = disabled;
    }
  }

  function extraBlock(key) {
    return document.querySelector('#rv-case-form .project-extra[data-extra="' + key + '"]');
  }

  function setOfficeStar(key, on) {
    var nodes = document.querySelectorAll('[data-office-star="' + key + '"]');
    for (var i = 0; i < nodes.length; i++) nodes[i].hidden = !on;
  }

  function writeRestrictor(id, value) {
    var el = $(id);
    if (el) el.value = value;
  }

  function clearHighExtras() {
    officeClearedExtras = true;
    writeRestrictor("rv-restrictor-count", "");
    writeRestrictor("rv-restrictor-locations", "");
    writeRestrictor("rv-restrictor-material", "");
  }

  function restoreSurveyorExtras() {
    if (!officeClearedExtras) return;
    officeClearedExtras = false;
    writeRestrictor("rv-restrictor-count", surveyorValue("restrictorMissingCount"));
    writeRestrictor("rv-restrictor-locations", surveyorValue("restrictorLocations"));
    writeRestrictor("rv-restrictor-material", surveyorValue("restrictorMaterial"));
  }

  function stripHighExtrasFromDraft() {
    var bodyEl = $("hhsrs-body");
    if (!bodyEl || bodyEl.readOnly) return;
    var next = String(bodyEl.value || "")
      .split("\n")
      .filter(function (line) { return !HIGH_ONLY_LINE.test(String(line || "").replace(/^\s+|\s+$/g, "")); })
      .join("\n");
    if (next !== bodyEl.value) bodyEl.value = next;
  }

  function markEmailStale() {
    if (sentStage()) return;
    emailGenerated = false;
    var badge = $("rv-email-badge");
    if (badge && /generated/i.test(badge.textContent || "")) badge.textContent = "Draft";
  }

  function syncOfficeCheck() {
    officeHoldMessage = "";
    if (cfg.mode !== "filled" || !cfg.surveyorCheck || sentStage()) {
      ["restrictorMissingCount", "restrictorLocations", "restrictorMaterial", "clientCallReference"].forEach(function (key) {
        setOfficeStar(key, false);
      });
      syncNeededMarks();
      return;
    }
    var rating = fieldText("rv-rating");
    var baseline = surveyorValue("rating");
    var projectCfg = matchProject(($("rv-project") && $("rv-project").value) || "");
    var dropped = officeDropped(projectCfg, baseline, rating);
    var raised = officeRaised(projectCfg, baseline, rating);
    var ratingChanged = officeRatingSeen !== null && officeRatingSeen !== rating;
    officeRatingSeen = rating;
    if (dropped) stripHighExtrasFromDraft();
    var surveyorHadRestrictors = !!(
      surveyorValue("restrictorMissingCount") ||
      surveyorValue("restrictorLocations") ||
      surveyorValue("restrictorMaterial")
    );
    var restrictors = extraBlock("restrictors");
    if (dropped && restrictors) {
      restrictors.hidden = true;
      setExtraInputs(restrictors, true);
    } else if (restrictors && (raised || (officeHighNow(projectCfg, rating) && surveyorHadRestrictors))) {
      restrictors.hidden = false;
      setExtraInputs(restrictors, false);
    }
    var wantsCall = raised && projectCollectsCallReference(projectCfg, rating);
    var calls = extraBlock("calls");
    if (wantsCall && calls) {
      calls.hidden = false;
      setExtraInputs(calls, false);
      syncCallRefFields();
    }
    var missingCount = raised && !surveyorValue("restrictorMissingCount") && !fieldText("rv-restrictor-count");
    var missingMaterial = raised && !surveyorValue("restrictorMaterial") && !fieldText("rv-restrictor-material");
    var missingLocations = raised && !surveyorValue("restrictorLocations") && !fieldText("rv-restrictor-locations");
    var missingCall = wantsCall && !surveyorCompletedCall() && !fieldText("rv-call-ref");
    setOfficeStar("restrictorMissingCount", raised && !surveyorValue("restrictorMissingCount"));
    setOfficeStar("restrictorMaterial", raised && !surveyorValue("restrictorMaterial"));
    setOfficeStar("restrictorLocations", raised && !surveyorValue("restrictorLocations"));
    setOfficeStar("clientCallReference", wantsCall && !surveyorCompletedCall());
    var note = $("rv-office-note");
    if (note) {
      if (raised && (missingCount || missingMaterial || missingLocations || missingCall)) {
        note.dataset.office = "rating";
        note.textContent = "Raised to " + raiseWord(projectCfg, rating) + ", so the office fills the extra details. Red stars mean they are still needed. Send stays off until they are filled.";
      } else if (dropped) {
        note.dataset.office = "rating";
        note.textContent = "Dropped below " + raiseWord(projectCfg, baseline) + ", so the extra details are not needed.";
      } else if (note.dataset.office === "rating") {
        note.textContent = "";
        delete note.dataset.office;
      }
    }
    if (missingCount || missingMaterial || missingLocations || missingCall) {
      officeHoldMessage = "Raised to " + raiseWord(projectCfg, rating) + ". Fill the extra details before sending.";
    }
    if (ratingChanged) markEmailStale();
    syncNeededMarks();
  }

  var MAX_CASE_PHOTOS = 4;
  var casePhotos = [];
  var photoSeq = 0;
  var emailGenerated = false;
  var caseLocked = false;
  var DRAG_HINT = "Drag a photo into your email draft. If that doesn’t work, download the photo.";

  function sentStage() {
    return !!(cfg.send && cfg.send.sent);
  }

  function dismissedStage() {
    var panel = $("rv-case-panel");
    return !!(panel && panel.classList && panel.classList.contains("is-dismissed-case"));
  }

  function lockSentEmailFields() {
    var nodes = document.querySelectorAll(
      ".email-draft-panel.is-sent-lock .field-locked, .email-draft-panel.is-sent-lock .field-with-copy, .email-draft-panel.is-sent-lock .attach-block, .email-draft-panel.is-sent-lock .email-photo-tools, .email-draft-panel.is-dismissed-lock .field-locked, .email-draft-panel.is-dismissed-lock .field-with-copy, .email-draft-panel.is-dismissed-lock .attach-block, .email-draft-panel.is-dismissed-lock .email-photo-tools"
    );
    for (var i = 0; i < nodes.length; i++) nodes[i].inert = true;
  }

  function syncEmailPanelLock() {
    var panel = document.querySelector(".email-draft-panel");
    if (!panel || !panel.classList) return;
    if (dismissedStage()) {
      panel.classList.remove("is-pre-generate");
      panel.classList.add("is-dismissed-lock");
      lockSentEmailFields();
      return;
    }
    if (sentStage()) {
      panel.classList.remove("is-pre-generate");
      lockSentEmailFields();
      return;
    }
    var waiting = !emailGenerated;
    panel.classList.toggle("is-pre-generate", waiting);
    if (!panel.querySelectorAll) return;
    var nodes = panel.querySelectorAll(
      ".field-locked, .field-with-copy, .attach-block, .signature-added-note, .email-photo-tools"
    );
    for (var i = 0; i < nodes.length; i++) nodes[i].inert = waiting;
  }

  function clearEmailDraft() {
    if (sentStage()) return;
    ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"].forEach(function (id) {
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
    var sent = sentStage();
    var dismissed = dismissedStage();
    var name = ($("rv-project") && $("rv-project").value) || "";
    var projectCfg = matchProject(name);
    var fields = $("rv-case-fields");
    var hint = $("rv-project-hint");
    var generateBtn = $("btn-generate-email");
    var genRow = document.querySelector("#rv-email-generate-row");
    if (fields) {
      // After send, and while a case is dismissed, CSS supplies the same grey
      // as Generate email. inert keeps the fields read-only without the extra
      // browser disabled fade.
      if (sent || dismissed) fields.removeAttribute("disabled");
      else if (!name && cfg.mode !== "filled") fields.setAttribute("disabled", "disabled");
      else fields.removeAttribute("disabled");
      fields.inert = sent || dismissed;
    }
    if (genRow) genRow.inert = sent || dismissed;
    if (generateBtn) generateBtn.disabled = sent || dismissed || !name;
    if (sent || dismissed) lockSentEmailFields();
    if (dismissed) {
      var projectBlock = $("rv-project-block");
      var project = $("rv-project");
      if (project) project.removeAttribute("disabled");
      if (projectBlock) projectBlock.inert = true;
    }
    if (hint && !sent && !dismissed) {
      hint.textContent = projectCfg
        ? projectCfg.hint
        : "Choose the project first. Extra fields and the email draft follow its rules.";
    }
    fillRatingOptions(projectCfg ? projectCfg.ratingScheme : "NEW", opts.keepRating);
    setExtraVisibility(projectCfg);
    if (sent || dismissed) return;
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
    var caseAdd = $("rv-case-photo-add");
    if (caseAdd) caseAdd.hidden = isBlank;
    var drop = $("rv-photos-dropzone");
    if (drop) drop.classList.toggle("is-disabled", casePhotos.length >= MAX_CASE_PHOTOS);
    var countEl = $("rv-photos-count");
    if (countEl) countEl.textContent = casePhotos.length + " / " + MAX_CASE_PHOTOS;
  }

  function appendThumb(grid, photo, opts) {
    var card = document.createElement("div");
    card.className = "photo-thumb photo-zoom " + (opts.email ? "email-photo-thumb" : "case-photo-thumb");
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
    var cap = document.createElement("figcaption");
    preview.appendChild(cap);
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
    var cap = preview.querySelector("figcaption");
    var sourceCap = card.querySelector("figcaption, .photo-caption");
    if (cap) cap.textContent = sourceCap ? sourceCap.textContent : "";
    var rect = card.getBoundingClientRect();
    var width = 340;
    var x = rect.right + 12;
    var y = rect.top;
    if (x + width + 16 > window.innerWidth) x = Math.max(8, rect.left - width - 12);
    preview.hidden = false;
    preview.style.left = Math.round(x) + "px";
    preview.style.top = Math.round(Math.max(8, y)) + "px";
    var height = preview.offsetHeight || 280;
    if (y + height > window.innerHeight) {
      preview.style.top = Math.round(Math.max(8, window.innerHeight - height - 8)) + "px";
    }
  }

  function thumbFromEvent(target) {
    return target && target.closest ? target.closest(".photo-zoom, .case-photo-thumb, .email-photo-thumb") : null;
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
      appendThumb(grid, photo, { email: false, removable: canRemove || !!photo.added });
    });
    if (caseLocked) setEmailPhotoTools(true);
  }

  function syncCaseLock() {
    var panel = $("rv-case-panel");
    if (panel) panel.classList.toggle("is-drafted", caseLocked);
    var photos = $("rv-photos-block");
    // Filled site-form cases keep the case photos on screen when the draft locks.
    // Blank mode ('Create new email') still hides them with the other case fields.
    if (photos) photos.hidden = caseLocked && cfg.mode !== "filled";
    var amend = $("btn-amend-case");
    if (amend) amend.hidden = !caseLocked;
    setEmailPhotoTools(caseLocked);
    syncEmailPanelLock();
  }

  function amendCaseDetails() {
    if (dismissedStage()) return;
    if (cfg.send && cfg.send.sent) return;
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
    if ($("rv-attach-block")) {
      box.hidden = true;
      return;
    }
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
    syncAddedPhotoForm();
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

  function isAddedPhotoFile(file) {
    var type = String((file && file.type) || "").toLowerCase();
    if (/^image\/(jpeg|jpg|png|webp|heic|heif)/.test(type)) return true;
    return /\.(jpe?g|png|webp|heic|heif)$/i.test(String((file && file.name) || ""));
  }

  function setCasePhotoMsg(text) {
    var msg = $("rv-case-photo-msg");
    if (!msg) return;
    msg.textContent = text || "";
    msg.hidden = !text;
  }

  function casePhotoDropOpen() {
    if (sentStage() || dismissedStage() || caseLocked) return false;
    var block = $("rv-photos-block");
    return !!(block && !block.hidden);
  }

  function addDroppedCasePhotos(fileList) {
    if (!casePhotoDropOpen() || !fileList || !fileList.length) return;
    var rejected = false;
    var capped = false;
    for (var i = 0; i < fileList.length; i++) {
      var file = fileList[i];
      if (!file) continue;
      if (casePhotos.length >= MAX_CASE_PHOTOS) {
        capped = true;
        break;
      }
      if (!isAddedPhotoFile(file)) {
        rejected = true;
        continue;
      }
      var url = URL.createObjectURL(file);
      var base = (file.name || "photo").replace(/\.[^.]+$/, "");
      var added = addCasePhoto({
        id: nextPhotoId(),
        name: file.name || "photo.jpg",
        caption: base || "Photo",
        mime: file.type || "image/jpeg",
        blob: file,
        blobUrl: url,
        url: url,
        added: true,
      });
      if (!added) {
        URL.revokeObjectURL(url);
        capped = true;
        break;
      }
    }
    if (capped) setCasePhotoMsg("Add up to 4 photos.");
    else if (rejected) setCasePhotoMsg("Photos must be JPEG, PNG, WebP or HEIC.");
    else setCasePhotoMsg("");
    syncAddedPhotoForm();
  }

  function syncAddedPhotoForm() {
    var form = $("rv-send-form");
    if (!form) return;
    var has = false;
    for (var i = 0; i < casePhotos.length; i++) {
      if (casePhotos[i] && casePhotos[i].added && casePhotos[i].blob) has = true;
    }
    if (has) form.setAttribute("enctype", "multipart/form-data");
    else form.removeAttribute("enctype");
  }

  function wireCasePhotoDrop(target, mark) {
    if (!target) return;
    target.addEventListener("dragenter", function (e) {
      e.preventDefault();
      if (mark) target.classList.add("is-dragover");
    });
    target.addEventListener("dragover", function (e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      if (mark) target.classList.add("is-dragover");
    });
    target.addEventListener("dragleave", function () {
      if (mark) target.classList.remove("is-dragover");
    });
    target.addEventListener("drop", function (e) {
      e.preventDefault();
      if (mark) target.classList.remove("is-dragover");
      addDroppedCasePhotos(e.dataTransfer && e.dataTransfer.files);
    });
  }

  function queueAddedCasePhotos(form) {
    var added = [];
    casePhotos.forEach(function (photo) {
      if (photo && photo.added && photo.blob) added.push(photo);
    });
    if (!added.length || !form) return;
    form.setAttribute("enctype", "multipart/form-data");
    var input = $("rv-send-new-photos");
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.id = "rv-send-new-photos";
      input.name = "photos";
      input.multiple = true;
      input.hidden = true;
      form.appendChild(input);
    }
    if (typeof DataTransfer === "undefined") return;
    try {
      var dt = new DataTransfer();
      added.forEach(function (photo) {
        var file = photo.blob;
        if (typeof File !== "undefined" && file instanceof File) dt.items.add(file);
        else dt.items.add(new File([file], photo.name || "photo.jpg", { type: photo.mime || file.type || "image/jpeg" }));
      });
      input.files = dt.files;
    } catch (err) {}
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
    var caseDrop = $("rv-case-photo-drop");
    var caseFile = $("rv-case-photo-file");
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
    wireCasePhotoDrop(caseDrop, true);
    wireCasePhotoDrop(caseGrid, false);
    if (caseFile) {
      caseFile.addEventListener("change", function () {
        addDroppedCasePhotos(caseFile.files);
        caseFile.value = "";
      });
    }
  }

  function callsExtraVisible() {
    var node = document.querySelector('#rv-case-form .project-extra[data-extra="calls"]');
    return !!(node && !node.hidden);
  }

  function composeBlankCallNotes(reason, extra) {
    extra = String(extra || "").replace(/^\s+|\s+$/g, "");
    if (reason === "Other") return extra ? "Other — " + extra : "";
    if (!reason) return extra;
    return extra ? reason + " — " + extra : reason;
  }

  function syncCallRefFields() {
    var refEl = $("rv-call-ref");
    var blank = $("rv-call-blank");
    var reasonEl = $("rv-call-reason");
    var notesEl = $("rv-call-notes");
    var visible = callsExtraVisible();
    var ref = refEl ? String(refEl.value || "").replace(/^\s+|\s+$/g, "") : "";
    if (refEl) refEl.disabled = !visible;
    var showBlank = visible && !ref;
    if (blank) blank.hidden = !showBlank;
    if (reasonEl) reasonEl.disabled = !showBlank;
    if (notesEl) notesEl.disabled = !showBlank;
  }

  function collectDraftPayload() {
    var visible = callsExtraVisible();
    var ref = visible && $("rv-call-ref") ? String($("rv-call-ref").value || "").replace(/^\s+|\s+$/g, "") : "";
    var reason = visible && !ref && $("rv-call-reason") ? String($("rv-call-reason").value || "").replace(/^\s+|\s+$/g, "") : "";
    var extra = visible && !ref && $("rv-call-notes") ? String($("rv-call-notes").value || "").replace(/^\s+|\s+$/g, "") : "";
    var callOutcome = "";
    var callNotes = "";
    if (visible && reason) {
      callOutcome = "Attempted";
      callNotes = composeBlankCallNotes(reason, extra);
    } else if (visible && !ref && extra) {
      callNotes = extra;
    }
    return {
      caseId: cfg.caseId || "",
      projectName: ($("rv-project") && $("rv-project").value) || "",
      address: ($("rv-address") && $("rv-address").value) || "",
      uprn: ($("rv-uprn") && $("rv-uprn").value) || "",
      surveyDate: ($("rv-survey-date") && $("rv-survey-date").value) || "",
      hazard: ($("rv-hazard") && $("rv-hazard").value) || "",
      rating: ($("rv-rating") && $("rv-rating").value) || "",
      notes: ($("rv-notes") && $("rv-notes").value) || "",
      callOutcome: callOutcome,
      clientCallReference: ref,
      callNotes: callNotes,
      suspectedCause: ($("rv-cause") && $("rv-cause").value) || "",
      includeCause: !!($("rv-include-cause") && $("rv-include-cause").checked),
      vulnerabilities: ($("rv-vulnerabilities") && $("rv-vulnerabilities").value) || "",
      onwardTopic: ($("rv-onward-topic") && $("rv-onward-topic").value) || "",
      cat1Confirmed: !!($("rv-cat1") && $("rv-cat1").checked),
      workOrder: ($("rv-work-order") && $("rv-work-order").value) || "",
      otherDetails: ($("rv-other-details") && $("rv-other-details").value) || "",
      restrictorMissingCount: ($("rv-restrictor-count") && $("rv-restrictor-count").value) || "",
      restrictorLocations: ($("rv-restrictor-locations") && $("rv-restrictor-locations").value) || "",
      restrictorMaterial: ($("rv-restrictor-material") && $("rv-restrictor-material").value) || "",
      photoCount: casePhotos.length,
    };
  }

  function fillDraftFields(draft) {
    var toEl = $("hhsrs-to");
    var ccEl = $("hhsrs-cc");
    var bccEl = $("hhsrs-bcc");
    var subEl = $("hhsrs-subject");
    var bodyEl = $("hhsrs-body");
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
    syncSendButton();
  }

  function generateEmail() {
    if (dismissedStage() || sentStage()) return;
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
        ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"].forEach(function (id) {
          var el = $(id);
          if (el) delete el.dataset.userEdited;
        });
        fillDraftFields(data);
        if (note) note.textContent = "Email generated. Case details are locked — Amend case details to edit, then Generate email again.";
        saveReviewDraftNow();
        showClientEmailDraft();
      })
      .catch(function () {
        if (note) note.textContent = "Could not prepare the client email. Check the case details and try again.";
      })
      .then(function () {
        if (btn) btn.disabled = !!(cfg.send && cfg.send.sent) || dismissedStage() || !(($("rv-project") && $("rv-project").value) || "");
      });
  }

  function clearBlankReview() {
    ["rv-uprn", "rv-surveyor", "rv-address", "rv-hazard", "rv-notes", "rv-call-ref", "rv-call-notes", "rv-cause", "rv-vulnerabilities", "rv-work-order", "rv-online-action", "rv-internal-notes"].forEach(function (id) {
      var el = $(id);
      if (el && !el.readOnly) el.value = "";
    });
    if ($("rv-call-reason")) $("rv-call-reason").value = "";
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

  function showClientEmailDraft() {
    var anchor = $("rv-email-draft");
    if (!anchor || typeof anchor.scrollIntoView !== "function") return;
    setTimeout(function () {
      function stickyTopOffset() {
        var topbar = document.querySelector(".topbar");
        if (!topbar || typeof topbar.getBoundingClientRect !== "function" || typeof window.getComputedStyle !== "function") return 0;
        var cs = window.getComputedStyle(topbar);
        if (cs.position !== "sticky" && cs.position !== "fixed") return 0;
        return Math.ceil(topbar.getBoundingClientRect().height);
      }
      function park() {
        if (typeof anchor.getBoundingClientRect !== "function" || typeof window.scrollBy !== "function") return;
        var offset = stickyTopOffset();
        var rect = anchor.getBoundingClientRect();
        var delta = rect.top - offset;
        if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
      }
      anchor.scrollIntoView({ behavior: "auto", block: "start" });
      park();
      if (typeof requestAnimationFrame === "function") requestAnimationFrame(park);
    }, 60);
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
  var REVIEW_SENT_CLEAR_KEY = "hhsrs-review-sent-clear";
  var REVIEW_CASE_FIELD_IDS = ["rv-uprn", "rv-surveyor", "rv-address", "rv-hazard", "rv-rating", "rv-notes", "rv-call-reason", "rv-call-ref", "rv-call-notes", "rv-survey-date", "rv-onward-topic", "rv-cat1", "rv-cause", "rv-include-cause", "rv-vulnerabilities", "rv-work-order", "rv-online-action", "rv-internal-notes"];
  var REVIEW_EMAIL_FIELD_IDS = ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"];
  var reviewDraftSaveTimer = null;
  var resumeCleared = false;
  var skipDraftSave = false;

  ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"].forEach(function (id) {
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
      ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body"].forEach(function (id) {
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

  (function wireBlankStockAddress() {
    if (cfg.mode === "filled") return;
    var uprnEl = $("rv-uprn");
    var addressEl = $("rv-address");
    if (!uprnEl || !addressEl) return;
    var fromStock = false;
    var timer = null;
    var seq = 0;
    var note = $("rv-address-stock");
    function setNote(text) {
      if (!note) return;
      note.textContent = text || "";
      note.hidden = !text;
    }
    function clearStockFill() {
      if (fromStock) {
        addressEl.value = "";
        fromStock = false;
      }
    }
    function lookup() {
      var project = ($("rv-project") && $("rv-project").value) || "";
      var uprn = String(uprnEl.value || "").trim();
      if (!project || !uprn) {
        clearStockFill();
        setNote("");
        return;
      }
      var ticket = ++seq;
      var base = String(cfg.base || "").replace(/\/$/, "");
      fetch(base + "/review/stock-lookup?project=" + encodeURIComponent(project) + "&uprn=" + encodeURIComponent(uprn), {
        headers: { Accept: "application/json" }
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data || {} }; }).catch(function () {
          return { ok: false, data: {} };
        });
      }).then(function (result) {
        if (ticket !== seq) return;
        var match = result.ok && result.data && result.data.match;
        if (!match || !match.line) {
          clearStockFill();
          setNote("Not on this project's stock list. Type the address.");
          return;
        }
        var line = String(match.line);
        var postcode = String(match.postcode || "").trim();
        if (postcode && line.toLowerCase().indexOf(postcode.toLowerCase()) === -1) line += ", " + postcode;
        addressEl.value = line;
        fromStock = true;
        setNote("");
        scheduleReviewDraftSave();
      }).catch(function () {
        if (ticket !== seq) return;
        clearStockFill();
        setNote("Not on this project's stock list. Type the address.");
      });
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(lookup, 250);
    }
    uprnEl.addEventListener("input", schedule);
    uprnEl.addEventListener("change", lookup);
    addressEl.addEventListener("input", function () { fromStock = false; });
    if ($("rv-project")) $("rv-project").addEventListener("change", lookup);
  })();

  var callRefEl = $("rv-call-ref");
  if (callRefEl) {
    callRefEl.addEventListener("input", syncCallRefFields);
    callRefEl.addEventListener("change", syncCallRefFields);
  }
  ["rv-restrictor-count", "rv-restrictor-locations", "rv-restrictor-material", "rv-call-ref"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    var onOfficeField = function () {
      syncOfficeCheck();
      if (emailGenerated) markEmailStale();
      syncSendButton();
    };
    el.addEventListener("input", onOfficeField);
    el.addEventListener("change", onOfficeField);
  });

  var hazardEl = $("rv-hazard");
  if (hazardEl) {
    var refreshExtras = function () {
      var name = ($("rv-project") && $("rv-project").value) || "";
      setExtraVisibility(matchProject(name));
    };
    hazardEl.addEventListener("change", refreshExtras);
    hazardEl.addEventListener("input", refreshExtras);
    var ratingEl = $("rv-rating");
    if (ratingEl) ratingEl.addEventListener("change", refreshExtras);
  }

  wirePhotoPreview(document.body);
  if ($("rv-photo-thumbs") || $("rv-email-photos")) {
    wirePhotoInteractions();
    resetCasePhotos(Array.isArray(cfg.casePhotos) ? cfg.casePhotos : []);
    caseLocked = false;
    syncCaseLock();
  }
  if (!reviewLeavingForResume && $("hhsrs-body")) restoreReviewDraft(reviewDraftKey());

  var generateBtn = $("btn-generate-email");
  if (generateBtn) generateBtn.addEventListener("click", generateEmail);
  var amendBtn = $("btn-amend-case");
  if (amendBtn) amendBtn.addEventListener("click", amendCaseDetails);

  function blankDraftHasContent() {
    if (casePhotos.length) return true;
    if (reviewDraftHasContent(collectReviewDraft())) return true;
    return reviewDraftHasContent(readReviewDrafts().blank);
  }

  var createBtn = $("btn-create-plain-email");
  if (createBtn) {
    createBtn.addEventListener("click", function (e) {
      var onBlank = cfg.mode !== "filled" && $("rv-project");
      var dirty = onBlank ? blankDraftHasContent() : reviewDraftHasContent(readReviewDrafts().blank);
      if (dirty && !window.confirm("Start a new email? Your unsent draft will be cleared.")) {
        e.preventDefault();
        return;
      }
      if (onBlank) {
        e.preventDefault();
        clearReviewDraft("blank");
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

  /* New-pending polling, the toast, and desktop notifications live in
     hhsrs-pending-alerts.js so every admin portal page shares one leader poll. */

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
    if (window.HhsrsPendingAlerts && window.HhsrsPendingAlerts.desktopAlertsOn) {
      return window.HhsrsPendingAlerts.desktopAlertsOn();
    }
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
    var testAlert = $("btn-admin-send-test-alert");
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
    if (testAlert) {
      if (perm === "granted") {
        testAlert.textContent = "Send test alert";
        testAlert.disabled = false;
      } else {
        testAlert.textContent = "Permission not granted — Enable";
        testAlert.disabled = perm === "unsupported";
      }
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
        hint.textContent = "Alerts were turned off. Enable them again on this page.";
      } else {
        hint.textContent = "Desktop alerts are required. Enable them on this page.";
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
    if (window.HhsrsPendingAlerts && window.HhsrsPendingAlerts.unlockAlertSound) {
      window.HhsrsPendingAlerts.unlockAlertSound();
    }
    if (notificationState() === "granted") {
      markDesktopAlertsOn();
      paintNotifStatus();
      return;
    }
    askNotificationPermission();
  }

  /* Client-side only. Same title and options as a real pending alert.
     Does not create a case or call the server. */
  function sendTestDesktopAlert() {
    if (notificationState() !== "granted") return;
    try {
      var note = new Notification("🔴 New HHSRS Hazard", {
        body: "Test · Project · Rating",
        tag: "hhsrs-test-" + Date.now(),
        requireInteraction: true,
      });
      note.onclick = function () {
        window.focus();
        note.close();
      };
    } catch (e) {
      /* the button stays available so they can try again */
    }
  }

  function onAdminTestAlertClick() {
    if (notificationState() !== "granted") {
      enableDesktopAlerts();
      return;
    }
    sendTestDesktopAlert();
  }

  clearLegacyDesktopAlertsDismiss();
  var enableBtn = $("btn-enable-desktop-alerts");
  if (enableBtn) enableBtn.addEventListener("click", enableDesktopAlerts);
  var adminEnableBtn = $("btn-admin-enable-desktop-alerts");
  if (adminEnableBtn) adminEnableBtn.addEventListener("click", enableDesktopAlerts);
  var adminTestBtn = $("btn-admin-send-test-alert");
  if (adminTestBtn) adminTestBtn.addEventListener("click", onAdminTestAlertClick);
  var simOffBtn = $("btn-admin-simulate-alerts-off");
  if (simOffBtn) {
    simOffBtn.addEventListener("click", function () {
      markDesktopAlertsSimulatedOff();
      paintNotifStatus();
    });
  }
  paintNotifStatus();

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
    if (dismissedStage()) return;
    if (skipDraftSave || !$("hhsrs-body") || (cfg.send && cfg.send.sent)) return;
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
    if (!$("hhsrs-body") || resumeCleared) return;
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

  function stopReviewDraftWrites() {
    skipDraftSave = true;
    if (reviewDraftSaveTimer) clearTimeout(reviewDraftSaveTimer);
    reviewDraftSaveTimer = null;
    try { sessionStorage.setItem(REVIEW_SENT_CLEAR_KEY, "1"); } catch (e) {}
  }

  function forgetHeldReviewDrafts() {
    stopReviewDraftWrites();
    clearReviewDraft("blank");
    if (cfg.caseId) clearReviewDraft(String(cfg.caseId));
  }

  function clearHeldBlankReview() {
    if (cfg.mode === "filled" || sentStage()) return;
    forgetHeldReviewDrafts();
    clearEmailDraft();
    var project = $("rv-project");
    if (project && !project.disabled) project.value = "";
    REVIEW_CASE_FIELD_IDS.forEach(function (id) {
      var field = $(id);
      if (!field || field.readOnly) return;
      if (field.type === "checkbox") field.checked = id === "rv-include-cause";
      else field.value = "";
    });
    ["rv-restrictor-count", "rv-restrictor-locations", "rv-restrictor-material"].forEach(function (id) {
      var field = $(id);
      if (!field || field.readOnly) return;
      field.value = "";
    });
    resetCasePhotos([]);
    var file = $("rv-photo-file");
    if (file) file.value = "";
    applyProjectChange({ skipDraft: true });
    syncSendButton();
  }

  function wireSentConfirm() {
    var overlay = $("sent-confirm-overlay");
    if (!overlay || overlay.hidden) return;
    forgetHeldReviewDrafts();
    if (document.body && document.body.style) document.body.style.overflow = "hidden";
    var title = $("sent-confirm-title");
    if (title && title.focus) {
      try { title.focus({ preventScroll: true }); }
      catch (err) { title.focus(); }
    }
    function closeSent() {
      overlay.hidden = true;
      if (document.body && document.body.style) document.body.style.overflow = "";
    }
    var ok = $("sent-confirm-ok");
    if (ok) ok.addEventListener("click", closeSent);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeSent();
    });
    document.addEventListener("keydown", function (e) {
      if (!overlay || overlay.hidden) return;
      if (e.key === "Escape") closeSent();
    });
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
    if (dismissedStage()) {
      setReviewDraftStatus(false);
      return false;
    }
    if (cfg.send && cfg.send.sent) {
      setReviewDraftStatus(false);
      return false;
    }
    var draft = readReviewDrafts()[key];
    if (!draft || !$("hhsrs-body")) {
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
    emailGenerated = hasEmail;
    caseLocked = !!draft.caseDetailsLocked;
    syncCaseLock();
    setReviewDraftStatus(true);
    syncSendButton();
    return true;
  }

  function initReviewResume() {
    if (!$("hhsrs-body")) return false;
    var compose = /(?:\?|&)compose=1(?:&|$)/.test(window.location.search);
    if (compose) {
      clearResumeKey();
      clearReviewDraft("blank");
      resumeCleared = false;
      skipDraftSave = false;
      return false;
    }
  if (!cfg.caseId) {
    return false;
  }
    setReviewLastKey(cfg.caseId);
    return false;
  }

  function discardGeneratedDraft() {
    skipDraftSave = true;
    if (reviewDraftSaveTimer) clearTimeout(reviewDraftSaveTimer);
    reviewDraftSaveTimer = null;
    if (!sentStage()) {
      emailGenerated = false;
      caseLocked = false;
      REVIEW_EMAIL_FIELD_IDS.forEach(function (id) {
        var field = $(id);
        if (!field || field.readOnly) return;
        field.value = "";
        delete field.dataset.userEdited;
      });
    }
    clearReviewDraft("blank");
    if (cfg.caseId) clearReviewDraft(String(cfg.caseId));
    clearResumeKey();
  }

  function wireReviewDraftPersistence() {
    if (!$("hhsrs-body")) return;
    REVIEW_CASE_FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var evt = (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") ? "change" : "input";
      el.addEventListener(evt, scheduleReviewDraftSave);
    });
    window.addEventListener("pagehide", saveReviewDraftNow);
    window.addEventListener("pageshow", function (e) {
      var abandoned = "";
      try { abandoned = sessionStorage.getItem("hhsrs-review-abandoned") || ""; } catch (err) {}
      if (abandoned === "1" && $("hhsrs-body")) {
        if (e && e.persisted) discardGeneratedDraft();
        skipDraftSave = false;
        resumeCleared = false;
        try { sessionStorage.removeItem("hhsrs-review-abandoned"); } catch (err2) {}
      }
      var flag = "";
      try { flag = sessionStorage.getItem(REVIEW_SENT_CLEAR_KEY) || ""; } catch (e) {}
      if (flag !== "1") return;
      if (sentStage()) return;
      if (cfg.mode === "filled") {
        stopReviewDraftWrites();
        var sentBtn = $("btn-send-email");
        if (sentBtn) {
          sentBtn.disabled = true;
          sentBtn.textContent = "✓ Sent and logged";
          if (sentBtn.classList) sentBtn.classList.add("is-sent");
        }
        var sentLine = $("rv-send-line");
        if (sentLine) {
          sentLine.hidden = false;
          sentLine.textContent = "Sent and logged in the Main Log. Can't be sent again.";
        }
        var sentCk = $("ck-overlay");
        if (sentCk) sentCk.hidden = true;
        return;
      }
      try { sessionStorage.removeItem(REVIEW_SENT_CLEAR_KEY); } catch (e2) {}
      clearHeldBlankReview();
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") saveReviewDraftNow();
    });
    var abandonForm = $("abandon-claim-form");
    if (abandonForm) {
      function onAbandon() {
        discardGeneratedDraft();
        try { sessionStorage.setItem("hhsrs-review-abandoned", "1"); } catch (err) {}
      }
      var abandonBtn = $("btn-abandon-claim");
      if (abandonBtn) abandonBtn.addEventListener("click", onAbandon);
      abandonForm.addEventListener("submit", onAbandon);
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
    if (anchor.closest && anchor.closest(".pending-issues-table")) attPopEl.classList.add("ml-photo-source");
    else attPopEl.classList.remove("ml-photo-source");
    attPopEl.setAttribute("aria-hidden", "false");
    renderAttPopThumbs(photos);
    positionAttPop(anchor);
  }

  function listFullPhoto() {
    return document.getElementById("ml-photo-full");
  }

  function closeListFullPhoto(event) {
    var full = listFullPhoto();
    if (!full) return false;
    if (event && event.type === "mouseleave") {
      var next = event.relatedTarget;
      if (next && full.contains(next)) return false;
    }
    if (!full.classList.contains("is-show")) return false;
    full.classList.remove("is-show");
    full.hidden = true;
    var img = full.querySelector("img");
    if (img) {
      img.removeAttribute("src");
      img.alt = "";
    }
    return true;
  }

  function openListFullPhoto(photo) {
    var full = listFullPhoto();
    if (!full || !photo || !photo.url) return;
    var img = full.querySelector("img");
    if (!img) return;
    hideAttPop(true);
    img.src = photo.url;
    img.alt = photo.caption || "Photo";
    full.hidden = false;
    full.classList.add("is-show");
  }

  function wireListFullPhoto() {
    var full = listFullPhoto();
    if (!full || full.getAttribute("data-list-photo") === "1") return;
    full.setAttribute("data-list-photo", "1");
    var img = full.querySelector("img");
    if (img) img.addEventListener("mouseleave", closeListFullPhoto);
    full.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (event.target === full) closeListFullPhoto();
    });
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
      var full = listFullPhoto();
      if (full && full.classList.contains("is-show") && full.contains(e.target)) {
        e.preventDefault();
        e.stopPropagation();
        if (e.target === full) closeListFullPhoto();
        return;
      }
      if (e.target.closest && e.target.closest("#main-log-table .photo-att-icon")) return;
      var listIcon = e.target.closest && e.target.closest(".pending-issues-table .photo-att-icon");
      if (listIcon) {
        e.preventDefault();
        e.stopPropagation();
        var first = photosFromButton(listIcon)[0];
        if (first) openListFullPhoto(first);
        return;
      }
      var thumbImg = e.target.closest && e.target.closest("#photo-att-pop img");
      var openIcon = document.querySelector(".pending-issues-table .photo-att-icon.is-pop-open");
      if (thumbImg && openIcon && !(openIcon.closest && openIcon.closest("#main-log-table"))) {
        e.preventDefault();
        e.stopPropagation();
        openListFullPhoto({ url: thumbImg.getAttribute("src"), caption: thumbImg.getAttribute("alt") });
        return;
      }
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
      if (e.key !== "Escape") return;
      if (closeListFullPhoto()) return;
      hideAttPop(true);
    });
    wireListFullPhoto();
    window.addEventListener("scroll", function () {
      if (attPopEl && attPopEl.classList.contains("is-visible")) hideAttPop(true);
    }, true);
    window.addEventListener("resize", function () {
      if (attPopEl && attPopEl.classList.contains("is-visible")) hideAttPop(true);
    });
  }

  if (!reviewLeavingForResume) wireReviewDraftPersistence();
  wireAttPhotoPopovers();
  wirePortalSend();
  wireSentConfirm();

  function ratingConfirmed() {
    if (cfg.findResend) return true;
    var box = $("rv-rating-happy");
    if (!box) return true;
    return !!box.checked;
  }

  function officeStarFields() {
    return {
      restrictorMissingCount: "rv-restrictor-count",
      restrictorLocations: "rv-restrictor-locations",
      restrictorMaterial: "rv-restrictor-material",
      clientCallReference: "rv-call-ref"
    };
  }

  function controlBlocked(el) {
    if (!el || el.disabled || el.readOnly) return true;
    var node = el;
    while (node) {
      if (node.hidden || node.inert) return true;
      if (String(node.tagName || "").toUpperCase() === "FIELDSET" && node.disabled) return true;
      node = node.parentElement || null;
    }
    return false;
  }

  function valueMissing(el) {
    var type = String(el.type || "").toLowerCase();
    if (type === "hidden" || type === "button" || type === "submit" || type === "file") return false;
    if (type === "checkbox" || type === "radio") return !el.checked;
    return !String(el.value || "").replace(/^\s+|\s+$/g, "");
  }

  function clearNeededMarks() {
    var nodes = document.querySelectorAll(".office-needed");
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].classList) nodes[i].classList.remove("office-needed");
    }
  }

  function markNeeded(el) {
    if (!el || !el.classList || controlBlocked(el) || !valueMissing(el)) return;
    el.classList.add("office-needed");
  }

  /** Red outline on Review and Create for a required control that is still empty or unticked. */
  function syncNeededMarks() {
    clearNeededMarks();
    if (cfg.findResend || !$("review-workspace")) return;
    if (sentStage() || dismissedStage()) return;
    var sendBtn = $("btn-send-email");
    if (sendBtn && (sendBtn.getAttribute("data-dismissed") === "1" || sendBtn.getAttribute("data-not-needed") === "1")) return;
    markNeeded($("rv-rating-happy"));
    var required = document.querySelectorAll("#review-workspace [required], #ck-overlay [required]");
    for (var i = 0; i < required.length; i++) markNeeded(required[i]);
    var starFields = officeStarFields();
    Object.keys(starFields).forEach(function (key) {
      var stars = document.querySelectorAll('[data-office-star="' + key + '"]');
      var active = false;
      for (var s = 0; s < stars.length; s++) {
        if (!stars[s].hidden) active = true;
      }
      if (active) markNeeded($(starFields[key]));
    });
    if (!cfg.caseId) {
      ["rv-project", "rv-address", "rv-uprn", "rv-hazard", "rv-rating"].forEach(function (id) {
        markNeeded($(id));
      });
    }
    var panel = document.querySelector(".email-draft-panel");
    var emailLocked = panel && panel.classList && (
      panel.classList.contains("is-pre-generate") ||
      panel.classList.contains("is-sent-lock") ||
      panel.classList.contains("is-dismissed-lock")
    );
    if (!emailLocked) {
      markNeeded($("hhsrs-to"));
      var subjectEl = $("hhsrs-subject");
      var bodyEl = $("hhsrs-body");
      if (subjectEl && bodyEl && valueMissing(subjectEl) && valueMissing(bodyEl)) {
        markNeeded(subjectEl);
        markNeeded(bodyEl);
      }
    }
    var overlay = $("ck-overlay");
    if (overlay && !overlay.hidden) markNeeded($("ck-tick"));
  }

  function syncDialogSend() {
    var ckSendBtn = $("ck-send");
    var ckTickBox = $("ck-tick");
    if (!ckSendBtn || !ckTickBox) return;
    ckSendBtn.disabled = !ckTickBox.checked || !ratingConfirmed();
    var label = $("ck-tick-label");
    if (label && label.classList) label.classList.toggle("is-on", !!ckTickBox.checked);
  }

  function syncSendButton() {
    syncNeededMarks();
    var btn = $("btn-send-email");
    var line = $("rv-send-line");
    if (!btn || !line) return;
    if (!cfg.findResend && cfg.send && cfg.send.sent) return;
    if (!cfg.findResend && btn.getAttribute("data-dismissed") === "1") {
      btn.disabled = true;
      line.hidden = false;
      line.textContent = "Restore it before sending.";
      return;
    }
    if (!cfg.findResend && btn.getAttribute("data-not-needed") === "1") {
      btn.disabled = true;
      line.hidden = false;
      line.textContent = "Move it back to Pending before sending.";
      return;
    }
    if (cfg.findResend) {
      if (!cfg.send || !cfg.send.configured) {
        btn.disabled = true;
        line.hidden = false;
        line.textContent = "Sending not set up yet.";
        return;
      }
      var findOver = attachmentBytes() > (cfg.send.maxBytes || 20 * 1024 * 1024);
      line.hidden = false;
      if (findOver) {
        btn.disabled = true;
        line.textContent = "Photos are over 20 MB.";
        return;
      }
      btn.disabled = false;
      line.textContent = "You check it before it goes.";
      return;
    }
    if (!cfg.send || !cfg.send.configured) {
      btn.disabled = true;
      line.hidden = false;
      line.textContent = "Sending not set up yet.";
      return;
    }
    var badge = $("rv-email-badge");
    var generated = emailGenerated || (badge && /generated/i.test(badge.textContent || ""));
    var to = ($("hhsrs-to") && String($("hhsrs-to").value || "").trim()) || "";
    var subject = ($("hhsrs-subject") && String($("hhsrs-subject").value || "").trim()) || "";
    var body = ($("hhsrs-body") && String($("hhsrs-body").value || "")) || "";
    var over = attachmentBytes() > (cfg.send.maxBytes || 20 * 1024 * 1024);
    line.hidden = false;
    if (over) {
      btn.disabled = true;
      line.textContent = "Photos are over 20 MB.";
      return;
    }
    if (!generated) {
      btn.disabled = true;
      line.textContent = "Generate the email first.";
      return;
    }
    if (!to) {
      btn.disabled = true;
      line.textContent = "Add a To address first.";
      return;
    }
    if (!subject && !String(body).trim()) {
      btn.disabled = true;
      line.textContent = "Add a subject or body first.";
      return;
    }
    if (officeHoldMessage) {
      btn.disabled = true;
      line.textContent = officeHoldMessage;
      return;
    }
    if (!cfg.caseId) {
      var project = ($("rv-project") && String($("rv-project").value || "").trim()) || "";
      var address = ($("rv-address") && String($("rv-address").value || "").trim()) || "";
      var uprn = ($("rv-uprn") && String($("rv-uprn").value || "").trim()) || "";
      var hazard = ($("rv-hazard") && String($("rv-hazard").value || "").trim()) || "";
      var rating = ($("rv-rating") && String($("rv-rating").value || "").trim()) || "";
      if (!project || !address || !uprn || !hazard || !rating) {
        btn.disabled = true;
        line.textContent = "Add the project, address, UPRN, hazard and rating first.";
        return;
      }
    }
    if (!ratingConfirmed()) {
      btn.disabled = true;
      line.textContent = "Tick I'm happy with the rating before sending.";
      return;
    }
    btn.disabled = false;
    line.textContent = "Sends the email and adds it to the Main Log.";
  }

  function attachmentBytes() {
    var total = 0;
    document.querySelectorAll("#rv-attach-list input[data-attach-name]").forEach(function (box) {
      if (!box.checked) return;
      total += Number(box.getAttribute("data-bytes") || 0);
    });
    return total;
  }

  function updateAttachCount() {
    var boxes = document.querySelectorAll("#rv-attach-list input[data-attach-name]");
    var on = 0;
    Array.prototype.forEach.call(boxes, function (box) {
      var item = box.closest(".attach-item");
      if (item) item.classList.toggle("is-on", box.checked);
      if (box.checked) on += 1;
    });
    var countEl = $("rv-attach-count");
    if (countEl && boxes.length) countEl.textContent = on + " of " + boxes.length + " attached";
  }

  function wirePortalSend() {
    var btn = $("btn-send-email");
    var list = $("rv-attach-list");
    if (list) list.addEventListener("change", function () { updateAttachCount(); syncSendButton(); });
    ["hhsrs-to", "hhsrs-cc", "hhsrs-bcc", "hhsrs-subject", "hhsrs-body", "rv-project", "rv-address", "rv-uprn", "rv-hazard", "rv-rating"].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener("input", syncSendButton);
      el.addEventListener("change", syncSendButton);
    });
    var ratingHappy = $("rv-rating-happy");
    if (ratingHappy && !cfg.findResend) {
      ratingHappy.addEventListener("change", function () {
        syncSendButton();
        syncDialogSend();
      });
    }
    var reviewRoot = $("review-workspace");
    if (reviewRoot && !cfg.findResend) {
      reviewRoot.addEventListener("input", syncNeededMarks);
      reviewRoot.addEventListener("change", syncNeededMarks);
    }
    syncSendButton();
    var ck = $("ck-overlay");
    if (!btn || !ck || (!cfg.findResend && cfg.send && cfg.send.sent)) return;
    var ckBody = $("ck-body");
    var ckTick = $("ck-tick");
    var ckTickLabel = $("ck-tick-label");
    var ckSend = $("ck-send");
    var ckBack = $("ck-back");
    var form = $("rv-send-form");
    var lastFocus = null;
    var sending = false;
    var restoreCheckScroll = function () {};

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }
    function val(id) {
      var el = $(id);
      return el ? String(el.value || "").trim() : "";
    }
    function tickedPhotos() {
      var photos = Array.isArray(cfg.casePhotos) ? cfg.casePhotos : [];
      var picked = [];
      document.querySelectorAll("#rv-attach-list input[data-attach-name]").forEach(function (box) {
        if (!box.checked) return;
        var name = box.getAttribute("data-attach-name") || "";
        var match = null;
        for (var i = 0; i < photos.length; i++) {
          if (photos[i] && photos[i].name === name) { match = photos[i]; break; }
        }
        picked.push(match || { name: name, caption: name, url: "" });
      });
      return picked;
    }
    function cardBodyHtml(text) {
      var trimmed = String(text || "").replace(/\r\n/g, "\n").replace(/\s+$/, "");
      if (!trimmed) return "";
      return esc(trimmed).replace(/\n/g, "<br>\n");
    }
    function openCheck() {
      if (btn.disabled || sending || !ratingConfirmed()) return;
      var photos = tickedPhotos();
      var h = "";
      var test = $("ck-test");
      if (test) h += test.outerHTML;
      var subject = val("hhsrs-subject");
      var bodyEl = $("hhsrs-body");
      var body = bodyEl ? String(bodyEl.value || "").replace(/\s+$/, "") : "";
      h += "<div class=\"ck-mail\" style=\"background:#e7edf3\">";
      h += "<article class=\"sent-card\" aria-label=\"Client email\">";
      if (subject) h += "<h2>" + esc(subject) + "</h2>";
      h += "<div class=\"sent-body\"><div class=\"sent-copy\">" + cardBodyHtml(body) + "</div>";
      var sigHtml = cfg.signature && cfg.signature.html;
      if (sigHtml) h += "<div class=\"sent-sign\">" + sigHtml + "</div>";
      if (photos.length) {
        h += "<div class=\"sent-photos\">" + photos.map(function (p) {
          var name = esc(p.name || "Photo");
          var alt = esc(p.caption || p.name || "Photo");
          var img = p.url
            ? "<img src=\"" + esc(p.url) + "\" alt=\"" + alt + "\" />"
            : "<div class=\"art-miss\">No file</div>";
          return "<figure class=\"photo-zoom\"><div class=\"art\">" + img + "</div><figcaption>" + name + "</figcaption></figure>";
        }).join("") + "</div>";
      }
      h += "</div></article></div>";
      ckBody.innerHTML = h;
      ckTick.checked = false;
      ckTickLabel.classList.remove("is-on");
      lastFocus = document.activeElement;
      var pane = document.querySelector(".content-pane");
      var root = document.scrollingElement || document.documentElement;
      var savedPaneScroll = pane ? pane.scrollTop : 0;
      var savedPageScroll = root ? root.scrollTop : 0;
      restoreCheckScroll = function () {
        if (pane) pane.scrollTop = savedPaneScroll;
        if (root) root.scrollTop = savedPageScroll;
      };
      ck.hidden = false;
      syncDialogSend();
      syncNeededMarks();
      document.body.style.overflow = "hidden";
      function pinCheckToTop() {
        if (pane) pane.scrollTop = 0;
        if (root) root.scrollTop = 0;
        ck.scrollTop = 0;
        var text = ck.querySelector(".ck-mail");
        if (text) text.scrollTop = 0;
      }
      pinCheckToTop();
      var title = $("ck-title");
      if (title) {
        try { title.focus({ preventScroll: true }); }
        catch (err) { title.focus(); }
      }
      pinCheckToTop();
      requestAnimationFrame(function () {
        pinCheckToTop();
        requestAnimationFrame(pinCheckToTop);
      });
    }
    function closeCheck() {
      if (sending) return;
      ck.hidden = true;
      syncNeededMarks();
      document.body.style.overflow = "";
      restoreCheckScroll();
      if (lastFocus && lastFocus.focus) {
        try { lastFocus.focus({ preventScroll: true }); }
        catch (err) { lastFocus.focus(); }
      }
    }
    ckTick.addEventListener("change", function () {
      syncDialogSend();
      syncNeededMarks();
    });
    ckBack.addEventListener("click", closeCheck);
    ck.addEventListener("click", function (e) { if (e.target === ck) closeCheck(); });
    document.addEventListener("keydown", function (e) {
      if (ck.hidden) return;
      if (e.key === "Escape") { closeCheck(); return; }
      if (e.key !== "Tab") return;
      var f = Array.prototype.slice.call(ck.querySelectorAll("button:not([disabled]), input, [tabindex=\"0\"]"));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    btn.addEventListener("click", openCheck);
    form.addEventListener("submit", function (e) {
      if (sending || !ckTick.checked || !ratingConfirmed()) {
        e.preventDefault();
        return;
      }
      sending = true;
      ckSend.disabled = true;
      ckSend.textContent = "Sending…";
      if (!cfg.caseId) {
        e.preventDefault();
        var fd = new FormData();
        fd.append("checked", ckTick.checked ? "1" : "");
        fd.append("project", val("rv-project"));
        fd.append("address", val("rv-address"));
        fd.append("uprn", val("rv-uprn"));
        fd.append("hazard", val("rv-hazard"));
        fd.append("rating", val("rv-rating"));
        fd.append("surveyor", val("rv-surveyor"));
        fd.append("surveyDate", val("rv-survey-date"));
        fd.append("notes", val("rv-notes"));
        fd.append("to", val("hhsrs-to"));
        fd.append("cc", val("hhsrs-cc"));
        fd.append("bcc", val("hhsrs-bcc"));
        fd.append("subject", val("hhsrs-subject"));
        var draftBody = $("hhsrs-body");
        fd.append("body", draftBody ? String(draftBody.value || "").replace(/\s+$/, "") : "");
        casePhotos.forEach(function (photo) {
          if (photo && photo.blob) fd.append("photos", photo.blob, photo.name || "photo.jpg");
        });
        fetch((cfg.base || "/HHSRSreporter") + "/review/office-send", {
          method: "POST",
          body: fd,
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          redirect: "manual"
        }).then(function (res) {
          return res.json().then(function (data) {
            var next = (data && data.redirect) || ((cfg.base || "/HHSRSreporter") + "/review");
            if (/\/review\/[^/?#]+/.test(next)) forgetHeldReviewDrafts();
            window.location.assign(next);
          });
        }).catch(function () {
          sending = false;
          syncDialogSend();
          ckSend.textContent = "Send and log";
          window.alert("Could not send. Try again.");
        });
        return;
      }
      stopReviewDraftWrites();
      $("rv-send-to").value = val("hhsrs-to");
      $("rv-send-cc").value = val("hhsrs-cc");
      $("rv-send-bcc").value = val("hhsrs-bcc");
      $("rv-send-subject").value = val("hhsrs-subject");
      var bodyEl = $("hhsrs-body");
      $("rv-send-body").value = bodyEl ? String(bodyEl.value || "").replace(/\s+$/, "") : "";
      var holder = $("rv-send-photo-fields");
      holder.innerHTML = "";
      [
        ["rating", val("rv-rating")],
        ["restrictorMissingCount", val("rv-restrictor-count")],
        ["restrictorLocations", val("rv-restrictor-locations")],
        ["restrictorMaterial", val("rv-restrictor-material")],
        ["clientCallReference", val("rv-call-ref")]
      ].forEach(function (pair) {
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = pair[0];
        input.value = pair[1];
        holder.appendChild(input);
      });
      tickedPhotos().forEach(function (p) {
        var input = document.createElement("input");
        input.type = "hidden";
        input.name = "photo";
        input.value = p.name;
        holder.appendChild(input);
      });
      queueAddedCasePhotos(form);
    });
  }

  var clientEmailPick = $("client-email-project");
  var clientEmailRows = document.querySelectorAll("#client-email-card .client-email-row");
  if (clientEmailPick && clientEmailRows.length) {
    var clientEmailKey = "hhsrs-client-email-project";
    function clientEmailRow(name) {
      for (var i = 0; i < clientEmailRows.length; i++) {
        if (clientEmailRows[i].getAttribute("data-project") === name) return clientEmailRows[i];
      }
      return null;
    }
    function clientEmailDirty(row) {
      if (!row) return false;
      var boxes = row.querySelectorAll("textarea");
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].value !== boxes[i].defaultValue) return true;
      }
      return false;
    }
    function clientEmailReset(row) {
      if (!row) return;
      var boxes = row.querySelectorAll("textarea");
      for (var i = 0; i < boxes.length; i++) boxes[i].value = boxes[i].defaultValue;
    }
    function clientEmailShow(name) {
      for (var i = 0; i < clientEmailRows.length; i++) {
        clientEmailRows[i].hidden = clientEmailRows[i].getAttribute("data-project") !== name;
      }
    }
    function clientEmailRemember(name) {
      try {
        if (name) sessionStorage.setItem(clientEmailKey, name);
        else sessionStorage.removeItem(clientEmailKey);
      } catch (err) {}
    }
    var clientEmailCurrent = clientEmailPick.value || "";
    if (!clientEmailCurrent) {
      try {
        var clientEmailSaved = sessionStorage.getItem(clientEmailKey) || "";
        if (clientEmailSaved && clientEmailRow(clientEmailSaved)) {
          clientEmailPick.value = clientEmailSaved;
          clientEmailCurrent = clientEmailSaved;
          clientEmailShow(clientEmailSaved);
        }
      } catch (err) {}
    } else {
      clientEmailRemember(clientEmailCurrent);
    }
    clientEmailPick.addEventListener("change", function () {
      var next = clientEmailPick.value || "";
      if (clientEmailCurrent !== next && clientEmailDirty(clientEmailRow(clientEmailCurrent))) {
        if (!window.confirm("Discard unsaved changes?")) {
          clientEmailPick.value = clientEmailCurrent;
          return;
        }
        clientEmailReset(clientEmailRow(clientEmailCurrent));
      }
      clientEmailCurrent = next;
      clientEmailShow(next);
      clientEmailRemember(next);
    });
  }

  function wireDismissHazard() {
    var openBtn = $("btn-dismiss-hazard");
    var overlay = $("dh-overlay");
    var form = $("dh-form");
    if (!openBtn || !overlay || !form) return;
    var confirmBtn = $("dh-confirm");
    var cancelBtn = $("dh-cancel");

    function selectedReason() {
      var picked = form.querySelector("input[name='reason']:checked");
      return picked ? picked.value : "";
    }
    function syncConfirm() {
      if (confirmBtn) confirmBtn.disabled = !selectedReason();
    }
    openBtn.addEventListener("click", function () {
      overlay.hidden = false;
      document.body.style.overflow = "hidden";
      var first = form.querySelector("input[name='reason']");
      if (first) first.focus();
    });
    function closeDismiss() {
      overlay.hidden = true;
      document.body.style.overflow = "";
      openBtn.focus();
    }
    if (cancelBtn) cancelBtn.addEventListener("click", closeDismiss);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeDismiss(); });
    form.addEventListener("change", syncConfirm);
    form.addEventListener("submit", function (e) {
      syncConfirm();
      if (confirmBtn && confirmBtn.disabled) e.preventDefault();
    });
    document.addEventListener("keydown", function (e) {
      if (overlay.hidden || e.key !== "Escape") return;
      closeDismiss();
    });
    syncConfirm();
  }
  wireDismissHazard();
})();
