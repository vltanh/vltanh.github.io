// Auto-collapse long code blocks with a fade + "Show more" button.
// Targets Kramdown's server-rendered wrapper `div.highlighter-rouge` so it
// does not depend on copy_code.js having run first.
(function () {
  var COLLAPSE_PX = 180; // Preview height in px before collapsing kicks in.

  function initOne(block) {
    if (block.dataset.collapseInit === "1") return;

    var pre = block.querySelector("pre");
    if (!pre) return;

    var natural = pre.scrollHeight;
    if (!natural) return; // Not yet laid out — try again on next scan.

    block.dataset.collapseInit = "1";
    if (natural <= COLLAPSE_PX + 20) return;

    block.classList.add("code-collapsible");
    block.style.setProperty("--code-collapsed-height", COLLAPSE_PX + "px");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-collapse-toggle";
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<span class="code-collapse-label">Show more</span>' + '<span class="code-collapse-caret" aria-hidden="true">▾</span>';

    btn.addEventListener("click", function () {
      var expanded = block.classList.toggle("expanded");
      btn.setAttribute("aria-expanded", expanded ? "true" : "false");
      btn.querySelector(".code-collapse-label").textContent = expanded ? "Show less" : "Show more";
      btn.querySelector(".code-collapse-caret").textContent = expanded ? "▴" : "▾";
    });

    block.appendChild(btn);
  }

  function scan() {
    document.querySelectorAll("div.highlighter-rouge").forEach(initOne);
  }

  function start() {
    scan();
    // Catch late wrappers (distill template finishing, MathJax, dynamic content)
    var tries = 0;
    var interval = setInterval(function () {
      scan();
      if (++tries >= 20) clearInterval(interval);
    }, 250);

    if (window.MutationObserver) {
      var observer = new MutationObserver(function () {
        scan();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () {
        observer.disconnect();
      }, 15000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
