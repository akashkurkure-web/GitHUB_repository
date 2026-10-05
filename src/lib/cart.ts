"use client";
import type { ItemConfig } from "@/lib/pricing";

export type CartItem = {
  key: string;
  cad_asset_id: string;
  catalog_product_id?: string | null;
  file_name: string;
  volume_cm3: number;
  bbox_mm: [number, number, number];
  watertight: boolean | null;
  config: ItemConfig;
};
const K = "l27_cart_v1";
export function readCart(): CartItem[] {
  try { return JSON.parse(localStorage.getItem(K) || "[]"); } catch { return []; }
}
export function writeCart(items: CartItem[]) {
  try { localStorage.setItem(K, JSON.stringify(items)); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("l27-cart"));
}
export function addToCart(item: CartItem) { writeCart([...readCart(), item]); }
export function clearCart() { writeCart([]); }
