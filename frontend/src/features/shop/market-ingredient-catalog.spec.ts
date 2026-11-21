import { expect, test, type Page } from '@playwright/test';
import type { MarketIngredientListing } from './market-ingredient-catalog';

const paste: MarketIngredientListing = {
  id: 'pistachio-sweeting', ingredient_id: 'pistachio-paste',
  name_en: 'Pistachio paste', name_th: 'พิสตาชิโอเพสต์สำหรับทำเจลาโต', category: 'baking', unit: 'kg',
  stock_kg: 25, price_per_kg_thb: '820.00', seller_id: 'sweeting', seller_name: 'Sweetingred Co.',
};
const alternate: MarketIngredientListing = {
  ...paste, id: 'pistachio-bakemate', seller_id: 'bakemate', seller_name: 'BakeMate',
  stock_kg: 3, price_per_kg_thb: '870.00',
};
const cream: MarketIngredientListing = {
  ...paste, id: 'cream-dairypro', ingredient_id: 'whipping-cream',
  name_en: 'Whipping cream', name_th: 'วิปปิ้งครีม', category: 'dairy',
  stock_kg: 0, price_per_kg_thb: '195.00', seller_id: 'dairypro', seller_name: 'DairyPro',
};

async function mockCatalog(page: Page) {
  await page.route('**/api/shop/listings?*', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const category = params.get('category');
    const ingredient = params.get('ingredient_id');
    const query = params.get('q')?.toLowerCase() ?? '';
    return route.fulfill({ json: { listings: [paste, alternate, cream].filter((listing) =>
      (!category || category === listing.category)
      && (!ingredient || ingredient === listing.ingredient_id)
      && (listing.name_en.toLowerCase().includes(query) || listing.name_th.includes(query)),
    ) } });
  });
}

test('filters listing reads by category and search and preserves seller choice for checkout', async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/tests/fixtures/market-ingredient-catalog.html');
  const catalog = page.getByRole('region', { name: 'Marketplace' });
  await expect(catalog.getByText('฿820.00 / kg')).toBeVisible();
  await expect(catalog.getByRole('button', { name: 'Add to cart: Whipping cream (DairyPro)' })).toBeDisabled();
  await catalog.getByRole('button', { name: 'Dairy', exact: true }).click();
  await expect(catalog.getByRole('button', { name: 'Dairy', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(catalog.getByRole('listitem')).toHaveCount(1);
  await catalog.getByRole('searchbox').fill('mango');
  await expect(catalog.getByText('No ingredients found.')).toBeVisible();
  await catalog.getByRole('button', { name: 'Baking' }).click();
  await catalog.getByRole('searchbox').fill('Pistachio');
  await expect(catalog.getByRole('listitem')).toHaveCount(2);
  await catalog.getByRole('button', { name: 'Add to cart: Pistachio paste (Sweetingred Co.)' }).click();
  await expect(page.getByLabel('Cart payload')).toContainText('"listing_id":"pistachio-sweeting"');
  await catalog.getByRole('button', { name: 'Pistachio paste', exact: true }).first().click();

  const detail = page.getByRole('region', { name: 'Product detail' });
  await expect(detail.getByText(paste.name_th)).toBeVisible();
  await detail.getByRole('radio', { name: /BakeMate/ }).check();
  const stepper = detail.getByRole('spinbutton', { name: 'Quantity (kg)' });
  const add = detail.getByRole('button', { name: 'Add to cart' });
  await expect(stepper).toHaveAttribute('max', '3');
  await stepper.fill('4');
  await expect(add).toBeDisabled();
  await stepper.fill('3');
  await add.click();
  await expect(page.getByLabel('Cart payload')).toContainText('"listing_id":"pistachio-bakemate"');
  await expect(page.getByLabel('Cart payload')).toContainText('"qty_kg":3');
});

test('shows two columns and wraps long Thai ingredient names at 360 px', async ({ page }) => {
  await mockCatalog(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/market-ingredient-catalog.html?locale=th');
  const catalog = page.getByRole('region', { name: 'ตลาดวัตถุดิบ' });
  await expect(catalog.getByRole('listitem')).toHaveCount(3);
  await catalog.getByRole('searchbox', { name: 'ค้นหาวัตถุดิบ' }).fill('พิสตาชิโอ');
  await expect(catalog.getByRole('listitem')).toHaveCount(2);
  await expect(catalog.getByRole('button', { name: paste.name_th, exact: true })).toHaveCount(2);
  const columns = await catalog.getByRole('list').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns);
  expect(columns.split(' ')).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
