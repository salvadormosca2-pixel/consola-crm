CREATE TYPE "public"."account_mode" AS ENUM('api', 'manual');--> statement-breakpoint
CREATE TYPE "public"."account_status" AS ENUM('activa', 'pausada', 'calentando', 'bloqueada');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."contact_stage" AS ENUM('nuevo', 'encolado', 'contactado', 'respondido', 'interesado', 'reunion_agendada', 'cerrado', 'no_interesado', 'descartado');--> statement-breakpoint
CREATE TYPE "public"."import_action" AS ENUM('insertado', 'actualizado', 'duplicado', 'revisar', 'error');--> statement-breakpoint
CREATE TYPE "public"."meeting_outcome" AS ENUM('cerro', 'seguimiento', 'no');--> statement-breakpoint
CREATE TYPE "public"."meeting_status" AS ENUM('agendada', 'confirmada', 'hecha', 'no_asistio', 'reprogramada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."meeting_type" AS ENUM('llamada', 'videollamada', 'presencial');--> statement-breakpoint
CREATE TYPE "public"."msg_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."msg_status" AS ENUM('encolado', 'abierto', 'enviado', 'entregado', 'leido', 'respondido', 'fallido', 'saltado');--> statement-breakpoint
CREATE TYPE "public"."template_channel" AS ENUM('whatsapp', 'instagram', 'ambos');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_name" text NOT NULL,
	"contact_name" text,
	"phone_raw" text,
	"phone_e164" text,
	"has_whatsapp" boolean DEFAULT false NOT NULL,
	"wa_verified_at" timestamp with time zone,
	"ig_username" text,
	"has_instagram" boolean DEFAULT false NOT NULL,
	"niche" text,
	"bought" text,
	"city" text,
	"notes" text,
	"stage" "contact_stage" DEFAULT 'nuevo' NOT NULL,
	"score" smallint DEFAULT 0 NOT NULL,
	"preferred_channel" "channel",
	"preferred_channel_locked" boolean DEFAULT false NOT NULL,
	"assigned_wa_account_id" uuid,
	"assigned_ig_account_id" uuid,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"received_count" integer DEFAULT 0 NOT NULL,
	"thread_count" integer DEFAULT 0 NOT NULL,
	"sequence_step" smallint DEFAULT 0 NOT NULL,
	"last_outbound_at" timestamp with time zone,
	"last_inbound_at" timestamp with time zone,
	"first_replied_at" timestamp with time zone,
	"next_followup_at" timestamp with time zone,
	"discarded_at" timestamp with time zone,
	"import_batch_id" uuid,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_has_channel" CHECK ("contacts"."phone_e164" is not null or "contacts"."ig_username" is not null),
	CONSTRAINT "contact_score_range" CHECK ("contacts"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"contact_id" uuid,
	"account_id" uuid,
	"message_id" uuid,
	"actor_user_id" uuid,
	"payload_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"action" "import_action" NOT NULL,
	"contact_id" uuid,
	"reason" text,
	"raw_jsonb" jsonb NOT NULL,
	"previous_jsonb" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"updated_rows" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"column_map_jsonb" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"duration_minutes" smallint DEFAULT 30 NOT NULL,
	"type" "meeting_type" DEFAULT 'llamada' NOT NULL,
	"location_or_link" text,
	"agenda" text,
	"notes" text,
	"status" "meeting_status" DEFAULT 'agendada' NOT NULL,
	"outcome" "meeting_outcome",
	"reminder_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contact_id" uuid NOT NULL,
	"account_id" uuid,
	"channel" "channel" NOT NULL,
	"direction" "msg_direction" NOT NULL,
	"body" text,
	"template_id" uuid,
	"template_variant" smallint,
	"sequence_step" smallint,
	"status" "msg_status" DEFAULT 'encolado' NOT NULL,
	"send_mode" "account_mode" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"fail_reason" text,
	"skip_reason" text,
	"scheduled_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messaging_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"channel" "channel" NOT NULL,
	"phone_e164" text,
	"ig_username" text,
	"instance_name" text,
	"mode" "account_mode" DEFAULT 'manual' NOT NULL,
	"status" "account_status" DEFAULT 'activa' NOT NULL,
	"daily_cap" smallint DEFAULT 30 NOT NULL,
	"warmup_daily_cap" smallint,
	"warmup_started_on" date,
	"min_gap_seconds" integer DEFAULT 45 NOT NULL,
	"window_start" time DEFAULT '09:00' NOT NULL,
	"window_end" time DEFAULT '20:00' NOT NULL,
	"sent_today" integer DEFAULT 0 NOT NULL,
	"counter_date" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_identity" CHECK (("messaging_accounts"."channel" = 'whatsapp' and "messaging_accounts"."phone_e164" is not null and "messaging_accounts"."ig_username" is null)
     or ("messaging_accounts"."channel" = 'instagram' and "messaging_accounts"."ig_username" is not null and "messaging_accounts"."phone_e164" is null)),
	CONSTRAINT "account_caps" CHECK ("messaging_accounts"."daily_cap" between 0 and 500 and "messaging_accounts"."min_gap_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"filters_jsonb" jsonb NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"step_number" smallint NOT NULL,
	"name" text NOT NULL,
	"delay_days" smallint NOT NULL,
	"template_id" uuid,
	"channel_preference" "template_channel" DEFAULT 'ambos' NOT NULL,
	"stop_on_reply" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value_jsonb" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"channel" "template_channel" DEFAULT 'ambos' NOT NULL,
	"niche" text,
	"sequence_step" smallint,
	"body" text NOT NULL,
	"variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_wa_account_id_messaging_accounts_id_fk" FOREIGN KEY ("assigned_wa_account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_assigned_ig_account_id_messaging_accounts_id_fk" FOREIGN KEY ("assigned_ig_account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_account_id_messaging_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD CONSTRAINT "import_batch_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD CONSTRAINT "import_batch_items_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_messaging_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."messaging_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_dedupe_key_uq" ON "contacts" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_phone_uq" ON "contacts" USING btree ("phone_e164") WHERE "contacts"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_ig_uq" ON "contacts" USING btree (lower("ig_username")) WHERE "contacts"."ig_username" is not null;--> statement-breakpoint
CREATE INDEX "contacts_stage_idx" ON "contacts" USING btree ("stage");--> statement-breakpoint
CREATE INDEX "contacts_followup_idx" ON "contacts" USING btree ("next_followup_at") WHERE "contacts"."next_followup_at" is not null and "contacts"."discarded_at" is null;--> statement-breakpoint
CREATE INDEX "contacts_wa_account_idx" ON "contacts" USING btree ("assigned_wa_account_id") WHERE "contacts"."assigned_wa_account_id" is not null;--> statement-breakpoint
CREATE INDEX "contacts_ig_account_idx" ON "contacts" USING btree ("assigned_ig_account_id") WHERE "contacts"."assigned_ig_account_id" is not null;--> statement-breakpoint
CREATE INDEX "contacts_batch_idx" ON "contacts" USING btree ("import_batch_id");--> statement-breakpoint
CREATE INDEX "contacts_niche_idx" ON "contacts" USING btree ("niche");--> statement-breakpoint
CREATE INDEX "contacts_city_idx" ON "contacts" USING btree ("city");--> statement-breakpoint
CREATE INDEX "contacts_search_trgm" ON "contacts" USING gin ((coalesce("business_name", '') || ' ' || coalesce("contact_name", '') || ' ' ||
         coalesce("phone_e164", '') || ' ' || coalesce("ig_username", '')) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "events_contact_idx" ON "events" USING btree ("contact_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "events_type_idx" ON "events" USING btree ("type","created_at" desc);--> statement-breakpoint
CREATE INDEX "import_items_batch_action_idx" ON "import_batch_items" USING btree ("batch_id","action");--> statement-breakpoint
CREATE INDEX "import_items_contact_idx" ON "import_batch_items" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "import_batches_created_idx" ON "import_batches" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "meetings_scheduled_idx" ON "meetings" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "meetings_contact_idx" ON "meetings" USING btree ("contact_id","scheduled_at" desc);--> statement-breakpoint
CREATE INDEX "messages_contact_idx" ON "messages" USING btree ("contact_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "messages_status_idx" ON "messages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_account_idx" ON "messages" USING btree ("account_id","sent_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "messages_external_uq" ON "messages" USING btree ("external_id") WHERE "messages"."external_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_code_uq" ON "messaging_accounts" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_phone_uq" ON "messaging_accounts" USING btree ("phone_e164") WHERE "messaging_accounts"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_ig_uq" ON "messaging_accounts" USING btree ("ig_username") WHERE "messaging_accounts"."ig_username" is not null;--> statement-breakpoint
CREATE INDEX "accounts_channel_status_idx" ON "messaging_accounts" USING btree ("channel","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_number_uq" ON "sequence_steps" USING btree ("step_number");--> statement-breakpoint
CREATE INDEX "templates_lookup_idx" ON "templates" USING btree ("channel","niche","sequence_step") WHERE "templates"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree (lower("email"));