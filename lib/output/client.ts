/**
 * Client-side behaviour for the generated report, injected inline by
 * renderHtml(). No dependencies, no network calls beyond overflow fragments.
 *
 * Responsibilities: theme + density persistence, ARIA-correct tab switching,
 * hash deep links, progressive list loading, back-to-top.
 */

export const CLIENT_SCRIPT = String.raw`<script>
(function () {
  "use strict";
  var root = document.documentElement;
  var suppressHash = false;

  function setPressed(nodes, attr, value) {
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute("aria-pressed", nodes[i].getAttribute(attr) === value ? "true" : "false");
    }
  }

  var themeButtons = document.querySelectorAll("[data-theme-set]");
  var densityButtons = document.querySelectorAll("[data-density-set]");
  setPressed(themeButtons, "data-theme-set", root.getAttribute("data-theme"));
  setPressed(densityButtons, "data-density-set", root.getAttribute("data-density"));

  function remember(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  for (var ti = 0; ti < themeButtons.length; ti++) {
    themeButtons[ti].addEventListener("click", function () {
      var t = this.getAttribute("data-theme-set");
      root.setAttribute("data-theme", t);
      setPressed(themeButtons, "data-theme-set", t);
      remember("db-report-theme", t);
    });
  }
  for (var di = 0; di < densityButtons.length; di++) {
    densityButtons[di].addEventListener("click", function () {
      var d = this.getAttribute("data-density-set");
      root.setAttribute("data-density", d);
      setPressed(densityButtons, "data-density-set", d);
      remember("db-report-density", d);
    });
  }

  function pushHash(btn) {
    if (suppressHash) return;
    var h = btn.getAttribute("data-hash");
    if (h && history.replaceState) history.replaceState(null, "", h);
  }

  function activate(buttons, contents, btn, contentAttr, contentValue) {
    for (var i = 0; i < buttons.length; i++) {
      var on = buttons[i] === btn;
      buttons[i].classList.toggle("active", on);
      buttons[i].setAttribute("aria-selected", on ? "true" : "false");
    }
    for (var j = 0; j < contents.length; j++) {
      contents[j].classList.toggle("active", contents[j].getAttribute(contentAttr) === contentValue);
    }
    pushHash(btn);
  }

  var tabs = document.querySelectorAll(".tabs > .tab");
  for (var a = 0; a < tabs.length; a++) {
    tabs[a].addEventListener("click", function () {
      var target = this.getAttribute("data-tab");
      var contents = document.querySelectorAll(".panel");
      var chosen = null;
      for (var k = 0; k < contents.length; k++) {
        if (contents[k].getAttribute("data-panel") === target) chosen = contents[k];
      }
      activate(tabs, contents, this, "data-panel", target);
      if (chosen) chosen.setAttribute("aria-labelledby", this.id || "");
    });
  }

  document.querySelectorAll(".sub-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var panel = this.closest(".panel");
      if (!panel) return;
      var sub = this.getAttribute("data-sub");
      activate(
        panel.querySelectorAll(".sub-tab"),
        panel.querySelectorAll(".sub-content"),
        this, "data-sub-content", sub
      );
    });
  });

  document.querySelectorAll(".source-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var subContent = this.closest(".sub-content");
      if (!subContent) return;
      var src = this.getAttribute("data-source");
      activate(
        subContent.querySelectorAll(".source-tab"),
        subContent.querySelectorAll(".source-content"),
        this, "data-source-content", src
      );
    });
  });

  document.querySelectorAll(".trading-group-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var grp = this.getAttribute("data-group");
      activate(
        document.querySelectorAll(".trading-group-tab"),
        document.querySelectorAll(".trading-group-content"),
        this, "data-group", grp
      );
    });
  });

  function clickByData(selector, attr, value, scope) {
    var nodes = (scope || document).querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute(attr) === value) { nodes[i].click(); return nodes[i]; }
    }
    return null;
  }

  function applyHash() {
    var hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    try { hash = decodeURIComponent(hash); } catch (e) {}
    var parts = hash.split("/");
    suppressHash = true;
    var panelBtn = clickByData(".tab", "data-tab", parts[0]);
    var panel = null;
    var all = document.querySelectorAll(".panel");
    for (var i = 0; i < all.length; i++) {
      if (all[i].getAttribute("data-panel") === parts[0]) panel = all[i];
    }
    if (panel && parts[1]) {
      clickByData(".sub-tab", "data-sub", parts[1], panel);
      var subs = panel.querySelectorAll(".sub-content");
      var activeSub = null;
      for (var j = 0; j < subs.length; j++) {
        if (subs[j].classList.contains("active")) activeSub = subs[j];
      }
      if (activeSub && parts[2] === "group") {
        clickByData(".trading-group-tab", "data-group", parts[3]);
      } else if (activeSub && parts[2]) {
        clickByData(".source-tab", "data-source", parts[2], activeSub);
      }
    }
    suppressHash = false;
    return panel;
  }

  applyHash();

  window.addEventListener("hashchange", applyHash);

  var topBtn = document.querySelector(".back-to-top");
  if (topBtn) {
    topBtn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  (function () {
    var slots = Array.prototype.slice.call(document.querySelectorAll(".more-slot"));
    if (!slots.length || !window.IntersectionObserver || !window.fetch) return;
    function setHint(slot, left) {
      slot.textContent = left > 0 ? slot.getAttribute("data-hint").replace("{n}", String(left)) : "";
    }
    function showNextPage(slot) {
      var page = slot.pages.shift();
      if (!page) { slot.remove(); return; }
      page.hidden = false;
      if (slot.pages.length === 0) { slot.remove(); return; }
      setHint(slot, slot.pages.length);
    }
    function load(slot) {
      if (slot.loading) return;
      if (slot.pages) { showNextPage(slot); return; }
      slot.loading = true;
      slot.textContent = slot.getAttribute("data-loading");
      fetch(slot.getAttribute("data-src"))
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.text();
        })
        .then(function (html) {
          var holder = document.createElement("div");
          holder.innerHTML = html;
          slot.parentNode.insertBefore(holder, slot);
          slot.pages = Array.prototype.slice.call(holder.querySelectorAll(".more-page"));
          slot.loading = false;
          if (!slot.pages.length) { slot.remove(); return; }
          showNextPage(slot);
        })
        .catch(function () {
          slot.loading = false;
          slot.textContent = slot.getAttribute("data-error");
        });
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) load(entry.target);
        });
      },
      { rootMargin: "600px 0px" }
    );
    slots.forEach(function (slot) {
      slot.addEventListener("click", function () { load(slot); });
      observer.observe(slot);
    });
  })();
})();
</script>`;
