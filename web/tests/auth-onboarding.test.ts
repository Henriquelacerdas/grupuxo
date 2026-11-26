import { describe, expect, it } from "vitest";
import { authErrorMessage, nameFromEmail, normalizeEmail, parseLinks, safeNext, withNext } from "@/features/auth/logic";
import { inviteCodeFromPath, inviteLink } from "@/features/onboarding/pending-invite";
import { STARTER_ROOMS, starterTasks } from "@/features/onboarding/starter-rooms";

const t = (key: string, ...args: (string | number)[]) => key.replace(/\{(\d+)\}/g, (_, i: string) => String(args[Number(i)]));

describe("safeNext", () => {
  it("aceita caminhos da própria origem", () => {
    expect(safeNext("/app/tasks?x=1")).toBe("/app/tasks?x=1");
    expect(safeNext("/invite/ABC123")).toBe("/invite/ABC123");
  });
  it("recusa redirecionamento aberto", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "javascript:alert(1)", "", "/a\nb", "/a\\b", null, undefined]) {
      expect(safeNext(bad)).toBe("/app");
    }
    expect(safeNext("/" + "a".repeat(600))).toBe("/app");
  });
  it("só repassa next quando não é o padrão", () => {
    expect(withNext("/signup", "/app")).toBe("/signup");
    expect(withNext("/signup", "/invite/ABC123")).toBe("/signup?next=%2Finvite%2FABC123");
  });
});

describe("conta", () => {
  it("normaliza e-mail e sugere nome", () => {
    expect(normalizeEmail("  Ana.Souza@Example.COM ")).toBe("ana.souza@example.com");
    expect(nameFromEmail("Ana.Souza@example.com")).toBe("ana.souza");
    expect(nameFromEmail("x7f2@privaterelay.appleid.com")).toBe("");
  });
  it("mensagens por passo", () => {
    expect(authErrorMessage(t, "invalid_credentials", "signIn")).toBe("E-mail ou senha incorretos. Tente de novo ou toque em Esqueci a senha.");
    expect(authErrorMessage(t, "user_not_found", "forgot")).toBe("Não encontramos uma conta com este e-mail.");
    expect(authErrorMessage(t, "invalid_password", "signUp")).toBe("Senha fraca. Pelo menos 6 caracteres, com uma letra minúscula.");
    expect(authErrorMessage(t, "invalid_parameter", "resend")).toBe("Esta conta já está confirmada. Volte e entre com sua senha.");
    expect(authErrorMessage(t, "whatever", "signIn")).toBe("Não foi possível concluir agora. Tente de novo em instantes.");
  });
  it("links legais só https, sem HTML", () => {
    expect(parseLinks("Veja os [Termos](https://a.example/t) e [x](javascript:alert(1)).")).toEqual([
      { text: "Veja os " }, { text: "Termos", href: "https://a.example/t" }, { text: " e [x](javascript:alert(1))." },
    ]);
  });
});

describe("convite e primeiros cômodos", () => {
  it("código do link", () => {
    expect(inviteCodeFromPath("abc123")).toBe("ABC123");
    expect(inviteCodeFromPath("ABC12")).toBeNull();
    expect(inviteCodeFromPath("ABC1234")).toBeNull();
    expect(inviteCodeFromPath("AB%2F123")).toBeNull();
    expect(inviteCodeFromPath("%E0%A4%A")).toBeNull();
    expect(inviteLink("https://reveza.app", "ABC123")).toBe("https://reveza.app/invite/ABC123");
  });
  it("seis cômodos com duas tarefas sugeridas cada", () => {
    expect(STARTER_ROOMS.map((r) => r.id)).toEqual(["kitchen", "bathroom", "livingRoom", "bedroom", "laundry", "outdoor"]);
    for (const room of STARTER_ROOMS) expect(starterTasks(room.id)).toHaveLength(2);
    expect(starterTasks("kitchen").map((s) => s.name)).toEqual(["Limpar o chão", "Limpar a pia"]);
  });
});
