export async function verifyLineSignature(
  body: ArrayBuffer,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!isValidBase64Signature(signature)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expectedSignature = await crypto.subtle.sign("HMAC", key, body);
  const actualBytes = base64ToBytes(signature);
  if (actualBytes === null) {
    return false;
  }
  const expectedBytes = new Uint8Array(expectedSignature);

  return constantTimeEqual(actualBytes, expectedBytes);
}

function isValidBase64Signature(signature: string): boolean {
  return /^[A-Za-z0-9+/]+={0,2}$/.test(signature) && signature.length > 0;
}

function base64ToBytes(value: string): Uint8Array | null {
  let binary: string;

  try {
    binary = atob(value);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function constantTimeEqual(actual: Uint8Array, expected: Uint8Array): boolean {
  let difference = actual.length ^ expected.length;
  const maxLength = Math.max(actual.length, expected.length);

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (actual[index] ?? 0) ^ (expected[index] ?? 0);
  }

  return difference === 0;
}
