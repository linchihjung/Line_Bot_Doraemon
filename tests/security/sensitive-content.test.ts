import { describe, expect, it } from "vitest";
import { isSensitiveContent } from "../../src/security/sensitive-content";

describe("sensitive content detection", () => {
  it("flags common password phrases", () => {
    expect(isSensitiveContent("my password is hunter2")).toBe(true);
    expect(isSensitiveContent("LINE密碼：abc12345")).toBe(true);
    expect(isSensitiveContent("api_key = sk-test-1234567890")).toBe(true);
  });

  it("flags card-like digit groups", () => {
    expect(isSensitiveContent("card 4111 1111 1111 1111")).toBe(true);
    expect(isSensitiveContent("信用卡 4242-4242-4242-4242")).toBe(true);
  });

  it("flags Taiwan ID-like patterns", () => {
    expect(isSensitiveContent("身分證 A123456789")).toBe(true);
    expect(isSensitiveContent("我的身份證字號是 b223456789")).toBe(true);
  });

  it("allows ordinary numbers and dates", () => {
    expect(isSensitiveContent("Please remind me at 2026-07-10 09:30")).toBe(false);
    expect(isSensitiveContent("Buy 12 eggs and 2 bottles of milk")).toBe(false);
    expect(isSensitiveContent("Order number 123456 for pickup")).toBe(false);
  });
});
