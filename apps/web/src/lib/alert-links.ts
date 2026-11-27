// Where each kind of alert is fixed, so an alert's title can take you there.
export const ALERT_HREF: Record<string, string> = {
  "new-subscription": "/bills",
  "price-increase": "/bills",
  "bill-due": "/bills",
  "large-charge": "/spending",
  "budget-over": "/budgets",
  "budget-near": "/budgets",
  "low-balance": "/safe-to-spend",
  "overdraft-risk": "/safe-to-spend#moves",
  "move-not-seen": "/safe-to-spend#moves",
  "spending-pace": "/safe-to-spend",
};
