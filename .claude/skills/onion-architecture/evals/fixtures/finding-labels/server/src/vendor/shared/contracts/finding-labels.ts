import { z } from 'zod';
import { findingLabels } from '../../../db/schema.js';

export const LabelColor = z.enum(['red', 'amber', 'green', 'blue', 'grey']);

export const FindingLabel = z.object({
  id: z.string().uuid(),
  finding_id: z.string().uuid(),
  name: z.string(),
  color: LabelColor,
  created_at: z.string(),
});
export type FindingLabel = z.infer<typeof FindingLabel>;

export type FindingLabelRecord = typeof findingLabels.$inferSelect;

export const AddLabelBody = z.object({
  name: z.string().min(1).max(40),
  color: LabelColor.default('grey'),
});
export type AddLabelBody = z.infer<typeof AddLabelBody>;
