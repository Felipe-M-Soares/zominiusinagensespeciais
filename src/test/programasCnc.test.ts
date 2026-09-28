import { describe, it, expect } from "vitest";
import { decodificarPrograma, detectarLinguagem, detectarMaquina, nomeSemExtensao } from "@/lib/programasCnc";

const enc = (s: string) => new TextEncoder().encode(s);

describe("importação de programas CNC", () => {
  it("lê UTF-8 e normaliza quebras de linha do Windows", () => {
    const r = decodificarPrograma(enc("%\r\nO1001 (BUCHA)\r\nG21 G90\r\nM30\r\n%"));
    expect(r.ok && r.conteudo).toBe("%\nO1001 (BUCHA)\nG21 G90\nM30\n%");
  });
  it("aceita Windows-1252 (comentário com acento)", () => {
    const bytes = new Uint8Array([...enc("(USINAGEM "), 0xc7, 0xc3, 0x4f, ...enc(")\nM30\n")]); // ÇÃO
    const r = decodificarPrograma(bytes);
    expect(r.ok && r.conteudo.startsWith("(USINAGEM ÇÃO)")).toBe(true);
  });
  it("recusa arquivo binário e vazio", () => {
    expect(decodificarPrograma(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01])).ok).toBe(false);
    expect(decodificarPrograma(new Uint8Array()).ok).toBe(false);
  });
  it("remove Ctrl-Z final", () => {
    const r = decodificarPrograma(new Uint8Array([...enc("G0 X0\nM30\n"), 26]));
    expect(r.ok && r.conteudo).toBe("G0 X0\nM30\n");
  });
  it("detecta linguagem e máquina pelo arquivo", () => {
    expect(detectarLinguagem("peca.mpf", "")).toBe("Siemens");
    expect(detectarLinguagem("peca.h", "")).toBe("Heidenhain");
    expect(detectarLinguagem("peca.nc", "%\nO1234\nG0")).toBe("Fanuc");
    expect(detectarLinguagem("peca.nc", "G0 X0 Y0")).toBe("G-Code");
    expect(detectarMaquina("MQ012_bucha.nc", ["MQ01", "MQ012"])).toBe("MQ012");
    expect(detectarMaquina("bucha.nc", ["MQ001"])).toBeNull();
    expect(nomeSemExtensao("OP10 bucha.tap")).toBe("OP10 bucha");
  });
});
