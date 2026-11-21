import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';

const demoPhotos = new Map<string, string>([
  ['mango-east', new URL('./assets/mango-east-harvest.webp', import.meta.url).href],
  ['mango-west', new URL('./assets/mango-west-selection.webp', import.meta.url).href],
  ['passion-east', new URL('./assets/passion-east-harvest.webp', import.meta.url).href],
]);

export function LotPhoto({ id, name, compact = false }: { id: string; name: string; compact?: boolean }) {
  const [failed, setFailed] = useState(false);
  const source = demoPhotos.get(id);
  return (
    <figure className={compact ? "lot-photo compact-photo" : "lot-photo"}>
      {source && !failed ? <>
        <img src={source} alt={compact ? "" : name} width={720} height={410}
          decoding="async" onError={() => setFailed(true)} />
        {!compact && <figcaption>ภาพจำลอง</figcaption>}
      </> : <div className="lot-no-photo"><ImageIcon size={22} aria-hidden="true"/>{!compact && "ยังไม่มีภาพล็อตนี้"}</div>}
    </figure>
  );
}
