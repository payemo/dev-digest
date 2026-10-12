ALTER TABLE "ci_installations" ADD COLUMN "repo_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "agent_slug" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "post_as" text DEFAULT 'github_review' NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "triggers" jsonb DEFAULT '["opened","synchronize"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_path" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_yaml" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "workflow_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "manifest_version" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "manifest_sha256" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "runner_version" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "runner_sha256" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "expected_blobs" jsonb;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "branch" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "pr_url" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" bigint;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_attempt" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "repo" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "job_url" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "verdict" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "verification" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "reported_findings_count" integer;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD CONSTRAINT "ci_installations_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_uq" ON "ci_installations" USING btree ("agent_id","repo");--> statement-breakpoint
CREATE INDEX "ci_installations_repo_idx" ON "ci_installations" USING btree ("repo");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_github_run_id_uq" ON "ci_runs" USING btree ("github_run_id");--> statement-breakpoint
CREATE INDEX "ci_runs_installation_ran_idx" ON "ci_runs" USING btree ("ci_installation_id","ran_at");