import { describe, it, expect } from "vitest";
import { validatePassword, passwordStrength } from "@/lib/passwordUtils";

// BUG-11: Tests for password validation — used in SetPassword, AdminUsers, admin-create-user
describe("validatePassword", () => {
  it("rejects passwords shorter than 8 characters", () => {
    expect(validatePassword("Ab1!")).not.toBeNull();
    expect(validatePassword("Ab1!567")).not.toBeNull();
  });
  it("accepts a valid strong password", () => {
    expect(validatePassword("Abcde1!x")).toBeNull();
    expect(validatePassword("MyP@ss123")).toBeNull();
  });
  it("rejects passwords exceeding 72 characters", () => {
    expect(validatePassword("A".repeat(73))).not.toBeNull();
  });
});

describe("passwordStrength", () => {
  it("returns low score for weak passwords (only length criterion met)", () => {
    // "aaaaaaaa": length>=8 (1pt) only → score=1
    expect(passwordStrength("aaaaaaaa").score).toBeLessThanOrEqual(2);
  });
  it("returns high score for complex passwords", () => {
    // "MyP@ss123!xyz": length>=12, upper+lower, digit, special → score=5
    expect(passwordStrength("MyP@ss123!xyz").score).toBeGreaterThanOrEqual(4);
  });
});
