import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("copilot proposes a real lot and moves it to the existing cart", async ({ page }) => {
  const key = randomUUID();
  const root = new URL("../../../", import.meta.url);
  const manageLot = (expression: string) => execFileSync("uv", ["run", "--locked", "python", "-c",
    `from backend.tests.marketplace.test_market import browser_lot, cleanup; import sys; ${expression}(sys.argv[1])`, key,
  ], { cwd: root });
  manageLot("browser_lot");
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/market");
    await page.getByRole("button", { name: "ผู้ช่วยจัดซื้อ" }).click();
    const chat = page.getByRole("dialog");
    await chat.getByLabel("รหัสไปรษณีย์").fill("10100");
    await chat.getByLabel("วันที่ต้องการรับ").fill(new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10));
    await chat.getByLabel("ข้อความถึงผู้ช่วย").fill(`หา ${key} 20 กก.`);
    await chat.getByRole("button", { name: "ส่ง", exact: true }).click();
    await expect(chat.getByText("ยอดส่งถึงเบื้องต้น ฿960")).toBeVisible();
    await chat.getByText("เครื่องมือที่เรียก").click();
    await expect(chat.getByText("search_listings · completed")).toBeVisible();
    await expect(page.getByRole("button", { name: "ตะกร้า (0)", includeHidden: true })).toBeAttached();
    await chat.getByRole("button", { name: "นำล็อตไปตะกร้า" }).click();
    await expect(page).toHaveURL("/market#cart");
    await expect(page.getByRole("button", { name: "ตะกร้า (1)" })).toBeVisible();
    await expect(page.getByText("รวมค่าส่ง 960 บาท", { exact: true })).toBeVisible();
  } finally {
    manageLot("cleanup");
  }
});

test("agent handoff through checkout and cancellation", async ({ page }) => {
  const buyer = randomUUID();
  const root = new URL("../../../", import.meta.url);
  execFileSync(
    "uv",
    [
      "run",
      "--locked",
      "python",
      "-X",
      "utf8",
      "-c",
      "from backend.tests.marketplace.test_market import browser_lot; import sys; browser_lot(sys.argv[1]); browser_lot(sys.argv[1]+'-unknown', None)",
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
    await expect(unknown.locator(".market-product-foot strong")).toContainText(
      "ยอดสำหรับ 20 กก.ยังคำนวณไม่ได้",
    );
    const lot = page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: buyer, exact: true }) });
    await expect(lot).toContainText("960 บาท");
    await page
      .getByRole("button", { name: "เงื่อนไขการซื้อ", exact: true })
      .click();
    await page.getByLabel("จำนวนที่ต้องการ (กก.)").fill("");
    await expect(
      unknown.getByRole("button", { name: "เพิ่มลงตะกร้า" }),
    ).toBeEnabled();
    await expect(unknown).toContainText("สวนยังไม่ระบุน้ำหนักต่อหน่วย");
    await page.getByLabel("จำนวนที่ต้องการ (กก.)").fill("20");
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
        "from backend.tests.marketplace.test_market import cleanup; import sys; cleanup(sys.argv[1]); cleanup(sys.argv[1]+'-unknown')",
        buyer,
      ],
      { cwd: root },
    );
  }
});

test("compare two farms at the same requested weight", async ({ page }) => {
  const key = randomUUID();
  const root = new URL("../../../", import.meta.url);
  const fixture = (code: string) =>
    execFileSync(
      "uv",
      ["run", "--locked", "python", "-X", "utf8", "-c", code, key],
      { cwd: root },
    );
  try {
    fixture(
      [
        "from backend.tests.marketplace.test_market import browser_lot",
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
      "from backend.tests.marketplace.test_market import cleanup; import sys; cleanup(sys.argv[1]); cleanup(sys.argv[1]+'-west')",
    );
  }
});

test("selected lots stay above deferred lots and farms after refresh", async ({
  page,
}) => {
  const key = randomUUID();
  const root = new URL("../../../", import.meta.url);
  const fixture = (code: string) =>
    execFileSync(
      "uv",
      ["run", "--locked", "python", "-X", "utf8", "-c", code, key],
      { cwd: root },
    );
  const names = ["a", "b", "c"].map((suffix) => key + "-" + suffix);
  try {
    fixture(
      [
        "from backend.tests.marketplace.test_market import browser_lot",
        "import sys",
        "k=sys.argv[1]",
        "browser_lot(k+'-a', farm='สวนรุ่งอรุณ')",
        "browser_lot(k+'-b')",
        "browser_lot(k+'-c')",
      ].join("\n"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/ideas/idea-c?q=" + key);
    for (const name of names) {
      await page
        .locator(".market-product")
        .filter({ hasText: name })
        .getByRole("button", { name: "เพิ่มลงตะกร้า" })
        .click();
    }
    await page.getByRole("button", { name: "ตะกร้า (3)" }).click();
    for (const name of names.slice(0, 2)) {
      await page
        .locator(".cart-line")
        .filter({ hasText: name })
        .getByRole("checkbox")
        .uncheck();
    }
    await page.reload();
    await expect(
      page.locator(".cart-line").first().getByText(names[2], { exact: true }),
    ).toBeInViewport();
    await expect(page.locator(".cart-group-heading").first()).toContainText(
      "48 บาท",
    );
  } finally {
    fixture(
      "from backend.tests.marketplace.test_market import cleanup; import sys; [cleanup(sys.argv[1]+'-'+suffix) for suffix in ('a','b','c')]",
    );
  }
});
