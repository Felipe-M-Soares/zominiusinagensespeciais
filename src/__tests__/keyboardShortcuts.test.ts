/**
 * Tests for keyboard shortcuts logic
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Simula a lógica de dispatch de eventos de teclado
function processKeydown(
  key: string,
  ctrlKey: boolean,
  targetTag: string
): string | null {
  const isCtrl = ctrlKey;
  const isInInput = ["INPUT", "TEXTAREA", "SELECT"].includes(targetTag);

  if (isCtrl && key === "k") return "zomini:focus-search";
  if (isCtrl && key === "/") return "zomini:show-shortcuts";
  if (key === "Escape" && !isInInput) return "zomini:escape";
  return null;
}

describe("useKeyboardShortcuts — key handling logic", () => {
  it("Ctrl+K triggers focus-search event", () => {
    expect(processKeydown("k", true, "BODY")).toBe("zomini:focus-search");
  });

  it("Ctrl+/ triggers show-shortcuts event", () => {
    expect(processKeydown("/", true, "BODY")).toBe("zomini:show-shortcuts");
  });

  it("Escape triggers escape event when not in input", () => {
    expect(processKeydown("Escape", false, "DIV")).toBe("zomini:escape");
  });

  it("Escape does NOT trigger when focus is in INPUT", () => {
    expect(processKeydown("Escape", false, "INPUT")).toBeNull();
  });

  it("Escape does NOT trigger when focus is in TEXTAREA", () => {
    expect(processKeydown("Escape", false, "TEXTAREA")).toBeNull();
  });

  it("regular key without ctrl does nothing", () => {
    expect(processKeydown("a", false, "BODY")).toBeNull();
  });

  it("Ctrl+K works from any non-input element", () => {
    expect(processKeydown("k", true, "BUTTON")).toBe("zomini:focus-search");
    expect(processKeydown("k", true, "DIV")).toBe("zomini:focus-search");
  });
});

describe("Custom event dispatch", () => {
  it("dispatches and receives zomini:focus-search event", () => {
    const handler = vi.fn();
    window.addEventListener("zomini:focus-search", handler);
    window.dispatchEvent(new CustomEvent("zomini:focus-search"));
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("zomini:focus-search", handler);
  });

  it("dispatches and receives zomini:escape event", () => {
    const handler = vi.fn();
    window.addEventListener("zomini:escape", handler);
    window.dispatchEvent(new CustomEvent("zomini:escape"));
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("zomini:escape", handler);
  });

  it("dispatches and receives zomini:show-shortcuts event", () => {
    const handler = vi.fn();
    window.addEventListener("zomini:show-shortcuts", handler);
    window.dispatchEvent(new CustomEvent("zomini:show-shortcuts"));
    expect(handler).toHaveBeenCalledOnce();
    window.removeEventListener("zomini:show-shortcuts", handler);
  });
});
