import { marketplaceListingImage } from './marketplace-fruit-images';

const butter = new URL('./ingredient-photos/unsalted-butter.webp', import.meta.url).href;

const photos = new Map([
  ['pistachio-gelato', new URL('./ingredient-photos/pistachio-gelato.webp', import.meta.url).href],
  ['pistachio-paste', new URL('./ingredient-photos/pistachio-paste.webp', import.meta.url).href],
  ['whipping-cream', new URL('./ingredient-photos/whipping-cream.webp', import.meta.url).href],
  ['milk', new URL('./ingredient-photos/milk.webp', import.meta.url).href],
  ['strawberry-shortcake', new URL('./ingredient-photos/strawberry-shortcake.webp', import.meta.url).href],
  ['mango-smoothie', new URL('./ingredient-photos/mango-smoothie.webp', import.meta.url).href],
  ['blueberry', new URL('./ingredient-photos/blueberry.webp', import.meta.url).href],
  ['cream-cheese', new URL('./ingredient-photos/cream-cheese.webp', import.meta.url).href],
  ['butter', butter],
  ['unsalted-butter', butter],
  ['chocolate-chips', new URL('./ingredient-photos/chocolate-chips.webp', import.meta.url).href],
  ['flour', new URL('./ingredient-photos/flour.webp', import.meta.url).href],
  ['sugar', new URL('./ingredient-photos/sugar.webp', import.meta.url).href],
  ['vanilla', new URL('./ingredient-photos/vanilla.webp', import.meta.url).href],
  ['cocoa', new URL('./ingredient-photos/cocoa.webp', import.meta.url).href],
  ['matcha', new URL('./ingredient-photos/matcha.webp', import.meta.url).href],
  ['orange', new URL('./ingredient-photos/orange.webp', import.meta.url).href],
  ['dragon-fruit', new URL('./ingredient-photos/dragon-fruit.webp', import.meta.url).href],
  ['coconut', new URL('./ingredient-photos/coconut.webp', import.meta.url).href],
  ['lemon', new URL('./ingredient-photos/lemon.webp', import.meta.url).href],
  ['raspberry', new URL('./ingredient-photos/raspberry.webp', import.meta.url).href],
  ['avocado', new URL('./ingredient-photos/avocado.webp', import.meta.url).href],
  ['lychee', new URL('./ingredient-photos/lychee.webp', import.meta.url).href],
  ['passion-fruit', new URL('./ingredient-photos/passion-fruit.webp', import.meta.url).href],
  ['yogurt', new URL('./ingredient-photos/yogurt.webp', import.meta.url).href],
  ['condensed-milk', new URL('./ingredient-photos/condensed-milk.webp', import.meta.url).href],
  ['almond', new URL('./ingredient-photos/almond.webp', import.meta.url).href],
  ['oat', new URL('./ingredient-photos/oat.webp', import.meta.url).href],
  ['honey', new URL('./ingredient-photos/honey.webp', import.meta.url).href],
  ['coffee', new URL('./ingredient-photos/coffee.webp', import.meta.url).href],
  ['black-tea', new URL('./ingredient-photos/black-tea.webp', import.meta.url).href],
]);
const fruitKeys = new Set(['mango', 'mango-market', 'strawberry', 'banana', 'pineapple', 'watermelon', 'grapes']);
const fallback = new URL('./ingredient-photos/fallback.svg', import.meta.url).href;

export function ingredientImage(key?: string | null): string {
  if (!key) return fallback;
  const normalized = key.trim().toLowerCase();
  return photos.get(normalized)
    ?? (fruitKeys.has(normalized)
      ? marketplaceListingImage({ id: normalized, name_en: '' }, normalized)
      : undefined)
    ?? fallback;
}
