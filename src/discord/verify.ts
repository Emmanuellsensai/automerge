// Ed25519 signature verification for Discord interaction webhooks.
// Discord signs each request with a public key set on the application.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function verifyDiscordRequest(
  request: Request,
  rawBody: string,
  publicKeyHex: string,
): Promise<boolean> {
  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(publicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"],
  );

  const encoder = new TextEncoder();
  const message = encoder.encode(timestamp + rawBody);
  const sig = hexToBytes(signature);
  return crypto.subtle.verify("Ed25519", key, sig, message);
}
