import type { Metadata } from "next";
import QuoteTool from "@/components/quote/QuoteTool";
import { publicClient } from "@/lib/supabase/public";
import { loadCatalog } from "@/lib/orders";
import { getSite } from "@/lib/site";

export const metadata: Metadata = { title: "Instant 3D printing quote", description: "Upload an STL and get a GST-ready 3D printing price in seconds." };
export const dynamic = "force-dynamic";

export default async function QuotePage() {
  const [{ materials, tiers }, { settings }] = await Promise.all([loadCatalog(publicClient() as any), getSite()]);
  return (
    <main className="wrap page">
      <div className="blk-head" style={{ marginBottom: 0 }}>
        <span className="eyebrow">Instant quote</span>
        <h2>Drop your file. Get a price in seconds.</h2>
        <p className="lede">Your file is measured in your browser and saved to a private vault. Only you, our engineers and your assigned print partner can open it.</p>
      </div>
      {!settings.accepting_orders && <div className="alert">{settings.paused_message}</div>}
      <QuoteTool materials={materials} tiers={tiers} fees={{ shipping: settings.shipping_inr, express: settings.express_inr, expressOn: settings.express_enabled, expressHours: settings.express_max_print_hours }} />
    </main>
  );
}
