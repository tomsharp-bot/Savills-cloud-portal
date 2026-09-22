(function () {
  const drop = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const form = drop && drop.tagName === "FORM" ? drop : null;
  const browse = document.getElementById("btnBrowse");

  if (browse && fileInput) {
    browse.addEventListener("click", function () {
      fileInput.click();
    });
  }
  if (fileInput && form) {
    fileInput.addEventListener("change", function () {
      if (fileInput.files && fileInput.files.length) form.submit();
    });
  }
  if (drop && form) {
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add("over");
      });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove("over");
      });
    });
    drop.addEventListener("drop", function (e) {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files || !files.length || !fileInput) return;
      const transfer = new DataTransfer();
      for (let i = 0; i < files.length; i++) transfer.items.add(files[i]);
      fileInput.files = transfer.files;
      form.submit();
    });
    window.addEventListener("dragover", function (e) {
      e.preventDefault();
    });
    window.addEventListener("drop", function (e) {
      if (e.target === drop || drop.contains(e.target)) return;
      e.preventDefault();
    });
  }

  const search = document.getElementById("docSearch");
  const body = document.getElementById("docBody");
  const empty = document.getElementById("docEmpty");
  function applySearch() {
    if (!body || !empty) return;
    const q = (search && search.value ? search.value : "").trim().toLowerCase();
    const rows = body.querySelectorAll("tr");
    let shown = 0;
    rows.forEach(function (row) {
      const name = (row.getAttribute("data-name") || "").toLowerCase();
      const on = !q || name.indexOf(q) !== -1;
      row.hidden = !on;
      if (on) shown += 1;
    });
    empty.hidden = shown > 0;
    if (!shown) {
      empty.textContent = rows.length
        ? "No documents match that search."
        : empty.getAttribute("data-empty") || "No documents in this category yet.";
    }
  }
  if (search) search.addEventListener("input", applySearch);

  document.querySelectorAll("[data-delete-form]").forEach(function (el) {
    el.addEventListener("submit", function (e) {
      const name = el.getAttribute("data-name") || "this file";
      const cat = el.getAttribute("data-category") || "this category";
      if (!window.confirm("Delete \u201c" + name + "\u201d from " + cat + "?")) e.preventDefault();
    });
  });

  const viewer = document.getElementById("viewer");
  const viewerTitle = document.getElementById("viewerTitle");
  const viewerBody = document.getElementById("viewerBody");
  const downloadBtn = document.getElementById("btnDownloadViewer");
  const closeBtn = document.getElementById("btnCloseViewer");

  function closeViewer() {
    if (!viewer || !viewerBody) return;
    viewer.classList.remove("open");
    viewer.hidden = true;
    viewerBody.replaceChildren();
  }
  function openViewer(link) {
    if (!viewer || !viewerTitle || !viewerBody || !downloadBtn) return;
    const name = link.getAttribute("data-name") || "Document";
    const kind = link.getAttribute("data-preview") || "";
    const viewUrl = link.getAttribute("href") || "";
    const downloadUrl = link.getAttribute("data-download") || viewUrl;
    viewerTitle.textContent = name;
    viewerBody.replaceChildren();
    if (kind === "pdf") {
      const iframe = document.createElement("iframe");
      iframe.src = viewUrl;
      iframe.title = name;
      viewerBody.appendChild(iframe);
    } else if (kind === "image") {
      const img = document.createElement("img");
      img.src = viewUrl;
      img.alt = name;
      viewerBody.appendChild(img);
    } else {
      const p = document.createElement("p");
      p.textContent = "“" + name + "” can’t be shown in the browser. Download it to open in Word or Excel.";
      viewerBody.appendChild(p);
    }
    downloadBtn.setAttribute("href", downloadUrl);
    viewer.hidden = false;
    viewer.classList.add("open");
  }

  if (body) {
    body.addEventListener("click", function (e) {
      const link = e.target.closest("[data-open]");
      if (!link) return;
      e.preventDefault();
      openViewer(link);
    });
  }
  if (closeBtn) closeBtn.addEventListener("click", closeViewer);
  if (viewer) {
    viewer.addEventListener("click", function (e) {
      if (e.target === viewer) closeViewer();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeViewer();
  });
})();
