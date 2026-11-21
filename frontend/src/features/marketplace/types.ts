export type Offer = {
  farm: string;
  lines: (Pick<Lot, "id" | "name" | "unit" | "price" | "requested_kg"> & { units: number })[];
  freight: number;
  total: number;
};

export type Order = Offer & {
  id: string;
  state: string;
  issue: string;
  refund: string;
  payment: string;
  arrival: string;
  expires: string;
  events: { action: string; note: string; at: string }[];
};

export type Lot = {
  id: string;
  farm: string;
  name: string;
  grade: string | null;
  uses: string;
  kg: number | string | null;
  unit: string;
  price: number;
  minimum: number;
  stock: number;
  freight: number;
  earliest: string;
  ends: string;
  transit: number;
  units: number;
  requested_kg: number | null;
  total: number;
  misses: string[];
  preferred: boolean;
};
