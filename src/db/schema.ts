import {
  bigint, bigserial, boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex,
} from "drizzle-orm/pg-core";

const money = (name: string) => bigint(name, { mode: "number" }).notNull().default(0);
const fk = (name: string) => bigint(name, { mode: "number" });
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updated = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "accountant"] }).notNull(),
  passwordHash: text("password_hash").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: created(),
  updatedAt: updated(),
});

export const sessions = pgTable("sessions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  userId: fk("user_id").notNull().references(() => users.id),
  createdAt: created(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revoked: boolean("revoked").notNull().default(false),
});

export const loginHistory = pgTable("login_history", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id"),
  email: text("email").notNull(),
  success: boolean("success").notNull(),
  event: text("event").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("login_history_email_at").on(t.email, t.at)]);

export const passwordResets = pgTable("password_resets", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: fk("user_id").notNull().references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: created(),
});

export const auditLog = pgTable("audit_log", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  userId: fk("user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull().default(""),
  before: jsonb("before"),
  after: jsonb("after"),
}, (t) => [index("audit_log_at").on(t.at)]);

export const business = pgTable("business", {
  id: integer("id").primaryKey().default(1),
  legalName: text("legal_name").notNull().default(""),
  tradeName: text("trade_name").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  pan: text("pan").notNull().default(""),
  address: text("address").notNull().default(""),
  stateCode: text("state_code").notNull().default("33"),
  jurisdiction: text("jurisdiction").notNull().default(""),
  registrationType: text("registration_type", { enum: ["regular", "composition"] }).notNull().default("regular"),
  filingFrequency: text("filing_frequency", { enum: ["monthly", "quarterly"] }).notNull().default("monthly"),
  fyStartYear: integer("fy_start_year").notNull().default(2026),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  b2clLimit: money("b2cl_limit").default(1_00_000_00),
  noItcScheme: boolean("no_itc_scheme").notNull().default(false),
  roundOff: boolean("round_off").notNull().default(true),
  defaultPriceMode: text("default_price_mode", { enum: ["exclusive", "inclusive"] }).notNull().default("exclusive"),
  updatedAt: updated(),
});

export const taxRates = pgTable("tax_rates", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  rateBp: integer("rate_bp").notNull().unique(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
});

export const hsnCodes = pgTable("hsn_codes", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  isService: boolean("is_service").notNull().default(false),
  defaultRateBp: integer("default_rate_bp").notNull().default(500),
  supplyKind: text("supply_kind").notNull().default("taxable"),
  uqc: text("uqc").notNull().default("NOS"),
  itcAllowed: boolean("itc_allowed").notNull().default(true),
  notes: text("notes").notNull().default(""),
  active: boolean("active").notNull().default(true),
});

export const parties = pgTable("parties", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind", { enum: ["customer", "supplier"] }).notNull(),
  name: text("name").notNull(),
  gstin: text("gstin").notNull().default(""),
  address: text("address").notNull().default(""),
  stateCode: text("state_code").notNull().default("33"),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex("parties_kind_name_gstin").on(t.kind, t.name, t.gstin),
  index("parties_gstin").on(t.gstin),
]);

const docTotals = {
  taxableValue: money("taxable_value"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  igst: money("igst"),
  cess: money("cess"),
  total: money("total"),
  roundOff: money("round_off"),
  grandTotal: money("grand_total"),
};

const lineCols = {
  position: integer("position").notNull(),
  description: text("description").notNull(),
  hsnSac: text("hsn_sac").notNull().default(""),
  qty: numeric("qty", { precision: 14, scale: 3 }).notNull(),
  unit: text("unit").notNull().default("NOS"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
  discount: money("discount"),
  gstRateBp: integer("gst_rate_bp").notNull(),
  cessRateBp: integer("cess_rate_bp").notNull().default(0),
  supplyKind: text("supply_kind").notNull(),
  taxableValue: money("taxable_value"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  igst: money("igst"),
  cess: money("cess"),
  total: money("total"),
};

export const salesDocs = pgTable("sales_docs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docType: text("doc_type", { enum: ["invoice", "credit_note", "debit_note"] }).notNull(),
  number: text("number").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  partyId: fk("party_id").references(() => parties.id),
  partyName: text("party_name").notNull(),
  partyGstin: text("party_gstin").notNull().default(""),
  partyAddress: text("party_address").notNull().default(""),
  partyStateCode: text("party_state_code").notNull().default(""),
  placeOfSupply: text("place_of_supply").notNull(),
  reverseCharge: boolean("reverse_charge").notNull().default(false),
  priceMode: text("price_mode", { enum: ["exclusive", "inclusive"] }).notNull().default("exclusive"),
  ...docTotals,
  notes: text("notes").notNull().default(""),
  status: text("status", { enum: ["active", "cancelled"] }).notNull().default("active"),
  originalNumber: text("original_number").notNull().default(""),
  originalDate: date("original_date", { mode: "string" }),
  noteReason: text("note_reason").notNull().default(""),
  isExport: boolean("is_export").notNull().default(false),
  exportWithIgst: boolean("export_with_igst").notNull().default(false),
  section: text("section").notNull(),
  amendsId: fk("amends_id"),
  amendedById: fk("amended_by_id"),
  amendPeriod: text("amend_period"),
  orderRef: text("order_ref").notNull().default(""),
  importBatchId: fk("import_batch_id"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex("sales_docs_type_number").on(t.docType, t.number),
  index("sales_docs_date").on(t.date),
  index("sales_docs_party_gstin").on(t.partyGstin),
]);

export const salesLines = pgTable("sales_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docId: fk("doc_id").notNull().references(() => salesDocs.id, { onDelete: "cascade" }),
  ...lineCols,
}, (t) => [index("sales_lines_doc").on(t.docId)]);

export const purchases = pgTable("purchases", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docType: text("doc_type", { enum: ["invoice", "credit_note", "debit_note"] }).notNull().default("invoice"),
  number: text("number").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  supplierId: fk("supplier_id").references(() => parties.id),
  supplierName: text("supplier_name").notNull(),
  supplierGstin: text("supplier_gstin").notNull().default(""),
  supplierStateCode: text("supplier_state_code").notNull().default(""),
  placeOfSupply: text("place_of_supply").notNull(),
  reverseCharge: boolean("reverse_charge").notNull().default(false),
  priceMode: text("price_mode", { enum: ["exclusive", "inclusive"] }).notNull().default("exclusive"),
  ...docTotals,
  itcTotal: money("itc_total"),
  category: text("category").notNull().default("goods"),
  itcPeriod: text("itc_period").notNull(),
  reconStatus: text("recon_status").notNull().default("not_checked"),
  notes: text("notes").notNull().default(""),
  status: text("status", { enum: ["active", "cancelled"] }).notNull().default("active"),
  originalNumber: text("original_number").notNull().default(""),
  importBatchId: fk("import_batch_id"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [
  uniqueIndex("purchases_supplier_number").on(t.supplierGstin, t.supplierName, t.number, t.docType),
  index("purchases_date").on(t.date),
  index("purchases_itc_period").on(t.itcPeriod),
]);

export const purchaseLines = pgTable("purchase_lines", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docId: fk("doc_id").notNull().references(() => purchases.id, { onDelete: "cascade" }),
  ...lineCols,
  itcEligible: boolean("itc_eligible").notNull().default(true),
  itcReason: text("itc_reason").notNull().default(""),
}, (t) => [index("purchase_lines_doc").on(t.docId)]);

export const itcAdjustments = pgTable("itc_adjustments", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  period: text("period").notNull(),
  kind: text("kind", { enum: ["reversal", "reclaim"] }).notNull(),
  rule: text("rule").notNull(),
  igst: money("igst"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  cess: money("cess"),
  note: text("note").notNull().default(""),
  createdAt: created(),
}, (t) => [index("itc_adjustments_period").on(t.period)]);

export const gstr2bEntries = pgTable("gstr2b_entries", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  period: text("period").notNull(),
  supplierGstin: text("supplier_gstin").notNull(),
  supplierName: text("supplier_name").notNull().default(""),
  docType: text("doc_type").notNull().default("invoice"),
  number: text("number").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  taxableValue: money("taxable_value"),
  igst: money("igst"),
  cgst: money("cgst"),
  sgst: money("sgst"),
  cess: money("cess"),
  itcAvailable: boolean("itc_available").notNull().default(true),
  reverseCharge: boolean("reverse_charge").notNull().default(false),
}, (t) => [index("gstr2b_period").on(t.period)]);

export const returnPeriods = pgTable("return_periods", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  period: text("period").notNull().unique(),
  fy: text("fy").notNull(),
  gstr1Status: text("gstr1_status", { enum: ["open", "approved", "filed"] }).notNull().default("open"),
  gstr3bStatus: text("gstr3b_status", { enum: ["open", "approved", "filed"] }).notNull().default("open"),
  gstr1Arn: text("gstr1_arn").notNull().default(""),
  gstr3bArn: text("gstr3b_arn").notNull().default(""),
  gstr1FiledOn: date("gstr1_filed_on", { mode: "string" }),
  gstr3bFiledOn: date("gstr3b_filed_on", { mode: "string" }),
  approvedBy: fk("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  figures: jsonb("figures"),
  snapshot: jsonb("snapshot"),
  paidIgst: money("paid_igst"),
  paidCgst: money("paid_cgst"),
  paidSgst: money("paid_sgst"),
  paidCess: money("paid_cess"),
  interest: money("interest"),
  lateFee: money("late_fee"),
  challanRef: text("challan_ref").notNull().default(""),
  paidOn: date("paid_on", { mode: "string" }),
  locked: boolean("locked").notNull().default(false),
  notes: text("notes").notNull().default(""),
  updatedAt: updated(),
});

export const importBatches = pgTable("import_batches", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  status: text("status").notNull(),
  totalRows: integer("total_rows").notNull().default(0),
  validRows: integer("valid_rows").notNull().default(0),
  errorRows: integer("error_rows").notNull().default(0),
  mapping: jsonb("mapping"),
  errors: jsonb("errors"),
  createdIds: jsonb("created_ids"),
  createdBy: fk("created_by"),
  createdAt: created(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
});

export const documents = pgTable("documents", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  entityType: text("entity_type", { enum: ["sale", "purchase", "return", "party"] }).notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind", { enum: ["bill_photo", "supplier_pdf", "acknowledgement", "other"] }).notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  objectKey: text("object_key").notNull().unique(),
  checksum: text("checksum").notNull(),
  uploadedBy: fk("uploaded_by"),
  createdAt: created(),
}, (t) => [index("documents_entity").on(t.entityType, t.entityId)]);

