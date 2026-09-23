// Minimal GitHub App auth for Cloudflare Workers.
// - JWT signed with the app's RSA private key (RS256).
// - Exchanged for a per-installation token from POST /app/installations/{id}/access_tokens.
// Installation tokens live ~1 hour and are cached in memory per request.

import type { Env } from "../index";

function pemToBinary(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function signAppJWT(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 30, exp: now + 9 * 60, iss: env.GITHUB_APP_ID };
  const enc = (obj: unknown) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc(header)}.${enc(payload)}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBinary(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

export async function getInstallationForRepo(
  env: Env,
  owner: string,
  repo: string,
): Promise<number | null> {
  const jwt = await signAppJWT(env);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "automerge-bot",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getInstallationForRepo: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: number };
  return data.id;
}

export async function installationToken(env: Env, installationId: number): Promise<string> {
  const jwt = await signAppJWT(env);
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "automerge-bot",
      },
    },
  );
  if (!res.ok) throw new Error(`installation token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}
