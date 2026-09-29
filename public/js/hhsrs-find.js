(function () {
  function $(id) {
    return document.getElementById(id);
  }

  document.querySelectorAll("tr.find-result").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target.closest("a")) return;
      var href = row.getAttribute("data-href");
      if (href) window.location.href = href;
    });
  });

  var close = $("fr-close");
  var shade = $("fr-shade");
  if (shade && close) shade.addEventListener("click", function () { window.location.href = close.href; });
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

  function paint() {
    var subject = correctionSubject(previousSubject);
    var oldHead = String(previous.address || "").split(",")[0].trim();
    var newHead = val("f-address").split(",")[0].trim();
    if (oldHead && newHead && oldHead !== newHead && subject.indexOf(oldHead) !== -1) {
      subject = subject.replace(oldHead, newHead);
    }
    var title = $("fr-preview-subject");
    if (title) title.textContent = subject;
    var amendment = val("f-amendment");
    var intro = amendment
      ? "Please disregard our previous email. " + amendment
      : "Please disregard our previous email.";
    var html = "<p>Hi all,</p><p>" + esc(intro) + "</p>";
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
  var send = $("btn-send-correction");
  function syncSend() {
    if (send) send.disabled = !(checked && checked.checked);
  }
  if (checked) checked.addEventListener("change", syncSend);
  document.querySelectorAll("#fr-amend input, #fr-amend select").forEach(function (el) {
    if (el.id === "fr-checked") return;
    el.addEventListener("input", paint);
    el.addEventListener("change", paint);
  });
  var form = $("rv-send-form");
  if (form) {
    form.addEventListener("submit", function (event) {
      if (!checked || !checked.checked) {
        event.preventDefault();
        syncSend();
      }
    });
  }
  syncSend();
  paint();
})();
