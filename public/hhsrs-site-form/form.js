(function () {
  var form = document.getElementById("hhsrs-form");
  var input = document.getElementById("photos");
  var newGrid = document.getElementById("new-photos");
  var existing = document.getElementById("existing-photos");
  var statusEl = document.getElementById("photo-status");
  var minPhotos = form ? parseInt(form.getAttribute("data-min-photos") || "1", 10) : 1;
  var max = form ? parseInt(form.getAttribute("data-max-photos") || "4", 10) : 4;
  var lookupUrl = form ? form.getAttribute("data-stock-lookup") || "" : "";

  var MAX_EDGE = 3000;
  var JPEG_QUALITY = 0.88;
  var SKIP_UNDER_BYTES = 3 * 1024 * 1024;
  var CLIENT_MAX_BYTES = 25 * 1024 * 1024;

  var findBtn = document.getElementById("btn-lookup-uprn");
  var findStatus = document.getElementById("find-status");
  var lookupBusy = false;
  var photoBusy = false;
  var chosen = [];
  var lastProject = "";
  var lastFocusedStep = "";

  function $(id) {
    return document.getElementById(id);
  }

  function val(id) {
    var el = $(id);
    return el ? String(el.value || "").trim() : "";
  }

  function normUprn(value) {
    return String(value || "").replace(/\s+/g, "").trim();
  }

  function setFindStatus(text, kind) {
    if (!findStatus) return;
    findStatus.textContent = text || "";
    findStatus.className = "find-status" + (kind ? " is-" + kind : "");
  }

  function setPhotoStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "find-status" + (kind ? " is-" + kind : "");
  }

  function progressive() {
    return window.matchMedia("(max-width: 1024px)").matches;
  }

  function showStep(el, arrive) {
    if (!el) return;
    var wasHidden = el.hidden;
    el.hidden = false;
    if (arrive && wasHidden) {
      el.classList.add("is-arrive");
      window.setTimeout(function () {
        el.classList.remove("is-arrive");
      }, 400);
    }
  }

  function hideStep(el) {
    if (!el) return;
    el.hidden = true;
    el.classList.remove("is-current", "is-arrive");
  }

  function setCurrent(el) {
    var steps = document.querySelectorAll(".flow-step");
    for (var i = 0; i < steps.length; i++) steps[i].classList.remove("is-current");
    if (el) el.classList.add("is-current");
  }

  // v4: section auto-advance. Scrolls the newly opened section's heading to near the top of the screen
  // (smooth unless reduced motion) and focuses its first field ONLY if that field does not raise the
  // on-screen keyboard (select, date, checkbox). Text fields are just scrolled to, never focused.
  function focusAndScroll(el, fieldId) {
    if (!el || !progressive()) return;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.setTimeout(function () {
      var vv = window.visualViewport;
      var shift = 0; // ignore the 12px "arrive" slide-in that may still be running
      try { shift = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42 || 0; } catch (e) { shift = 0; }
      var top = el.getBoundingClientRect().top - shift + window.pageYOffset - (vv ? vv.offsetTop : 0) - 12;
      try {
        window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
      } catch (e) {
        window.scrollTo(0, Math.max(0, top));
      }
    }, 40);
    var field = fieldId ? $(fieldId) : null;
    var noKeyboard = field && (field.tagName === "SELECT" || /^(date|checkbox|radio)$/i.test(field.type || ""));
    if (field && noKeyboard && !field.disabled && !field.readOnly) {
      window.setTimeout(function () {
        try {
          field.focus({ preventScroll: true });
        } catch (err) {
          field.focus();
        }
      }, 320);
    }
  }

  function addressLocked() {
    var card = $("addr-card");
    return !!(card && !card.hidden);
  }

  function clearAddressMatch(keepUprn) {
    var uprn = $("uprn");
    var address = $("fullAddress");
    var postcode = $("postcode");
    var confirm = $("addressConfirmed");
    var card = $("addr-card");
    var kept = keepUprn && uprn ? uprn.value : "";
    if (address) address.value = "";
    if (postcode) postcode.value = "";
    if (confirm) confirm.checked = false;
    if (card) card.hidden = true;
    if (uprn) {
      uprn.value = kept;
      uprn.readOnly = false;
    }
    if (findBtn) findBtn.disabled = false;
    setFindStatus("");
  }

  function applyStockMatch(match) {
    var address = $("fullAddress");
    var postcode = $("postcode");
    var uprn = $("uprn");
    var confirm = $("addressConfirmed");
    var card = $("addr-card");
    if (address) {
      address.value = match.line || "";
      address.readOnly = false;
      address.classList.remove("is-invalid");
    }
    if (postcode) {
      postcode.value = match.postcode || "";
      postcode.readOnly = false;
      postcode.classList.remove("is-invalid");
    }
    if (uprn) {
      uprn.value = match.uprn || uprn.value;
      uprn.readOnly = true;
      uprn.classList.remove("is-invalid");
    }
    if (confirm) confirm.checked = false;
    if (card) card.hidden = false;
    if (findBtn) findBtn.disabled = true;
    setFindStatus("Match found on this project’s stock list. Edit the address if it’s wrong, then confirm.", "ok");
    updateFlow({ announce: true });
  }

  function lookupUprn() {
    if (!findBtn || lookupBusy || addressLocked()) return;
    var project = val("projectId");
    var uprnEl = $("uprn");
    var uprn = normUprn(uprnEl ? uprnEl.value : "");
    if (!project) {
      setFindStatus("Choose a project first.", "err");
      return;
    }
    if (!uprn) {
      setFindStatus("Enter a UPRN.", "err");
      return;
    }
    if (!lookupUrl) {
      setFindStatus("UPRN lookup is not available.", "err");
      return;
    }
    lookupBusy = true;
    findBtn.disabled = true;
    setFindStatus("Looking up UPRN…", "");
    var url = lookupUrl + "?projectId=" + encodeURIComponent(project) + "&uprn=" + encodeURIComponent(uprn);
    fetch(url, { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().then(
          function (data) {
            return { status: res.status, data: data || {} };
          },
          function () {
            return { status: res.status, data: {} };
          }
        );
      })
      .then(function (result) {
        var data = result.data || {};
        if (result.status === 429) {
          setFindStatus(data.error || "Too many lookups. Wait a moment and try again.", "err");
          return;
        }
        if (!result.status || result.status >= 400 || !data.match) {
          setFindStatus(data.error || "No match on this project’s stock list — check the UPRN.", "err");
          return;
        }
        applyStockMatch(data.match);
      })
      .catch(function () {
        setFindStatus("Could not look up that UPRN. Check your connection and try again.", "err");
      })
      .then(function () {
        lookupBusy = false;
        if (findBtn && !addressLocked()) findBtn.disabled = false;
      });
  }

  if (findBtn) findBtn.addEventListener("click", lookupUprn);

  var uprnInput = $("uprn");
  if (uprnInput) {
    uprnInput.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || addressLocked()) return;
      e.preventDefault();
      lookupUprn();
    });
  }

  var changeUprn = $("btn-change-uprn");
  if (changeUprn) {
    changeUprn.addEventListener("click", function () {
      var kept = val("uprn");
      clearAddressMatch(false);
      var uprn = $("uprn");
      if (uprn) {
        uprn.value = kept;
        uprn.focus();
        if (uprn.select) uprn.select();
      }
      updateFlow({ announce: false });
    });
  }

  ["fullAddress", "postcode"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("input", function () {
      var confirm = $("addressConfirmed");
      if (confirm) confirm.checked = false;
      updateFlow({ announce: false });
    });
  });

  function visitDone() {
    return Boolean(val("projectId") && val("surveyDate") && val("surveyorName"));
  }

  function propertyDone() {
    var confirm = $("addressConfirmed");
    return Boolean(addressLocked() && val("uprn") && val("fullAddress") && val("postcode") && confirm && confirm.checked);
  }

  function hazardDone() {
    return Boolean(val("category") && val("rating") && val("comment"));
  }

  function callsRequired() {
    var project = $("projectId");
    var opt = project && project.selectedIndex >= 0 ? project.options[project.selectedIndex] : null;
    return !!(opt && opt.getAttribute("data-calls") === "1");
  }

  function extrasDone() {
    if (!hazardDone()) return false;
    if (callsRequired()) {
      var skipped = $("callUnreached") && $("callUnreached").checked;
      if (skipped) {
        if (!val("callRefBlankReason")) return false;
        if (val("callRefBlankReason") === "Other" && !val("callUnreachedNote")) return false;
      } else if (!val("clientCallReference")) {
        return false;
      }
    }
    return true;
  }

  function syncProjectExtras() {
    var project = $("projectId");
    var opt = project && project.selectedIndex >= 0 ? project.options[project.selectedIndex] : null;
    var label = $("extra-project-label");
    if (label) {
      var name = opt && project && val("projectId") ? String(opt.textContent || "").trim() : "";
      label.textContent = name ? "· " + name : "";
    }
    var flags = {
      calls: !!(opt && opt.getAttribute("data-calls") === "1"),
      saxon: !!(opt && opt.getAttribute("data-saxon") === "1"),
      online: !!(opt && opt.getAttribute("data-online") === "1"),
    };
    var nodes = document.querySelectorAll(".project-extra");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-extra") || "";
      var show = !!flags[key];
      nodes[i].hidden = !show;
      if (key === "calls") continue;
      var inputs = nodes[i].querySelectorAll("input, textarea, select");
      for (var j = 0; j < inputs.length; j++) inputs[j].disabled = !show;
    }
    syncCallUnreached();
  }

  function syncCallUnreached() {
    var box = $("callUnreached");
    var wrap = $("call-ref-why");
    var note = $("callUnreachedNote");
    var reason = $("callRefBlankReason");
    var ref = $("clientCallReference");
    var calls = document.querySelector('.project-extra[data-extra="calls"]');
    var callsShown = !!(calls && !calls.hidden);
    if (box) box.disabled = !callsShown;
    var on = !!(box && box.checked && callsShown);
    if (wrap) wrap.hidden = !on;
    if (note) note.disabled = !on;
    if (reason) reason.disabled = !on;
    if (ref) {
      ref.disabled = !callsShown || on;
      if (on) ref.value = "";
    }
    if (!on) {
      if (reason) reason.value = "";
      if (note) note.value = "";
    }
    if (note && reason) {
      var need = val("callRefBlankReason") === "Other";
      note.required = need;
      note.placeholder = need ? "Please say why…" : "Add a short note if needed…";
    }
  }

  function updateFlow(opts) {
    opts = opts || {};
    var announce = !!opts.announce;
    var project = val("projectId");
    if (project !== lastProject) {
      if (lastProject) clearAddressMatch(false);
      lastProject = project;
    }
    syncProjectExtras();

    var details = $("issue-details");
    var hint = $("visit-gate-hint");
    var actions = $("form-actions");
    var stepVisit = $("step-visit");
    var stepProp = $("step-property");
    var stepHaz = $("step-hazard");
    var stepEx = $("extra-box");
    var stepPh = $("step-photos");
    var vDone = visitDone();
    var narrow = progressive();

    if (hint) hint.hidden = vDone;
    if (details) details.hidden = !vDone;
    if (!vDone) {
      hideStep(stepHaz);
      hideStep(stepEx);
      hideStep(stepPh);
      if (actions) actions.hidden = true;
      setCurrent(stepVisit);
      return;
    }

    showStep(stepProp, false);
    if (!narrow) {
      showStep(stepHaz, false);
      showStep(stepEx, false);
      showStep(stepPh, false);
      if (actions) actions.hidden = false;
      setCurrent(stepVisit);
      return;
    }

    if (!propertyDone()) {
      hideStep(stepHaz);
      hideStep(stepEx);
      hideStep(stepPh);
      if (actions) actions.hidden = true;
      setCurrent(stepProp);
      if (announce && lastFocusedStep !== "property") {
        lastFocusedStep = "property";
        focusAndScroll(stepProp, addressLocked() ? "addressConfirmed" : "uprn");
      }
      return;
    }

    showStep(stepHaz, announce);
    if (!hazardDone()) {
      hideStep(stepEx);
      hideStep(stepPh);
      if (actions) actions.hidden = true;
      setCurrent(stepHaz);
      if (announce && lastFocusedStep !== "hazard") {
        lastFocusedStep = "hazard";
        focusAndScroll(stepHaz, "category");
      }
      return;
    }

    showStep(stepEx, announce);
    if (!extrasDone()) {
      hideStep(stepPh);
      if (actions) actions.hidden = true;
      setCurrent(stepEx);
      if (announce && lastFocusedStep !== "extras") {
        lastFocusedStep = "extras";
        var focusId = $("callUnreached") && $("callUnreached").checked ? "callRefBlankReason" : "clientCallReference";
        focusAndScroll(stepEx, callsRequired() ? focusId : "otherDetails");
      }
      return;
    }

    showStep(stepPh, announce);
    if (actions) actions.hidden = false;
    var photoCount = existingCount() + chosen.length;
    if (photoCount < minPhotos || photoCount > max) {
      setCurrent(stepPh);
      if (announce && lastFocusedStep !== "photos") {
        lastFocusedStep = "photos";
        focusAndScroll(stepPh, null);
      }
      return;
    }

    if (actions) setCurrent(actions);
    if (announce && lastFocusedStep !== "actions") {
      lastFocusedStep = "actions";
      focusAndScroll(actions, null);
    }
  }

  ["projectId", "surveyDate", "surveyorName", "category", "rating", "comment", "clientCallReference", "callRefBlankReason", "callUnreachedNote", "otherDetails"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("change", function () {
      updateFlow({ announce: true });
    });
    el.addEventListener("input", function () {
      updateFlow({ announce: false });
    });
  });

  var confirmBox = $("addressConfirmed");
  if (confirmBox) {
    confirmBox.addEventListener("change", function () {
      updateFlow({ announce: true });
    });
  }
  var callBox = $("callUnreached");
  if (callBox) {
    callBox.addEventListener("change", function () {
      syncCallUnreached();
      updateFlow({ announce: true });
    });
  }

  var narrowMedia = window.matchMedia("(max-width: 1024px)");
  if (narrowMedia.addEventListener) {
    narrowMedia.addEventListener("change", function () {
      updateFlow({ announce: false });
    });
  }

  updateFlow({ announce: false });

  if (!input || !newGrid) return;

  function existingCount() {
    return existing ? existing.querySelectorAll("[data-existing]").length : 0;
  }

  function visibleRequiredMissing() {
    if (!form) return false;
    var nodes = form.querySelectorAll("input[required], textarea[required], select[required]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.type === "checkbox") {
        if (!el.checked && !el.disabled && !(el.closest && el.closest("[hidden]"))) return true;
        continue;
      }
      if (el.disabled || (el.closest && el.closest("[hidden]"))) continue;
      if (!String(el.value || "").trim()) return true;
    }
    return false;
  }

  function syncFiles(files) {
    var dt = new DataTransfer();
    files.forEach(function (f) {
      dt.items.add(f);
    });
    input.files = dt.files;
  }

  function fmtMb(n) {
    return (n / (1024 * 1024)).toFixed(n >= 5 * 1024 * 1024 ? 1 : 2) + " MB";
  }

  function renderNew() {
    newGrid.innerHTML = "";
    chosen.forEach(function (file, index) {
      var fig = document.createElement("figure");
      fig.className = "photo-card";
      var img = document.createElement("img");
      img.alt = file.name;
      if (file.type && file.type.indexOf("image/") === 0 && file.type.indexOf("heic") === -1 && file.type.indexOf("heif") === -1) {
        img.src = URL.createObjectURL(file);
      }
      var cap = document.createElement("figcaption");
      cap.textContent = file.name + " · " + fmtMb(file.size);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hhsrs-btn hhsrs-btn-ghost photo-remove";
      btn.textContent = "Remove";
      btn.addEventListener("click", function () {
        chosen = chosen.filter(function (_f, i) {
          return i !== index;
        });
        syncFiles(chosen);
        renderNew();
        setPhotoStatus(chosen.length ? chosen.length + " photo(s) ready." : "", chosen.length ? "ok" : "");
        updateFlow({ announce: true });
      });
      fig.appendChild(img);
      fig.appendChild(cap);
      fig.appendChild(btn);
      newGrid.appendChild(fig);
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("decode"));
      };
      img.src = url;
    });
  }

  function compressFile(file) {
    var type = String(file.type || "").toLowerCase();
    var canTry = type.indexOf("image/") === 0 || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "");
    if (!canTry) return Promise.resolve({ file: file, shrunk: false, from: file.size, to: file.size });
    if (type.indexOf("heic") >= 0 || type.indexOf("heif") >= 0 || /\.heic$/i.test(file.name || "") || /\.heif$/i.test(file.name || "")) {
      return Promise.resolve({ file: file, shrunk: false, from: file.size, to: file.size, heic: true });
    }
    return loadImage(file)
      .then(function (img) {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) return { file: file, shrunk: false, from: file.size, to: file.size };
        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        if (file.size <= SKIP_UNDER_BYTES && scale === 1 && (type === "image/jpeg" || type === "image/jpg")) {
          return { file: file, shrunk: false, from: file.size, to: file.size };
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return { file: file, shrunk: false, from: file.size, to: file.size };
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              if (!blob || blob.size >= file.size) {
                resolve({ file: file, shrunk: false, from: file.size, to: file.size });
                return;
              }
              var base = String(file.name || "photo").replace(/\.[a-z0-9]+$/i, "");
              var next = new File([blob], base + ".jpg", { type: "image/jpeg", lastModified: Date.now() });
              resolve({ file: next, shrunk: true, from: file.size, to: next.size });
            },
            "image/jpeg",
            JPEG_QUALITY
          );
        });
      })
      .catch(function () {
        return { file: file, shrunk: false, from: file.size, to: file.size };
      });
  }

  input.addEventListener("change", function () {
    if (photoBusy) return;
    var room = Math.max(0, max - existingCount() - chosen.length);
    var picked = Array.prototype.slice.call(input.files || []);
    if (!picked.length) {
      syncFiles(chosen);
      renderNew();
      updateFlow({ announce: true });
      return;
    }
    if (room <= 0) {
      syncFiles(chosen);
      renderNew();
      setPhotoStatus("Add " + minPhotos + " to " + max + " photos.", "err");
      updateFlow({ announce: true });
      return;
    }
    var batch = picked.slice(0, room);
    var trimmed = picked.length > room;
    photoBusy = true;
    setPhotoStatus("Shrinking photos for a quicker upload…", "");
    Promise.all(batch.map(compressFile))
      .then(function (results) {
        var notes = [];
        results.forEach(function (result) {
          if (result.file.size > CLIENT_MAX_BYTES) {
            notes.push((result.file.name || "photo") + " is still over 25 MB after shrink — choose another shot.");
            return;
          }
          chosen.push(result.file);
          if (result.heic) notes.push((result.file.name || "photo") + ": HEIC kept as-is (some phones).");
          else if (result.shrunk) notes.push((result.file.name || "photo") + ": " + fmtMb(result.from) + " → " + fmtMb(result.to));
          else notes.push((result.file.name || "photo") + ": " + fmtMb(result.to) + " (already small enough)");
        });
        if (trimmed) notes.push("Only " + max + " photos can be added.");
        syncFiles(chosen);
        renderNew();
        setPhotoStatus(notes.join(" · "), chosen.length ? "ok" : "err");
      })
      .catch(function () {
        syncFiles(chosen);
        setPhotoStatus("Couldn’t shrink one of the photos — try again or pick another.", "err");
      })
      .then(function () {
        photoBusy = false;
        updateFlow({ announce: true });
      });
  });

  if (existing) {
    existing.addEventListener("click", function (e) {
      var btn = e.target.closest(".photo-remove");
      if (!btn) return;
      var card = btn.closest("[data-existing]");
      if (card) card.remove();
      updateFlow({ announce: true });
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      if (photoBusy) {
        e.preventDefault();
        setPhotoStatus("Still preparing photos…", "err");
        return;
      }
      syncFiles(chosen);
      var total = existingCount() + chosen.length;
      var oversized = "";
      for (var i = 0; i < chosen.length; i++) {
        if (chosen[i].size > CLIENT_MAX_BYTES) {
          oversized = chosen[i].name || "photo";
          break;
        }
      }
      if (oversized) {
        e.preventDefault();
        setPhotoStatus(oversized + " is still over 25 MB after shrink — choose another shot.", "err");
        return;
      }
      if (total > max) {
        e.preventDefault();
        setPhotoStatus("Add " + minPhotos + " to " + max + " photos.", "err");
        return;
      }
      if (total < minPhotos && !visibleRequiredMissing()) {
        e.preventDefault();
        setPhotoStatus(minPhotos === 1 ? "Add at least 1 photo." : "Add at least " + minPhotos + " photos.", "err");
      }
    });
  }

  var clearBtn = $("clear-form");
  var FIELD_IDS = [
    "projectId",
    "fullAddress",
    "uprn",
    "postcode",
    "surveyorName",
    "category",
    "rating",
    "comment",
    "clientCallReference",
    "otherDetails",
    "callUnreachedNote",
    "callRefBlankReason",
  ];

  function todayLondonDate() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  }

  function resetFormToDefaults() {
    FIELD_IDS.forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.value = "";
      el.classList.remove("is-invalid");
    });
    var dateEl = $("surveyDate");
    if (dateEl) {
      dateEl.value = todayLondonDate();
      dateEl.classList.remove("is-invalid");
    }
    chosen = [];
    syncFiles([]);
    renderNew();
    if (existing) existing.innerHTML = "";
    setPhotoStatus("");
    clearAddressMatch(false);
    lastProject = "";
    lastFocusedStep = "";
    var callUnreached = $("callUnreached");
    if (callUnreached) callUnreached.checked = false;
    updateFlow({ announce: false });
    var submit = form && form.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Review";
    }
    var banner = document.querySelector(".hhsrs-errors");
    if (banner) banner.remove();
    if (form) {
      form.querySelectorAll(".field-error").forEach(function (p) {
        p.remove();
      });
    }
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", function () {
      if (!confirm("Clear the form? This cannot be undone.")) return;
      resetFormToDefaults();
    });
  }
})();

/* ---------- PART B: touch add-on (after form.js) ---------- */
/* HHSRS site form - v4 touch add-on (append after form.js, or paste at the end of form.js).
   1. Keyboard helper: a focused text box / textarea / UPRN box is moved to roughly the top third of the
      visible area above the on-screen keyboard (window.visualViewport), re-checked while the keyboard animates in.
   2. Next-field advance: after a dropdown (or date) is chosen and the section is not yet complete,
      move to the next empty field in that section (focus only if it is a dropdown/date; text fields are only scrolled to).
   3. Take photo: a big camera button (capture="environment") that feeds the SAME photo list as "Add from gallery".
   Touch / narrow screens only (<=1024px or pointer:coarse); desktop unchanged. Respects prefers-reduced-motion.
   Never fights the user: any manual scroll (touchmove / wheel) cancels pending automatic scrolls. */
(function () {
  var form = document.getElementById("hhsrs-form");
  if (!form) return;
  var mqTouch = window.matchMedia("(max-width: 1024px), (pointer: coarse)");
  var mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  function touchUi() { return mqTouch.matches; }
  function behavior() { return mqReduce.matches ? "auto" : "smooth"; }

  var userMovedAt = 0;
  ["touchmove", "wheel"].forEach(function (ev) {
    window.addEventListener(ev, function () { userMovedAt = Date.now(); }, { passive: true });
  });

  function visibleArea() {
    var vv = window.visualViewport;
    return vv ? { top: vv.offsetTop, h: vv.height } : { top: 0, h: window.innerHeight };
  }
  function anchorFor(el) {
    var lab = el.id ? form.querySelector('label[for="' + el.id + '"]') : null;
    if (lab && lab.getClientRects().length && !lab.classList.contains("confirm-row")) {
      var lr = lab.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (lr.top <= er.top && er.top - lr.bottom < 40) return lab;
    }
    return el;
  }
  // put the field (with its label) at ~18% of the visible height; leave it if already in the top ~40%
  function placeInTopThird(el) {
    var v = visibleArea();
    var a = anchorFor(el).getBoundingClientRect();
    if (a.top >= v.top + 8 && a.top <= v.top + v.h * 0.4) return false;
    var delta = a.top - (v.top + v.h * 0.18);
    if (Math.abs(delta) < 16) return false;
    try { window.scrollBy({ top: delta, behavior: behavior() }); } catch (e) { window.scrollBy(0, delta); }
    return true;
  }
  function isTextField(el) {
    return el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|email|tel|number|url|password)$/i.test(el.type));
  }
  function isChoice(el) {
    return el.tagName === "SELECT" || (el.tagName === "INPUT" && /^(date|radio)$/i.test(el.type));
  }

  /* 0. scroll room: while sections are still opening on a touch/narrow screen, leave space under the form
        so the section being worked on can sit near the top of the screen (and above the keyboard) */
  var actionsEl = document.getElementById("form-actions");
  var mqSteps = window.matchMedia("(max-width: 1024px)"); // same test form.js uses for the step-by-step flow
  function syncRoom() {
    var finished = actionsEl && !actionsEl.hidden && actionsEl.classList.contains("is-current");
    document.body.classList.toggle("hhsrs-flow-room", mqSteps.matches && !!actionsEl && !finished);
  }
  if (actionsEl && window.MutationObserver) {
    new MutationObserver(syncRoom).observe(actionsEl, { attributes: true, attributeFilter: ["hidden", "class"] });
  }
  if (mqSteps.addEventListener) mqSteps.addEventListener("change", syncRoom);
  syncRoom();

  /* 1. keyboard helper */
  var kb = null, kbTimer = 0;
  form.addEventListener("focusin", function (e) {
    var el = e.target;
    if (!touchUi() || !isTextField(el) || el.readOnly || el.disabled) return;
    var started = Date.now();
    kb = { el: el, started: started };
    window.setTimeout(function () {
      if (kb && kb.el === el && userMovedAt < started) placeInTopThird(el);
    }, 150);
  });
  form.addEventListener("focusout", function (e) {
    if (kb && kb.el === e.target) kb = null;
  });
  if (window.visualViewport) {
    var onViewport = function () {
      if (!kb || !touchUi()) return;
      if (userMovedAt > kb.started) return;          // user scrolled by hand: leave it alone
      if (Date.now() - kb.started > 1500) return;    // only while the keyboard is animating in
      window.clearTimeout(kbTimer);
      kbTimer = window.setTimeout(function () {
        if (kb && userMovedAt <= kb.started) placeInTopThird(kb.el);
      }, 80);
    };
    window.visualViewport.addEventListener("resize", onViewport);
    window.visualViewport.addEventListener("scroll", onViewport);
  }

  /* 2. next field in the same section after a dropdown/date is chosen */
  function nextEmptyField(step, from) {
    var list = Array.prototype.slice.call(step.querySelectorAll("input, select, textarea"));
    for (var j = list.indexOf(from) + 1; j < list.length; j++) {
      var f = list[j];
      if (f.disabled || f.readOnly || /^(hidden|file|checkbox|button|submit)$/i.test(f.type || "")) continue;
      if ((f.closest && f.closest("[hidden]")) || !f.getClientRects().length) continue;
      if (String(f.value || "").trim()) continue;
      return f;
    }
    return null;
  }
  form.addEventListener("change", function (e) {
    var el = e.target;
    if (!touchUi() || !isChoice(el)) return;
    var step = el.closest && el.closest(".flow-step");
    if (!step) return;
    var at = Date.now();
    window.setTimeout(function () {
      if (userMovedAt > at) return;
      if (!step.classList.contains("is-current")) return; // section finished: the section auto-advance takes over
      var next = nextEmptyField(step, el);
      if (!next) return;
      if (isChoice(next)) {
        try { next.focus({ preventScroll: true }); } catch (err) { next.focus(); }
      }
      placeInTopThird(next);
    }, 60);
  });

  /* 4. Review page "Edit <section>" lands back on that section (live: POST /edit with jump=..., form gets data-jump) */
  var jump = form.getAttribute("data-jump") || "";
  if (/^(step-visit|step-property|step-hazard|extra-box|step-photos)$/.test(jump)) {
    window.setTimeout(function () {
      var t = document.getElementById(jump);
      if (t && !t.hidden) window.scrollTo(0, Math.max(0, t.getBoundingClientRect().top + window.pageYOffset - 12));
    }, 60);
  }

  /* 3. Take photo (camera) + Add from gallery, both feeding the one photo list (#photos) */
  var gallery = document.getElementById("photos");
  var galleryBtn = form.querySelector('label.hhsrs-file-btn[for="photos"]');
  if (gallery && galleryBtn && window.DataTransfer) {
    var max = parseInt(form.getAttribute("data-max-photos") || "4", 10);
    var cam = document.createElement("input");
    cam.type = "file";
    cam.accept = "image/*";
    cam.setAttribute("capture", "environment");
    cam.id = "photos-camera";
    cam.className = "photo-camera-input";
    cam.tabIndex = -1; // no name attribute: never submitted itself, files are handed to #photos
    var camBtn = document.createElement("label");
    camBtn.htmlFor = "photos-camera";
    camBtn.className = "hhsrs-file-btn photo-btn-camera";
    var row = document.createElement("div");
    row.className = "photo-buttons";
    galleryBtn.parentNode.insertBefore(row, galleryBtn);
    row.appendChild(camBtn);
    row.appendChild(galleryBtn);
    row.parentNode.insertBefore(cam, row.nextSibling); // hidden input sits outside the button grid
    galleryBtn.classList.add("photo-btn-gallery");
    galleryBtn.innerHTML = '<span class="photo-when-touch">Add from gallery</span><span class="photo-when-desktop">Add photos</span>';

    var count = function () {
      return form.querySelectorAll("#new-photos .photo-card, #existing-photos [data-existing]").length;
    };
    var sync = function () {
      var n = count(), full = n >= max;
      camBtn.innerHTML = full
        ? '<span aria-hidden="true">📷</span> ' + max + " of " + max + " photos added"
        : '<span aria-hidden="true">📷</span> ' + (n ? "Take another photo" : "Take photo");
      [camBtn, galleryBtn].forEach(function (b) {
        b.classList.toggle("is-disabled", full);
        b.setAttribute("aria-disabled", full ? "true" : "false");
      });
      cam.disabled = full;
    };
    [camBtn, galleryBtn].forEach(function (b) {
      b.addEventListener("click", function (e) {
        if (count() >= max) {
          e.preventDefault();
          var st = document.getElementById("photo-status");
          if (st) { st.textContent = "You already have " + max + " photos. Remove one to add another."; st.className = "find-status is-err"; }
        }
      });
    });
    cam.addEventListener("change", function () {
      var files = cam.files;
      if (!files || !files.length) return;
      var dt = new DataTransfer();
      for (var i = 0; i < files.length; i++) dt.items.add(files[i]);
      gallery.files = dt.files;                                        // same path as a gallery pick:
      gallery.dispatchEvent(new Event("change", { bubbles: true }));   // limit, resize and checks all apply
      cam.value = "";
    });
    if (window.MutationObserver) {
      var mo = new MutationObserver(sync);
      ["new-photos", "existing-photos"].forEach(function (id) {
        var g = document.getElementById(id);
        if (g) mo.observe(g, { childList: true, subtree: true });
      });
    }
    sync();
  }
})();
