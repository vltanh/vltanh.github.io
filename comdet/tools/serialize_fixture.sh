#!/bin/bash
#
# Auto-generates the CSV mirror of comdet/js/fixture.js into
# community-detection/examples/cd_fixture/{edge.csv, com.csv}.
# Source-of-truth = the JS fixture; CSV mirror = downstream artifact.
# Run after any edit to fixture.js.

set -eu

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
COMDET_DIR="$( cd "${SCRIPT_DIR}/.." && pwd )"
FIXTURE_JS="${COMDET_DIR}/js/fixture.js"

# Resolve mirror destination via the symlink convention. The symlink
# community-detection/vltanh.github.io -> /path/to/vltanh.github.io means
# the inverse path lives at ../../community-detection from comdet/.
GHIO_ROOT="$( cd "${COMDET_DIR}/.." && pwd )"
# This script ships under vltanh.github.io which is symlinked from CD; resolve
# CD's actual location from a known cwd or env var. Default: assume CD is the
# umbrella's submodule.
CD_DIR="${CD_DIR:-/home/vltanh/Documents/netsci-research/community-detection}"
DEST_DIR="${CD_DIR}/examples/cd_fixture"

mkdir -p "${DEST_DIR}"

node - "${FIXTURE_JS}" "${DEST_DIR}" <<'JS'
const fs = require("fs");
const path = require("path");

const fixturePath = process.argv[2];
const destDir = process.argv[3];

// Load fixture.js by faking a window object.
const src = fs.readFileSync(fixturePath, "utf-8");
const window = {};
const sandbox = { window, console };
// eslint-disable-next-line no-new-func
new Function("window", "console", src)(window, console);

const FIXTURE = window.COMDET.FIXTURE;
if (!FIXTURE) {
  console.error("Failed to load COMDET.FIXTURE from", fixturePath);
  process.exit(1);
}

const edgeCsv = ["source,target"]
  .concat(FIXTURE.edges.map(([s, t]) => `${s},${t}`))
  .join("\n") + "\n";
fs.writeFileSync(path.join(destDir, "edge.csv"), edgeCsv);

// Outliers (gt=-1) are dropped from com.csv per CD convention (com.csv has
// only nodes with valid cluster assignments). drop_singleton_clusters takes
// care of size-1 clusters at run time; here outliers are explicit.
const comRows = ["node_id,cluster_id"];
FIXTURE.nodes.forEach((nodeId, i) => {
  const c = FIXTURE.gt[i];
  if (c >= 0) comRows.push(`${nodeId},${c}`);
});
fs.writeFileSync(path.join(destDir, "com.csv"), comRows.join("\n") + "\n");

console.log(`Wrote ${path.join(destDir, "edge.csv")} (${FIXTURE.edges.length} edges)`);
console.log(`Wrote ${path.join(destDir, "com.csv")} (${comRows.length - 1} assigned nodes; ${FIXTURE.gt.filter(c => c < 0).length} outliers dropped)`);
JS
