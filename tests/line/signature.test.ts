import { describe, expect, it } from "vitest";
import { verifyLineSignature } from "../../src/line/signature";

async function makeSignature(body: ArrayBuffer, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, body);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

describe("LINE signature verification", () => {
  it("accepts an exact HMAC-SHA256 signature over the raw body bytes", async () => {
    const body = new TextEncoder().encode('{"events":[{"type":"message"}]}').buffer;
    const signature = await makeSignature(body, "channel-secret");

    await expect(verifyLineSignature(body, signature, "channel-secret")).resolves.toBe(true);
  });

  it("rejects an altered body", async () => {
    const originalBody = new TextEncoder().encode('{"events":[]}').buffer;
    const alteredBody = new TextEncoder().encode('{"events":[1]}').buffer;
    const signature = await makeSignature(originalBody, "channel-secret");

    await expect(verifyLineSignature(alteredBody, signature, "channel-secret")).resolves.toBe(
      false,
    );
  });

  it("rejects altered, missing, or malformed signatures", async () => {
    const body = new TextEncoder().encode('{"events":[]}').buffer;
    const signature = await makeSignature(body, "channel-secret");

    await expect(
      verifyLineSignature(body, `${signature.slice(0, -2)}xx`, "channel-secret"),
    ).resolves.toBe(false);
    await expect(verifyLineSignature(body, "", "channel-secret")).resolves.toBe(false);
    await expect(verifyLineSignature(body, "not base64!?", "channel-secret")).resolves.toBe(
      false,
    );
    await expect(verifyLineSignature(body, "A", "channel-secret")).resolves.toBe(false);
  });
});
