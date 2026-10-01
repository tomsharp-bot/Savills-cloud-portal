(function () {
  var form = document.getElementById("ml-filters");
  if (form) {
    form.addEventListener("change", function (event) {
      var target = event.target;
      if (target && target.id === "ml-q") return;
      form.submit();
    });
    var search = document.getElementById("ml-q");
    var timer = 0;
    if (search) {
      search.addEventListener("input", function () {
        window.clearTimeout(timer);
        timer = window.setTimeout(function () { form.submit(); }, 400);
      });
    }
  }

  document.querySelectorAll("tr[data-href]").forEach(function (row) {
    row.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest("a, button")) return;
      var href = row.getAttribute("data-href");
      if (href) window.location.href = href;
    });
  });

  var full = document.getElementById("ml-photo-full");
  var fullImg = full ? full.querySelector("img") : null;

  function hideThumbPop() {
    var pop = document.getElementById("photo-att-pop");
    if (pop) {
      pop.classList.remove("is-visible");
      pop.setAttribute("aria-hidden", "true");
    }
    document.querySelectorAll("#main-log-table .photo-att-icon.is-pop-open").forEach(function (btn) {
      btn.classList.remove("is-pop-open");
    });
  }

  function closeFullPhoto() {
    if (!full || !full.classList.contains("is-show")) return false;
    full.classList.remove("is-show");
    full.hidden = true;
    if (fullImg) {
      fullImg.removeAttribute("src");
      fullImg.alt = "";
    }
    return true;
  }

  function readPhotos(btn) {
    var raw = btn.getAttribute("data-photos") || "";
    try {
      var parsed = JSON.parse(decodeURIComponent(raw));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function openFull(photo) {
    if (!full || !fullImg || !photo || !photo.url) return;
    hideThumbPop();
    fullImg.src = photo.url;
    fullImg.alt = photo.caption || "Photo";
    full.hidden = false;
    full.classList.add("is-show");
  }

  document.addEventListener("mouseover", function (event) {
    var btn = event.target.closest && event.target.closest(".photo-att-icon");
    if (!btn) return;
    function mark() {
      var pop = document.getElementById("photo-att-pop");
      if (!pop) return;
      if (btn.closest("#main-log-table")) pop.classList.add("ml-photo-source");
      else pop.classList.remove("ml-photo-source");
    }
    mark();
    window.requestAnimationFrame(mark);
  });

  document.addEventListener("click", function (event) {
    var icon = event.target.closest && event.target.closest("#main-log-table .photo-att-icon");
    if (icon) {
      event.preventDefault();
      event.stopPropagation();
      var photos = readPhotos(icon);
      if (photos.length) openFull(photos[0]);
      return;
    }
    var fromMainLog = document.querySelector("#main-log-table .photo-att-icon.is-pop-open");
    var thumbImg = event.target.closest && event.target.closest("#photo-att-pop img");
    if (thumbImg && fromMainLog) {
      event.preventDefault();
      event.stopPropagation();
      openFull({ url: thumbImg.getAttribute("src"), caption: thumbImg.getAttribute("alt") });
      return;
    }
    if (event.target === full) closeFullPhoto();
  });

  if (fullImg) fullImg.addEventListener("mouseleave", closeFullPhoto);

  var closeLink = document.getElementById("ml-close");
  function closePanel() {
    if (closeLink) window.location.href = closeLink.href;
  }
  var scrim = document.getElementById("ml-scrim");
  if (scrim) scrim.addEventListener("click", closePanel);
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape") return;
    if (closeFullPhoto()) return;
    closePanel();
  });
})();
