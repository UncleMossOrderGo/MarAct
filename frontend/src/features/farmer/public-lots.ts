export const FARMER_API = '/api/ideas/idea-d';
const seedPhotos: Record<string, string> = {
  gold: new URL('./assets/product-mango-namdokmai-a.webp', import.meta.url).href,
  green: new URL('./assets/product-mango-khiaosawoei-b.webp', import.meta.url).href,
};
export const publicPhoto = (id: string) => seedPhotos[id] ?? FARMER_API + '/marketplace/photos/' + encodeURIComponent(id);
export type Profile = { name: string; location: string; area: string; about: string };
export type Fields = { fruit: string; stock_kg: number|null; price: number|null; unit: string; kg_per_unit: number|null; min_kg: number|null; ready: string|null; area: string };
export type FarmLot = { id: string; fields: Fields; photos: string[]; cover: number; available?: boolean };
export type PublicFarm = { farmId: number; profile: Profile; listings: FarmLot[] };

export function matchesPublishedLot(farmName: string, lot: FarmLot, query: string): boolean {
  const term = query.trim().toLocaleLowerCase('th');
  return lot.fields.fruit.toLocaleLowerCase('th').includes(term)
    || lot.fields.area.toLocaleLowerCase('th').includes(term)
    || farmName.trim().toLocaleLowerCase('th') === term;
}

export async function getPublishedFarms(signal: AbortSignal): Promise<PublicFarm[]> {
  const response = await fetch(FARMER_API + '/marketplace', { signal, cache: 'no-store' });
  if (!response.ok) throw Error('โหลดประกาศจากสวนไม่ได้');
  return response.json();
}
