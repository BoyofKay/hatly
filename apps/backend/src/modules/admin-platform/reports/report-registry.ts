import { Permission } from '../../permissions/permission.enum';
import { addCairoRange, assertDate, assertMaxRange, assertUuid, REPORTING_TIMEZONE } from '../common/platform-sql';
import { ReportDefinition, ReportParam } from './report-types';

const P = Permission;
const TZ = REPORTING_TIMEZONE;
const dt = (col: string) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:MI')`;
const d = (col: string) => `to_char(${col} AT TIME ZONE '${TZ}', 'YYYY-MM-DD')`;

const RANGE: ReportParam[] = [
  { key: 'from', type: 'date', en: 'From', ar: 'من' },
  { key: 'to', type: 'date', en: 'To', ar: 'إلى' },
];
const GRANULARITY: ReportParam = { key: 'granularity', type: 'enum', en: 'Group by', ar: 'تجميع حسب', options: ['day', 'week', 'month'] };

/** Every report must have a bounded range: the model of "everything, ever" is how an export brings a database down. */
function range(params: Record<string, string>, col: string, values: unknown[], where: string[], maxDays = 366): void {
  const from = assertDate(params.from, 'from');
  const to = assertDate(params.to, 'to');
  assertMaxRange(from, to, maxDays);
  addCairoRange(where, values, col, from, to);
}
const gran = (params: Record<string, string>): 'day' | 'week' | 'month' => (['day', 'week', 'month'].includes(params.granularity) ? (params.granularity as 'day' | 'week' | 'month') : 'day');
const clause = (where: string[]) => (where.length ? `WHERE ${where.join(' AND ')}` : '');

/**
 * THE report catalogue. A report is defined ONCE here (columns, permissions, SQL); the Dashboard preview, CSV / XLSX / PDF exports and
 * the scheduled/queued jobs all run this same definition — so a figure can never differ between the screen and the file.
 * Money is always integer minor units in SQL; writers render it as a 2-decimal number. Dates are Africa/Cairo calendar values.
 */
export const REPORTS: ReportDefinition[] = [
  {
    id: 'S01', family: 'EXECUTIVE', en: 'Executive summary', ar: 'الملخص التنفيذي',
    descriptionEn: 'The headline KPIs of the period, each with the previous period for comparison.', descriptionAr: 'مؤشرات الأداء الرئيسية للفترة مع مقارنة بالفترة السابقة.',
    view: [P.VIEW_REPORTS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.REPORTS_EXPORT,
    params: RANGE,
    columns: [
      { key: 'kpi', en: 'KPI', ar: 'المؤشر', type: 'text' },
      { key: 'value', en: 'Value', ar: 'القيمة', type: 'text' },
      { key: 'previous', en: 'Previous period', ar: 'الفترة السابقة', type: 'text' },
      { key: 'deltaPct', en: 'Change %', ar: 'التغيير %', type: 'percent' },
    ],
    rows: undefined, // supplied by ReportRunner (needs ExecutiveService)
  },
  {
    id: 'S02', family: 'SALES', en: 'Orders', ar: 'الطلبات',
    descriptionEn: 'Every order placed in the period with its money, payment and cancellation facts.', descriptionAr: 'كل طلب في الفترة مع بياناته المالية والدفع والإلغاء.',
    view: [P.VIEW_REPORTS, P.VIEW_ORDERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.ORDERS_EXPORT, maxRows: 100000,
    params: [...RANGE, { key: 'status', type: 'enum', en: 'Status', ar: 'الحالة', options: ['PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED_TO_DRIVER', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'FAILED_DELIVERY', 'COLLECTED'] }, { key: 'paymentMethod', type: 'text', en: 'Payment method', ar: 'طريقة الدفع' }, { key: 'vendorBranchId', type: 'uuid', en: 'Vendor branch', ar: 'فرع المورد' }],
    columns: [
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'createdAt', en: 'Placed (Cairo)', ar: 'وقت الطلب (القاهرة)', type: 'datetime' },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'enum' },
      { key: 'paymentMethod', en: 'Payment', ar: 'الدفع', type: 'enum' },
      { key: 'customerName', en: 'Customer', ar: 'العميل', type: 'text', pii: 'name' },
      { key: 'customerPhone', en: 'Phone', ar: 'الهاتف', type: 'text', pii: 'phone' },
      { key: 'vendors', en: 'Vendors', ar: 'الموردون', type: 'text' },
      { key: 'subtotalMinor', en: 'Subtotal', ar: 'المجموع الفرعي', type: 'money', total: 'sum' },
      { key: 'discountMinor', en: 'Discount', ar: 'الخصم', type: 'money', total: 'sum' },
      { key: 'deliveryFeeMinor', en: 'Delivery fee', ar: 'رسوم التوصيل', type: 'money', total: 'sum' },
      { key: 'totalMinor', en: 'Total', ar: 'الإجمالي', type: 'money', total: 'sum' },
      { key: 'cancelledBy', en: 'Cancelled by', ar: 'ألغاه', type: 'text' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'o.created_at', v, w);
      if (p.status) { v.push(p.status); w.push(`o.status = $${v.length}`); }
      if (p.paymentMethod) { v.push(p.paymentMethod); w.push(`o.payment_method = $${v.length}`); }
      const branch = assertUuid(p.vendorBranchId, 'vendorBranchId');
      if (branch) { v.push(branch); w.push(`EXISTS (SELECT 1 FROM order_vendor_segments f WHERE f.order_id = o.id AND f.vendor_branch_id = $${v.length})`); }
      return {
        sql: `SELECT o.order_number AS "orderNumber", ${dt('o.created_at')} AS "createdAt", o.status AS status, o.payment_method AS "paymentMethod", u.full_name AS "customerName", u.phone AS "customerPhone",
                (SELECT string_agg(DISTINCT coalesce(s.vendor_name_snapshot, s.branch_name_snapshot), ', ') FROM order_vendor_segments s WHERE s.order_id = o.id) AS vendors,
                o.subtotal_minor AS "subtotalMinor", o.discount_minor AS "discountMinor", o.delivery_fee_minor AS "deliveryFeeMinor", o.total_minor AS "totalMinor", o.cancelled_by_role AS "cancelledBy"
              FROM orders o LEFT JOIN users u ON u.id = o.customer_id ${clause(w)} ORDER BY o.created_at DESC, o.id`,
        values: v,
      };
    },
  },
  {
    id: 'S03', family: 'SALES', en: 'Order lines and product sales', ar: 'بنود الطلبات ومبيعات المنتجات',
    descriptionEn: 'Each ordered item with vendor, quantity and amount (cancelled parts excluded).', descriptionAr: 'كل صنف مطلوب مع المورد والكمية والمبلغ (دون الأجزاء الملغاة).',
    view: [P.VIEW_REPORTS, P.VIEW_ORDERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.ORDERS_EXPORT, maxRows: 100000,
    params: [...RANGE, { key: 'vendorBranchId', type: 'uuid', en: 'Vendor branch', ar: 'فرع المورد' }],
    columns: [
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'createdAt', en: 'Placed (Cairo)', ar: 'وقت الطلب (القاهرة)', type: 'datetime' },
      { key: 'vendor', en: 'Vendor', ar: 'المورد', type: 'text' },
      { key: 'product', en: 'Item', ar: 'الصنف', type: 'text' },
      { key: 'quantity', en: 'Quantity', ar: 'الكمية', type: 'int', total: 'sum' },
      { key: 'unitPriceMinor', en: 'Unit price', ar: 'سعر الوحدة', type: 'money' },
      { key: 'lineTotalMinor', en: 'Line total', ar: 'إجمالي البند', type: 'money', total: 'sum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`s.status <> 'CANCELLED'`];
      range(p, 'o.created_at', v, w);
      const branch = assertUuid(p.vendorBranchId, 'vendorBranchId');
      if (branch) { v.push(branch); w.push(`s.vendor_branch_id = $${v.length}`); }
      w.push('i.removed_at IS NULL'); // items taken off the order as unavailable (PD-016) were never sold
      return {
        sql: `SELECT o.order_number AS "orderNumber", ${dt('o.created_at')} AS "createdAt", coalesce(s.vendor_name_snapshot, s.branch_name_snapshot) AS vendor,
                coalesce(i.product_name_snapshot, i.free_text_description_snapshot, '—') AS product, i.quantity AS quantity, i.unit_price_minor AS "unitPriceMinor",
                coalesce(i.final_amount_minor, i.actual_amount_minor, i.unit_price_minor * i.quantity, 0) AS "lineTotalMinor"
              FROM order_items i JOIN order_vendor_segments s ON s.id = i.order_vendor_segment_id JOIN orders o ON o.id = s.order_id ${clause(w)} ORDER BY o.created_at DESC, i.id`,
        values: v,
      };
    },
  },
  {
    id: 'S04', family: 'SALES', en: 'Sales by period', ar: 'المبيعات حسب الفترة',
    descriptionEn: 'Orders, cancellations, gross merchandise value and average order value per day, week or month (Cairo).', descriptionAr: 'الطلبات والإلغاءات وإجمالي قيمة البضائع ومتوسط قيمة الطلب لكل يوم أو أسبوع أو شهر (القاهرة).',
    view: [P.VIEW_REPORTS, P.VIEW_ORDERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.ORDERS_EXPORT,
    params: [...RANGE, GRANULARITY],
    columns: [
      { key: 'bucket', en: 'Period', ar: 'الفترة', type: 'date' },
      { key: 'orders', en: 'Orders', ar: 'الطلبات', type: 'int', total: 'sum' },
      { key: 'cancelled', en: 'Cancelled', ar: 'الملغاة', type: 'int', total: 'sum' },
      { key: 'gmvMinor', en: 'GMV (goods value)', ar: 'قيمة البضائع', type: 'money', total: 'sum' },
      { key: 'aovMinor', en: 'Avg order value', ar: 'متوسط قيمة الطلب', type: 'money' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'o.created_at', v, w);
      const g = gran(p);
      return {
        sql: `SELECT to_char(date_trunc('${g}', o.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS bucket, count(*)::int AS orders, count(*) FILTER (WHERE o.status = 'CANCELLED')::int AS cancelled,
                coalesce(sum(g.gmv), 0)::bigint AS "gmvMinor",
                CASE WHEN count(*) FILTER (WHERE o.status <> 'CANCELLED') > 0 THEN (coalesce(sum(g.gmv), 0) / count(*) FILTER (WHERE o.status <> 'CANCELLED'))::bigint ELSE 0 END AS "aovMinor"
              FROM orders o LEFT JOIN LATERAL (SELECT sum(s.subtotal_minor) AS gmv FROM order_vendor_segments s WHERE s.order_id = o.id AND s.status <> 'CANCELLED') g ON true ${clause(w)} GROUP BY 1 ORDER BY 1`,
        values: v,
      };
    },
  },
  {
    id: 'S05', family: 'SALES', en: 'Vendor and branch performance', ar: 'أداء الموردين والفروع',
    descriptionEn: 'Per branch: parts received, rejected, gross sales, commission recognised and rating.', descriptionAr: 'لكل فرع: الأجزاء المستلمة والمرفوضة والمبيعات الإجمالية والعمولة المعترف بها والتقييم.',
    view: [P.VIEW_REPORTS], moneyPermission: P.VIEW_VENDOR_FINANCIAL_REPORTS, exportPermission: P.ORDERS_EXPORT,
    params: RANGE,
    columns: [
      { key: 'vendor', en: 'Vendor', ar: 'المورد', type: 'text' },
      { key: 'branch', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'received', en: 'Parts received', ar: 'الأجزاء المستلمة', type: 'int', total: 'sum' },
      { key: 'rejected', en: 'Rejected', ar: 'المرفوضة', type: 'int', total: 'sum' },
      { key: 'rejectionRate', en: 'Rejection %', ar: 'نسبة الرفض %', type: 'percent' },
      { key: 'grossSalesMinor', en: 'Gross sales', ar: 'إجمالي المبيعات', type: 'money', total: 'sum' },
      { key: 'commissionMinor', en: 'Commission recognised', ar: 'العمولة المعترف بها', type: 'money', total: 'sum' },
      { key: 'rating', en: 'Rating', ar: 'التقييم', type: 'text' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`s.group_type = 'CATALOG'`];
      range(p, 's.created_at', v, w);
      const cw: string[] = []; const cv: unknown[] = [];
      void cw; void cv;
      const evWhere: string[] = [];
      const from = assertDate(p.from, 'from'); const to = assertDate(p.to, 'to');
      if (from) { v.push(from); evWhere.push(`e.created_at >= (($${v.length}::date)::timestamp AT TIME ZONE '${TZ}')`); }
      if (to) { v.push(to); evWhere.push(`e.created_at < ((($${v.length}::date + 1))::timestamp AT TIME ZONE '${TZ}')`); }
      return {
        sql: `SELECT ven.name AS vendor, b.name AS branch, count(*)::int AS received, count(*) FILTER (WHERE s.status = 'CANCELLED')::int AS rejected,
                round(100.0 * count(*) FILTER (WHERE s.status = 'CANCELLED') / nullif(count(*), 0), 1) AS "rejectionRate",
                coalesce(sum(s.subtotal_minor) FILTER (WHERE s.status <> 'CANCELLED'), 0)::bigint AS "grossSalesMinor",
                coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.vendor_branch_id = b.id AND e.type = 'VENDOR_COMMISSION_RECOGNIZED' ${evWhere.length ? `AND ${evWhere.join(' AND ')}` : ''}), 0)::bigint AS "commissionMinor",
                CASE WHEN b.rating_count > 0 THEN round(b.rating_sum_stars::numeric / b.rating_count, 2)::text || ' (' || b.rating_count || ')' ELSE '—' END AS rating
              FROM order_vendor_segments s JOIN vendor_branches b ON b.id = s.vendor_branch_id JOIN vendors ven ON ven.id = b.vendor_id ${clause(w)} GROUP BY ven.name, b.id, b.name ORDER BY "grossSalesMinor" DESC, b.name`,
        values: v,
      };
    },
  },
  {
    id: 'S06', family: 'CUSTOMERS', en: 'Customers', ar: 'العملاء',
    descriptionEn: 'Registered customers with order counts and last order (registration date range).', descriptionAr: 'العملاء المسجلون مع عدد الطلبات وآخر طلب (حسب تاريخ التسجيل).',
    view: [P.VIEW_REPORTS, P.VIEW_CUSTOMERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.CUSTOMERS_EXPORT, maxRows: 100000,
    params: RANGE,
    columns: [
      { key: 'name', en: 'Customer', ar: 'العميل', type: 'text', pii: 'name' },
      { key: 'phone', en: 'Phone', ar: 'الهاتف', type: 'text', pii: 'phone' },
      { key: 'registeredAt', en: 'Registered (Cairo)', ar: 'تاريخ التسجيل (القاهرة)', type: 'datetime' },
      { key: 'orders', en: 'Orders', ar: 'الطلبات', type: 'int', total: 'sum' },
      { key: 'delivered', en: 'Delivered', ar: 'المسلمة', type: 'int', total: 'sum' },
      { key: 'lastOrderAt', en: 'Last order (Cairo)', ar: 'آخر طلب (القاهرة)', type: 'datetime' },
      { key: 'active', en: 'Active', ar: 'نشط', type: 'bool' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`u.role = 'CUSTOMER'`, 'u.deleted_at IS NULL'];
      range(p, 'u.created_at', v, w, 3660);
      return {
        sql: `SELECT u.full_name AS name, u.phone AS phone, ${dt('u.created_at')} AS "registeredAt", count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.status IN ('DELIVERED','COLLECTED'))::int AS delivered,
                ${dt('max(o.created_at)')} AS "lastOrderAt", u.is_active AS active FROM users u LEFT JOIN orders o ON o.customer_id = u.id ${clause(w)} GROUP BY u.id ORDER BY u.created_at DESC, u.id`,
        values: v,
      };
    },
  },
  {
    id: 'S07', family: 'CATALOG', en: 'Products and inventory', ar: 'المنتجات والمخزون',
    descriptionEn: 'Every product with price, stock and stock state.', descriptionAr: 'كل المنتجات مع السعر والمخزون وحالته.',
    view: [P.VIEW_REPORTS, P.CATALOG_VIEW], moneyPermission: P.CATALOG_VIEW, exportPermission: P.CATALOG_EXPORT, maxRows: 100000,
    params: [{ key: 'vendorBranchId', type: 'uuid', en: 'Vendor branch', ar: 'فرع المورد' }, { key: 'state', type: 'enum', en: 'Stock state', ar: 'حالة المخزون', options: ['OUT', 'LOW', 'OK', 'UNLIMITED'] }],
    columns: [
      { key: 'vendor', en: 'Vendor', ar: 'المورد', type: 'text' },
      { key: 'branch', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'product', en: 'Product', ar: 'المنتج', type: 'text' },
      { key: 'priceMinor', en: 'Price', ar: 'السعر', type: 'money' },
      { key: 'inventoryMode', en: 'Inventory', ar: 'المخزون', type: 'enum' },
      { key: 'quantity', en: 'Quantity', ar: 'الكمية', type: 'int' },
      { key: 'state', en: 'Stock state', ar: 'حالة المخزون', type: 'enum' },
      { key: 'active', en: 'Available', ar: 'متاح', type: 'bool' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = ['pr.deleted_at IS NULL'];
      const branch = assertUuid(p.vendorBranchId, 'vendorBranchId');
      if (branch) { v.push(branch); w.push(`pr.vendor_branch_id = $${v.length}`); }
      const stateSql = `CASE WHEN pr.inventory_mode <> 'TRACKED' THEN 'UNLIMITED' WHEN pr.quantity <= 0 THEN 'OUT' WHEN pr.quantity <= coalesce(pr.low_stock_threshold, 5) THEN 'LOW' ELSE 'OK' END`;
      if (p.state) { v.push(p.state); w.push(`${stateSql} = $${v.length}`); }
      return {
        sql: `SELECT ven.name AS vendor, b.name AS branch, pr.name AS product, pr.price_minor AS "priceMinor", pr.inventory_mode AS "inventoryMode", pr.quantity AS quantity, ${stateSql} AS state, pr.is_available AS active
              FROM products pr JOIN vendor_branches b ON b.id = pr.vendor_branch_id JOIN vendors ven ON ven.id = b.vendor_id ${clause(w)} ORDER BY ven.name, b.name, pr.name`,
        values: v,
      };
    },
  },
  {
    id: 'S08', family: 'FLEET', en: 'Driver performance', ar: 'أداء السائقين',
    descriptionEn: 'Deliveries completed per driver with median delivery time and rating.', descriptionAr: 'التوصيلات المكتملة لكل سائق مع وسيط زمن التوصيل والتقييم.',
    view: [P.VIEW_REPORTS, P.FLEET_VIEW], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FLEET_EXPORT,
    params: RANGE,
    columns: [
      { key: 'driver', en: 'Driver', ar: 'السائق', type: 'text' },
      { key: 'deliveries', en: 'Deliveries', ar: 'التوصيلات', type: 'int', total: 'sum' },
      { key: 'medianMinutes', en: 'Median minutes (assigned → delivered)', ar: 'الوسيط بالدقائق (من التعيين للتسليم)', type: 'text' },
      { key: 'reassignments', en: 'Reassignments', ar: 'إعادة التعيين', type: 'int', total: 'sum' },
      { key: 'rating', en: 'Rating', ar: 'التقييم', type: 'text' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = ['dl.delivered_at IS NOT NULL'];
      range(p, 'dl.delivered_at', v, w);
      return {
        sql: `SELECT u.full_name AS driver, count(*)::int AS deliveries,
                round((percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (dl.delivered_at - dl.assigned_at)) / 60))::numeric, 1)::text AS "medianMinutes",
                coalesce(sum(dl.reassignment_count), 0)::int AS reassignments,
                CASE WHEN dr.rating_count > 0 THEN round(dr.rating_sum_stars::numeric / dr.rating_count, 2)::text || ' (' || dr.rating_count || ')' ELSE '—' END AS rating
              FROM deliveries dl JOIN drivers dr ON dr.id = dl.driver_id JOIN users u ON u.id = dr.user_id ${clause(w)} GROUP BY dr.id, u.full_name ORDER BY deliveries DESC, u.full_name`,
        values: v,
      };
    },
  },
  {
    id: 'S09', family: 'FINANCE', en: 'Ledger (financial events)', ar: 'دفتر الأستاذ (الأحداث المالية)',
    descriptionEn: 'Every financial event of the period, append-only.', descriptionAr: 'كل الأحداث المالية في الفترة (سجل لا يُعدَّل).',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT, maxRows: 200000,
    params: [...RANGE, { key: 'type', type: 'text', en: 'Event type', ar: 'نوع الحدث' }],
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'type', en: 'Type', ar: 'النوع', type: 'enum' },
      { key: 'direction', en: 'Direction', ar: 'الاتجاه', type: 'enum' },
      { key: 'amountMinor', en: 'Amount', ar: 'المبلغ', type: 'money', total: 'sum' },
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'branch', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'reason', en: 'Reason', ar: 'السبب', type: 'text' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'e.created_at', v, w);
      if (p.type) { v.push(p.type); w.push(`e.type = $${v.length}`); }
      return { sql: `SELECT ${dt('e.created_at')} AS "createdAt", e.type AS type, e.direction AS direction, e.amount_minor AS "amountMinor", o.order_number AS "orderNumber", b.name AS branch, e.reason AS reason FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id LEFT JOIN vendor_branches b ON b.id = e.vendor_branch_id ${clause(w)} ORDER BY e.created_at DESC, e.id`, values: v };
    },
  },
  {
    id: 'S10', family: 'FINANCE', en: 'Revenue and commissions', ar: 'الإيرادات والعمولات',
    descriptionEn: 'Hatly revenue = vendor commission + driver commission + service charge − net Hatly-funded discount. Gross sales are not revenue.', descriptionAr: 'إيراد حاتلي = عمولة الموردين + عمولة السائقين + رسوم الخدمة − صافي الخصم الممول من حاتلي. إجمالي المبيعات ليس إيرادًا.',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT,
    params: [...RANGE, GRANULARITY],
    columns: [
      { key: 'bucket', en: 'Period', ar: 'الفترة', type: 'date' },
      { key: 'vendorCommissionMinor', en: 'Vendor commission', ar: 'عمولة الموردين', type: 'money', total: 'sum' },
      { key: 'driverCommissionMinor', en: 'Driver commission', ar: 'عمولة السائقين', type: 'money', total: 'sum' },
      { key: 'serviceChargeMinor', en: 'Service charge', ar: 'رسوم الخدمة', type: 'money', total: 'sum' },
      { key: 'discountNetMinor', en: 'Hatly-funded discount (net)', ar: 'صافي الخصم الممول من حاتلي', type: 'money', total: 'sum' },
      { key: 'revenueMinor', en: 'Hatly revenue', ar: 'إيراد حاتلي', type: 'money', total: 'sum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'e.created_at', v, w);
      const g = gran(p);
      return {
        sql: `SELECT bucket, vc AS "vendorCommissionMinor", dc AS "driverCommissionMinor", sc AS "serviceChargeMinor", (dr - dres) AS "discountNetMinor", (vc + dc + sc - (dr - dres)) AS "revenueMinor" FROM (
                SELECT to_char(date_trunc('${g}', e.created_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS bucket,
                  coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'VENDOR_COMMISSION_RECOGNIZED'), 0)::bigint AS vc,
                  coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'DRIVER_COMMISSION_RECOGNIZED'), 0)::bigint AS dc,
                  coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_SERVICE_CHARGE_RECOGNIZED'), 0)::bigint AS sc,
                  coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RECORDED'), 0)::bigint AS dr,
                  coalesce(sum(e.amount_minor) FILTER (WHERE e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED'), 0)::bigint AS dres
                FROM financial_events e ${clause(w)} GROUP BY 1) t ORDER BY bucket`,
        values: v,
      };
    },
  },
  {
    id: 'S11', family: 'FINANCE', en: 'Driver settlements', ar: 'تسويات السائقين',
    descriptionEn: 'Closed driver periods: earnings, commission, reimbursements, net payable, direction, settled and status.', descriptionAr: 'فترات السائقين المغلقة: الأرباح والعمولة والتعويضات وصافي المستحق والاتجاه والمسدد والحالة.',
    view: [P.VIEW_REPORTS, P.VIEW_DRIVER_SETTLEMENTS], moneyPermission: P.VIEW_DRIVER_SETTLEMENTS, exportPermission: P.FINANCE_EXPORT,
    params: [...RANGE, { key: 'driverId', type: 'uuid', en: 'Driver', ar: 'السائق' }],
    columns: [
      { key: 'driver', en: 'Driver', ar: 'السائق', type: 'text' },
      { key: 'periodStart', en: 'From', ar: 'من', type: 'date' },
      { key: 'periodEnd', en: 'To', ar: 'إلى', type: 'date' },
      { key: 'earningsMinor', en: 'Earnings', ar: 'الأرباح', type: 'money', total: 'sum' },
      { key: 'commissionMinor', en: 'Commission', ar: 'العمولة', type: 'money', total: 'sum' },
      { key: 'reimbursementsMinor', en: 'Reimbursements', ar: 'التعويضات', type: 'money', total: 'sum' },
      { key: 'netMinor', en: 'Net payable (− = driver owes Hatly)', ar: 'صافي المستحق (− = على السائق)', type: 'money', total: 'sum' },
      { key: 'direction', en: 'Direction', ar: 'الاتجاه', type: 'enum' },
      { key: 'settledMinor', en: 'Settled', ar: 'المسدد', type: 'money', total: 'sum' },
      { key: 'status', en: 'Payment status', ar: 'حالة السداد', type: 'enum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`p.status = 'CLOSED'`, 'p.deleted_at IS NULL'];
      range(p, 'p.period_end', v, w);
      const drv = assertUuid(p.driverId, 'driverId');
      if (drv) { v.push(drv); w.push(`p.driver_id = $${v.length}`); }
      return {
        sql: `SELECT t.*, CASE WHEN abs(t."netMinor") <= 0 THEN CASE WHEN t."settledMinor" > 0 THEN 'OVERPAID' ELSE 'NOTHING_DUE' END WHEN t."settledMinor" <= 0 THEN 'UNPAID' WHEN t."settledMinor" < abs(t."netMinor") THEN 'PARTIAL' WHEN t."settledMinor" = abs(t."netMinor") THEN 'PAID' ELSE 'OVERPAID' END AS status FROM (
                SELECT u.full_name AS driver, ${d('p.period_start')} AS "periodStart", ${d('p.period_end')} AS "periodEnd", p.total_earnings_minor AS "earningsMinor", p.total_commission_owed_minor AS "commissionMinor",
                  p.total_reimbursements_owed_minor AS "reimbursementsMinor", p.net_payable_minor AS "netMinor", CASE WHEN p.net_payable_minor >= 0 THEN 'PAYOUT' ELSE 'COLLECTION' END AS direction,
                  coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED'), 0)::bigint AS "settledMinor"
                FROM driver_settlement_periods p JOIN drivers dr ON dr.id = p.driver_id JOIN users u ON u.id = dr.user_id ${clause(w)}) t ORDER BY t."periodEnd" DESC, t.driver`,
        values: v,
      };
    },
  },
  {
    id: 'S12', family: 'FINANCE', en: 'Hatly-funded discounts', ar: 'الخصومات الممولة من حاتلي',
    descriptionEn: 'Recorded and restored Hatly-funded discounts; net = recorded − restored.', descriptionAr: 'الخصومات الممولة من حاتلي المسجلة والمستردة؛ الصافي = المسجل − المسترد.',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT,
    params: RANGE,
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'type', en: 'Type', ar: 'النوع', type: 'enum' },
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'signedAmountMinor', en: 'Amount (restored negative)', ar: 'المبلغ (المسترد سالب)', type: 'money', total: 'sum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`e.type IN ('HATLY_FUNDED_OFFER_DISCOUNT_RECORDED','HATLY_FUNDED_OFFER_DISCOUNT_RESTORED')`];
      range(p, 'e.created_at', v, w);
      return { sql: `SELECT ${dt('e.created_at')} AS "createdAt", e.type AS type, o.order_number AS "orderNumber", CASE WHEN e.type = 'HATLY_FUNDED_OFFER_DISCOUNT_RESTORED' THEN -e.amount_minor ELSE e.amount_minor END AS "signedAmountMinor" FROM financial_events e LEFT JOIN orders o ON o.id = e.order_id ${clause(w)} ORDER BY e.created_at DESC, e.id`, values: v };
    },
  },
  {
    id: 'S13', family: 'FINANCE', en: 'Liabilities and receivables', ar: 'الالتزامات والمستحقات',
    descriptionEn: 'Customer wallets, refunds recorded but not sent, vendor commission receivable and driver payables/receivables, as of now.', descriptionAr: 'محافظ العملاء والمستردات المسجلة وغير المرسلة وعمولات الموردين المستحقة وما للسائقين وعليهم، حتى الآن.',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT,
    params: [],
    columns: [
      { key: 'item', en: 'Item', ar: 'البند', type: 'text' },
      { key: 'amountMinor', en: 'Amount', ar: 'المبلغ', type: 'money' },
    ],
    build: () => ({
      sql: `SELECT * FROM (
        SELECT 1 AS ord, 'Customer wallet balances (Hatly owes customers)' AS item, coalesce((SELECT sum(b.bal) FROM (SELECT sum(amount_delta_minor) AS bal FROM wallet_transactions GROUP BY customer_id HAVING sum(amount_delta_minor) > 0) b), 0)::bigint AS "amountMinor"
        UNION ALL SELECT 2, 'Refunds recorded but not yet sent', coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.type = 'MANUAL_TRANSFER_REFUND_RECORDED' AND NOT EXISTS (SELECT 1 FROM refund_payouts rp WHERE rp.financial_event_id = e.id)), 0)::bigint
        UNION ALL SELECT 3, 'Vendor commission receivable (closed periods, uncollected)', coalesce((SELECT sum(greatest(p.total_commission_owed_minor - coalesce(s.settled, 0), 0)) FROM vendor_settlement_periods p LEFT JOIN LATERAL (SELECT sum(amount_minor) AS settled FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED') s ON true WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL), 0)::bigint
        UNION ALL SELECT 4, 'Driver payable (Hatly owes drivers, closed periods, unpaid)', coalesce((SELECT sum(greatest(p.net_payable_minor - coalesce(s.settled, 0), 0)) FROM driver_settlement_periods p LEFT JOIN LATERAL (SELECT sum(amount_minor) AS settled FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED') s ON true WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL AND p.net_payable_minor > 0), 0)::bigint
        UNION ALL SELECT 5, 'Driver receivable (drivers owe Hatly, closed periods, uncollected)', coalesce((SELECT sum(greatest(abs(p.net_payable_minor) - coalesce(s.settled, 0), 0)) FROM driver_settlement_periods p LEFT JOIN LATERAL (SELECT sum(amount_minor) AS settled FROM settlement_payments x WHERE x.driver_period_id = p.id AND x.status = 'RECORDED') s ON true WHERE p.status = 'CLOSED' AND p.deleted_at IS NULL AND p.net_payable_minor < 0), 0)::bigint
      ) t ORDER BY ord`,
      values: [],
    }),
  },
  {
    id: 'S15', family: 'FINANCE', en: 'Vendor settlements (receivable)', ar: 'تسويات الموردين (المستحقات)',
    descriptionEn: 'Closed vendor periods: the commission the vendor owes Hatly, what was collected, and what is outstanding. Gross sales are for reference only.', descriptionAr: 'فترات الموردين المغلقة: العمولة المستحقة لحاتلي على المورد وما تم تحصيله والمتبقي. إجمالي المبيعات للاطلاع فقط.',
    view: [P.VIEW_REPORTS, P.VIEW_VENDOR_FINANCIAL_REPORTS], moneyPermission: P.VIEW_VENDOR_FINANCIAL_REPORTS, exportPermission: P.FINANCE_EXPORT,
    params: [...RANGE, { key: 'vendorBranchId', type: 'uuid', en: 'Vendor branch', ar: 'فرع المورد' }],
    columns: [
      { key: 'vendor', en: 'Vendor', ar: 'المورد', type: 'text' },
      { key: 'branch', en: 'Branch', ar: 'الفرع', type: 'text' },
      { key: 'periodStart', en: 'From', ar: 'من', type: 'date' },
      { key: 'periodEnd', en: 'To', ar: 'إلى', type: 'date' },
      { key: 'grossSalesMinor', en: 'Gross sales (reference)', ar: 'إجمالي المبيعات (للاطلاع)', type: 'money', total: 'sum' },
      { key: 'commissionDueMinor', en: 'Commission due to Hatly', ar: 'العمولة المستحقة لحاتلي', type: 'money', total: 'sum' },
      { key: 'collectedMinor', en: 'Collected', ar: 'المحصّل', type: 'money', total: 'sum' },
      { key: 'outstandingMinor', en: 'Outstanding', ar: 'المتبقي', type: 'money', total: 'sum' },
      { key: 'status', en: 'Payment status', ar: 'حالة السداد', type: 'enum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`p.status = 'CLOSED'`, 'p.deleted_at IS NULL'];
      range(p, 'p.period_end', v, w);
      const br = assertUuid(p.vendorBranchId, 'vendorBranchId');
      if (br) { v.push(br); w.push(`p.vendor_branch_id = $${v.length}`); }
      return {
        sql: `SELECT t.*, greatest(t."commissionDueMinor" - t."collectedMinor", 0) AS "outstandingMinor", CASE WHEN t."commissionDueMinor" <= 0 THEN CASE WHEN t."collectedMinor" > 0 THEN 'OVERPAID' ELSE 'NOTHING_DUE' END WHEN t."collectedMinor" <= 0 THEN 'UNPAID' WHEN t."collectedMinor" < t."commissionDueMinor" THEN 'PARTIAL' WHEN t."collectedMinor" = t."commissionDueMinor" THEN 'PAID' ELSE 'OVERPAID' END AS status FROM (
                SELECT ven.name AS vendor, b.name AS branch, ${d('p.period_start')} AS "periodStart", ${d('p.period_end')} AS "periodEnd", p.gross_sales_minor AS "grossSalesMinor", p.total_commission_owed_minor AS "commissionDueMinor",
                  coalesce((SELECT sum(x.amount_minor) FROM settlement_payments x WHERE x.vendor_period_id = p.id AND x.status = 'RECORDED'), 0)::bigint AS "collectedMinor"
                FROM vendor_settlement_periods p JOIN vendor_branches b ON b.id = p.vendor_branch_id JOIN vendors ven ON ven.id = b.vendor_id ${clause(w)}) t ORDER BY t."periodEnd" DESC, t.vendor`,
        values: v,
      };
    },
  },
  {
    id: 'S16', family: 'FINANCE', en: 'Payments and refunds', ar: 'المدفوعات والمستردات',
    descriptionEn: 'Payments of the period; refund state: recorded vs actually sent.', descriptionAr: 'مدفوعات الفترة وحالة المستردات: مسجلة مقابل مرسلة فعليًا.',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT, maxRows: 100000,
    params: [...RANGE, { key: 'method', type: 'text', en: 'Method', ar: 'الطريقة' }, { key: 'status', type: 'text', en: 'Status', ar: 'الحالة' }],
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'method', en: 'Method', ar: 'الطريقة', type: 'enum' },
      { key: 'status', en: 'Status', ar: 'الحالة', type: 'enum' },
      { key: 'amountMinor', en: 'Amount', ar: 'المبلغ', type: 'money', total: 'sum' },
      { key: 'refundRecordedMinor', en: 'Refund recorded', ar: 'مسترد مسجل', type: 'money', total: 'sum' },
      { key: 'refundSentMinor', en: 'Refund sent', ar: 'مسترد مرسل', type: 'money', total: 'sum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'pay.created_at', v, w);
      if (p.method) { v.push(p.method); w.push(`pay.method = $${v.length}`); }
      if (p.status) { v.push(p.status); w.push(`pay.status = $${v.length}`); }
      return {
        sql: `SELECT ${dt('pay.created_at')} AS "createdAt", o.order_number AS "orderNumber", pay.method AS method, pay.status AS status, pay.amount_minor AS "amountMinor",
                coalesce((SELECT sum(e.amount_minor) FROM financial_events e WHERE e.order_id = o.id AND e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'), 0)::bigint AS "refundRecordedMinor",
                coalesce((SELECT sum(e.amount_minor) FROM financial_events e JOIN refund_payouts rp ON rp.financial_event_id = e.id WHERE e.order_id = o.id AND e.type = 'MANUAL_TRANSFER_REFUND_RECORDED'), 0)::bigint AS "refundSentMinor"
              FROM payments pay JOIN orders o ON o.id = pay.order_id ${clause(w)} ORDER BY pay.created_at DESC, pay.id`,
        values: v,
      };
    },
  },
  {
    id: 'S17', family: 'MARKETING', en: 'Offers and coupons', ar: 'العروض والقسائم',
    descriptionEn: 'Offer performance: units consumed, discount given, budget, reversals.', descriptionAr: 'أداء العروض: الوحدات المستهلكة والخصم الممنوح والميزانية والاستردادات.',
    view: [P.VIEW_REPORTS, P.MARKETING_VIEW], moneyPermission: P.MARKETING_VIEW, exportPermission: P.MARKETING_EXPORT,
    params: [],
    columns: [
      { key: 'name', en: 'Offer', ar: 'العرض', type: 'text' },
      { key: 'coupon', en: 'Coupon', ar: 'القسيمة', type: 'text' },
      { key: 'mechanism', en: 'Mechanism', ar: 'الآلية', type: 'enum' },
      { key: 'active', en: 'Active', ar: 'نشط', type: 'bool' },
      { key: 'consumptions', en: 'Consumptions', ar: 'مرات الاستخدام', type: 'int', total: 'sum' },
      { key: 'reversed', en: 'Reversed', ar: 'المستردة', type: 'int', total: 'sum' },
      { key: 'discountMinor', en: 'Discount given (net of reversals)', ar: 'الخصم الممنوح (بعد الاستردادات)', type: 'money', total: 'sum' },
      { key: 'budgetCapMinor', en: 'Budget cap', ar: 'سقف الميزانية', type: 'money' },
    ],
    build: () => ({
      sql: `SELECT o.name AS name, o.coupon_code AS coupon, o.mechanism AS mechanism, o.is_active AS active, count(c.id)::int AS consumptions, count(c.id) FILTER (WHERE c.is_reversed)::int AS reversed,
              coalesce(sum(c.discount_applied_minor) FILTER (WHERE NOT c.is_reversed), 0)::bigint AS "discountMinor", o.budget_cap_minor AS "budgetCapMinor"
            FROM offers o LEFT JOIN offer_consumptions c ON c.offer_id = o.id WHERE o.deleted_at IS NULL GROUP BY o.id ORDER BY o.created_at DESC`,
      values: [],
    }),
  },
  {
    id: 'S20', family: 'OPERATIONS', en: 'Cancellations', ar: 'الإلغاءات',
    descriptionEn: 'Cancelled orders with who cancelled, the reason and the amount.', descriptionAr: 'الطلبات الملغاة ومن ألغاها والسبب والمبلغ.',
    view: [P.VIEW_REPORTS, P.VIEW_ORDERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.ORDERS_EXPORT,
    params: RANGE,
    columns: [
      { key: 'orderNumber', en: 'Order', ar: 'الطلب', type: 'text' },
      { key: 'createdAt', en: 'Placed (Cairo)', ar: 'وقت الطلب (القاهرة)', type: 'datetime' },
      { key: 'cancelledBy', en: 'Cancelled by', ar: 'ألغاه', type: 'text' },
      { key: 'reason', en: 'Reason', ar: 'السبب', type: 'text' },
      { key: 'paymentMethod', en: 'Payment', ar: 'الدفع', type: 'enum' },
      { key: 'totalMinor', en: 'Order total at placement', ar: 'إجمالي الطلب', type: 'money' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [`o.status = 'CANCELLED'`];
      range(p, 'o.created_at', v, w);
      return { sql: `SELECT o.order_number AS "orderNumber", ${dt('o.created_at')} AS "createdAt", o.cancelled_by_role AS "cancelledBy", o.cancellation_reason AS reason, o.payment_method AS "paymentMethod", o.total_minor AS "totalMinor" FROM orders o ${clause(w)} ORDER BY o.created_at DESC, o.id`, values: v };
    },
  },
  {
    id: 'S21', family: 'SECURITY', en: 'Audit log', ar: 'سجل التدقيق',
    descriptionEn: 'Who did what, when and with what outcome (append-only).', descriptionAr: 'من فعل ماذا ومتى ونتيجته (سجل لا يُعدَّل).',
    view: [P.VIEW_AUDIT_LOG], moneyPermission: P.VIEW_AUDIT_LOG, exportPermission: P.AUDIT_EXPORT, maxRows: 100000,
    params: [...RANGE, { key: 'action', type: 'text', en: 'Action', ar: 'الإجراء' }],
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'actor', en: 'Actor', ar: 'المنفذ', type: 'text' },
      { key: 'role', en: 'Role', ar: 'الدور', type: 'text' },
      { key: 'action', en: 'Action', ar: 'الإجراء', type: 'text' },
      { key: 'targetType', en: 'Target', ar: 'الهدف', type: 'text' },
      { key: 'targetRef', en: 'Target id', ar: 'معرّف الهدف', type: 'text' },
      { key: 'outcome', en: 'Outcome', ar: 'النتيجة', type: 'enum' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'a.created_at', v, w);
      if (p.action) { v.push(p.action); w.push(`a.action = $${v.length}`); }
      return { sql: `SELECT ${dt('a.created_at')} AS "createdAt", u.full_name AS actor, a.actor_role AS role, a.action AS action, a.target_type AS "targetType", a.target_id AS "targetRef", a.outcome AS outcome FROM admin_audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id ${clause(w)} ORDER BY a.created_at DESC, a.id`, values: v };
    },
  },
  {
    id: 'S23', family: 'FINANCE', en: 'Wallet transactions', ar: 'معاملات المحفظة',
    descriptionEn: 'Customer wallet ledger rows of the period.', descriptionAr: 'قيود محفظة العميل في الفترة.',
    view: [P.VIEW_REPORTS, P.VIEW_FINANCIALS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.FINANCE_EXPORT, maxRows: 100000,
    params: [...RANGE, { key: 'type', type: 'enum', en: 'Type', ar: 'النوع', options: ['LOYALTY_REDEMPTION', 'ADMIN_CREDIT', 'DRIVER_CASH_REMAINDER', 'ORDER_PAYMENT', 'ORDER_REFUND', 'ADJUSTMENT', 'EXPIRATION'] }],
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'customer', en: 'Customer', ar: 'العميل', type: 'text', pii: 'name' },
      { key: 'type', en: 'Type', ar: 'النوع', type: 'enum' },
      { key: 'amountMinor', en: 'Amount', ar: 'المبلغ', type: 'money', total: 'sum' },
      { key: 'reason', en: 'Reason', ar: 'السبب', type: 'text' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 't.created_at', v, w);
      if (p.type) { v.push(p.type); w.push(`t.type = $${v.length}`); }
      return { sql: `SELECT ${dt('t.created_at')} AS "createdAt", u.full_name AS customer, t.type AS type, t.amount_delta_minor AS "amountMinor", t.reason AS reason FROM wallet_transactions t JOIN users u ON u.id = t.customer_id ${clause(w)} ORDER BY t.created_at DESC, t.id`, values: v };
    },
  },
  {
    id: 'S24', family: 'CUSTOMERS', en: 'Ratings', ar: 'التقييمات',
    descriptionEn: 'Customer ratings of vendors, drivers and products, including hidden ones.', descriptionAr: 'تقييمات العملاء للموردين والسائقين والمنتجات بما فيها المخفية.',
    view: [P.VIEW_REPORTS, P.VIEW_CUSTOMERS], moneyPermission: P.VIEW_FINANCIALS, exportPermission: P.CUSTOMERS_EXPORT,
    params: RANGE,
    columns: [
      { key: 'createdAt', en: 'Time (Cairo)', ar: 'الوقت (القاهرة)', type: 'datetime' },
      { key: 'target', en: 'Target', ar: 'الهدف', type: 'enum' },
      { key: 'stars', en: 'Stars', ar: 'النجوم', type: 'int' },
      { key: 'comment', en: 'Comment', ar: 'التعليق', type: 'text' },
      { key: 'hidden', en: 'Hidden', ar: 'مخفي', type: 'bool' },
    ],
    build: (p) => {
      const v: unknown[] = []; const w: string[] = [];
      range(p, 'x.created_at', v, w);
      return { sql: `SELECT ${dt('x.created_at')} AS "createdAt", x.target AS target, x.stars AS stars, x.comment AS comment, (x.hidden_at IS NOT NULL) AS hidden FROM (
                SELECT 'vendor' AS target, stars, comment, created_at, hidden_at FROM vendor_ratings WHERE deleted_at IS NULL
                UNION ALL SELECT 'driver', stars, comment, created_at, hidden_at FROM driver_ratings WHERE deleted_at IS NULL
                UNION ALL SELECT 'product', stars, comment, created_at, hidden_at FROM product_ratings WHERE deleted_at IS NULL) x ${clause(w)} ORDER BY x.created_at DESC`, values: v };
    },
  },
  {
    id: 'S25', family: 'SECURITY', en: 'Permission matrix', ar: 'مصفوفة الصلاحيات',
    descriptionEn: 'Which admin holds which permissions.', descriptionAr: 'من يملك أي الصلاحيات من المسؤولين.',
    view: [], moneyPermission: P.VIEW_AUDIT_LOG, exportPermission: P.AUDIT_EXPORT, superAdminOnly: true,
    params: [],
    columns: [
      { key: 'admin', en: 'Admin', ar: 'المسؤول', type: 'text' },
      { key: 'role', en: 'Role', ar: 'الدور', type: 'text' },
      { key: 'active', en: 'Active', ar: 'نشط', type: 'bool' },
      { key: 'permissionCount', en: 'Permissions', ar: 'عدد الصلاحيات', type: 'int' },
      { key: 'permissions', en: 'Permission list', ar: 'قائمة الصلاحيات', type: 'text' },
    ],
    build: () => ({
      sql: `SELECT u.full_name AS admin, u.role AS role, u.is_active AS active, count(p.id)::int AS "permissionCount", coalesce(string_agg(p.permission, ', ' ORDER BY p.permission), CASE WHEN u.role = 'SUPER_ADMIN' THEN 'ALL (super admin)' ELSE '' END) AS permissions
            FROM users u LEFT JOIN admin_permissions p ON p.user_id = u.id AND p.deleted_at IS NULL WHERE u.role IN ('ADMIN','SUPER_ADMIN') AND u.deleted_at IS NULL GROUP BY u.id ORDER BY u.role DESC, u.full_name`,
      values: [],
    }),
  },
];

export const REPORT_BY_ID = new Map(REPORTS.map((r) => [r.id, r]));
