CREATE TABLE "agent_context_documents" (
	"agent_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_documents_agent_id_repo_id_document_id_pk" PRIMARY KEY("agent_id","repo_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "context_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"folder" text NOT NULL,
	"category" text NOT NULL,
	"origin" text NOT NULL,
	"availability" text DEFAULT 'present' NOT NULL,
	"content" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"fingerprint" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "context_sync_state" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"last_synced_sha" text,
	"last_synced_at" timestamp with time zone,
	"document_count" integer DEFAULT 0 NOT NULL,
	"outcome" text DEFAULT 'ok' NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "skill_context_documents" (
	"skill_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_documents_skill_id_repo_id_document_id_pk" PRIMARY KEY("skill_id","repo_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "agent_context_documents" ADD CONSTRAINT "agent_context_documents_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_documents" ADD CONSTRAINT "agent_context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_documents" ADD CONSTRAINT "agent_context_documents_document_id_context_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."context_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_documents" ADD CONSTRAINT "context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "context_sync_state" ADD CONSTRAINT "context_sync_state_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_documents" ADD CONSTRAINT "skill_context_documents_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_documents" ADD CONSTRAINT "skill_context_documents_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_documents" ADD CONSTRAINT "skill_context_documents_document_id_context_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."context_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_context_documents_repo_doc_idx" ON "agent_context_documents" USING btree ("repo_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "context_documents_repo_origin_path_uq" ON "context_documents" USING btree ("repo_id","origin","path");--> statement-breakpoint
CREATE INDEX "context_documents_repo_idx" ON "context_documents" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "context_documents_workspace_idx" ON "context_documents" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "skill_context_documents_repo_doc_idx" ON "skill_context_documents" USING btree ("repo_id","document_id");