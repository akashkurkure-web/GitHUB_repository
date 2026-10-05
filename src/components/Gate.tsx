import { can, MODULES, type Module } from "@/lib/permissions";

/** Wraps a back-office page: staff without write access see everything greyed out and read-only. */
export default function Gate({ perms, m, children }: { perms: string[]; m: Module; children: React.ReactNode }) {
  const ok = can(perms, m);
  return (
    <>
      {!ok && <div className="notice">View only. Your access doesn&apos;t include <b>{MODULES[m].label}</b>. Ask an owner under Team &amp; access if you need to make changes.</div>}
      <fieldset disabled={!ok} className="gate">{children}</fieldset>
    </>
  );
}
