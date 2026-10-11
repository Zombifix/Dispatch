CREATE TABLE "bullet_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bullet_id" uuid NOT NULL,
	"angle" text NOT NULL,
	"language" text NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bullet_variants_bullet_angle_lang_unique" UNIQUE("bullet_id","angle","language")
);
--> statement-breakpoint
CREATE TABLE "profile_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"kind" text NOT NULL,
	"angle" text NOT NULL,
	"language" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profile_variants_user_kind_angle_lang_unique" UNIQUE("user_id","kind","angle","language")
);
--> statement-breakpoint
ALTER TABLE "bullet_variants" ADD CONSTRAINT "bullet_variants_bullet_id_bullets_id_fk" FOREIGN KEY ("bullet_id") REFERENCES "public"."bullets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_variants" ADD CONSTRAINT "profile_variants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_bullet_variants_bullet_id" ON "bullet_variants" USING btree ("bullet_id");