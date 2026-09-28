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

  var amend = $("fr-amend");
  if (!amend) return;

  var reason = "";
  var error = $("fr-error");
  var note = $("fr-note");
  var subject = $("hhsrs-subject");

  function showError(message) {
    if (!error) return;
    if (!message) {
      error.hidden = true;
      error.textContent = "";
      return;
    }
    error.hidden = false;
    error.textContent = message;
  }

  function includedNames() {
    var names = [];
    document.querySelectorAll("#rv-attach-list input[data-attach-name]").forEach(function (box) {
      if (box.checked) names.push(box.getAttribute("data-attach-name"));
    });
    return names;
  }

  function syncPhotos() {
    var names = includedNames();
    document.querySelectorAll("#fr-thumbs .find-thumb[data-photo]").forEach(function (thumb) {
      thumb.classList.toggle("is-off", names.indexOf(thumb.getAttribute("data-photo")) === -1);
    });
    document.querySelectorAll("#fr-picker [data-add-photo]").forEach(function (btn) {
      btn.classList.toggle("is-off", names.indexOf(btn.getAttribute("data-add-photo")) !== -1);
    });
    var count = $("fr-photo-count");
    if (count) count.textContent = "Photos (" + names.length + ")";
  }

  function boxFor(name) {
    var found = null;
    document.querySelectorAll("#rv-attach-list input[data-attach-name]").forEach(function (box) {
      if (box.getAttribute("data-attach-name") === name) found = box;
    });
    return found;
  }

  document.querySelectorAll("[data-remove-photo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var box = boxFor(btn.getAttribute("data-remove-photo"));
      if (box) box.checked = false;
      syncPhotos();
    });
  });

  document.querySelectorAll("[data-add-photo]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var box = boxFor(btn.getAttribute("data-add-photo"));
      if (box) box.checked = true;
      syncPhotos();
    });
  });

  var add = $("fr-add-photo");
  var picker = $("fr-picker");
  if (add && picker) {
    add.addEventListener("click", function () {
      picker.hidden = !picker.hidden;
    });
  }

  document.querySelectorAll("#fr-reasons .find-pick").forEach(function (btn) {
    btn.addEventListener("click", function () {
      reason = btn.getAttribute("data-reason") || "";
      document.querySelectorAll("#fr-reasons .find-pick").forEach(function (other) {
        other.classList.toggle("is-on", other === btn);
      });
      showError("");
      var hidden = $("fr-send-reason");
      if (hidden) hidden.value = reason;
    });
  });

  function prefixSubject(value) {
    var rest = String(value || "").replace(/^(?:correction:\s*)+/i, "").trim();
    return rest ? "CORRECTION: " + rest : "CORRECTION:";
  }

  var sendBtn = $("btn-send-email");
  if (sendBtn) {
    sendBtn.addEventListener("click", function (event) {
      var to = $("hhsrs-to");
      var toValue = to ? String(to.value || "").trim() : "";
      var noteValue = note ? String(note.value || "").trim() : "";
      var message = "";
      if (!reason) message = "Pick a reason.";
      else if (reason === "Other" && !noteValue) message = "Add a short note.";
      else if (!toValue) message = "Add a To address.";
      if (message) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showError(message);
        return;
      }
      showError("");
      if (subject) subject.value = prefixSubject(subject.value);
      var reasonField = $("fr-send-reason");
      var noteField = $("fr-send-note");
      if (reasonField) reasonField.value = reason;
      if (noteField) noteField.value = noteValue;
    }, true);
  }

  syncPhotos();
})();
