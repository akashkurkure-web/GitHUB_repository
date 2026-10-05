import { label, tone } from "@/lib/format";
export default function Pill({ s }: { s: string | null | undefined }) {
  if (!s) return <span className="muted">—</span>;
  return <span className={`pill ${tone(s)}`}>{label(s)}</span>;
}
