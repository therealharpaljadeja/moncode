import { createHmac, timingSafeEqual } from "node:crypto";

/** Nango Environment Settings → Webhooks → Signing key */
export function getNangoWebhookSigningKey(): string | null {
  const key = process.env.NANGO_WEBHOOK_SECRET?.trim();
  return key || null;
}

/**
 * Verify Nango's X-Nango-Hmac-Sha256 header (HMAC-SHA256 of the raw body).
 * @see https://nango.dev/docs/guides/platform/webhooks-from-nango
 */
export function verifyNangoWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingKey: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", signingKey)
    .update(rawBody)
    .digest("hex");

  try {
    const received = Buffer.from(signatureHeader, "utf8");
    const computed = Buffer.from(expected, "utf8");
    if (received.length !== computed.length) return false;
    return timingSafeEqual(received, computed);
  } catch {
    return false;
  }
}
