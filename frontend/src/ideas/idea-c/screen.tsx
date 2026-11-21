import { useEffect, useState } from "react";
import "./style.css";

const orchardPhoto = new URL(
  "./assets/cover-suan-lung-som.webp",
  import.meta.url,
).href;
const mangoPhoto = new URL(
  "./assets/product-mango-namdokmai-a.webp",
  import.meta.url,
).href;

type Lot = {
  id: string;
  farm: string;
  name: string;
  grade: string | null;
  uses: string;
  kg: string | null;
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
type Line = Pick<Lot, "id" | "name" | "unit" | "price" | "requested_kg"> & {
  units: number;
};
type Offer = { farm: string; lines: Line[]; freight: number; total: number };
type Order = Offer & {
  id: string;
  state: string;
  issue: string;
  refund: string;
  payment: string;
  arrival: string;
  expires: string;
  events: { action: string; note: string; at: string }[];
};
type Cart = { lot: Lot; units: number; requested_kg: number | null }[];
const labels: Record<string, string> = {
  pending: "รอสวนยืนยัน",
  expired: "หมดเวลายืนยัน",
  accepted: "สวนยืนยันแล้ว",
  rejected: "สวนปฏิเสธ",
  shipped: "จัดส่งแล้ว",
  received: "ได้รับสินค้าแล้ว",
  cancelled: "ยกเลิกแล้ว",
  cancel_requested: "รอสวนอนุมัติยกเลิก",
  open: "รอสวนตอบ",
  replied: "สวนตอบแล้ว",
  escalated: "ส่งต่อผู้ดูแลแล้ว",
  resolved: "ปิดเรื่องแล้ว",
  cancel: "ยกเลิก",
  ask_cancel: "ขอยกเลิก",
  receive: "ยืนยันรับสินค้า",
  report: "แจ้งปัญหา",
  escalate: "ส่งต่อผู้ดูแล",
  accept: "สวนยืนยัน",
  reject: "สวนปฏิเสธ",
  ship: "จัดส่ง",
  approve_cancel: "อนุมัติยกเลิก",
  deny_cancel: "ปฏิเสธการยกเลิก",
  reply: "คำตอบจากสวน",
  resolve: "ผลจากผู้ดูแล",
  refund: "การคืนเงิน",
};
const money = (n: number) => n.toLocaleString("th-TH") + " บาท";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    "/api/ideas/idea-c/" + path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!res.ok) {
    const data = await res.json();
    throw new Error(
      typeof data.detail === "string" ? data.detail : "กรุณาตรวจสอบข้อมูลอีกครั้ง",
    );
  }
  return res.json();
}

export function IdeaC() {
  const [params] = useState(() => new URLSearchParams(location.search));
  const [q, setQ] = useState(params.get("q") ?? "");
  const [kg, setKg] = useState(params.get("kg") ?? "");
  const [postcode, setPostcode] = useState(params.get("postcode") ?? "");
  const [arrival, setArrival] = useState(params.get("arrival") ?? "");
  const [preference, setPreference] = useState(params.get("preference") ?? "");
  const [sort, setSort] = useState(
    ["cost", "date"].includes(params.get("sort") ?? "")
      ? params.get("sort")!
      : "match",
  );
  const [lots, setLots] = useState<Lot[]>([]);
  const [tab, setTab] = useState("market");
  const [cart, setCart] = useState<Cart>([]);
  const [later, setLater] = useState<string[]>([]);
  const [buyer, setBuyer] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [review, setReview] = useState<{
    id: string;
    offer: Offer;
    address: string;
    postcode: string;
    arrival: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const [notes, setNotes] = useState<Record<string, string>>({});
  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({ q, sort, preference });
    if (kg) query.set("kg", kg);
    if (postcode.length === 5) query.set("postcode", postcode);
    if (arrival) query.set("arrival", arrival);
    api<Lot[]>("lots?" + query)
      .then((data) => {
        if (current) {
          setLots(data);
          setCatalogError("");
        }
      })
      .catch((e) => {
        if (current) {
          setLots([]);
          setCatalogError(e.message);
        }
      });
    return () => {
      current = false;
    };
  }, [q, kg, postcode, arrival, sort, preference, revision]);
  async function loadOrders() {
    const data = await api<{ buyer: string; orders: Order[] }>("orders");
    setBuyer(data.buyer);
    setOrders(data.orders);
  }
  useEffect(() => {
    void loadOrders().catch(() => {});
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }
  function edit(next: Cart) {
    setCart(next);
    setReview(null);
  }
  function add(lot: Lot) {
    const found = cart.find((i) => i.lot.id === lot.id);
    edit(
      found
        ? cart.map((i) =>
            i === found
              ? {
                  lot,
                  units: i.units + lot.units,
                  requested_kg:
                    (i.requested_kg ?? 0) + (lot.requested_kg ?? 0) || null,
                }
              : i,
          )
        : [...cart, { lot, units: lot.units, requested_kg: lot.requested_kg }],
    );
  }
  const fields = (
    <div className="market-fields">
      <label>
        รหัสไปรษณีย์
        <input
          inputMode="numeric"
          maxLength={5}
          value={postcode}
          onChange={(e) => {
            setPostcode(e.target.value.replace(/\D/g, ""));
            setReview(null);
          }}
        />
      </label>
      <label>
        วันที่ต้องการรับ
        <input
          type="date"
          value={arrival}
          onChange={(e) => {
            setArrival(e.target.value);
            setReview(null);
          }}
        />
      </label>
    </div>
  );
  return (
    <fieldset className="market" disabled={busy}>
      <nav aria-label="Marketplace">
        {[
          ["market", "เลือกผลผลิต"],
          ["cart", "ตะกร้า (" + cart.length + ")"],
          ["orders", "คำสั่งซื้อ"],
        ].map(([key, text]) => (
          <button
            key={key}
            aria-pressed={key === tab}
            onClick={() => {
              setTab(key);
              setError("");
              if (key === "orders" && buyer) void run(loadOrders);
            }}
          >
            {text}
          </button>
        ))}
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "market" && (
        <>
          <section className="market-hero">
            <div className="market-story">
              <h1>
                ตลาดผลไม้
                <br />
                จากสวน
              </h1>
              <label>
                ผลไม้ สวน หรือเมนู
                <input
                  value={q}
                  placeholder="เช่น มะม่วง หรือ สมูทตี"
                  onChange={(e) => setQ(e.target.value)}
                />
              </label>
            </div>
            <img className="market-orchard" src={orchardPhoto} alt="" />
          </section>
          <section className="market-filters" aria-label="เงื่อนไขการเลือกผลผลิต">
            <div className="market-fields">
              <label>
                จำนวนที่ต้องการ (กก.)
                <input
                  type="number"
                  min="1"
                  value={kg}
                  onChange={(e) => setKg(e.target.value)}
                />
              </label>
              <label>
                ความสนใจของร้าน
                <input
                  value={preference}
                  onChange={(e) => setPreference(e.target.value)}
                  placeholder="เช่น เบเกอรี"
                />
              </label>
            </div>
            {fields}
          </section>
          <div className="market-heading">
            <h2>
              ล็อตผลผลิต <span className="market-count">{lots.length}</span>
            </h2>
            <label>
              เรียงตาม{" "}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="match">แนะนำสำหรับร้าน</option>
                <option value="cost">ยอดรวม</option>
                <option value="date">วันที่รับเร็วที่สุด</option>
              </select>
            </label>
          </div>
          {catalogError && <p role="alert">{catalogError}</p>}
          {!lots.length && !catalogError && (
            <p>ไม่มีล็อตตรงกับคำค้น ลองเปลี่ยนชนิดผลไม้หรือเมนู</p>
          )}
          <div className="market-grid">
            {lots.map((l) => (
              <article key={l.id} className="market-product">
                <div className="market-product-head">
                  {l.name.includes("มะม่วงน้ำดอกไม้") && (
                    <img
                      src={mangoPhoto}
                      loading="lazy"
                      alt="ภาพประกอบมะม่วงน้ำดอกไม้"
                    />
                  )}
                  <div className="market-product-title">
                    <small>{l.farm}</small>
                    <h3>{l.name}</h3>
                  </div>
                </div>
                <div className="market-product-body">
                  <p>
                    {l.grade ?? "สวนยังไม่ระบุเกรด"} · {l.uses}
                  </p>
                  <strong className="market-price">
                    {money(l.price)} / {l.unit}
                  </strong>
                  <p>
                    ขั้นต่ำ {l.minimum} {l.unit} · เหลือ {l.stock} {l.unit} ·{" "}
                    {l.kg ? l.kg + " กก./" + l.unit : "สวนยังไม่ระบุน้ำหนัก"}
                  </p>
                  <p>
                    รับได้เร็วสุด {l.earliest} · ค่าส่ง {money(l.freight)}
                  </p>
                  <p>
                    {l.misses.join(" · ") ||
                      (postcode.length === 5 && arrival
                        ? "ส่งถึงตามวันที่เลือก"
                        : "ระบุพื้นที่และวันรับเพื่อตรวจรอบส่ง")}
                    {l.preferred ? " · ตรงความสนใจของร้าน" : ""}
                  </p>
                  <div className="market-product-foot">
                    <strong>
                      {l.units} {l.unit}{" "}
                      {l.kg ? "(" + Number(l.kg) * l.units + " กก.)" : ""} รวม{" "}
                      {money(l.total)}
                    </strong>{" "}
                    <button
                      disabled={
                        l.stock < l.units ||
                        l.requested_kg !== (kg ? Number(kg) : null) ||
                        (l.requested_kg !== null && !l.kg)
                      }
                      onClick={() => add(l)}
                    >
                      เพิ่มลงตะกร้า
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
      {tab !== "market" && !buyer && (
        <section>
          <h2>บัญชีผู้ประกอบการ</h2>
          <label>
            ชื่อร้าน
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            รหัสผ่าน (อย่างน้อย 8 ตัว)
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {[false, true].map((register) => (
            <button
              key={String(register)}
              disabled={busy || !name || password.length < 8}
              onClick={() =>
                void run(async () => {
                  await api("session", { name, password, register });
                  setPassword("");
                  await loadOrders();
                })
              }
            >
              {register ? "สร้างบัญชีร้าน" : "เข้าสู่ระบบ"}
            </button>
          ))}
        </section>
      )}
      {tab === "cart" && (
        <>
          <h1>ตะกร้าของร้าน</h1>
          {!cart.length ? (
            <p>ตะกร้ายังว่างอยู่</p>
          ) : (
            <>
              {fields}
              <label>
                ที่อยู่จัดส่ง
                <input
                  value={address}
                  maxLength={200}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    setReview(null);
                  }}
                />
              </label>
              {[...new Set(cart.map((i) => i.lot.farm))].map((farm) => {
                const group = cart.filter((i) => i.lot.farm === farm);
                const selected = group.filter((i) => !later.includes(i.lot.id));
                const lines = selected.map((i) => ({
                  id: i.lot.id,
                  units: i.units,
                  requested_kg: i.requested_kg,
                }));
                const before = selected.reduce(
                  (n, i) => n + i.units * i.lot.price,
                  Math.max(0, ...selected.map((i) => i.lot.freight)),
                );
                return (
                  <article key={farm}>
                    <h3>{farm}</h3>
                    {group.map((i) => (
                      <div key={i.lot.id}>
                        <label>
                          <input
                            type="checkbox"
                            checked={!later.includes(i.lot.id)}
                            onChange={(e) => {
                              setReview(null);
                              setLater(
                                e.target.checked
                                  ? later.filter((id) => id !== i.lot.id)
                                  : [...later, i.lot.id],
                              );
                            }}
                          />
                          รวมในรอบส่งนี้
                        </label>
                        <label>
                          {i.lot.name} ({i.lot.unit})
                          <input
                            type="number"
                            min={i.lot.minimum}
                            max={i.lot.stock}
                            value={i.units}
                            onChange={(e) =>
                              edit(
                                cart.map((v) =>
                                  v === i
                                    ? { ...v, units: Number(e.target.value) }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <button
                          onClick={() => edit(cart.filter((v) => v !== i))}
                        >
                          นำออก
                        </button>
                      </div>
                    ))}
                    <p>ยอดในตะกร้ารวมค่าส่ง {money(before)}</p>
                    <button
                      disabled={
                        busy ||
                        !selected.length ||
                        !buyer ||
                        postcode.length !== 5 ||
                        !arrival ||
                        !address.trim()
                      }
                      onClick={() =>
                        void run(async () => {
                          setReview(null);
                          const offer = await api<Offer>("quote", {
                            lines,
                            postcode,
                            arrival,
                          });
                          setReview({
                            id: crypto.randomUUID(),
                            offer,
                            address,
                            postcode,
                            arrival,
                          });
                        })
                      }
                    >
                      ตรวจยอดและรอบส่ง
                    </button>
                    {review?.offer.farm === farm && (
                      <div>
                        <h3>ตรวจสอบก่อนสั่ง</h3>
                        {review.offer.lines.map((l) => (
                          <p key={l.id}>
                            {l.name} {l.units} × {money(l.price)}
                          </p>
                        ))}
                        <p>
                          ค่าส่ง {money(review.offer.freight)} · ยอดล่าสุด{" "}
                          {money(review.offer.total)}
                        </p>
                        <p>รับวันที่ {review.arrival} · สวนมีเวลา 12 ชั่วโมงเพื่อยืนยัน</p>
                        <button
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api("orders", {
                                id: review.id,
                                expected: review.offer,
                                lines: review.offer.lines.map(
                                  ({ id, units, requested_kg }) => ({
                                    id,
                                    units,
                                    requested_kg,
                                  }),
                                ),
                                postcode: review.postcode,
                                arrival: review.arrival,
                                address: review.address,
                              });
                              edit(cart.filter((i) => !selected.includes(i)));
                              refresh((n) => n + 1);
                              setTab("orders");
                              await loadOrders();
                            })
                          }
                        >
                          ยืนยันคำสั่งซื้อ
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </>
          )}
        </>
      )}
      {tab === "orders" && buyer && (
        <>
          <h1>คำสั่งซื้อของ {buyer}</h1>
          <button
            onClick={() =>
              void run(async () => {
                await api("logout", {});
                setOrders([]);
                setBuyer("");
                setAddress("");
                setCart([]);
                setNotes({});
                setReview(null);
              })
            }
          >
            ออกจากระบบ
          </button>
          <button disabled={busy} onClick={() => void run(loadOrders)}>
            อัปเดตสถานะ
          </button>
          {!orders.length && <p>ยังไม่มีคำสั่งซื้อ</p>}
          {orders.map((o) => {
            const actions: string[] = [];
            if (o.state === "pending") actions.push("cancel");
            if (o.state === "accepted") actions.push("ask_cancel");
            if (o.state === "shipped") actions.push("receive");
            if (
              !["pending", "expired", "rejected"].includes(o.state) &&
              (!o.issue || o.issue === "resolved")
            )
              actions.push("report");
            if (["open", "replied"].includes(o.issue)) actions.push("escalate");
            return (
              <article key={o.id}>
                <small>{o.id}</small>
                <h3>
                  {o.farm} · {labels[o.state]}
                </h3>
                {o.lines.map((l) => (
                  <p key={l.id}>
                    {l.name} {l.units} {l.unit} × {money(l.price)}
                  </p>
                ))}
                <p>
                  รวม {money(o.total)} (ค่าส่ง {money(o.freight)}) · รับวันที่{" "}
                  {o.arrival}
                </p>
                {o.state === "pending" && (
                  <p>รอยืนยันถึง {new Date(o.expires).toLocaleString("th-TH")}</p>
                )}
                {o.payment && <p>วิธีชำระตรงกับสวน · {o.payment}</p>}
                {o.issue && <p>เรื่องที่แจ้ง · {labels[o.issue]}</p>}
                {o.refund && <p>สถานะคืนเงิน · {o.refund}</p>}
                {o.events.map((e, i) => (
                  <p key={i}>
                    {labels[e.action]} {e.note}
                  </p>
                ))}
                {actions.length > 0 && (
                  <label>
                    รายละเอียดเพิ่มเติม
                    <input
                      maxLength={500}
                      value={notes[o.id] ?? ""}
                      onChange={(e) =>
                        setNotes({ ...notes, [o.id]: e.target.value })
                      }
                    />
                  </label>
                )}
                {actions.map((action) => (
                  <button
                    key={action}
                    disabled={
                      busy || (action === "report" && !notes[o.id]?.trim())
                    }
                    onClick={() =>
                      void run(async () => {
                        await api("orders/" + o.id + "/events", {
                          action,
                          note: notes[o.id] ?? "",
                        });
                        setNotes({ ...notes, [o.id]: "" });
                        await loadOrders();
                        refresh((n) => n + 1);
                      })
                    }
                  >
                    {labels[action]}
                  </button>
                ))}
              </article>
            );
          })}
        </>
      )}
    </fieldset>
  );
}
