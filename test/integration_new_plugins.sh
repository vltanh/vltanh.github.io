#!/usr/bin/env bash
# Covers al_rtl, al_marimo and al_email_protect: each renders when its gate is
# on, and renders nothing when it is off.
#
# The "off" half is the point. All three are two-layer gated, so a regression
# does not raise an error — the Liquid tag just returns an empty string and the
# feature silently disappears. Only asserting the rendered output catches that.
set -euo pipefail

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

build() {
  local name="$1"
  shift
  local out="${tmp_dir}/site-${name}"
  bundle exec jekyll build "$@" -d "${out}" >/dev/null
  echo "${out}"
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

# --- al_rtl -----------------------------------------------------------------

default_site="$(build default)"

# The upstream starter ships dedicated RTL and Marimo demo posts. Personal
# sites commonly remove those demos, so create equivalent test-only posts in
# an isolated source tree rather than requiring published fixture content.
feature_source="${tmp_dir}/source"
rsync -a \
  --exclude '.git' \
  --exclude '.jekyll-cache' \
  --exclude '_site' \
  --exclude 'node_modules' \
  --exclude 'vendor' \
  ./ "${feature_source}/"
mkdir -p "${feature_source}/_posts"
printf '%s\n' \
  '---' \
  'layout: post' \
  'title: RTL integration fixture' \
  'date: 2026-01-01 00:00:00' \
  'lang: fa' \
  'permalink: /test/rtl/' \
  '---' \
  'RTL integration fixture.' >"${feature_source}/_posts/2026-01-01-rtl-integration-fixture.md"
printf '%s\n' \
  '---' \
  'layout: post' \
  'title: Marimo integration fixture' \
  'date: 2026-01-02 00:00:00' \
  'marimo: true' \
  'permalink: /test/marimo/' \
  '---' \
  'Marimo integration fixture.' >"${feature_source}/_posts/2026-01-02-marimo-integration-fixture.md"
feature_site="$(build features --source "${feature_source}" --config "${feature_source}/_config.yml")"
rtl_page="${feature_site}/test/rtl/index.html"
[ -f "${rtl_page}" ] || fail "RTL integration fixture was not built"

# dir must sit on <html>, not on a wrapper: that is what the browser's bidi
# algorithm and CSS logical properties key off.
grep -q '<html[^>]*dir="rtl"' "${rtl_page}" || fail "RTL post is missing dir=\"rtl\" on <html>"
grep -q '<html[^>]*lang="fa"' "${rtl_page}" || fail "RTL post is missing lang=\"fa\" on <html>"
grep -q 'assets/al_rtl/css/rtl.css' "${rtl_page}" || fail "RTL post does not load the RTL stylesheet"

# The stylesheet must actually exist where the tag points. Publishing it outside
# /assets/ is a 404 that no unit test can see.
[ -f "${default_site}/assets/al_rtl/css/rtl.css" ] || fail "rtl.css is referenced but not published"

# An English page must be untouched.
grep -q 'dir="rtl"' "${default_site}/index.html" && fail "home page wrongly marked RTL"
grep -q 'assets/al_rtl/css/rtl.css' "${default_site}/index.html" && fail "home page wrongly loads the RTL stylesheet"

# --- al_marimo --------------------------------------------------------------

marimo_page="${feature_site}/test/marimo/index.html"
[ -f "${marimo_page}" ] || fail "Marimo integration fixture was not built"

grep -q 'assets/al_marimo/js/marimo-snippets.js' "${marimo_page}" || fail "marimo post does not load the runtime"
[ -f "${feature_site}/assets/al_marimo/js/marimo-snippets.js" ] || fail "marimo runtime is referenced but not published"

# The stylesheet matters on its own: it hides .al-marimo-inline until the runtime
# has moved the code blocks into place. Without it a reader sees the raw source
# before initialization, while the script hook still looks healthy.
grep -q 'assets/al_marimo/css/marimo.css' "${marimo_page}" || fail "marimo post does not load the stylesheet"
[ -f "${feature_site}/assets/al_marimo/css/marimo.css" ] || fail "marimo stylesheet is referenced but not published"

# Vendored, not fetched: no third-party origin may execute script in the page.
grep -q 'cdn.jsdelivr.net/npm/@marimo-team' "${marimo_page}" && fail "marimo runtime is being loaded from a CDN"

# A page that did not opt in must not pay for the plugin.
grep -q 'al_marimo' "${default_site}/index.html" && fail "home page wrongly loads marimo"

# --- al_email_protect -------------------------------------------------------

# Off by default, so this builds with an override rather than changing the
# shipped config: turning it on for the demo site would flip the default for
# everyone who copies this template.
override="${tmp_dir}/protect-email.yml"
printf 'protect_email: true\n' >"${override}"
protected_site="$(build protected --config "_config.yml,${override}")"

# Scope note: this asserts the gating and the runtime, NOT that site-wide
# addresses are obfuscated. `al_folio_core`'s metadata.liquid renders social
# emails itself (`mailto:{{ social[1] | encode_email }}`), so the plugin is not
# consulted for them — a layout has to call {% al_email_protect_link %}. Wiring
# core's socials through the plugin needs a change in that gem; until then,
# asserting "no mailto: anywhere" would be asserting something untrue, and
# asserting "mailto: still present" would codify the gap as correct.
grep -q 'assets/al_email_protect/js/email-protect.js' "${protected_site}/index.html" \
  || fail "email-protect runtime not loaded with protect_email on"
[ -f "${protected_site}/assets/al_email_protect/js/email-protect.js" ] \
  || fail "email-protect runtime referenced but not published"
grep -q 'assets/al_email_protect/css/email-protect.css' "${protected_site}/index.html" \
  || fail "email-protect stylesheet not loaded with protect_email on"
[ -f "${protected_site}/assets/al_email_protect/css/email-protect.css" ] \
  || fail "email-protect stylesheet referenced but not published"

# ...and with it off (the default), the plugin costs nothing.
grep -q 'al_email_protect' "${default_site}/index.html" \
  && fail "email-protect assets loaded while disabled"

echo "new plugin integration checks passed"
