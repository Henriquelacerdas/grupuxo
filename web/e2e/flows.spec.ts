import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CODE, PASSWORD, email, skipWelcome } from "./support";

// Fluxo principal: cadastro → criar casa → convite por link → segundo morador entra → tarefas, avisos e saída.

async function signUp(page: Page, address: string, name: string) {
  await page.getByLabel("E-mail").fill(address);
  await page.getByLabel("Senha", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Criar conta" }).click();
  await page.getByLabel("Código").fill(CODE);
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Como a casa vai te chamar?" })).toBeVisible();
  await page.getByLabel("Seu nome").fill(name);
  await page.getByRole("button", { name: "Continuar" }).click();
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  await skipWelcome(page);
  return page;
}

test("cadastro, casa, convite, tarefas, avisos e saída", async ({ browser }) => {
  const ana = await newPage(browser);
  await ana.goto("/signup");
  await signUp(ana, email("ana"), "Ana Clara");

  // Criar a casa com um cômodo inicial.
  await ana.getByRole("button", { name: /Criar uma casa/ }).click();
  await ana.getByLabel("Nome da casa").fill("Rep E2E");
  await ana.getByRole("button", { name: "Continuar" }).click();
  await ana.getByText("Cozinha", { exact: true }).click();
  await ana.getByRole("button", { name: "Criar cômodos" }).click();
  const codeGroup = ana.getByRole("group", { name: /Código da casa/ });
  await expect(codeGroup).toBeVisible();
  const code = ((await codeGroup.getAttribute("aria-label")) ?? "").split(":")[1]?.replace(/\s/g, "") ?? "";
  expect(code).toMatch(/^[A-Z0-9]{6}$/);
  await ana.getByRole("button", { name: "Fazer isso depois" }).click();
  await expect(ana.getByRole("heading", { name: "Casa", exact: true })).toBeVisible();
  await expect(ana.getByText("Cozinha").first()).toBeVisible();
  await expectAccessible(ana);

  // Segundo morador entra pelo link do convite.
  const bruno = await newPage(browser);
  await bruno.goto(`/invite/${code}`);
  await bruno.getByRole("link", { name: "Criar conta" }).click();
  await signUp(bruno, email("bruno"), "Bruno Lima");
  // Com o convite guardado, o perfil já entra na casa do código.
  await expect(bruno.getByRole("heading", { name: "Casa", exact: true })).toBeVisible();
  await expect(bruno.getByText("Rep E2E")).toBeVisible();

  // Ana vê o aviso de entrada.
  await ana.goto("/app/notifications");
  await expect(ana.getByText(/Bruno.*entrou na casa/)).toBeVisible();
  await expectAccessible(ana);

  // Minhas tarefas: concluir e reabrir.
  await ana.goto("/app/tasks");
  await expect(ana.getByRole("heading", { name: "Minhas tarefas" })).toBeVisible();
  const done = ana.getByRole("button", { name: /Marcar .* como feita|Concluir/ }).first();
  await done.click();
  await expect(ana.getByText(/1 de \d/).first()).toBeVisible();
  await expectAccessible(ana);

  // Criar uma tarefa pela sheet única.
  await ana.getByRole("button", { name: "Adicionar tarefa" }).click();
  const sheet = ana.getByRole("dialog");
  await sheet.getByLabel("Título da tarefa").fill("Regar as plantas da janela");
  await sheet.getByRole("combobox", { name: "Cômodo" }).selectOption({ label: "Cozinha" });
  await sheet.getByRole("button", { name: "Salvar" }).click();
  await expect(sheet).toBeHidden();
  await expect(ana.getByText("Regar as plantas da janela").first()).toBeVisible();

  // Ajustes abre; modo férias liga e desliga.
  await ana.goto("/app/settings");
  await expect(ana.getByRole("heading", { name: "Ajustes" })).toBeVisible();
  await expectAccessible(ana);

  // Bruno sai da casa e volta ao onboarding.
  await bruno.goto("/app/house/settings");
  await bruno.getByRole("button", { name: "Sair da casa" }).click();
  await bruno.getByRole("alertdialog").getByRole("button", { name: "Sair da casa" }).click();
  await expect(bruno.getByRole("heading", { name: "Você já tem uma casa no Reveza?" })).toBeVisible();
});

test("rotas protegidas e CSRF", async ({ page, request }) => {
  await page.goto("/app/tasks");
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Ftasks/);
  const forged = await request.post("/api/auth/sign-out", { headers: { origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);
  const noHeader = await request.post("/api/v1/me", { data: { name: "x" } });
  expect(noHeader.status()).toBe(403);
});

test("página inicial e login acessíveis @mobile", async ({ page }) => {
  await skipWelcome(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Usar na web" })).toBeVisible();
  await expectAccessible(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expectAccessible(page);
});

test("tema escuro sem violações de contraste", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await skipWelcome(page);
  await page.goto("/login");
  await expectAccessible(page);
});
