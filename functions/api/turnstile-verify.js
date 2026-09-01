// Cloudflare Pages Function: POST /api/turnstile-verify
// Requires env var TURNSTILE_SECRET (Cloudflare Pages → Settings → Variables and Secrets).
// Body: cf-turnstile-response (or token) — json or form-urlencoded.

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });

async function readToken(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    return body["cf-turnstile-response"] || body.token || "";
  }
  const form = await request.formData().catch(() => null);
  if (!form) return "";
  return form.get("cf-turnstile-response") || form.get("token") || "";
}

export const onRequestPost = async ({ request, env }) => {
  if (!env.TURNSTILE_SECRET) {
    return json({ success: false, "error-codes": ["missing-input-secret"] }, 500);
  }

  const token = await readToken(request);
  if (!token) {
    return json({ success: false, "error-codes": ["missing-input-response"] }, 400);
  }

  const remoteip = request.headers.get("CF-Connecting-IP") || "";
  const verify = await fetch(SITEVERIFY, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip }),
  })
    .then((r) => r.json())
    .catch(() => null);

  if (!verify) {
    return json({ success: false, "error-codes": ["internal-error"] }, 502);
  }

  if (!verify.success) {
    return json(verify, 403);
  }

  return json({
    success: true,
    hostname: verify.hostname,
    action: verify.action,
    challenge_ts: verify.challenge_ts,
  });
};

export const onRequest = () => json({ success: false, "error-codes": ["bad-request"] }, 405, { allow: "POST" });
