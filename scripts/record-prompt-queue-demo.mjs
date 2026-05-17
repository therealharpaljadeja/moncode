import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const ARTIFACT_DIR = "/opt/cursor/artifacts/prompt-queue-demo";

function sse(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function mockApis(page) {
  let chatTurn = 0;

  await page.route("**/api/sandbox", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        sandboxUrl: "https://example.com",
        title: "Prompt queue demo",
      }),
    });
  });

  await page.route("**/api/sandbox/stream", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body: sse("status", {
        status: "ready",
        sandboxUrl: "https://example.com",
      }),
    });
  });

  await page.route("**/api/transcript", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });

  await page.route("**/api/files**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ tree: [] }),
    });
  });

  await page.route("**/api/chat", async (route) => {
    chatTurn += 1;
    const turn = chatTurn;
    const { message } = route.request().postDataJSON();
    const delayMs = turn === 1 ? 7000 : 3500;

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    const body =
      sse("sdk_message", {
        message: {
          type: "assistant",
          uuid: `demo-assistant-${turn}`,
          message: {
            content: [
              {
                type: "text",
                text: `Done with turn ${turn}: “${message}”`,
              },
            ],
          },
        },
      }) + sse("done", {});

    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
      body,
    });
  });
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: {
      dir: ARTIFACT_DIR,
      size: { width: 1280, height: 800 },
    },
  });

  const page = await context.newPage();
  await mockApis(page);

  await page.goto(BASE_URL, { waitUntil: "networkidle" });

  const textarea = page.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout: 30000 });

  const readyDeadline = Date.now() + 45000;
  while (Date.now() < readyDeadline) {
    const placeholder = (await textarea.getAttribute("placeholder")) ?? "";
    if (/Build a Monad|Queue another prompt/.test(placeholder)) break;
    await page.waitForTimeout(250);
  }
  const placeholder = (await textarea.getAttribute("placeholder")) ?? "";
  if (!/Build a Monad|Queue another prompt/.test(placeholder)) {
    throw new Error(`Chat not ready. Placeholder: ${placeholder}`);
  }

  async function waitForPlaceholder(pattern, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = (await textarea.getAttribute("placeholder")) ?? "";
      if (pattern.test(value)) return;
      await page.waitForTimeout(200);
    }
    throw new Error(`Timed out waiting for placeholder /${pattern}/`);
  }

  // Turn 1 — agent stays busy ~7s
  await textarea.fill("Build a token swap UI");
  await page.keyboard.press("Enter");
  await waitForPlaceholder(/Queue another prompt/, 10000);

  // Queue two follow-ups while busy
  await textarea.fill("Add dark mode toggle");
  await page.keyboard.press("Enter");
  await page.getByText("Queued prompts").waitFor({ timeout: 5000 });

  await textarea.fill("Add wallet connect button");
  await page.keyboard.press("Enter");
  await page.locator('[class*="font-normal"]').filter({ hasText: "2" }).waitFor({
    timeout: 5000,
  });

  // Remove one queued item
  const removeButtons = page.getByRole("button", { name: /Remove queued prompt/ });
  await removeButtons.last().click();
  await page.waitForTimeout(800);

  // Wait for first turn + auto-drained second
  await page.getByText("Done with turn 1").waitFor({ timeout: 20000 });
  await page.getByText("Done with turn 2").waitFor({ timeout: 20000 });

  await page.waitForTimeout(1500);

  await context.close();
  await browser.close();

  console.log(`Video saved under ${ARTIFACT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
