#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
tmp_override="${tmp_dir}/comments-test-override.yml"
tmp_site="${tmp_dir}/site"

cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

cat >"${tmp_override}" <<'YAML'
giscus:
  repo: alshedivat/al-folio
  repo_id: R_kgDOExample
  category: Comments
  category_id: DIC_kwDOExample
defaults:
  - scope:
      path: ""
      type: posts
    values:
      disqus_comments: true
YAML

bundle exec jekyll build --config "_config.yml,${tmp_override}" -d "${tmp_site}" >/dev/null

giscus_page="$(grep -rl 'id="giscus_thread"' "${tmp_site}/blog" | head -n 1 || true)"
disqus_page="$(grep -rl 'id="disqus_thread"' "${tmp_site}/blog" | head -n 1 || true)"

if [[ -z "${giscus_page}" || -z "${disqus_page}" ]]; then
  echo "expected Giscus and Disqus comment pages in generated output" >&2
  exit 1
fi

grep -q 'id="giscus_thread"' "${giscus_page}"
grep -q 'src="/assets/js/giscus-setup.js"' "${giscus_page}"
if grep -q 'giscus comments misconfigured' "${giscus_page}"; then
  echo "unexpected giscus misconfiguration warning in ${giscus_page}" >&2
  exit 1
fi

grep -q 'id="disqus_thread"' "${disqus_page}"
grep -q '.disqus.com/embed.js' "${disqus_page}"

echo "comments integration checks passed"
