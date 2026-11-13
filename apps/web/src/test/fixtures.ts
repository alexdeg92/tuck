import errorNotFound from '@todo/contracts/examples/error-not-found.json' with { type: 'json' };
import errorValidation from '@todo/contracts/examples/error-validation.json' with { type: 'json' };
import health from '@todo/contracts/examples/health.json' with { type: 'json' };
import task from '@todo/contracts/examples/task.json' with { type: 'json' };
import taskList from '@todo/contracts/examples/task-list.json' with { type: 'json' };
import trashList from '@todo/contracts/examples/trash-list.json' with { type: 'json' };
import trashedTask from '@todo/contracts/examples/trashed-task.json' with { type: 'json' };
import user from '@todo/contracts/examples/user.json' with { type: 'json' };

export const fixtures = {
  user,
  task,
  taskList,
  trashedTask,
  trashList,
  health,
  errorNotFound,
  errorValidation,
} as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export function trashedResponse(task: object): Response {
  const { deletedAt, purgeAt } = fixtures.trashedTask;
  return jsonResponse({ ...task, deletedAt, purgeAt });
}
