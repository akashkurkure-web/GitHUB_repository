const STEPS: [string, string][] = [["paid", "Paid"], ["in_production", "Printing"], ["qc_passed", "QC passed"], ["packed", "Packed"], ["shipped", "Shipped"], ["out_for_delivery", "Out for delivery"], ["delivered", "Delivered"]];
const RANK = ["draft", "pending_payment", "proforma_issued", "paid", "in_production", "qc_passed", "packed", "shipped", "out_for_delivery", "delivered"];
export default function Timeline({ status }: { status: string }) {
  if (["cancelled", "refunded", "rto_delivered"].includes(status)) return null;
  const r = RANK.indexOf(status);
  return (
    <div className="timeline">
      {STEPS.map(([k, t]) => { const i = RANK.indexOf(k); return <div key={k} className={i < r ? "done" : i === r ? "now" : ""}>{t}</div>; })}
    </div>
  );
}
