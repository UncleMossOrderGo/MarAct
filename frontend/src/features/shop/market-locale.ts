import { useState } from 'react';

export type MarketLocale = 'th' | 'en';

const storageKey = 'maract.idea-a.locale';

export const marketCopy = {
  th: {
    today: 'เทรนด์วันนี้', marketplace: 'ตลาดวัตถุดิบ', stock: 'สต็อกร้าน', orders: 'คำสั่งซื้อ', settings: 'ตั้งค่า',
    navigation: 'เมนูหลัก', activeShop: 'ร้านที่ใช้งาน', search: 'ค้นหาวัตถุดิบ', cart: 'ตะกร้า',
    loading: 'กำลังโหลด', retry: 'ลองอีกครั้ง', loadError: 'โหลดข้อมูลไม่สำเร็จ',
    available: 'มีสินค้า', unavailable: 'ไม่มีสินค้า', placeOrder: 'สั่งซื้อ', orderSaved: 'บันทึกคำสั่งซื้อแล้ว',
    language: 'ภาษา', orderHistory: 'ประวัติคำสั่งซื้อ', orderIngredients: 'สั่งซื้อวัตถุดิบ',
  },
  en: {
    today: 'Today’s Trends', marketplace: 'Marketplace', stock: 'Shop stock', orders: 'Orders', settings: 'Settings',
    navigation: 'Marketplace navigation', activeShop: 'Active shop', search: 'Search ingredients', cart: 'Cart',
    loading: 'Loading', retry: 'Retry', loadError: 'Could not load the data',
    available: 'In stock', unavailable: 'Unavailable', placeOrder: 'Place order', orderSaved: 'Order saved',
    language: 'Language', orderHistory: 'Order history', orderIngredients: 'Order Ingredients',
  },
} as const;

export function useMarketLanguage() {
  const [locale, setLanguage] = useState<MarketLocale>(() =>
    localStorage.getItem(storageKey) === 'en' ? 'en' : 'th',
  );

  function setLocale(next: MarketLocale) {
    localStorage.setItem(storageKey, next);
    setLanguage(next);
  }

  return { locale, setLocale };
}
