export const marketplaceMascot = new URL('./brand/mascot.webp', import.meta.url).href;

export function MarketBrand() {
  return (
    <p className="market-brand">
      <img src={marketplaceMascot} alt="" width={32} height={32} />
      MarAct
    </p>
  );
}
