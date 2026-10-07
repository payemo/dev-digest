CREATE TABLE "eval_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"agent_version" integer NOT NULL,
	"provider" text,
	"model" text NOT NULL,
	"skill_snapshot" jsonb NOT NULL,
	"case_ids" jsonb NOT NULL,
	"status" text NOT NULL,
	"cases_total" integer DEFAULT 0 NOT NULL,
	"cases_done" integer DEFAULT 0 NOT NULL,
	"passed" integer DEFAULT 0 NOT NULL,
	"errored" integer DEFAULT 0 NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	"duration_ms" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_case_id_eval_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_runs" ALTER COLUMN "case_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "kind" text DEFAULT 'must_find' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "forbidden_location" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_decision" text;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "case_name" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "case_kind" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "emitted" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "grounded" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "expected_n" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "got_m" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "matched" jsonb;--> statement-breakpoint
ALTER TABLE "eval_agent_runs" ADD CONSTRAINT "eval_agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_agent_runs" ADD CONSTRAINT "eval_agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_agent_runs_agent_started_idx" ON "eval_agent_runs" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_agent_runs_one_running_uq" ON "eval_agent_runs" USING btree ("agent_id") WHERE status = 'running';--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_run_id_eval_agent_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_name_uq" ON "eval_cases" USING btree ("owner_kind","owner_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_owner_source_finding_uq" ON "eval_cases" USING btree ("owner_id","source_finding_id") WHERE source_finding_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "eval_runs_case_ran_idx" ON "eval_runs" USING btree ("case_id","ran_at");--> statement-breakpoint
CREATE INDEX "eval_runs_suite_run_idx" ON "eval_runs" USING btree ("suite_run_id");