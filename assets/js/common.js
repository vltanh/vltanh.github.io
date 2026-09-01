document.addEventListener("DOMContentLoaded", () => {
  const toggleSpecs = [
    { trigger: ".publication-toggle.abstract, a.abstract", target: ".abstract.hidden" },
    { trigger: ".publication-toggle.award, a.award", target: ".award.hidden" },
    { trigger: ".publication-toggle.bibtex, a.bibtex", target: ".bibtex.hidden" },
  ];

  const resolveToggleScope = (link) => {
    const linksContainer = link.closest(".links");
    if (linksContainer && linksContainer.parentElement) {
      return linksContainer.parentElement;
    }

    return link.closest("li, .card-body, article, .post, .row") || link.parentElement;
  };

  const setPanelState = (scope, panel, isOpen) => {
    panel.classList.toggle("open", isOpen);
    panel.setAttribute("aria-hidden", String(!isOpen));
    panel.toggleAttribute("inert", !isOpen);

    scope.querySelectorAll(".publication-toggle[data-toggle-target]").forEach((control) => {
      if (control.dataset.toggleTarget === panel.id) {
        control.setAttribute("aria-expanded", String(isOpen));
      }
    });
  };

  const closePanels = (scope, exceptPanel) => {
    scope.querySelectorAll(".abstract.hidden.open, .award.hidden.open, .bibtex.hidden.open").forEach((panel) => {
      if (panel !== exceptPanel) {
        setPanelState(scope, panel, false);
      }
    });
  };

  toggleSpecs.forEach((spec) => {
    document.querySelectorAll(spec.trigger).forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        const scope = resolveToggleScope(link);
        if (!scope) {
          return;
        }

        const panelId = link.dataset.toggleTarget;
        const panel = panelId ? document.getElementById(panelId) : scope.querySelector(spec.target);
        if (panel) {
          closePanels(scope, panel);
          setPanelState(scope, panel, !panel.classList.contains("open"));
        }
      });
    });
  });

  document.querySelectorAll("a.waves-effect, a.waves-light").forEach((anchor) => {
    anchor.classList.remove("waves-effect", "waves-light");
  });

  const tocSidebar = document.querySelector("#toc-sidebar");
  const contentRoot = document.querySelector('[role="main"]') || document.querySelector("main") || document.body;
  const buildSidebarToc = (tocRoot) => {
    const headings = Array.from(contentRoot.querySelectorAll("h2, h3")).filter((heading) => {
      return !heading.hasAttribute("data-toc-skip");
    });

    if (!headings.length) {
      return;
    }

    const list = document.createElement("ul");
    list.className = "toc-list";

    headings.forEach((heading) => {
      if (!heading.id) {
        heading.id = heading.textContent
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }

      const item = document.createElement("li");
      item.className = "toc-list-item";
      const link = document.createElement("a");
      link.className = "toc-link";
      link.href = `#${heading.id}`;
      link.textContent = heading.dataset.tocText || heading.textContent.trim();
      if (heading.tagName.toLowerCase() === "h3") {
        item.classList.add("is-collapsible");
      }

      item.appendChild(link);
      list.appendChild(item);
    });

    tocRoot.replaceChildren(list);
  };

  if (tocSidebar) {
    const resolveTocCollapseDepth = () => {
      const explicitDepth = Number.parseInt(tocSidebar.dataset.tocCollapseDepth || "", 10);
      if (!Number.isNaN(explicitDepth) && explicitDepth >= 0) {
        return explicitDepth;
      }

      const collapseMode = (tocSidebar.dataset.tocCollapse || "expanded").toLowerCase();
      if (["auto", "scroll", "true", "collapsed"].includes(collapseMode)) {
        // Keep top-level entries visible and expand nested branches while scrolling.
        return 3;
      }

      return 6;
    };

    document.querySelectorAll(".publications h2").forEach((heading) => {
      heading.setAttribute("data-toc-skip", "");
    });

    const headings = Array.from(contentRoot.querySelectorAll("h2, h3")).filter((heading) => !heading.hasAttribute("data-toc-skip"));
    headings.forEach((heading) => {
      if (!heading.id) {
        heading.id = heading.textContent
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      }
    });

    const applyCustomTocLabels = () => {
      tocSidebar.querySelectorAll(".toc-link").forEach((link) => {
        const anchor = link.getAttribute("href") || "";
        const headingId = decodeURIComponent(anchor.replace(/^#/, ""));
        if (!headingId) {
          return;
        }
        const heading = document.getElementById(headingId);
        const customText = heading?.dataset?.tocText;
        if (customText) {
          link.textContent = customText;
        }
      });
    };

    if (window.tocbot && typeof window.tocbot.init === "function" && headings.length > 0) {
      if (typeof window.tocbot.destroy === "function") {
        window.tocbot.destroy();
      }

      window.tocbot.init({
        tocSelector: "#toc-sidebar",
        contentSelector: '[role="main"]',
        headingSelector: "h2, h3",
        ignoreSelector: "[data-toc-skip]",
        hasInnerContainers: true,
        collapseDepth: resolveTocCollapseDepth(),
        orderedList: false,
        activeLinkClass: "is-active-link",
        scrollSmooth: true,
        scrollSmoothOffset: -80,
        headingsOffset: 80,
      });
      applyCustomTocLabels();
    } else {
      buildSidebarToc(tocSidebar);
    }
  }

  const prefersTheme = () => {
    if (typeof window.determineComputedTheme === "function") {
      return window.determineComputedTheme();
    }
    return document.documentElement.dataset.theme || "light";
  };

  const jupyterTheme = prefersTheme();
  document.querySelectorAll(".jupyter-notebook-iframe-container iframe").forEach((iframe) => {
    const applyNotebookStyling = () => {
      const iframeDocument = iframe.contentDocument;
      if (!iframeDocument) {
        return;
      }

      if (!iframeDocument.querySelector('link[data-al-folio-jupyter="true"]')) {
        const cssLink = iframeDocument.createElement("link");
        cssLink.href = "../css/jupyter.css";
        cssLink.rel = "stylesheet";
        cssLink.type = "text/css";
        cssLink.setAttribute("data-al-folio-jupyter", "true");
        iframeDocument.head.appendChild(cssLink);
      }

      if (jupyterTheme === "dark") {
        iframeDocument.body?.setAttribute("data-jp-theme-light", "false");
        iframeDocument.body?.setAttribute("data-jp-theme-name", "JupyterLab Dark");
      }
    };

    if (iframe.contentDocument?.readyState === "complete") {
      applyNotebookStyling();
    }
    iframe.addEventListener("load", applyNotebookStyling);
  });

  if (window.AlFolioUi && typeof window.AlFolioUi.initPopovers === "function") {
    window.AlFolioUi.initPopovers(document);
  }

  const profileGallery = document.querySelector(".profile-gallery");
  if (profileGallery) {
    let gallery = [];
    try {
      gallery = JSON.parse(profileGallery.dataset.gallery || "[]");
    } catch {
      gallery = [];
    }

    const flipper = profileGallery.querySelector("#profile-pic-toggle");
    const image = flipper?.querySelector("img");
    const hearts = profileGallery.querySelector(".profile-gallery-hearts");
    const cue = profileGallery.querySelector(".profile-gallery-cue");
    if (!flipper || !image || gallery.length === 0) {
      return;
    }

    const spawnHearts = (count) => {
      if (!hearts) {
        return;
      }

      const glyphs = ["\ud83d\udc96", "\ud83d\udc95", "\ud83d\udc97", "\ud83d\udc98", "\u2764\ufe0f", "\ud83d\udc9e"];
      for (let index = 0; index < count; index += 1) {
        const heart = document.createElement("span");
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9);
        const distance = 80 + Math.random() * 70;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance;
        heart.className = "profile-gallery-heart";
        heart.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
        heart.style.setProperty("--dx", `${dx.toFixed(1)}px`);
        heart.style.setProperty("--dy", `${dy.toFixed(1)}px`);
        heart.style.setProperty("--dx-start", `${(dx * 0.05).toFixed(1)}px`);
        heart.style.setProperty("--dy-start", `${(dy * 0.05).toFixed(1)}px`);
        heart.style.setProperty("--rot", `${Math.floor((Math.random() - 0.5) * 60)}deg`);
        heart.style.animationDelay = `${index * 40}ms`;
        heart.style.fontSize = `${1.3 + Math.random() * 0.9}rem`;
        hearts.appendChild(heart);
        window.setTimeout(() => heart.remove(), 1400 + index * 40);
      }
    };

    const advanceGallery = () => {
      if (flipper.classList.contains("is-flipping")) {
        return;
      }

      const index = (Number.parseInt(profileGallery.dataset.index || "0", 10) + 1) % gallery.length;
      const item = gallery[index];
      const swap = () => {
        image.removeAttribute("srcset");
        image.removeAttribute("data-src");
        image
          .closest("picture")
          ?.querySelectorAll("source")
          .forEach((source) => source.remove());
        image.src = item.src;
        image.alt = item.alt || "";
        profileGallery.dataset.index = index.toString();
        flipper.setAttribute("aria-label", `${item.alt || "Photo"}; show next photo`);
      };

      if (/engaged/i.test(item.src || "") || /married|engaged/i.test(item.alt || "")) {
        spawnHearts(9);
      }

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        swap();
        return;
      }

      flipper.classList.add("is-flipping");
      window.setTimeout(swap, 350);
      window.setTimeout(() => flipper.classList.remove("is-flipping"), 720);
    };

    flipper.addEventListener("click", advanceGallery);
    cue?.addEventListener("click", advanceGallery);
  }
});
