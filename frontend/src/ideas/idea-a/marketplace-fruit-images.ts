const fruitPhotos = [
  { name: /mango/i, url: new URL('./marketplace-photos/mango.webp', import.meta.url).href },
  { name: /strawberr/i, url: new URL('./marketplace-photos/strawberry.webp', import.meta.url).href },
  { name: /banana/i, url: new URL('./marketplace-photos/banana.webp', import.meta.url).href },
  { name: /watermelon/i, url: new URL('./marketplace-photos/watermelon.webp', import.meta.url).href },
  { name: /pineapple/i, url: new URL('./marketplace-photos/pineapple.webp', import.meta.url).href },
  { name: /grape/i, url: new URL('./marketplace-photos/grapes.webp', import.meta.url).href },
];

export function marketplaceListingImage(fruit: { id: string; name_en: string }, listingId?: string): string | undefined {
  if (listingId === 'mango-market') {
    return new URL('./marketplace-photos/mango-market.webp', import.meta.url).href;
  }
  return fruitPhotos.find(({ name }) => name.test(fruit.id) || name.test(fruit.name_en))?.url;
}
