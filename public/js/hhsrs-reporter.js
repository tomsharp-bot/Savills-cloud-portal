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
      if (lower.indexOf("mtvh") === 0 && keys[i] === "MTVH") return p;
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
})();
