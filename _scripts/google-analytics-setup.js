---
permalink: /assets/js/google-analytics-setup.js
---
// Google Analytics 4 (gtag.js) initialization.
(function () {
  var measurementId = "{{ site.google_analytics }}";
  if (!measurementId) return;

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;

  gtag("js", new Date());
  // anonymize_ip is the GA4 default but we set it explicitly. send_page_view
  // fires automatically on initial load.
  gtag("config", measurementId, {
    anonymize_ip: true,
    transport_type: "beacon",
  });

  // SPA-style hash navigation (rare on this site, but cheap to support).
  window.addEventListener("hashchange", function () {
    gtag("event", "page_view", {
      page_location: window.location.href,
      page_path: window.location.pathname + window.location.hash,
      page_title: document.title,
    });
  });

  // Outbound link tracking — useful for an academic site full of external
  // references. Fires a `click` event in GA4 with the destination URL.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href) return;
      try {
        var url = new URL(href, window.location.href);
        if (url.host && url.host !== window.location.host) {
          gtag("event", "click", {
            event_category: "outbound",
            event_label: url.href,
            transport_type: "beacon",
          });
        }
      } catch (_) {
        /* ignore malformed URLs */
      }
    },
    true,
  );
})();
