/**
 * Tests for OfflineBanner logic — estado e transições
 */
import { describe, it, expect } from "vitest";

// Lógica pura de exibição do banner — extraída para teste sem DOM
function shouldShowBanner(isOnline: boolean, syncing: boolean, pendingCount: number, justCameOnline: boolean): boolean {
  if (isOnline && !syncing && pendingCount === 0 && !justCameOnline) return false;
  return true;
}

function getBannerMessage(isOnline: boolean, syncing: boolean, pendingCount: number): string {
  if (!isOnline && pendingCount > 0) return `Sem conexão — ${pendingCount} operaç${pendingCount === 1 ? "ão" : "ões"} aguardando sincronização`;
  if (!isOnline) return "Sem conexão — operações serão salvas localmente";
  if (syncing) return `Sincronizando ${pendingCount} operaç${pendingCount === 1 ? "ão" : "ões"}...`;
  return "Conexão restaurada";
}

describe("OfflineBanner — display logic", () => {
  it("hides banner when online, not syncing, no pending", () => {
    expect(shouldShowBanner(true, false, 0, false)).toBe(false);
  });

  it("shows banner when offline", () => {
    expect(shouldShowBanner(false, false, 0, false)).toBe(true);
  });

  it("shows banner when syncing", () => {
    expect(shouldShowBanner(true, true, 3, false)).toBe(true);
  });

  it("shows banner briefly when just came online", () => {
    expect(shouldShowBanner(true, false, 0, true)).toBe(true);
  });

  it("shows banner with pending count", () => {
    expect(shouldShowBanner(true, false, 5, false)).toBe(true);
  });
});

describe("OfflineBanner — message logic", () => {
  it("shows offline message with no pending", () => {
    const msg = getBannerMessage(false, false, 0);
    expect(msg).toBe("Sem conexão — operações serão salvas localmente");
  });

  it("shows pending count when offline with pending ops", () => {
    const msg = getBannerMessage(false, false, 3);
    expect(msg).toContain("3 operações aguardando sincronização");
  });

  it("uses singular for 1 pending operation", () => {
    const msg = getBannerMessage(false, false, 1);
    expect(msg).toContain("1 operação aguardando");
  });

  it("shows syncing message when online and syncing", () => {
    const msg = getBannerMessage(true, true, 2);
    expect(msg).toContain("Sincronizando 2");
  });

  it("shows reconnected message", () => {
    const msg = getBannerMessage(true, false, 0);
    expect(msg).toBe("Conexão restaurada");
  });
});
