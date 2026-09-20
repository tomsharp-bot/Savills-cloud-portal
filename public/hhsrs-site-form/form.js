(function () {
  var input = document.getElementById("photos");
  var newGrid = document.getElementById("new-photos");
  var existing = document.getElementById("existing-photos");
  var max = 4;
  if (!input || !newGrid) return;

  function existingCount() {
    return existing ? existing.querySelectorAll("[data-existing]").length : 0;
  }

  function syncFiles(files) {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
  }

  function currentFiles() {
    return Array.prototype.slice.call(input.files || []);
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

  input.addEventListener("change", function () {
    var room = Math.max(0, max - existingCount());
    var picked = currentFiles().slice(0, room);
    syncFiles(picked);
    renderNew();
  });

  if (existing) {
    existing.addEventListener("click", function (e) {
      var btn = e.target.closest(".photo-remove");
      if (!btn) return;
      var card = btn.closest("[data-existing]");
      if (card) card.remove();
    });
  }
})();
