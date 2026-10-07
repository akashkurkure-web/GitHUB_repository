document.addEventListener("DOMContentLoaded", () => {
  // Mobile sidebar toggle
  const sidebar = document.querySelector(".sidebar");
  document.querySelectorAll("[data-toggle-sidebar]").forEach((btn) =>
    btn.addEventListener("click", () => sidebar && sidebar.classList.toggle("open"))
  );

  // Clickable table rows
  document.querySelectorAll("tr[data-href]").forEach((row) =>
    row.addEventListener("click", (e) => {
      if (!e.target.closest("a, button, form")) window.location = row.dataset.href;
    })
  );

  // Auto-hide flash messages
  document.querySelectorAll(".toast-area .alert").forEach((el) =>
    setTimeout(() => bootstrap.Alert.getOrCreateInstance(el).close(), 6000)
  );

  // Drag & drop file zones
  document.querySelectorAll(".dropzone").forEach((zone) => {
    const input = zone.querySelector("input[type=file]");
    const list = zone.querySelector(".dropzone-list");
    const maxMb = parseFloat(zone.dataset.maxMb || "4");
    const allowed = (input.getAttribute("accept") || "").split(",").filter(Boolean);
    const render = () => {
      list.innerHTML = "";
      Array.from(input.files).forEach((f) => {
        const ext = "." + f.name.split(".").pop().toLowerCase();
        const bad = (allowed.length && !allowed.includes(ext)) || f.size > maxMb * 1024 * 1024;
        const li = document.createElement("li");
        li.innerHTML = `<span><i class="bi bi-file-earmark${bad ? "-x text-danger" : "-check text-success"}"></i> ${f.name}</span><span class="text-muted">${(f.size / 1048576).toFixed(2)} MB</span>`;
        list.appendChild(li);
      });
    };
    zone.addEventListener("click", (e) => { if (e.target.tagName !== "INPUT") input.click(); });
    input.addEventListener("change", render);
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", (e) => { input.files = e.dataTransfer.files; render(); });
  });

  // Show carrier/tracking fields only when shipping
  const statusSelect = document.querySelector("#status-form select[name=status]");
  const shipFields = document.querySelector("#ship-fields");
  if (statusSelect && shipFields) {
    const sync = () => shipFields.classList.toggle("d-none", statusSelect.value !== "shipped");
    statusSelect.addEventListener("change", sync);
    sync();
  }

  // Scroll chat to bottom
  document.querySelectorAll(".chat").forEach((c) => (c.scrollTop = c.scrollHeight));
});

// Quote form: show the medical notice and confirmation only for medical enquiries
document.addEventListener("DOMContentLoaded", () => {
  const segment = document.querySelector("select[name=segment]");
  const note = document.getElementById("medical-note");
  const ack = document.getElementById("medical-ack");
  if (!segment || !note) return;
  const sync = () => {
    const medical = segment.value === "medical";
    note.classList.toggle("d-none", !medical);
    if (ack) ack.classList.toggle("d-none", !medical);
  };
  segment.addEventListener("change", sync);
  sync();
});

// Website: reveal sections on scroll and solidify the navbar after scrolling.
(() => {
  const items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }), { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach((el) => io.observe(el));
  } else {
    items.forEach((el) => el.classList.add("in"));
  }
  const nav = document.querySelector(".site-nav");
  if (nav) {
    const onScroll = () => nav.classList.toggle("scrolled", window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();
