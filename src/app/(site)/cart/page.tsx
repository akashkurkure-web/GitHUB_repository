"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readCart, writeCart, type CartItem } from "@/lib/cart";

export default function CartPage() {
  const [items, setItems] = useState<CartItem[] | null>(null);
  useEffect(() => setItems(readCart()), []);
  const save = (next: CartItem[]) => { setItems(next); writeCart(next); };
  if (items === null) return <main className="wrap page"><h1>Your cart</h1></main>;
  return (
    <main className="wrap page">
      <div className="head"><div><h1>Your cart</h1><p className="muted">Final prices, discounts and GST are confirmed at checkout.</p></div><Link className="btn ghost" href="/quote">Add another part</Link></div>
      {items.length === 0 ? (
        <div className="card empty">Your cart is empty. <Link href="/quote">Upload an STL to get started.</Link></div>
      ) : (
        <>
          <div className="tw"><table>
            <thead><tr><th>Part</th><th>Material</th><th>Settings</th><th>Quantity</th><th /></tr></thead>
            <tbody>{items.map((it, i) => (
              <tr key={it.key}>
                <td><b>{it.file_name}</b><div className="muted mono">{it.bbox_mm.map((v) => v.toFixed(1)).join(" × ")} mm · {it.volume_cm3.toFixed(2)} cm³</div></td>
                <td>{it.config.selection_mode === "manual_user" ? it.config.material.replace("_", " ") : it.config.selection_mode === "ai_recommended" ? "Recommended" : "Engineer decides"} · {it.config.color}</td>
                <td className="mono">{it.config.layer} mm{it.config.material.includes("resin") ? "" : ` · ${it.config.infill}%`}</td>
                <td><input type="number" min={1} max={5000} value={it.config.quantity} style={{ width: 90 }}
                  onChange={(e) => { const n = [...items]; n[i] = { ...it, config: { ...it.config, quantity: Math.max(1, Number(e.target.value) || 1) } }; save(n); }} /></td>
                <td><button className="btn sm ghost" onClick={() => save(items.filter((x) => x.key !== it.key))}>Remove</button></td>
              </tr>))}</tbody>
          </table></div>
          <div className="row" style={{ justifyContent: "flex-end" }}><Link className="btn lg" href="/checkout">Continue to checkout</Link></div>
        </>
      )}
    </main>
  );
}
