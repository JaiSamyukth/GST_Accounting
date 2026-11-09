CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" bigint,
	"user_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"summary" text DEFAULT '' NOT NULL,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "business" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"legal_name" text DEFAULT '' NOT NULL,
	"trade_name" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"pan" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"state_code" text DEFAULT '33' NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"registration_type" text DEFAULT 'regular' NOT NULL,
	"filing_frequency" text DEFAULT 'monthly' NOT NULL,
	"fy_start_year" integer DEFAULT 2026 NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"b2cl_limit" bigint DEFAULT 10000000 NOT NULL,
	"no_itc_scheme" boolean DEFAULT false NOT NULL,
	"round_off" boolean DEFAULT true NOT NULL,
	"default_price_mode" text DEFAULT 'exclusive' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"object_key" text NOT NULL,
	"checksum" text NOT NULL,
	"uploaded_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "gstr2b_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"supplier_gstin" text NOT NULL,
	"supplier_name" text DEFAULT '' NOT NULL,
	"doc_type" text DEFAULT 'invoice' NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"itc_available" boolean DEFAULT true NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hsn_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"is_service" boolean DEFAULT false NOT NULL,
	"default_rate_bp" integer DEFAULT 500 NOT NULL,
	"supply_kind" text DEFAULT 'taxable' NOT NULL,
	"uqc" text DEFAULT 'NOS' NOT NULL,
	"itc_allowed" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "hsn_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"valid_rows" integer DEFAULT 0 NOT NULL,
	"error_rows" integer DEFAULT 0 NOT NULL,
	"mapping" jsonb,
	"errors" jsonb,
	"created_ids" jsonb,
	"created_by" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rolled_back_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "itc_adjustments" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"kind" text NOT NULL,
	"rule" text NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint,
	"email" text NOT NULL,
	"success" boolean NOT NULL,
	"event" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"state_code" text DEFAULT '33' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit" text DEFAULT 'NOS' NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"cess_rate_bp" integer DEFAULT 0 NOT NULL,
	"supply_kind" text NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"itc_eligible" boolean DEFAULT true NOT NULL,
	"itc_reason" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_type" text DEFAULT 'invoice' NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"supplier_id" bigint,
	"supplier_name" text NOT NULL,
	"supplier_gstin" text DEFAULT '' NOT NULL,
	"supplier_state_code" text DEFAULT '' NOT NULL,
	"place_of_supply" text NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"price_mode" text DEFAULT 'exclusive' NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"round_off" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"itc_total" bigint DEFAULT 0 NOT NULL,
	"category" text DEFAULT 'goods' NOT NULL,
	"itc_period" text NOT NULL,
	"recon_status" text DEFAULT 'not_checked' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"original_number" text DEFAULT '' NOT NULL,
	"import_batch_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "return_periods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"fy" text NOT NULL,
	"gstr1_status" text DEFAULT 'open' NOT NULL,
	"gstr3b_status" text DEFAULT 'open' NOT NULL,
	"gstr1_arn" text DEFAULT '' NOT NULL,
	"gstr3b_arn" text DEFAULT '' NOT NULL,
	"gstr1_filed_on" date,
	"gstr3b_filed_on" date,
	"approved_by" bigint,
	"approved_at" timestamp with time zone,
	"figures" jsonb,
	"snapshot" jsonb,
	"paid_igst" bigint DEFAULT 0 NOT NULL,
	"paid_cgst" bigint DEFAULT 0 NOT NULL,
	"paid_sgst" bigint DEFAULT 0 NOT NULL,
	"paid_cess" bigint DEFAULT 0 NOT NULL,
	"interest" bigint DEFAULT 0 NOT NULL,
	"late_fee" bigint DEFAULT 0 NOT NULL,
	"challan_ref" text DEFAULT '' NOT NULL,
	"paid_on" date,
	"locked" boolean DEFAULT false NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_periods_period_unique" UNIQUE("period")
);
--> statement-breakpoint
CREATE TABLE "sales_docs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_type" text NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"party_id" bigint,
	"party_name" text NOT NULL,
	"party_gstin" text DEFAULT '' NOT NULL,
	"party_address" text DEFAULT '' NOT NULL,
	"party_state_code" text DEFAULT '' NOT NULL,
	"place_of_supply" text NOT NULL,
	"reverse_charge" boolean DEFAULT false NOT NULL,
	"price_mode" text DEFAULT 'exclusive' NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"round_off" bigint DEFAULT 0 NOT NULL,
	"grand_total" bigint DEFAULT 0 NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"original_number" text DEFAULT '' NOT NULL,
	"original_date" date,
	"note_reason" text DEFAULT '' NOT NULL,
	"is_export" boolean DEFAULT false NOT NULL,
	"export_with_igst" boolean DEFAULT false NOT NULL,
	"section" text NOT NULL,
	"amends_id" bigint,
	"amended_by_id" bigint,
	"amend_period" text,
	"order_ref" text DEFAULT '' NOT NULL,
	"import_batch_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"doc_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"hsn_sac" text DEFAULT '' NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"unit" text DEFAULT 'NOS' NOT NULL,
	"unit_price" numeric(14, 4) NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"gst_rate_bp" integer NOT NULL,
	"cess_rate_bp" integer DEFAULT 0 NOT NULL,
	"supply_kind" text NOT NULL,
	"taxable_value" bigint DEFAULT 0 NOT NULL,
	"cgst" bigint DEFAULT 0 NOT NULL,
	"sgst" bigint DEFAULT 0 NOT NULL,
	"igst" bigint DEFAULT 0 NOT NULL,
	"cess" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"revoked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"rate_bp" integer NOT NULL,
	"label" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tax_rates_rate_bp_unique" UNIQUE("rate_bp")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_doc_id_purchases_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_parties_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_docs" ADD CONSTRAINT "sales_docs_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_lines" ADD CONSTRAINT "sales_lines_doc_id_sales_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "public"."sales_docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "documents_entity" ON "documents" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "gstr2b_period" ON "gstr2b_entries" USING btree ("period");--> statement-breakpoint
CREATE INDEX "itc_adjustments_period" ON "itc_adjustments" USING btree ("period");--> statement-breakpoint
CREATE INDEX "login_history_email_at" ON "login_history" USING btree ("email","at");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_kind_name_gstin" ON "parties" USING btree ("kind","name","gstin");--> statement-breakpoint
CREATE INDEX "parties_gstin" ON "parties" USING btree ("gstin");--> statement-breakpoint
CREATE INDEX "purchase_lines_doc" ON "purchase_lines" USING btree ("doc_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_supplier_number" ON "purchases" USING btree ("supplier_gstin","supplier_name","number","doc_type");--> statement-breakpoint
CREATE INDEX "purchases_date" ON "purchases" USING btree ("date");--> statement-breakpoint
CREATE INDEX "purchases_itc_period" ON "purchases" USING btree ("itc_period");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_docs_type_number" ON "sales_docs" USING btree ("doc_type","number");--> statement-breakpoint
CREATE INDEX "sales_docs_date" ON "sales_docs" USING btree ("date");--> statement-breakpoint
CREATE INDEX "sales_docs_party_gstin" ON "sales_docs" USING btree ("party_gstin");--> statement-breakpoint
CREATE INDEX "sales_lines_doc" ON "sales_lines" USING btree ("doc_id");