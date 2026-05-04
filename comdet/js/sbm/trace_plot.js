/* Shared trace plotter for the SBM equilibration plots.
 *
 * One trace (Σ + B dual-axis) on per-variant pages, two or three traces
 * (per-variant Σ overlay) on the *-best comparison pages.
 *
 * COMDET.SBM.tracePlot({
 *   hostId,
 *   traces: [{ series, key, label, color, primary?, axis: "left" | "right", step? }],
 *   xMax,
 * });
 *
 * Each trace's series is an array of { sweep, [key]: number, ... } rows.
 * Axes auto-scale to the union of all "left"-axis traces and the union
 * of all "right"-axis traces. Primary traces draw thicker.
 */
(function () {
  "use strict";
  if (!window.COMDET) window.COMDET = {};
  if (!window.COMDET.SBM) window.COMDET.SBM = {};

  function tracePlot(opts) {
    const host = document.getElementById(opts.hostId);
    if (!host || typeof d3 === "undefined") return;
    host.innerHTML = "";
    const traces = opts.traces || [];
    const W = opts.width || 720, H = opts.height || 240;
    const ML = 60, MR = 60, MT = 14, MB = 30;
    const xMax = opts.xMax;

    const svg = d3.select(host).append("svg")
      .attr("viewBox", "0 0 " + W + " " + H)
      .attr("preserveAspectRatio", "xMidYMid meet")
      .style("width", "100%").style("height", "auto").style("display", "block");

    function rangeOnAxis(side) {
      let min = Infinity, max = -Infinity, count = 0;
      for (let i = 0; i < traces.length; i++) {
        const t = traces[i];
        if ((t.axis || "left") !== side) continue;
        for (let j = 0; j < t.series.length; j++) {
          const v = +t.series[j][t.key];
          if (v < min) min = v;
          if (v > max) max = v;
          count += 1;
        }
      }
      return count ? { min: min, max: max, count: count } : { min: 0, max: 1, count: 0 };
    }
    const left = rangeOnAxis("left");
    const right = rangeOnAxis("right");
    const leftMin = left.min, leftMax = left.max;
    const rightMin = right.min, rightMax = right.max;
    const leftVals = { length: left.count };
    const rightVals = { length: right.count };
    const xScale = function (x) { return ML + x / xMax * (W - ML - MR); };
    const yLeft  = function (v) { return H - MB - (v - leftMin)  / (leftMax  - leftMin  || 1) * (H - MT - MB); };
    const yRight = function (v) { return H - MB - (v - rightMin) / (rightMax - rightMin || 1) * (H - MT - MB); };

    const ax = svg.append("g").attr("class", "axes");
    ax.append("line").attr("x1", ML).attr("y1", H - MB).attr("x2", W - MR).attr("y2", H - MB)
      .attr("stroke", "#1b2033");
    ax.append("line").attr("x1", ML).attr("y1", MT).attr("x2", ML).attr("y2", H - MB)
      .attr("stroke", "#1b2033");
    if (rightVals.length) {
      ax.append("line").attr("x1", W - MR).attr("y1", MT).attr("x2", W - MR).attr("y2", H - MB)
        .attr("stroke", "#1b2033").attr("stroke-dasharray", "2 3");
    }
    for (let i = 0; i <= xMax; i += Math.max(1, Math.round(xMax / 4))) {
      ax.append("text").attr("x", xScale(i)).attr("y", H - MB + 14)
        .attr("text-anchor", "middle").attr("font-size", 10)
        .attr("font-family", "Special Elite, monospace").attr("fill", "#1b2033").text(i);
    }
    if (leftVals.length) {
      const c = traces.find(function (t) { return (t.axis || "left") === "left"; });
      const col = c ? c.color : "#1b2033";
      ax.append("text").attr("x", ML - 6).attr("y", yLeft(leftMin))
        .attr("text-anchor", "end").attr("font-size", 10)
        .attr("font-family", "Special Elite, monospace").attr("fill", col).text(leftMin.toFixed(0));
      ax.append("text").attr("x", ML - 6).attr("y", yLeft(leftMax) + 8)
        .attr("text-anchor", "end").attr("font-size", 10)
        .attr("font-family", "Special Elite, monospace").attr("fill", col).text(leftMax.toFixed(0));
    }
    if (rightVals.length) {
      const c = traces.find(function (t) { return t.axis === "right"; });
      const col = c ? c.color : "#1b2033";
      ax.append("text").attr("x", W - MR + 6).attr("y", yRight(rightMin))
        .attr("text-anchor", "start").attr("font-size", 10)
        .attr("font-family", "Special Elite, monospace").attr("fill", col).text(String(rightMin));
      ax.append("text").attr("x", W - MR + 6).attr("y", yRight(rightMax) + 8)
        .attr("text-anchor", "start").attr("font-size", 10)
        .attr("font-family", "Special Elite, monospace").attr("fill", col).text(String(rightMax));
    }

    traces.forEach(function (t) {
      const y = (t.axis === "right") ? yRight : yLeft;
      const lineGen = d3.line()
        .x(function (d) { return xScale(d.sweep); })
        .y(function (d) { return y(+d[t.key]); });
      if (t.step) lineGen.curve(d3.curveStepAfter);
      svg.append("path").datum(t.series).attr("d", lineGen)
        .attr("fill", "none").attr("stroke", t.color)
        .attr("stroke-width", t.primary ? 2.4 : 1.6)
        .attr("opacity", t.primary === false ? 0.7 : 1.0)
        .attr("stroke-dasharray", t.step ? "3 3" : "0");
      // End-point label for multi-trace overlays.
      if (t.label && traces.length > 1 && (t.axis || "left") === "left") {
        const last = t.series[t.series.length - 1];
        svg.append("text")
          .attr("x", W - MR + 6).attr("y", y(+last[t.key]))
          .attr("text-anchor", "start").attr("font-size", 11)
          .attr("font-family", "Special Elite, monospace")
          .attr("fill", t.color).text(t.label);
      }
    });

    // Endpoint markers on the primary left trace.
    const primary = traces.find(function (t) { return t.primary && (t.axis || "left") === "left"; });
    if (primary && primary.series.length) {
      const first = primary.series[0], last = primary.series[primary.series.length - 1];
      svg.append("circle").attr("cx", xScale(+first.sweep)).attr("cy", yLeft(+first[primary.key]))
        .attr("r", 3.5).attr("fill", primary.color);
      svg.append("circle").attr("cx", xScale(+last.sweep)).attr("cy", yLeft(+last[primary.key]))
        .attr("r", 3.5).attr("fill", primary.color);
    }
  }

  COMDET.SBM.tracePlot = tracePlot;
})();
