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

  function stubDraft(projectCfg) {
    var toEl = $("rv-email-to");
    var ccEl = $("rv-email-cc");
    var subEl = $("rv-email-subject");
    var bodyEl = $("rv-email-body");
    if (!projectCfg) {
      if (toEl && !toEl.dataset.userEdited) toEl.value = "";
      if (ccEl && !ccEl.dataset.userEdited) ccEl.value = "";
      if (subEl && !subEl.dataset.userEdited) subEl.value = "";
      if (bodyEl && !bodyEl.dataset.userEdited) bodyEl.value = "";
      return;
    }
    if (toEl && !toEl.dataset.userEdited) toEl.value = (projectCfg.to || []).join("; ");
    if (ccEl && !ccEl.dataset.userEdited) ccEl.value = (projectCfg.cc || []).join("; ");

    // Filled cases keep server draft unless user cleared / no server draft
    if (cfg.mode === "filled" && cfg.serverDraft && (cfg.serverDraft.subject || cfg.serverDraft.body)) {
      if (subEl && !subEl.dataset.userEdited && !subEl.value) subEl.value = cfg.serverDraft.subject || "";
      if (bodyEl && !bodyEl.dataset.userEdited && !bodyEl.value) bodyEl.value = cfg.serverDraft.body || "";
      return;
    }
    if (cfg.mode === "filled") return;

    var address = (($("rv-address") && $("rv-address").value) || "").trim() || "[address]";
    var hazard = (($("rv-hazard") && $("rv-hazard").value) || "").trim() || "[hazard]";
    var rating = (($("rv-rating") && $("rv-rating").value) || "").trim() || "[rating]";
    var notes = (($("rv-notes") && $("rv-notes").value) || "").trim();
    var description = notes || "There is a reported hazard at the property.";
    var subject = projectCfg.name + " - HHSRS – " + address;
    if (projectCfg.template === "BPHA") subject = "BPHA - HHSRS – " + address;
    if (projectCfg.template === "Cornwall") subject = "Cornwall 2026 - HHSRS – " + address;
    if (projectCfg.template === "Vico Homes") {
      subject =
        "Vico Homes - HHSRS" + (/damp|mould|mold/i.test(hazard) ? " D&M" : "") + " - " + address;
    }
    var lines = [
      "Hi all,",
      "",
      "One of our surveyors has visited " + address + ".",
      description + " We have recorded this as " + rating + " for " + hazard + " on the HHSRS.",
    ];
    if (subEl && !subEl.dataset.userEdited) subEl.value = subject;
    if (bodyEl && !bodyEl.dataset.userEdited) bodyEl.value = lines.join("\n");
  }

  function applyProjectChange(opts) {
    opts = opts || {};
    var name = ($("rv-project") && $("rv-project").value) || "";
    var projectCfg = matchProject(name);
    var fields = $("rv-case-fields");
    var hint = $("rv-project-hint");
    if (fields) {
      if (!name && cfg.mode !== "filled") fields.setAttribute("disabled", "disabled");
      else fields.removeAttribute("disabled");
    }
    if (hint) {
      hint.textContent = projectCfg
        ? projectCfg.hint
        : "Choose the project first. Extra fields and the email draft follow its rules.";
    }
    fillRatingOptions(projectCfg ? projectCfg.ratingScheme : "NEW", opts.keepRating);
    setExtraVisibility(projectCfg);
    if (!opts.skipDraft) stubDraft(projectCfg);
  }

  ["rv-email-to", "rv-email-cc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("input", function () {
      el.dataset.userEdited = "1";
    });
  });

  var projectSel = $("rv-project");
  if (projectSel) {
    projectSel.addEventListener("change", function () {
      ["rv-email-to", "rv-email-cc", "rv-email-subject", "rv-email-body"].forEach(function (id) {
        var el = $(id);
        if (el) delete el.dataset.userEdited;
      });
      applyProjectChange();
    });
    var keep = ($("rv-rating") && $("rv-rating").value) || undefined;
    if (cfg.initialProject && !projectSel.value) {
      // Try exact then fuzzy match into select
      if (DEMO[cfg.initialProject]) projectSel.value = cfg.initialProject;
      else {
        var m = matchProject(cfg.initialProject);
        if (m) projectSel.value = m.name;
      }
    }
    applyProjectChange({ keepRating: keep, skipDraft: cfg.mode === "filled" });
  }

  ["rv-hazard", "rv-address", "rv-notes", "rv-rating"].forEach(function (id) {
    var el = $(id);
    if (!el) return;
    el.addEventListener("change", function () {
      if (cfg.mode === "blank") {
        var name = ($("rv-project") && $("rv-project").value) || "";
        stubDraft(matchProject(name));
        setExtraVisibility(matchProject(name));
      }
    });
    el.addEventListener("input", function () {
      if (cfg.mode === "blank") {
        var name = ($("rv-project") && $("rv-project").value) || "";
        stubDraft(matchProject(name));
      }
    });
  });

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
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    var summary = item.summary || [item.category, item.rating].filter(Boolean).join(" · ");
    var body = [item.projectName, item.fullAddress, summary].filter(Boolean).join(" — ");
    try {
      var note = new Notification("New HHSRS hazard", {
        body: body,
        tag: "hhsrs-" + item.id,
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
    fresh.forEach(function (item) {
      rememberId(item.id);
    });
    saveSeen();
    showToast(fresh);
    var limit = Math.min(fresh.length, 3);
    for (var n = 0; n < limit; n++) desktopNotify(fresh[n]);
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

  function paintNotifStatus() {
    var status = $("notif-status");
    var btn = $("btn-enable-desktop-alerts");
    var perm = notificationState();
    if (status) {
      status.classList.remove("granted", "denied");
      if (perm === "granted") {
        status.textContent = "Desktop alerts on";
        status.classList.add("granted");
      } else if (perm === "denied") {
        status.textContent = "Desktop alerts blocked. On-screen alerts still show.";
        status.classList.add("denied");
      } else if (perm === "unsupported") {
        status.textContent = "Desktop alerts are unavailable in this browser. On-screen alerts still show.";
      } else {
        status.textContent = "On-screen alerts are on.";
      }
    }
    if (btn) {
      if (perm === "granted") {
        btn.textContent = "Desktop alerts on";
        btn.disabled = true;
      } else if (perm === "unsupported") {
        btn.disabled = true;
      } else {
        btn.textContent = "Enable desktop alerts";
        btn.disabled = false;
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

  var dismissBtn = $("hhsrs-toast-dismiss");
  if (dismissBtn) dismissBtn.addEventListener("click", hideToast);
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") hideToast();
  });

  var enableBtn = $("btn-enable-desktop-alerts");
  if (enableBtn) {
    enableBtn.addEventListener("click", function () {
      unlockAlertSound();
      askNotificationPermission();
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
})();
