const ALL = ['pos', 'print', 'orders.edit', 'menu', 'tables', 'kitchen', 'reports', 'inventory', 'users.manage', 'audit.view', 'settings', 'discount', 'tables.manage', 'kitchen.view', 'shift', 'customers', 'reservations', 'giftcards', 'crm.manage', 'qrmenu', 'delivery', 'delivery.manage'];
const ROLES = {
  owner: ALL,
  manager: ['pos', 'print', 'orders.edit', 'menu', 'tables', 'kitchen', 'reports', 'inventory', 'users.manage', 'audit.view', 'discount', 'tables.manage', 'kitchen.view', 'shift', 'customers', 'reservations', 'giftcards', 'crm.manage', 'qrmenu', 'delivery', 'delivery.manage'],
  cashier: ['pos', 'print', 'tables', 'shift', 'customers', 'reservations', 'giftcards', 'delivery'],
  accountant: ['reports', 'audit.view'],
  kitchen: ['kitchen.view'],
  waiter: ['pos', 'tables'],
};
const ROLE_LABELS = { owner: 'مالك', manager: 'مدير فرع', cashier: 'كاشير', accountant: 'محاسب', kitchen: 'مطبخ', waiter: 'نادل' };
const can = (role, perm) => (ROLES[role] || []).includes(perm);
module.exports = { ROLES, can };
