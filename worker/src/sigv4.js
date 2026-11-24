// Presigned URLs for Cloudflare R2 (S3-compatible API), AWS Signature V4, query-string form.
// The browser uploads/downloads directly to R2, so big videos never pass through the Worker.

const enc = new TextEncoder();

export function presignR2(env, method, key, expiresSec = 3600) {
  return presign({
    method, expiresSec,
    host: `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    path: `/${env.R2_BUCKET}/${key.split("/").map(uriEncode).join("/")}`,
    region: "auto",
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secret: env.R2_SECRET_ACCESS_KEY,
  });
}

export async function presign({ method, host, path, region, accessKeyId, secret, expiresSec, now = new Date() }) {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;

  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "host",
  };
  const query = Object.keys(q).sort().map((k) => `${uriEncode(k)}=${uriEncode(q[k])}`).join("&");

  const canonical = [method, path, query, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await hex(await sha(canonical))].join("\n");

  let k = await hmac(enc.encode(`AWS4${secret}`), day);
  k = await hmac(k, region);
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const sig = await hex(await hmac(k, toSign));

  return `https://${host}${path}?${query}&X-Amz-Signature=${sig}`;
}

function uriEncode(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
async function sha(s) { return crypto.subtle.digest("SHA-256", enc.encode(s)); }
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(msg)));
}
async function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
