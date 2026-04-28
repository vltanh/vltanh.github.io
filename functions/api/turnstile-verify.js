// Cloudflare Pages Function: POST /api/turnstile-verify
// Verifies a Turnstile token via siteverify and returns the result.
// Pair with the client widget rendered by _includes/turnstile.liquid.
//
// Required env var (set in Cloudflare Pages → Settings → Environment Variables):
//   TURNSTILE_SECRET   — secret key paired with the public site key.
//
// Request:
//   POST /api/turnstile-verify
//   Content-Type: application/x-www-form-urlencoded  OR  application/json
//   Body must include `cf-turnstile-response` (or `token`) from the widget.
//
// Response: 200 { success: true, hostname, action, challenge_ts }
//           403 { success: false, "error-codes": [...] }
//           400 { success: false, "error-codes": ["missing-input-response"] }

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
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
  }).then((r) => r.json()).catch(() => null);

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

export const onRequest = () =>
  json({ success: false, "error-codes": ["bad-request"] }, 405);
