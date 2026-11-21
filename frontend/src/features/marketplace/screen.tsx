import { useEffect, useState } from "react";
import { ClipboardList, LayoutGrid, ShoppingBasket } from "lucide-react";
import { WorkspaceNav } from "../../shared/workspace-nav";
import { useLocation, useNavigate } from "react-router-dom";
import { MarketCopilot } from "../copilot/copilot";
import type { Lot } from "./types";
import { nextSaturday, WeekendTrial } from "./weekend-trial";
import "./style.css";

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
type CartLot = Pick<
  Lot,
  | "id"
  | "farm"
  | "name"
  | "unit"
  | "kg"
  | "minimum"
  | "stock"
  | "price"
  | "freight"
>;
type Cart = { lot: CartLot; units: number; requested_kg: number | null }[];
function minimumUnits({ lot, requested_kg }: Cart[number]) {
  return Math.max(
    lot.minimum,
    requested_kg && lot.kg ? Math.ceil(requested_kg / Number(lot.kg)) : 0,
  );
}
const cartKey = "maract.idea-c.cart.v1";
type SavedCart = {
  cart: Cart;
  later: string[];
  postcode: string;
  arrival: string;
};

function readCart(): SavedCart {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(cartKey) ?? "null",
    ) as SavedCart | null;
    if (
      saved &&
      Array.isArray(saved.cart) &&
      saved.cart.every(
        (i) =>
          i?.lot &&
          [i.lot.id, i.lot.name, i.lot.farm, i.lot.unit].every(
            (v) => typeof v === "string",
          ) &&
          [
            i.units,
            i.lot.price,
            i.lot.freight,
            i.lot.minimum,
            i.lot.stock,
          ].every(Number.isFinite) &&
          (i.requested_kg === null || Number.isFinite(i.requested_kg)) &&
          (i.lot.kg === null ||
            typeof i.lot.kg === "string" ||
            Number.isFinite(i.lot.kg)),
      ) &&
      Array.isArray(saved.later) &&
      saved.later.every((id) => typeof id === "string") &&
      typeof saved.postcode === "string" &&
      typeof saved.arrival === "string"
    )
      return saved;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return { cart: [], later: [], postcode: "", arrival: "" };
}
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
const deliveryDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
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

export function Marketplace() {
  const [saved] = useState(readCart);
  const route = useLocation();
  const navigate = useNavigate();
  const copilotOpen = new URLSearchParams(route.search).get("copilot") === "1";
  function setCopilot(open: boolean, hash = route.hash) {
    const search = new URLSearchParams(route.search);
    if (open) search.set("copilot", "1");
    else search.delete("copilot");
    navigate({ pathname: route.pathname, search: search.toString(), hash }, { replace: !open });
  }
  const tab =
    route.hash === "#cart"
      ? "cart"
      : route.hash === "#orders"
        ? "orders"
        : "market";
  function setTab(next: string) {
    navigate({
      pathname: route.pathname,
      search: route.search,
      hash: next === "market" ? "" : "#" + next,
    });
    window.scrollTo(0, 0);
  }
  const [params] = useState(() => new URLSearchParams(location.search));
  const guided = !["q", "kg", "arrival", "postcode", "preference", "budget", "sort"].some(key => params.has(key));
  const [catalogOpen, setCatalogOpen] = useState(!guided);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [budget, setBudget] = useState(params.get("budget") ?? (guided ? "500" : ""));
  const [kg, setKg] = useState(params.get("kg") ?? (guided ? "5" : ""));
  const resumingCart = tab === "cart" && saved.cart.length > 0;
  const [postcode, setPostcode] = useState(
    resumingCart ? saved.postcode : (params.get("postcode") ?? (saved.postcode || (guided ? "10100" : ""))),
  );
  const [arrival, setArrival] = useState(
    resumingCart ? saved.arrival : (params.get("arrival") ?? (guided ? nextSaturday() : saved.arrival)),
  );
  const [preference, setPreference] = useState(params.get("preference") ?? "");
  const [sort, setSort] = useState(
    ["cost", "date"].includes(params.get("sort") ?? "")
      ? params.get("sort")!
      : "match",
  );
  const [lots, setLots] = useState<Lot[]>([]);
  const [cart, setCart] = useState<Cart>(saved.cart);
  const [later, setLater] = useState<string[]>(saved.later);
  const [filtersOpen, setFiltersOpen] = useState(params.has("budget"));
  const [checkoutFarm, setCheckoutFarm] = useState("");
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
    try {
      if (cart.length)
        sessionStorage.setItem(
          cartKey,
          JSON.stringify({ cart, later, postcode, arrival }),
        );
      else sessionStorage.removeItem(cartKey);
    } catch {
      /* The in-memory basket still works when storage is unavailable. */
    }
  }, [cart, later, postcode, arrival]);
  const query = new URLSearchParams({ q, sort, preference });
  if (kg) query.set("kg", kg);
  if (postcode.length === 5) query.set("postcode", postcode);
  if (arrival) query.set("arrival", arrival);
  const queryString = query.toString();
  const [loadedQuery, setLoadedQuery] = useState("");
  const partialPostcode = postcode.length > 0 && postcode.length !== 5;
  useEffect(() => {
    let current = true;
    api<Lot[]>("lots?" + queryString)
      .then((data) => {
        if (current) {
          setLots(data);
          setLoadedQuery(queryString);
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
  }, [queryString, revision, tab]);
  useEffect(() => {
    if (tab !== "market") return;
    const reread = () => {
      if (!document.hidden) refresh(value => value + 1);
    };
    window.addEventListener("focus", reread);
    const timer = window.setInterval(reread, 30_000);
    return () => {
      window.removeEventListener("focus", reread);
      window.clearInterval(timer);
    };
  }, [tab]);
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
    setLater((ids) => ids.filter((id) => next.some((i) => i.lot.id === id)));
    setReview(null);
  }
  function add(lot: Lot) {
    const found = cart.find((i) => i.lot.id === lot.id);
    if (
      loadedQuery !== queryString ||
      partialPostcode ||
      lot.misses.length ||
      (found?.units ?? 0) + lot.units > lot.stock
    )
      return;
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
  async function applyCopilot(lots: Lot[]) {
    const next = new Map(cart.map((line) => [line.lot.id, line]));
    for (const lot of lots) {
      const previous = next.get(lot.id);
      next.set(lot.id, {
        lot,
        units: (previous?.units ?? 0) + lot.units,
        requested_kg: (previous?.requested_kg ?? 0) + (lot.requested_kg ?? 0) || null,
      });
    }
    const lines = [...next.values()];
    const added = new Set(lots.map(({ id }) => id));
    await Promise.all([...new Set(lots.map(({ farm }) => farm))].map((farm) =>
      api<Offer>("quote", {
        postcode, arrival,
        lines: lines.filter((line) => line.lot.farm === farm && (added.has(line.lot.id) || !later.includes(line.lot.id)))
          .map(({ lot, units, requested_kg }) => ({ id: lot.id, units, requested_kg })),
      }),
    ));
    edit(lines);
    setLater((ids) => ids.filter((id) => !added.has(id)));
    setCopilot(false, "#cart");
  }
  const displayCart = [
    ...cart.filter((i) => !later.includes(i.lot.id)),
    ...cart.filter((i) => later.includes(i.lot.id)),
  ];
  const farmGroups = [...new Set(displayCart.map((i) => i.lot.farm))].map(
    (farm) => {
      const group = displayCart.filter((i) => i.lot.farm === farm);
      const selected = group.filter((i) => !later.includes(i.lot.id));
      const freight = Math.max(0, ...selected.map((i) => i.lot.freight));
      const total = selected.reduce(
        (sum, i) => sum + i.units * i.lot.price,
        freight,
      );
      return { farm, group, selected, total };
    },
  );
  const accountForm = (
    <section className="shop-account">
      <h2>บัญชีผู้ประกอบการ</h2>
      <p className="market-hint">ใช้ครั้งแรก เลือก “สร้างบัญชีร้าน”</p>
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
  );
  return (
    <fieldset className="market" lang="th" disabled={busy}>
      <WorkspaceNav label="Marketplace">
        {([
          ["market", "วางแผนเมนู", LayoutGrid],
          ["cart", "ตะกร้า (" + cart.length + ")", ShoppingBasket],
          ["orders", "คำสั่งซื้อ", ClipboardList],
        ] as const).map(([key, text, Icon]) => (
          <button
            key={key}
            aria-pressed={key === tab && (key !== "market" || guided)}
            onClick={() => {
              if (key === "market" && !guided) {
                window.location.assign("/market");
                return;
              }
              setTab(key);
              setError("");
              if (key === "orders" && buyer) void run(loadOrders);
            }}
          >
            <Icon aria-hidden="true" />{text}
          </button>
        ))}
      </WorkspaceNav>
      <div className="catalog-workspace">
      {tab !== "market" && <button type="button" onClick={() => setCopilot(true)}>ผู้ช่วยจัดซื้อ</button>}
      {copilotOpen && <MarketCopilot postcode={postcode} arrival={arrival} preference={preference}
        deliveryFields={fields} onClose={() => setCopilot(false)} onApply={applyCopilot}
        onBrowse={(query) => { setQ(query); setCatalogOpen(true); setCopilot(false, ""); }} />}
      {error && <p role="alert">{error}</p>}
      {tab === "market" && (
        <>
          {guided && <WeekendTrial lots={lots} budget={budget} postcode={postcode} arrival={arrival} kg={kg}
            loading={loadedQuery !== queryString} error={catalogError} hasCart={cart.length > 0}
            onCart={() => setTab("cart")} onReserve={lot => { add(lot); setTab("cart"); }}
            conditions={<>
              <label>งบรวมค่าส่ง (บาท)<input type="number" min="1" value={budget} onChange={e => setBudget(e.target.value)} /></label>
              <label>จำนวนที่ต้องการ (กก.)<input type="number" min="1" value={kg} onChange={e => setKg(e.target.value)} /></label>
              {fields}
            </>} />}

          <button type="button" onClick={() => setCopilot(true)}>ผู้ช่วยจัดซื้อ</button>
          <details className="trial-catalog" open={catalogOpen} onToggle={event => setCatalogOpen(event.currentTarget.open)}>
            <summary>เปรียบเทียบล็อตอื่นจากสวน</summary>
          <section className="market-hero" data-enter>
            <div className="market-story">
              {!guided && <h1>ล็อตผลไม้จากสวน</h1>}
              <form
                className="fruit-search"
                role="search"
                onSubmit={(event) => {
                  event.preventDefault();
                  const results = document.getElementById("market-results");
                  results?.focus({ preventScroll: true });
                  results?.scrollIntoView({ block: "start" });
                }}
              >
                <label htmlFor="fruit-query">ค้นหาผลไม้ สวน หรือเมนู</label>
                <div>
                  <input
                    id="fruit-query"
                    type="search"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="เช่น มะม่วงน้ำดอกไม้"
                  />
                  <button type="submit">ดูล็อตผลผลิต</button>
                </div>
              </form>
            </div>
          </section>
          <div className="catalog-layout" id="market-catalog">
            <div className="catalog-results">
              <div className="market-heading">
                <h2 id="market-results" tabIndex={-1}>
                  ล็อตผลผลิต <span className="market-count">{lots.length}</span>
                </h2>
                {!guided && <button
                  className="filter-toggle"
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="market-conditions"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  เงื่อนไขการซื้อ
                </button>}
                {!guided && !filtersOpen && <span className="condition-summary">
                  {[
                    kg && kg + " กก.",
                    postcode,
                    arrival &&
                      Number.isFinite(Date.parse(arrival)) &&
                      deliveryDate.format(new Date(arrival)),
                    preference,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "ยังไม่ระบุจำนวนและปลายทาง"}
                </span>}
                <label>
                  เรียงตาม{" "}
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="match">แนะนำสำหรับร้าน</option>
                    <option value="cost">ยอดรวม</option>
                    <option value="date">วันที่รับเร็วที่สุด</option>
                  </select>
                </label>
              </div>
              {!guided && <section
                id="market-conditions"
                hidden={!filtersOpen}
                className="market-filters"
                aria-label="เงื่อนไขการเลือกผลผลิต"
              >
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
                    งบรวมค่าส่ง (บาท)
                    <input type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} />
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
              </section>}
              {!guided && catalogError && <p role="alert">{catalogError}</p>}
              {!lots.length && !catalogError && loadedQuery !== queryString && (
                <p role="status">กำลังค้นหาล็อตผลผลิต</p>
              )}
              {!lots.length && !catalogError && loadedQuery === queryString && (
                <p>ไม่มีล็อตตรงกับคำค้น ลองเปลี่ยนชนิดผลไม้หรือเมนู</p>
              )}
              <div className="market-grid">
                {lots.map((l) => {
                  const inCart =
                    cart.find((i) => i.lot.id === l.id)?.units ?? 0;
                  const checking = loadedQuery !== queryString;
                  const unknownTargetWeight = l.requested_kg !== null && !l.kg;
                  const reason = checking
                    ? "กำลังตรวจเงื่อนไข"
                    : partialPostcode
                      ? "กรอกรหัสไปรษณีย์ให้ครบ 5 หลัก"
                      : (budget && l.total > Number(budget) ? "ยอดรวมเกินงบที่ตั้งไว้" : "") || l.misses.join(" · ") ||
                        (inCart + l.units > l.stock
                          ? "จำนวนรวมในตะกร้าเกินสต็อก"
                          : "");
                  return (
                    <article key={l.id} className="market-product">
                      <div className="lot-identity">
                        {l.cover_url?.startsWith("/api/farmer/marketplace/photos/") &&
                          <img className="farm-lot-cover" src={l.cover_url} alt={l.name} loading="lazy" />}
                        <h3>{l.name}</h3>
                        <strong>{l.farm}</strong>
                        {l.is_sample && <small>ล็อตตัวอย่าง</small>}
                        <p>{l.grade ?? "สวนยังไม่ระบุเกรด"}</p>
                        <p>{l.uses}</p>
                      </div>
                      <div className="lot-comparison">
                        <strong className="market-price">
                          {l.kg
                            ? money(l.price / Number(l.kg)) + " / กก."
                            : money(l.price) + " / " + l.unit}
                        </strong>
                        {l.unit !== "กก." && l.kg && (
                          <p>
                            {money(l.price)} / {l.unit} ({l.kg} กก.)
                          </p>
                        )}
                        {!l.kg && !l.requested_kg && (
                          <p>สวนยังไม่ระบุน้ำหนักต่อหน่วย</p>
                        )}
                        <p>
                          ขั้นต่ำ {l.minimum} {l.unit} · เหลือ {l.stock} {l.unit}
                        </p>
                        <p>
                          รับได้ตั้งแต่{" "}
                          <time dateTime={l.earliest}>
                            {deliveryDate.format(new Date(l.earliest))}
                          </time>
                        </p>
                        {l.preferred && <p>ตรงความสนใจของร้าน</p>}
                      </div>
                      <div className="market-product-foot">
                        {unknownTargetWeight ? (
                          <strong>
                            <small>ยอดสำหรับ {l.requested_kg} กก.</small>
                            ยังคำนวณไม่ได้
                          </strong>
                        ) : (
                          <strong>
                            <small>
                              {l.requested_kg ? "ยอดสำหรับ" : "ยอดขั้นต่ำสำหรับ"}{" "}
                              {l.units} {l.unit}
                              {l.kg && l.unit !== "กก."
                                ? " (" + Number(l.kg) * l.units + " กก.)"
                                : ""}
                            </small>
                            {money(l.total)}
                          </strong>
                        )}
                        <small>
                          {unknownTargetWeight ? "ค่าส่งต่อรอบ" : "รวมค่าส่ง"}{" "}
                          {money(l.freight)}
                        </small>
                        <p
                          className={
                            reason ? "delivery-blocked" : "delivery-status"
                          }
                        >
                          {reason ||
                            (postcode && arrival
                              ? "ส่งถึงตามวันที่เลือก"
                              : postcode
                                ? "อยู่ในพื้นที่จัดส่ง"
                                : "ยังไม่ระบุพื้นที่จัดส่ง")}
                        </p>
                        {reason && !checking && (
                          <button
                            type="button"
                            className="edit-conditions"
                            onClick={() => {
                              if (guided) {
                                document.querySelector<HTMLInputElement>(".trial-conditions input")?.focus();
                                return;
                              }
                              setFiltersOpen(true);
                              requestAnimationFrame(() => {
                                const selector =
                                  partialPostcode ||
                                  l.misses.includes("อยู่นอกพื้นที่จัดส่ง")
                                    ? "input[inputmode=numeric]"
                                    : l.misses.includes("รอบส่งไม่ตรงกับวันรับ")
                                      ? "input[type=date]"
                                      : "input[type=number]";
                                document
                                  .querySelector<HTMLInputElement>(
                                    "#market-conditions " + selector,
                                  )
                                  ?.focus();
                              });
                            }}
                          >
                            แก้เงื่อนไขการซื้อ
                          </button>
                        )}
                        <button disabled={!!reason} onClick={() => add(l)}>
                          เพิ่มลงตะกร้า
                        </button>
                        {inCart > 0 && (
                          <small role="status">
                            ในตะกร้า {inCart} {l.unit}
                          </small>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
          </details>
        </>
      )}
      {tab === "orders" && !buyer && accountForm}
      {tab === "cart" && (
        <>
          <h1>ตะกร้าของร้าน</h1>
          {!cart.length ? (
            <p>ตะกร้ายังว่างอยู่</p>
          ) : (
            <>
              {farmGroups.length > 1 && (
                <p>
                  <strong>
                    ยอดรวมทุกสวน{" "}
                    {money(farmGroups.reduce((sum, g) => sum + g.total, 0))}
                  </strong>
                </p>
              )}
              {farmGroups.map(({ farm, group, selected, total }) => {
                const missing = [
                  !buyer && "เข้าสู่ระบบ",
                  !selected.length && "เลือกล็อตสำหรับรอบส่ง",
                  selected.some(
                    (i) =>
                      !Number.isInteger(i.units) ||
                      i.units < minimumUnits(i) ||
                      i.units > i.lot.stock,
                  ) && "แก้จำนวนให้ตรงกับน้ำหนักที่ต้องการและสต็อกของสวน",
                  postcode.length !== 5 && "กรอกรหัสไปรษณีย์ 5 หลัก",
                  !arrival && "เลือกวันรับ",
                  !address.trim() && "กรอกที่อยู่จัดส่ง",
                ].filter(Boolean);
                const lines = selected.map((i) => ({
                  id: i.lot.id,
                  units: i.units,
                  requested_kg: i.requested_kg,
                }));
                return (
                  <article className="cart-group" key={farm}>
                    <div className="cart-group-heading">
                      <h3>{farm}</h3>
                      <strong>รวมค่าส่ง {money(total)}</strong>
                    </div>
                    {group.map((i) => (
                      <div className="cart-line" key={i.lot.id}>
                        <strong>{i.lot.name}</strong>
                        <p>
                          {i.units} {i.lot.unit} × {money(i.lot.price)}
                        </p>
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
                          จำนวน ({i.lot.unit})
                          {i.requested_kg && i.lot.kg && (
                            <small>
                              ขั้นต่ำ {minimumUnits(i)} {i.lot.unit} สำหรับ{" "}
                              {i.requested_kg} กก.
                            </small>
                          )}
                          <input
                            type="number"
                            min={minimumUnits(i)}
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
                    {checkoutFarm !== farm ? (
                      <button
                        type="button"
                        disabled={!selected.length}
                        onClick={() => {
                          setCheckoutFarm(farm);
                          setReview(null);
                        }}
                      >
                        ระบุข้อมูลเพื่อจอง
                      </button>
                    ) : (
                      <section className="checkout-fields">
                        <h3>ข้อมูลรับสินค้า</h3>
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
                        {!buyer && accountForm}
                        {missing.length > 0 && (
                          <p className="market-hint">
                            ก่อนตรวจยอด กรุณา{missing.join(" · ")}
                          </p>
                        )}
                        <button
                          disabled={busy || missing.length > 0}
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
                      </section>
                    )}
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
                setLater([]);
                setCheckoutFarm("");
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
      </div>
    </fieldset>
  );
}
