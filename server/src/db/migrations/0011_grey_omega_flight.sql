ALTER TABLE "agent_runs" ALTER COLUMN "status" SET DEFAULT 'running';--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "status" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_commits_pr_id_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_files_pr_id_idx" ON "pr_files" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "findings_review_id_idx" ON "findings" USING btree ("review_id");