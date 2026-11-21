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
    await page.setViewportSize({ width: 390, height: 844 });
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
    await page
      .getByRole("button", { name: "เงื่อนไขการซื้อ", exact: true })
      .click();
    await page.getByLabel("รหัสไปรษณีย์").fill("50000");
    await expect(
      lot.getByRole("button", { name: "เพิ่มลงตะกร้า" }),
    ).toBeDisabled();
    await expect(lot).toContainText("อยู่นอกพื้นที่จัดส่ง");
    await page
      .getByRole("button", { name: "เงื่อนไขการซื้อ", exact: true })
      .click();
    await lot.getByRole("button", { name: "แก้เงื่อนไขการซื้อ" }).click();
    await expect(page.getByLabel("รหัสไปรษณีย์")).toBeFocused();
    await page.getByLabel("รหัสไปรษณีย์").fill("10100");
    await page.getByLabel("วันที่ต้องการรับ").fill("2020-01-01");
    await expect(lot).toContainText("รอบส่งไม่ตรงกับวันรับ");
    await expect(
      lot.getByRole("button", { name: "เพิ่มลงตะกร้า" }),
    ).toBeDisabled();
    await page.getByLabel("วันที่ต้องการรับ").fill(arrival);
    await lot.getByRole("button", { name: "เพิ่มลงตะกร้า" }).click();
    await page.getByRole("button", { name: "ตะกร้า (1)", exact: true }).click();
    await expect(page.getByText(buyer, { exact: true })).toBeInViewport();
    await expect(
      page.getByText("รวมค่าส่ง 960 บาท", { exact: true }),
    ).toBeInViewport();
    await expect(page.getByLabel("ชื่อร้าน")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText(buyer, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "ระบุข้อมูลเพื่อจอง" }).click();
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

test("compare two farms at the same requested weight", async ({ page }) => {
  const key = randomUUID();
  const root = new URL("../../../../", import.meta.url);
  const fixture = (code: string) =>
    execFileSync(
      "uv",
      ["run", "--locked", "python", "-X", "utf8", "-c", code, key],
      { cwd: root },
    );
  try {
    fixture(
      [
        "from backend.src.modules.idea_c.test_market import browser_lot",
        "import sys",
        "k=sys.argv[1]",
        "browser_lot(k, name=k, farm='สวนรุ่งอรุณ', grade='สุกพร้อมปั่น', price=45, minimum=10, freight=150)",
        "browser_lot(k+'-west', name=k, grade='สุกคัดพิเศษ', minimum=5)",
      ].join("\n"),
    );
    await page.goto(
      "/ideas/idea-c?" +
        new URLSearchParams({
          q: key,
          kg: "10",
          postcode: "10100",
          sort: "cost",
        }),
    );
    const rows = page.locator(".market-product");
    await expect(rows).toHaveCount(2);
    const [west, east] = [rows.nth(0), rows.nth(1)];
    for (const [row, farm, grade, price, total] of [
      [west, "สวนริมคลอง", "สุกคัดพิเศษ", "48 บาท / กก.", "480 บาท"],
      [east, "สวนรุ่งอรุณ", "สุกพร้อมปั่น", "45 บาท / กก.", "600 บาท"],
    ] as const) {
      await expect(row.getByText(farm, { exact: true })).toBeVisible();
      await expect(row.getByText(grade, { exact: true })).toBeVisible();
      await expect(row.locator(".market-price")).toHaveText(price);
      await expect(row.locator(".market-product-foot strong")).toContainText(
        "10 crate",
      );
      await expect(row.locator(".market-product-foot strong")).toContainText(
        total,
      );
    }
  } finally {
    fixture(
      "from backend.src.modules.idea_c.test_market import cleanup; import sys; cleanup(sys.argv[1]); cleanup(sys.argv[1]+'-west')",
    );
  }
});
