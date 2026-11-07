/**
 * R7: when Hatly itself makes a product available (Admin activate, Admin bulk "Make available", an Admin Excel import), that IS Hatly's
 * approval — a vendor's product still waiting (PENDING) or REJECTED becomes APPROVED, and its pending new-product review is closed as
 * approved. Without this a product could be live in search/home while still marked as waiting. Vendor paths never reach this for a
 * product that is not approved (they are refused or only record the wish first).
 */
export async function approveOnHatlyActivation(db: { query: (sql: string, params?: unknown[]) => Promise<unknown> }, productId: string): Promise<void> {
  await db.query(`UPDATE products SET approval_status = 'APPROVED' WHERE id = $1 AND approval_status <> 'APPROVED'`, [productId]);
  await db.query(
    `UPDATE product_change_requests SET status = 'APPROVED', decided_at = now(), decision_note = 'Made available directly by Hatly', updated_at = now()
      WHERE product_id = $1 AND kind = 'NEW_PRODUCT' AND status = 'PENDING'`,
    [productId],
  );
}
