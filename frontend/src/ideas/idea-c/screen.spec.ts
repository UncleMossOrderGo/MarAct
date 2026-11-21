import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("agent handoff through checkout and cancellation", async ({ page }) => {
  const buyer = randomUUID();
  const root = new URL("../../../../", import.meta.url);
  execFileSync(
    "uv",
    [
      "run",
      "--locked",
      "python",
      "-X",
      "utf8",
      "-c",
      "from backend.src.modules.idea_c.test_market import browser_lot; import sys; browser_lot(sys.argv[1]); browser_lot(sys.argv[1]+'-unknown', None)",
      buyer,
    ],
    { cwd: root },
  );
  try {
    const arrival = new Date(Date.now() + 4 * 86400000)
      .toISOString()
      .slice(0, 10);
    await page.goto(
      "/ideas/idea-c?" +
        new URLSearchParams({
          q: buyer,
          kg: "20",
          postcode: "10100",
          arrival,
          sort: "cost",
        }),
    );
    const unknown = page
      .locator("article")
      .filter({ hasText: buyer + "-unknown" });
    await expect(
      unknown.getByRole("button", { name: "เพิ่มลงตะกร้า" }),
    ).toBeDisabled();
    const lot = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: buyer, exact: true }) });
    await expect(lot).toContainText("960 บาท");
    await lot.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
    await page.getByRole("button", { name: "ตะกร้า (1)", exact: true }).click();
    await page.getByLabel("ชื่อร้าน").fill(buyer);
    await page.getByLabel("รหัสผ่าน").fill(buyer);
    await page.getByRole("button", { name: "สร้างบัญชีร้าน" }).click();
    await page.getByLabel("ที่อยู่จัดส่ง").fill("Demo cafe");
    await page.getByRole("button", { name: "ตรวจยอดและรอบส่ง" }).click();
    await page.getByRole("button", { name: "ยืนยันคำสั่งซื้อ" }).click();
    await expect(
      page.getByRole("heading", { name: /สวนริมคลอง · รอสวนยืนยัน/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: /สวนริมคลอง · ยกเลิกแล้ว/ }),
    ).toBeVisible();
  } finally {
    execFileSync(
      "uv",
      [
        "run",
        "--locked",
        "python",
        "-c",
        "from backend.src.modules.idea_c.test_market import cleanup; import sys; cleanup(sys.argv[1]); cleanup(sys.argv[1]+'-unknown')",
        buyer,
      ],
      { cwd: root },
    );
  }
});
