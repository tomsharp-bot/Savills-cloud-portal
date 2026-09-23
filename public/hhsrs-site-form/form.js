(function () {
  var form = document.getElementById("hhsrs-form");
  var input = document.getElementById("photos");
  var newGrid = document.getElementById("new-photos");
  var existing = document.getElementById("existing-photos");
  var statusEl = document.getElementById("photo-status");
  var minPhotos = form ? parseInt(form.getAttribute("data-min-photos") || "1", 10) : 1;
  var max = form ? parseInt(form.getAttribute("data-max-photos") || "4", 10) : 4;
  var maxBytes = form
    ? parseInt(form.getAttribute("data-max-file-bytes") || String(40 * 1024 * 1024), 10)
    : 40 * 1024 * 1024;
  var maxMb = form ? parseInt(form.getAttribute("data-max-file-mb") || "40", 10) : 40;
  var MAX_EDGE = 2048;
  var JPEG_QUALITY = 0.82;
  var SKIP_UNDER_BYTES = 2 * 1024 * 1024;

  var findBtn = document.getElementById("btn-find-address");
  var findStatus = document.getElementById("find-status");
  var matchList = document.getElementById("match-list");
  var lookupUrl = form ? form.getAttribute("data-address-lookup") || "" : "";
  var lookupBusy = false;

  function setFindStatus(text, kind) {
    if (!findStatus) return;
    findStatus.textContent = text || "";
    findStatus.className = "find-status" + (kind ? " is-" + kind : "");
  }

  function clearMatches() {
    if (!matchList) return;
    matchList.hidden = true;
    matchList.replaceChildren();
  }

  function keepAddressEditable() {
    ["fullAddress", "uprn"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.readOnly = false;
      el.disabled = false;
    });
  }

  function applyMatch(match) {
    var address = document.getElementById("fullAddress");
    var uprn = document.getElementById("uprn");
    var postcode = document.getElementById("postcode");
    keepAddressEditable();
    if (address) {
      address.value = match.line || "";
      address.classList.remove("is-invalid");
    }
    if (uprn) {
      uprn.value = match.uprn || "";
      uprn.classList.remove("is-invalid");
    }
    if (postcode && match.postcode) {
      postcode.value = match.postcode;
      postcode.classList.remove("is-invalid");
    }
    clearMatches();
    setFindStatus("Address found.", "ok");
  }

  function showMatches(matches) {
    if (!matchList) return;
    matchList.replaceChildren();
    matches.forEach(function (match) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      var label = match.line || "Address";
      if (match.uprn) label += " · UPRN " + match.uprn;
      btn.textContent = label;
      btn.addEventListener("click", function () {
        applyMatch(match);
      });
      li.appendChild(btn);
      matchList.appendChild(li);
    });
    matchList.hidden = false;
  }

  function findAddress() {
    if (!findBtn || lookupBusy) return;
    var postcodeEl = document.getElementById("postcode");
    var houseEl = document.getElementById("houseNumber");
    var postcode = postcodeEl ? String(postcodeEl.value || "").trim() : "";
    var house = houseEl ? String(houseEl.value || "").trim() : "";
    clearMatches();
    if (!postcode || !house) {
      setFindStatus("Enter postcode and house number / name first.", "err");
      return;
    }
    if (!lookupUrl) {
      setFindStatus("Address lookup is not available.", "err");
      return;
    }
    lookupBusy = true;
    findBtn.disabled = true;
    setFindStatus("Looking up address…", "");
    var url =
      lookupUrl +
      "?postcode=" +
      encodeURIComponent(postcode) +
      "&house=" +
      encodeURIComponent(house);
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
        if (result.status === 503 || result.status === 501) {
          setFindStatus(data.error || "Address lookup is not configured.", "err");
          return;
        }
        if (result.status === 429) {
          setFindStatus(data.error || "Too many lookups. Wait a moment and try again.", "err");
          return;
        }
        if (!result.status || result.status >= 400) {
          setFindStatus(data.error || "Could not look up that address.", "err");
          return;
        }
        var matches = Array.isArray(data.matches) ? data.matches : [];
        if (matches.length === 1) {
          applyMatch(matches[0]);
          return;
        }
        if (matches.length > 1) {
          setFindStatus("Pick the matching address:", "");
          showMatches(matches);
          return;
        }
        setFindStatus("No matching address. Type the full address and UPRN yourself.", "err");
      })
      .catch(function () {
        setFindStatus("Could not look up that address. Check your connection or type the address.", "err");
      })
      .then(function () {
        lookupBusy = false;
        if (findBtn) findBtn.disabled = false;
      });
  }

  if (findBtn) findBtn.addEventListener("click", findAddress);

  function onLookupEnter(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    findAddress();
  }

  ["postcode", "houseNumber"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("keydown", onLookupEnter);
  });

  function visitReady() {
    var project = document.getElementById("projectId");
    var date = document.getElementById("surveyDate");
    var name = document.getElementById("surveyorName");
    return !!(
      project && String(project.value || "").trim() &&
      date && String(date.value || "").trim() &&
      name && String(name.value || "").trim()
    );
  }

  function syncProjectExtras() {
    var project = document.getElementById("projectId");
    var opt = project && project.selectedIndex >= 0 ? project.options[project.selectedIndex] : null;
    var flags = {
      calls: !!(opt && opt.getAttribute("data-calls") === "1"),
      onward: !!(opt && opt.getAttribute("data-onward") === "1"),
      saxon: !!(opt && opt.getAttribute("data-saxon") === "1"),
      online: !!(opt && opt.getAttribute("data-online") === "1"),
    };
    var nodes = document.querySelectorAll(".project-extra");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-extra") || "";
      var show = !!flags[key];
      nodes[i].hidden = !show;
      var inputs = nodes[i].querySelectorAll("input, textarea, select");
      for (var j = 0; j < inputs.length; j++) inputs[j].disabled = !show;
    }
  }

  function updateVisitGate() {
    var details = document.getElementById("issue-details");
    var hint = document.getElementById("visit-gate-hint");
    var open = visitReady();
    if (details) details.hidden = !open;
    if (hint) hint.hidden = open;
    if (open) keepAddressEditable();
    syncProjectExtras();
    syncCallUnreached();
  }

  function syncCallUnreached() {
    var box = document.getElementById("callUnreached");
    var wrap = document.getElementById("call-unreached-note");
    var note = document.getElementById("callUnreachedNote");
    var calls = document.querySelector('.project-extra[data-extra="calls"]');
    var callsShown = !!(calls && !calls.hidden);
    var on = !!(box && box.checked && callsShown);
    if (wrap) wrap.hidden = !on;
    if (note) note.disabled = !on;
  }

  var callBox = document.getElementById("callUnreached");
  if (callBox) callBox.addEventListener("change", syncCallUnreached);

  ["projectId", "surveyDate", "surveyorName"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", updateVisitGate);
    el.addEventListener("change", updateVisitGate);
  });
  updateVisitGate();

  if (!input || !newGrid) return;

  function existingCount() {
    return existing ? existing.querySelectorAll("[data-existing]").length : 0;
  }

  function visibleRequiredMissing() {
    if (!form) return false;
    var nodes = form.querySelectorAll("input[required], textarea[required], select[required]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.disabled || (el.closest && el.closest("[hidden]"))) continue;
      if (!String(el.value || "").trim()) return true;
    }
    return false;
  }

  function syncFiles(files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
  }

  function currentFiles() {
    return Array.prototype.slice.call(input.files || []);
  }

  function setStatus(text) {
    if (!statusEl) return;
    if (!text) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = text;
  }

  function renderNew() {
    newGrid.innerHTML = "";
    currentFiles().forEach(function (file, index) {
      var fig = document.createElement("figure");
      fig.className = "photo-card";
      var img = document.createElement("img");
      img.alt = file.name;
      if (file.type && file.type.indexOf("image/") === 0 && file.type.indexOf("heic") === -1 && file.type.indexOf("heif") === -1) {
        img.src = URL.createObjectURL(file);
      }
      var cap = document.createElement("figcaption");
      cap.textContent = file.name;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "hhsrs-btn hhsrs-btn-ghost photo-remove";
      btn.textContent = "Remove";
      btn.addEventListener("click", function () {
        var next = currentFiles().filter(function (_f, i) { return i !== index; });
        syncFiles(next);
        renderNew();
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
    var canTry =
      type === "image/jpeg" ||
      type === "image/jpg" ||
      type === "image/png" ||
      type === "image/webp" ||
      type === "image/heic" ||
      type === "image/heif" ||
      /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "");
    if (!canTry) return Promise.resolve(file);

    return loadImage(file)
      .then(function (img) {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) return file;
        var scale = Math.min(1, MAX_EDGE / Math.max(w, h));
        if (file.size <= SKIP_UNDER_BYTES && scale === 1 && (type === "image/jpeg" || type === "image/jpg")) {
          return file;
        }
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        var ctx = canvas.getContext("2d");
        if (!ctx) return file;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return new Promise(function (resolve) {
          canvas.toBlob(
            function (blob) {
              if (!blob || blob.size >= file.size) {
                resolve(file);
                return;
              }
              var base = String(file.name || "photo").replace(/\.[a-z0-9]+$/i, "");
              resolve(new File([blob], base + ".jpg", { type: "image/jpeg", lastModified: Date.now() }));
            },
            "image/jpeg",
            JPEG_QUALITY
          );
        });
      })
      .catch(function () {
        return file;
      });
  }

  function oversizedName(files) {
    for (var i = 0; i < files.length; i++) {
      if (files[i].size > maxBytes) return files[i].name || "photo";
    }
    return "";
  }

  input.addEventListener("change", function () {
    var room = Math.max(0, max - existingCount());
    var picked = currentFiles().slice(0, room);
    syncFiles(picked);
    renderNew();
    var big = oversizedName(picked);
    if (big) {
      setStatus(big + " is over " + maxMb + "MB. Each photo up to " + maxMb + "MB. It will be compressed on Review if possible.");
    } else {
      setStatus("");
    }
  });

  if (existing) {
    existing.addEventListener("click", function (e) {
      var btn = e.target.closest(".photo-remove");
      if (!btn) return;
      var card = btn.closest("[data-existing]");
      if (card) card.remove();
    });
  }

  if (form) {
    form.addEventListener("submit", function (e) {
      if (form.getAttribute("data-photos-ready") === "1") return;
      var files = currentFiles();
      var total = existingCount() + files.length;
      if (total < minPhotos && !visibleRequiredMissing()) {
        e.preventDefault();
        setStatus(minPhotos === 1 ? "Add at least 1 photo." : "Add at least " + minPhotos + " photos.");
        return;
      }
      if (total > max) {
        e.preventDefault();
        setStatus("Add " + minPhotos + " to " + max + " photos.");
        return;
      }
      if (!files.length) return;
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparing photos…";
      }
      setStatus("Compressing photos for upload…");
      Promise.all(files.map(compressFile))
        .then(function (next) {
          syncFiles(next);
          renderNew();
          var big = oversizedName(next);
          if (big) {
            setStatus(big + " is still over " + maxMb + "MB (each photo up to " + maxMb + "MB). Choose a smaller photo.");
            if (btn) {
              btn.disabled = false;
              btn.textContent = "Review";
            }
            return;
          }
          setStatus("");
          form.setAttribute("data-photos-ready", "1");
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
        })
        .catch(function () {
          form.setAttribute("data-photos-ready", "1");
          if (typeof form.requestSubmit === "function") form.requestSubmit();
          else form.submit();
        });
    });
  }

  var clearBtn = document.getElementById("clear-form");
  var FIELD_IDS = [
    "projectId",
    "houseNumber",
    "postcode",
    "fullAddress",
    "uprn",
    "surveyorName",
    "category",
    "rating",
    "comment",
    "clientCallReference",
    "otherDetails",
    "callUnreachedNote",
  ];

  function todayLondonDate() {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  }

  function resetFormToDefaults() {
    FIELD_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.value = "";
      el.classList.remove("is-invalid");
    });
    var dateEl = document.getElementById("surveyDate");
    if (dateEl) {
      dateEl.value = todayLondonDate();
      dateEl.classList.remove("is-invalid");
    }
    syncFiles([]);
    renderNew();
    if (existing) existing.innerHTML = "";
    setStatus("");
    clearMatches();
    setFindStatus("", "");
    var cat1 = document.getElementById("cat1Confirmed");
    if (cat1) cat1.checked = false;
    var callUnreached = document.getElementById("callUnreached");
    if (callUnreached) callUnreached.checked = false;
    updateVisitGate();
    if (form) form.removeAttribute("data-photos-ready");
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
