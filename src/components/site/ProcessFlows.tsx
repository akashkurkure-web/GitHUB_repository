"use client";
import { useEffect, useState } from "react";

const IC: Record<string, string> = {
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18"/>',
  print: '<rect x="4" y="3" width="16" height="6" rx="1"/><path d="M8 9v4h8V9M6 21h12M9 17h6"/>',
  scale: '<path d="M4 20h16M6 20l2-9h8l2 9"/><circle cx="12" cy="7" r="3"/>',
  truck: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  check: '<path d="M5 12l4 4 10-10"/>',
  inbox: '<path d="M4 13l3-8h10l3 8v6H4z"/><path d="M4 13h5l1 2h4l1-2h5"/>',
  hand: '<path d="M7 11V6a2 2 0 0 1 4 0v5M11 10V5a2 2 0 0 1 4 0v6M15 11V8a2 2 0 0 1 4 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-3-5a2 2 0 0 1 3-2l1 1"/>',
  brush: '<path d="M14 4l6 6-8 8H6v-6z"/><path d="M4 20h6"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  bank: '<path d="M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18"/>',
  quote: '<path d="M4 4h16v12H8l-4 4z"/><path d="M8 9h8M8 12h5"/>',
};
const FLOWS: Record<string, [string, string, string, string][]> = {
  customer: [["upload", "c-blue", "Upload STL", "Instant price and design checks"], ["pay", "c-teal", "Pay securely", "UPI, card or netbanking via Razorpay"], ["print", "c-orange", "Printing", "Partner accepts within 4 hours"], ["scale", "c-amber", "Weighed QC", "Photo on a calibrated scale"], ["truck", "c-rose", "Shipped", "Tracking on WhatsApp, same-day in MMR"], ["check", "c-green", "Delivered", "48-hour reprint warranty starts"]],
  vendor: [["inbox", "c-blue", "Job queued", "Job card with material and infill"], ["hand", "c-teal", "Accepted", "Within 4 working hours"], ["print", "c-orange", "Printing", "Sliced to spec, no shortcuts"], ["brush", "c-amber", "Post-processing", "Supports off, resin washed and cured"], ["box", "c-rose", "QC and pack", "Weigh, photo, plain box"], ["truck", "c-green", "Handed over", "Courier scan, payout next Monday"]],
  b2b: [["quote", "c-blue", "Request quote", "Upload files, add GSTIN and PO"], ["doc", "c-teal", "Proforma issued", "Download a GST proforma instantly"], ["bank", "c-orange", "NEFT or credit", "Pay by bank or use your credit line"], ["print", "c-amber", "Production", "Batch nested across printers"], ["doc", "c-rose", "Tax invoice", "Sequential MH invoice, ITC ready"], ["check", "c-green", "Monthly statement", "Consolidated for your accounts team"]],
};

export default function ProcessFlows() {
  const [key, setKey] = useState("customer");
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setStep((s) => (s + 1) % 6), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="tabs" role="tablist">
        {[["customer", "Your order"], ["vendor", "On the shop floor"], ["b2b", "Company purchase"]].map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={key === k} onClick={() => { setKey(k); setStep(0); }}>{t}</button>
        ))}
      </div>
      <div className="flow">
        {FLOWS[key].map(([ic, c, t, d], i) => (
          <div key={t + i} className={`step ${c}${i === step ? " on" : ""}`}>
            <div className="ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: IC[ic] }} /></div>
            <span className="k">STEP {i + 1}</span><h3>{t}</h3><p>{d}</p>
          </div>
        ))}
      </div>
    </>
  );
}
