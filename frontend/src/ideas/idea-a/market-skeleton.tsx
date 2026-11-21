import './market-design.css';

export function MarketSkeleton({ label, lines = 4 }: { label: string; lines?: number }) {
  return (
    <div className="market-skeleton" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} aria-hidden="true" className="market-skeleton-line" />
      ))}
    </div>
  );
}
