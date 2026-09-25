(function () {
  "use strict";
  var box = document.getElementById("photoLightbox");
  if (!box) return;
  var titleEl = document.getElementById("lightboxTitle");
  var subEl = document.getElementById("lightboxSub");
  var img = document.getElementById("lightboxImg");

  function openPhoto(src, title, sub) {
    if (titleEl) titleEl.textContent = title || "Photo";
    if (subEl) subEl.textContent = sub || "";
    if (img) {
      img.src = src || "";
      img.alt = title || "Photo";
    }
    box.hidden = false;
    box.classList.add("open");
  }

  function closePhoto() {
    box.hidden = true;
    box.classList.remove("open");
    if (img) img.removeAttribute("src");
  }

  document.querySelectorAll("[data-photo-open]").forEach(function (el) {
    el.addEventListener("click", function () {
      openPhoto(el.getAttribute("data-src"), el.getAttribute("data-title"), el.getAttribute("data-sub"));
    });
  });

  var closeBtn = document.getElementById("btnCloseLightbox");
  var okBtn = document.getElementById("btnLightboxOk");
  if (closeBtn) closeBtn.addEventListener("click", closePhoto);
  if (okBtn) okBtn.addEventListener("click", closePhoto);
  box.addEventListener("click", function (e) {
    if (e.target === box) closePhoto();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !box.hidden) closePhoto();
  });
})();
