'use strict';
/**
 * Staff roles in the admin portal and what each one can open.
 *  - owner: everything, including staff accounts and the audit log.
 *  - manager: runs the store day to day (orders, catalog, sellers, deliveries, payouts, marketing), but cannot
 *    manage staff or read the audit log.
 *  - support: helps buyers. Reads orders, customers and messages; answers help desk requests and handles returns.
 */
const ROLES = ['owner', 'manager', 'support'];

const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', support: 'Support' };

// Every portal section, in menu order, with the /api/admin paths it uses.
const SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', group: 'Overview', api: ['stats'] },
  { key: 'orders', label: 'Orders', group: 'Sales', api: ['orders'] },
  { key: 'returns', label: 'Returns', group: 'Sales', api: ['returns'] },
  { key: 'express', label: 'Express', group: 'Delivery', api: ['express'] },
  { key: 'riders', label: 'Riders', group: 'Delivery', api: ['riders'] },
  { key: 'products', label: 'Products', group: 'Catalog', api: ['products', 'uploads'] },
  { key: 'qc', label: 'Catalog check', group: 'Catalog', api: ['qc'] },
  { key: 'sellers', label: 'Sellers', group: 'Partners', api: ['sellers'] },
  { key: 'resellers', label: 'Resellers', group: 'Partners', api: ['resellers'] },
  { key: 'claims', label: 'Claims', group: 'Partners', api: ['claims'] },
  { key: 'settlement', label: 'Settlement', group: 'Partners', api: ['settlement'] },
  { key: 'sales', label: 'Sale events', group: 'Marketing', api: ['sales', 'winback'] },
  { key: 'coupons', label: 'Coupons', group: 'Marketing', api: ['coupons'] },
  { key: 'plus', label: 'Plus members', group: 'Marketing', api: ['plus'] },
  { key: 'ads', label: 'Ads', group: 'Marketing', api: ['ads'] },
  { key: 'helpdesk', label: 'Help desk', group: 'Customers', api: ['tickets'] },
  { key: 'customers', label: 'Customers', group: 'Customers', api: ['users'] },
  { key: 'messages', label: 'Messages sent', group: 'Customers', api: ['messages'] },
  { key: 'reports', label: 'Reports', group: 'Insights', api: ['reports'] },
  { key: 'staff', label: 'Staff and roles', group: 'Settings', api: ['staff'] },
  { key: 'audit', label: 'Audit log', group: 'Settings', api: ['audit'] },
];

const ACCESS = {
  owner: { read: SECTIONS.map((s) => s.key), write: SECTIONS.map((s) => s.key) },
  manager: {
    read: SECTIONS.map((s) => s.key).filter((k) => !['staff', 'audit'].includes(k)),
    write: SECTIONS.map((s) => s.key).filter((k) => !['staff', 'audit'].includes(k)),
  },
  support: { read: ['dashboard', 'orders', 'returns', 'helpdesk', 'customers', 'messages'], write: ['returns', 'helpdesk'] },
};

const sectionOfApi = new Map(SECTIONS.flatMap((s) => s.api.map((a) => [a, s.key])));

/** The sections a staff role sees in the menu. */
const sectionsFor = (role) => SECTIONS.filter((s) => (ACCESS[role] || { read: [] }).read.includes(s.key));

/** Whether `role` may call `method` on /api/admin/<first>/... */
function can(role, method, first) {
  const access = ACCESS[role];
  const section = sectionOfApi.get(first);
  if (!access || !section) return false;
  return ['GET', 'HEAD'].includes(method) ? access.read.includes(section) : access.write.includes(section);
}

module.exports = { ROLES, ROLE_LABEL, SECTIONS, sectionsFor, can };
