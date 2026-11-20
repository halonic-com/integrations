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
 * of 50 small whatever Paperclip sends. Document titles share it.
 */
export const maxTitleChars = 500;

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

/**
 * A task that blocks another, or that another blocks, as Paperclip sends it
 * with one task. Only the fields we read.
 */
const linkedTaskSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  status: z.string(),
});

/**
 * One task as Paperclip sends it, only the fields we read. Paperclip sends
 * many more, among them the plan's text, the project and the workspace;
 * none of them reach a result.
 */
export const taskSchema = listedTaskSchema.extend({
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  // Its parent first, then the parent's parent, up to the top task.
  ancestors: z.array(z.object({ id: z.string(), identifier: z.string() })),
  blockedBy: z.array(linkedTaskSchema),
  blocks: z.array(linkedTaskSchema),
  // Every document of the task, the plan included, without its text.
  documentSummaries: z.array(z.object({ key: z.string() })),
});
export type Task = z.infer<typeof taskSchema>;

/** A task linked to the one read: its parent, a blocker or a task it blocks. */
export interface LinkedTask {
  id: string;
  /** Left out when Paperclip doesn't send it, as for a parent it can't find. */
  identifier?: string;
  title?: string;
  status?: string;
}

/** One task, as `issues_get` returns it. */
export interface TaskDetail extends TaskSummary {
  description: string;
  /** Left out when the task has no parent. */
  parent?: LinkedTask;
  blockedBy: LinkedTask[];
  blocks: LinkedTask[];
  /** Pass one to `issues_get_document`. */
  documentKeys: string[];
}

/** The sheet's promise: a description is cut after 20,000 characters. */
export const maxDescriptionChars = 20_000;

export function taskDetail(task: Task): TaskDetail {
  const detail: TaskDetail = {
    ...taskSummary(task),
    description: cutText(task.description ?? "", maxDescriptionChars),
    blockedBy: task.blockedBy.map(linkedTask),
    blocks: task.blocks.map(linkedTask),
    documentKeys: task.documentSummaries.map((document) => document.key),
  };
  const parent = parentOf(task);
  if (parent !== undefined) detail.parent = parent;
  return detail;
}

function parentOf(task: Task): LinkedTask | undefined {
  if (task.parentId === null) return undefined;
  const ancestor = task.ancestors.find((candidate) => candidate.id === task.parentId);
  return ancestor === undefined
    ? { id: task.parentId }
    : { id: ancestor.id, identifier: ancestor.identifier };
}

function linkedTask(task: z.infer<typeof linkedTaskSchema>): LinkedTask {
  return {
    id: task.id,
    identifier: task.identifier,
    title: cutText(task.title, maxTitleChars),
    status: task.status,
  };
}

/** A task in the agent's inbox, as Paperclip sends it: only the fields we read. */
export const inboxTaskSchema = listedTaskSchema
  .pick({ id: true, identifier: true, title: true, status: true, priority: true, updatedAt: true })
  .extend({
    // Whether every task that blocks it is done.
    dependencyReady: z.boolean(),
  });
export type InboxTask = z.infer<typeof inboxTaskSchema>;

/** One task in the inbox, as `issues_list_inbox` returns it. */
export interface InboxTaskSummary {
  id: string;
  identifier: string;
  title: string;
  status: string;
  priority: string;
  /** Whether every task that blocks it is done. */
  blockersDone: boolean;
  updatedAt: string;
}

export function inboxTaskSummary(task: InboxTask): InboxTaskSummary {
  return {
    id: task.id,
    identifier: task.identifier,
    title: cutText(task.title, maxTitleChars),
    status: task.status,
    priority: task.priority,
    blockersDone: task.dependencyReady,
    updatedAt: task.updatedAt,
  };
}

function assigneeOf(task: ListedTask): Assignee | undefined {
  if (task.assigneeAgentId !== null) return { agentId: task.assigneeAgentId };
  if (task.assigneeUserId !== null) return { userId: task.assigneeUserId };
  return undefined;
}
