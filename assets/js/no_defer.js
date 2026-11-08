document.addEventListener("DOMContentLoaded", () => {
  const compatBootstrap = Boolean(window.alFolio && window.alFolio.compatBootstrap);
  const computedTheme =
    typeof window.determineComputedTheme === "function" ? window.determineComputedTheme() : document.documentElement.dataset.theme || "light";

  document.querySelectorAll("table").forEach((table) => {
    if (computedTheme === "dark") {
      table.classList.add("table-dark");
    } else {
      table.classList.remove("table-dark");
    }

    const insideExcludedParent =
      table.closest('[class*="news"]') ||
      table.closest('[class*="card"]') ||
      table.closest('[class*="archive"]') ||
      table.closest("pre") ||
      table.closest("code");

    if (!insideExcludedParent) {
      table.classList.add("table", "table-hover");
      // Make only the table scroll sideways. If the table shares its parent with
      // other content (a Markdown table sits directly in <article>), wrap it
      // instead of turning the whole parent into a horizontal scroll box.
      const parent = table.parentElement;
      if (parent && parent.children.length === 1) {
        parent.classList.add("table-responsive");
      } else if (parent && !parent.classList.contains("table-responsive")) {
        const wrapper = document.createElement("div");
        wrapper.className = "table-responsive";
        parent.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }

      if (compatBootstrap) {
        table.setAttribute("data-toggle", "table");
      }
    }
  });
});
