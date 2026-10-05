/** Back-office modules. Shared by the database (has_perm) and the app. */
export const MODULES = {
  orders: { label: "Orders & documents", desc: "Change order status, mark NEFT paid, tracking, cancel and refund" },
  production: { label: "Production & partners", desc: "Assign print partners, vendor jobs, partner accounts" },
  support: { label: "Support & claims", desc: "Tickets and warranty claims, approve reprints" },
  customers: { label: "Customers", desc: "Edit customer details, verify GSTIN, wallet adjustments" },
  finance: { label: "Finance", desc: "B2B credit, repayments, partner payouts (also needed to see them)" },
  marketing: { label: "Marketing", desc: "Coupons, reviews and review rewards" },
  catalog: { label: "Products & pricing", desc: "Shop products, materials, colours, rates, batch tiers" },
  content: { label: "Website content", desc: "Homepage text, FAQ, announcement bar, policy pages" },
  settings: { label: "Business settings", desc: "GSTIN, legal name, fees, payment options, pause orders" },
  team: { label: "Team & access", desc: "Invite staff and change what they can do (also needed to see the team)" },
  audit: { label: "Audit log", desc: "See every change made in the back office" },
} as const;
export type Module = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as Module[];

export const PRESETS: Record<string, { label: string; perms: (Module | "*")[]; desc: string }> = {
  owner: { label: "Owner", perms: ["*"], desc: "Everything, including team and audit" },
  operations: { label: "Operations manager", perms: ["orders", "production", "support", "customers"], desc: "Runs daily orders, partners and support" },
  finance: { label: "Accountant", perms: ["finance", "orders", "audit"], desc: "Payments, credit, payouts and invoices" },
  support_agent: { label: "Support agent", perms: ["support"], desc: "Answers tickets and claims; can view orders" },
  content_editor: { label: "Content editor", perms: ["content", "catalog", "marketing"], desc: "Website text, products, prices and coupons" },
  custom: { label: "Custom", perms: [], desc: "Pick modules one by one" },
};

export function can(perms: string[] | null | undefined, m: Module) {
  return Boolean(perms && (perms.includes("*") || perms.includes(m)));
}
