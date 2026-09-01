$(document).ready(function () {
  // Toggle publication details while keeping keyboard and screen-reader state in sync.
  $(".publication-toggle").click(function () {
    var $button = $(this);
    var targetId = $button.attr("data-toggle-target");
    var target = document.getElementById(targetId);
    if (!target) return;

    var shouldOpen = !$(target).hasClass("open");
    $button
      .closest(".links")
      .find(".publication-toggle")
      .each(function () {
        var siblingTarget = document.getElementById($(this).attr("data-toggle-target"));
        if (siblingTarget) {
          $(siblingTarget).removeClass("open").attr({ "aria-hidden": "true", inert: "" });
        }
        $(this).attr("aria-expanded", "false");
      });

    if (shouldOpen) {
      $(target).addClass("open").attr("aria-hidden", "false").removeAttr("inert");
      $button.attr("aria-expanded", "true");
    }
  });
  $("a").removeClass("waves-effect waves-light");

  // bootstrap-toc
  if ($("#toc-sidebar").length) {
    // remove related publications years from the TOC
    $(".publications h2").each(function () {
      $(this).attr("data-toc-skip", "");
    });
    var navSelector = "#toc-sidebar";
    var $myNav = $(navSelector);
    Toc.init($myNav);
    $("body").scrollspy({
      target: navSelector,
      offset: 100,
    });
  }

  // add css to jupyter notebooks
  const cssLink = document.createElement("link");
  cssLink.href = "../css/jupyter.css";
  cssLink.rel = "stylesheet";
  cssLink.type = "text/css";

  let jupyterTheme = determineComputedTheme();

  $(".jupyter-notebook-iframe-container iframe").each(function () {
    $(this).contents().find("head").append(cssLink);

    if (jupyterTheme == "dark") {
      $(this).bind("load", function () {
        $(this).contents().find("body").attr({
          "data-jp-theme-light": "false",
          "data-jp-theme-name": "JupyterLab Dark",
        });
      });
    }
  });

  // trigger popovers
  $('[data-toggle="popover"]').popover({
    trigger: "hover",
  });

  // Profile-pic gallery (about page): cycle through profile.gallery on next-click
  var $profileGallery = $(".profile-gallery");
  if ($profileGallery.length) {
    var gallery = [];
    try {
      gallery = JSON.parse($profileGallery.attr("data-gallery") || "[]");
    } catch (e) {
      gallery = [];
    }
    var $flipper = $profileGallery.find("#profile-pic-toggle");
    var $img = $flipper.find("img").first();
    var $hearts = $profileGallery.find(".profile-gallery-hearts");
    var $cue = $profileGallery.find(".profile-gallery-cue");

    var spawnHearts = function (count) {
      if (!$hearts.length) return;
      var glyphs = ["💖", "💕", "💗", "💘", "❤️", "💞"];
      for (var i = 0; i < count; i++) {
        (function (n) {
          var $h = $('<span class="profile-gallery-heart"></span>').text(glyphs[Math.floor(Math.random() * glyphs.length)]);
          var angle = -Math.PI / 2 + (Math.random() - 0.5) * (Math.PI * 0.9);
          var dist = 80 + Math.random() * 70;
          var dx = Math.cos(angle) * dist;
          var dy = Math.sin(angle) * dist;
          $h.css({
            "--dx": dx.toFixed(1) + "px",
            "--dy": dy.toFixed(1) + "px",
            "--dx-start": (dx * 0.05).toFixed(1) + "px",
            "--dy-start": (dy * 0.05).toFixed(1) + "px",
            "--rot": Math.floor((Math.random() - 0.5) * 60) + "deg",
            "animation-delay": n * 40 + "ms",
            "font-size": 1.3 + Math.random() * 0.9 + "rem",
          });
          $hearts.append($h);
          setTimeout(
            function () {
              $h.remove();
            },
            1400 + n * 40
          );
        })(i);
      }
    };

    var advance = function () {
      if (!gallery.length || $flipper.hasClass("is-flipping")) return;
      var idx = ((parseInt($profileGallery.attr("data-index"), 10) || 0) + 1) % gallery.length;
      var item = gallery[idx];
      var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var swap = function () {
        $img.removeAttr("srcset").removeAttr("data-src");
        $img.closest("picture").find("source").remove();
        $img.attr("src", item.src).attr("alt", item.alt || "");
        $profileGallery.attr("data-index", idx);
        $flipper.attr("aria-label", (item.alt || "Photo") + "; show next photo");
      };

      // Hearts only when landing on the engagement photo. 💖
      var isEngagement = (item.src && /engaged/i.test(item.src)) || (item.alt && /married|engaged/i.test(item.alt));
      if (isEngagement) {
        spawnHearts(9);
      }

      if (reduceMotion) {
        swap();
        return;
      }

      $flipper.addClass("is-flipping");
      setTimeout(swap, 350);
      setTimeout(function () {
        $flipper.removeClass("is-flipping");
      }, 720);
    };

    $flipper.on("click", advance);
    $cue.on("click", advance);
  }
});
