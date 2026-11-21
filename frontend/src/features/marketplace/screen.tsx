import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, PackageOpen, Search, ShoppingBasket, SlidersHorizontal, Sprout } from "lucide-react";
import { ProductHeader } from "../../app/ProductHeader";
import { BuyerAccount } from "./BuyerAccount";
import type { BuyerProfile } from "./BuyerAccount";
import { ShopOrders } from "./ShopOrders";
import type { Offer, Order } from "./types";
import { FarmHarvest } from "./FarmHarvest";
import { LotPhoto } from "./LotPhoto";
import { TrendStrip } from "./TrendStrip";
import { MarketCopilot } from "../copilot/copilot";
import type { Lot } from "./types";
import "./style.css";

const mangoPhoto = new URL(
  "../../legacy/workspace/procurement-produce.webp",
  import.meta.url,
).href;

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
const money = (n: number) => n.toLocaleString("th-TH") + " บาท";
const deliveryDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
class MarketApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
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
    throw new MarketApiError(res.status,
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
    else { search.delete("copilot"); search.delete("brief"); }
    navigate({ pathname: route.pathname, search: search.toString(), hash }, { replace: !open });
  }
  const tab =
    route.hash === "#cart"
      ? "cart"
      : route.hash === "#orders"
        ? "orders"
        : route.hash === "#buyer" ? "buyer" : "market";
  function setTab(next: string) {
    navigate({
      pathname: route.pathname,
      search: route.search,
      hash: next === "market" ? "" : "#" + next,
    });
    window.scrollTo(0, 0);
  }
  const [params] = useState(() => new URLSearchParams(location.search));
  const q = new URLSearchParams(route.search).get("q") ?? "";
  function searchFor(value: string, closeChat = false) {
    const search = new URLSearchParams(route.search);
    if (value) search.set("q", value); else search.delete("q");
    if (closeChat) { search.delete("copilot"); search.delete("brief"); }
    navigate({pathname: route.pathname, search: search.toString(), hash: ""}, {replace: true});
  }
  const [kg, setKg] = useState(params.get("kg") ?? "");
  const resumingCart = tab === "cart" && saved.cart.length > 0;
  const [postcode, setPostcode] = useState(
    resumingCart ? saved.postcode : (params.get("postcode") ?? saved.postcode),
  );
  const [arrival, setArrival] = useState(
    resumingCart ? saved.arrival : (params.get("arrival") ?? saved.arrival),
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [checkoutFarm, setCheckoutFarm] = useState("");
  const [buyer, setBuyer] = useState("");
  const [profile, setProfile] = useState<BuyerProfile>({business: "", postcode: ""});
  const loadedBuyer = useRef("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [ordersStatus, setOrdersStatus] = useState<"loading" | "ready" | "error">("loading");
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
  }, [queryString, revision]);
  async function loadOrders() {
    try {
      const data = await api<{ buyer: string; orders: Order[]; profile: BuyerProfile }>("orders");
      setProfile(data.profile);
      if (loadedBuyer.current !== data.buyer) {
        loadedBuyer.current = data.buyer;
        setPostcode(current => current || data.profile.postcode);
      }
      setBuyer(data.buyer);
      setOrders(data.orders);
    } catch (failure) {
      if (!(failure instanceof MarketApiError && failure.status === 401)) {
        setOrdersStatus("error");
        return;
      }
      setBuyer("");
      setOrders([]);
    }
    setOrdersStatus("ready");
  }
  useEffect(() => {
    void loadOrders();
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
      return false;
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
    setBusy(true);
    try {
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
    } finally { setBusy(false); }
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
  function logout() {
    return run(async () => {
      await api("logout", {});
      loadedBuyer.current = "";
      setProfile({business: "", postcode: ""}); setPostcode(""); setArrival(""); setBuyer(""); setName("");
      setAddress(""); setCart([]); setLater([]); setCheckoutFarm(""); setReview(null); setOrders([]);
    });
  }
  const accountForm = (
    <section className="shop-account">
      <h2>บัญชีผู้ประกอบการ</h2>
      <p className="market-hint">ใช้ครั้งแรก เลือก “สร้างบัญชีร้าน”</p>
      <label>
        ชื่อร้าน
        <input autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        รหัสผ่าน (อย่างน้อย 8 ตัว)
        <input
          type="password" autoComplete="current-password"
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
    <>
    <ProductHeader market={{ tab, count: cart.length, select: (next) => {
      setTab(next); setError("");
      if (next === "orders" && buyer) void run(loadOrders);
    } }}/>
    <main className="product-wide">
    <fieldset className="market" lang="th" disabled={busy}>
      <MarketCopilot key={buyer} open={copilotOpen} onOpen={() => setCopilot(true)} business={profile.business} initialText={new URLSearchParams(route.search).get("brief") ?? ""} postcode={postcode} arrival={arrival} preference={preference}
        deliveryFields={fields} onClose={() => setCopilot(false)} onApply={applyCopilot}
        onBrowse={(query) => searchFor(query, true)} />
      {error && <p role="alert">{error}</p>}
      {tab === "market" && (
        <>
          <section className="market-hero" data-enter>
            <div className="market-story">
              <h1>
                ตลาดผลไม้
                <br />
                <em>ตรงจากสวน</em>
              </h1>
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
                <label htmlFor="fruit-query">ค้นหาผลไม้ สวน หรือเมนูที่ต้องการเข้าร้าน</label>
                <div>
                  <Search aria-hidden="true" size={20}/><input
                    id="fruit-query"
                    type="search"
                    value={q}
                    onChange={(e) => searchFor(e.target.value)}
                    placeholder="เช่น มะม่วงน้ำดอกไม้"
                  />
                  <button type="submit">ค้นหา</button>
                </div>
              </form>
            </div>
            <img
              className="market-orchard"
              src={mangoPhoto}
              alt="ลังมะม่วงและสับปะรดพร้อมส่งจากสวน" fetchPriority="high"
            />
          </section>
          <TrendStrip/>
          <div className="catalog-layout" id="market-catalog">
            <div className="catalog-results">
              <div className="market-heading">
                <h2 id="market-results" tabIndex={-1}>
                  ล็อตที่สั่งซื้อได้ <span className="market-count">{lots.length} ล็อต</span>
                </h2>
                <button
                  className="filter-toggle"
                  type="button"
                  aria-expanded={filtersOpen}
                  aria-controls="market-conditions"
                  onClick={() => setFiltersOpen(!filtersOpen)}
                >
                  <SlidersHorizontal size={16} aria-hidden="true"/>เงื่อนไขการซื้อ
                </button>
                {(kg || postcode || arrival || preference) && <span className="condition-summary">
                  {[
                    kg && kg + " กก.",
                    postcode,
                    arrival &&
                      Number.isFinite(Date.parse(arrival)) &&
                      deliveryDate.format(new Date(arrival)),
                    preference,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>}
                <label>
                  <span className="sort-prefix">เรียงตาม</span>
                  <select aria-label="เรียงตาม"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="match">แนะนำสำหรับร้าน</option>
                    <option value="cost">ยอดรวม</option>
                    <option value="date">วันที่รับเร็วที่สุด</option>
                  </select>
                </label>
              </div>
              <section
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
              {catalogError && <p role="alert">โหลดล็อตที่สั่งซื้อไม่ได้ <button onClick={() => refresh(n => n + 1)}>ลองอีกครั้ง</button></p>}
              {!lots.length && !catalogError && loadedQuery !== queryString && (
                <p role="status">กำลังค้นหาล็อตผลผลิต</p>
              )}
              {!lots.length && !catalogError && loadedQuery === queryString && (
                <div className="catalog-empty" role="status">
                  <Search aria-hidden="true" size={25}/>
                  <div><h3>{q ? "ไม่มีล็อตตรงกับคำค้นนี้" : "ยังไม่มีล็อตที่สั่งซื้อได้"}</h3>
                    <p>{q ? "ลองค้นด้วยชื่อผลไม้ สวน หรือเมนูอื่น" : "ดูประกาศที่เกษตรกรลงไว้ในส่วนประกาศจากสวนด้านล่าง"}</p></div>
                  {q && <button type="button" onClick={() => searchFor("")}>ล้างคำค้น</button>}
                </div>
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
                      : l.misses.join(" · ") ||
                        (inCart + l.units > l.stock
                          ? "จำนวนรวมในตะกร้าเกินสต็อก"
                          : "");
                  return (
                    <article key={l.id} className="market-product">
                      <LotPhoto id={l.id} name={l.name}/>
                      <div className="lot-identity">
                        <p className="lot-farm"><Sprout size={15} aria-hidden="true"/>{l.farm}</p>
                        <h3>{l.name}</h3>
                        <p className="lot-description"><span>{l.grade ?? "สวนยังไม่ระบุเกรด"}</span>{l.uses && <> · {l.uses}</>}</p>
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
                        <p className="lot-fact"><PackageOpen size={16} aria-hidden="true"/>
                          ขั้นต่ำ {l.minimum} {l.unit} · เหลือ {l.stock} {l.unit}
                        </p>
                        <p className="lot-fact"><CalendarDays size={16} aria-hidden="true"/>
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
                        <button className="lot-add" disabled={!!reason} onClick={() => add(l)}>
                          <ShoppingBasket size={18} aria-hidden="true"/>เพิ่มลงตะกร้า
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
            <FarmHarvest query={q}/>
          </div>
        </>
      )}
      {tab === "buyer" && (ordersStatus === "ready" ? <BuyerAccount key={buyer} buyer={buyer} profile={profile}
        accountForm={accountForm} onSave={value => run(async () => {
          const updated = await api<BuyerProfile>("buyer/profile", value);
          setProfile(updated); setPostcode(updated.postcode); setReview(null);
        })} onChat={() => setCopilot(true)} onOrders={() => setTab("orders")} onLogout={() => void logout()}/>
        : <p role="status">{ordersStatus === "loading" ? "กำลังเปิดบัญชี…" : "โหลดบัญชีไม่ได้"}
          {ordersStatus === "error" && <button onClick={() => void run(loadOrders)}>ลองอีกครั้ง</button>}</p>)}
      {tab === "orders" && <ShopOrders buyer={buyer} orders={orders} status={ordersStatus} accountForm={accountForm}
        onBrowse={() => setTab("market")} onRefresh={() => void run(loadOrders)}
        onLogout={() => void logout()}
        onAction={(id, action, note) => run(async () => {
          await api("orders/" + id + "/events", { action, note });
          await loadOrders();
          refresh(n => n + 1);
        })} />}
      {tab === "cart" && (
        <>
          <h1>ตะกร้าของร้าน</h1>
          {!cart.length ? (
            <section className="basket-empty" aria-label="ตะกร้าว่าง">
              <ShoppingBasket size={32} aria-hidden="true"/><h2>ตะกร้ายังว่างอยู่</h2>
              <p>เลือกล็อตจากสวนเพื่อดูยอดสินค้าและค่าจัดส่งของแต่ละสวน</p>
              <button type="button" onClick={() => setTab("market")}>ไปเลือกผลผลิต <ArrowRight size={16} aria-hidden="true"/></button>
            </section>
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
    </fieldset>
    </main></>
  );
}
