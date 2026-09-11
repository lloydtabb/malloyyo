CREATE TABLE "oauth_device_codes" (
	"device_code_hash" text PRIMARY KEY NOT NULL,
	"user_code_hash" text NOT NULL,
	"client_id" text NOT NULL,
	"scope" text NOT NULL,
	"resource" text,
	"user_id" uuid,
	"approved_at" timestamp with time zone,
	"denied_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_device_codes_user_code_hash_unique" UNIQUE("user_code_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_device_codes" ADD CONSTRAINT "oauth_device_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_device_codes" ADD CONSTRAINT "oauth_device_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_device_codes_expires_idx" ON "oauth_device_codes" USING btree ("expires_at");