import { cutText } from "@halonicjs/integration-shared";
import { z } from "zod";

/**
 * A task as Paperclip lists it, only the fields we read. Paperclip sends
 * many more, the whole description included; `z.object` lets them pass
 * and they never reach a result (guide, section 4, rule 5).
 */
export const listedTaskSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.string(),
  assigneeAgentId: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  updatedAt: z.string(),
});
export type ListedTask = z.infer<typeof listedTaskSchema>;

/** Who a task is assigned to: an agent or a person, by id. */
export type Assignee = { agentId: string } | { userId: string };

/** One task in a list, as the tools return it: no description. */
export interface TaskSummary {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  /** Left out when nobody has the task. */
  assignee?: Assignee;
  /** When the task last changed. */
  updatedAt: string;
}

/**
 * Titles are short, but someone else writes them; the limit keeps a list
 * of 50 small whatever Paperclip sends.
 */
const maxTitleChars = 500;

export function taskSummary(task: ListedTask): TaskSummary {
  const summary: TaskSummary = {
    id: task.id,
    identifier: task.identifier,
    title: cutText(task.title, maxTitleChars),
    status: task.status,
    priority: task.priority,
    updatedAt: task.updatedAt,
  };
  const assignee = assigneeOf(task);
  if (assignee !== undefined) summary.assignee = assignee;
  return summary;
}

function assigneeOf(task: ListedTask): Assignee | undefined {
  if (task.assigneeAgentId !== null) return { agentId: task.assigneeAgentId };
  if (task.assigneeUserId !== null) return { userId: task.assigneeUserId };
  return undefined;
}
