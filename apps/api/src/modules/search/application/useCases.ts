import type {
  RelatedTasks,
  SearchQuery,
  SearchResult,
  TaskHighlights,
  TaskId,
  UserId,
} from '@todo/contracts';
import { notFound } from '../../../shared/errors';
import { taskHighlights } from '../domain/highlights';
import { relatedTasks } from '../domain/related';
import { type Corpus, search } from '../domain/smartSearch';
import type { SearchSources } from './ports';

const corpusOf = async ({ tasksOf, itemsOf }: SearchSources, userId: UserId): Promise<Corpus> => {
  const [tasks, items] = await Promise.all([tasksOf(userId), itemsOf(userId)]);
  return { tasks, items };
};

export const makeSearchTasks =
  (sources: SearchSources) =>
  async (userId: UserId, { q }: SearchQuery): Promise<SearchResult> =>
    search(await corpusOf(sources, userId), q);

export const makeRelatedTasks =
  (sources: SearchSources) =>
  async (userId: UserId, id: TaskId): Promise<RelatedTasks> => {
    const corpus = await corpusOf(sources, userId);
    if (!corpus.tasks.some((task) => task.id === id)) throw notFound('Task not found');
    return { items: relatedTasks(corpus, id) };
  };

export const makeTaskHighlights =
  (sources: SearchSources) =>
  async (userId: UserId, id: TaskId, { q }: SearchQuery): Promise<TaskHighlights> => {
    const corpus = await corpusOf(sources, userId);

    const task = corpus.tasks.find((candidate) => candidate.id === id);
    if (task === undefined) throw notFound('Task not found');
    return taskHighlights(corpus, task, q);
  };
