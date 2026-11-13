import { type Corpus, groupItemsByTask } from './smartSearch';
import { tokens } from './fold';
import type { ChecklistItem, Task } from '@todo/contracts';

const MAX_RELATED = 3;
const MIN_SIMILARITY = 0.1;
const MIN_WORD_LENGTH = 3;

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'are',
  'was',
  'were',
  'will',
  'have',
  'has',
  'had',
  'not',
  'but',
  'you',
  'your',
  'our',
  'out',
  'all',
  'any',
  'can',
  'into',
  'about',
  'over',
  'then',
  'than',
  'them',
  'they',
  'its',
  'too',
  'very',
  'just',
  'get',
  'got',
]);

type Vector = Map<string, number>;

const wordsOf = (task: Task, items: ChecklistItem[]): string[] =>
  [task.title, task.notes, ...items.map(({ text }) => text)]
    .flatMap(tokens)
    .filter((word) => word.length >= MIN_WORD_LENGTH && !STOP_WORDS.has(word));

const counts = (words: string[]): Vector =>
  words.reduce(
    (tally, word) => tally.set(word, (tally.get(word) ?? 0) + 1),
    new Map<string, number>(),
  );

const norm = (vector: Vector): number =>
  Math.sqrt([...vector.values()].reduce((sum, weight) => sum + weight * weight, 0));

const cosine = (a: Vector, b: Vector): number => {
  const dot = [...a].reduce((sum, [word, weight]) => sum + weight * (b.get(word) ?? 0), 0);
  const lengths = norm(a) * norm(b);
  return lengths === 0 ? 0 : dot / lengths;
};

export const relatedTasks = (corpus: Corpus, taskId: string): Task[] => {
  const itemsByTask = groupItemsByTask(corpus.items);
  const termCounts = corpus.tasks.map((task) => ({
    task,
    counts: counts(wordsOf(task, itemsByTask.get(task.id) ?? [])),
  }));
  const documentFrequency = termCounts
    .flatMap(({ counts: tally }) => [...tally.keys()])
    .reduce((df, word) => df.set(word, (df.get(word) ?? 0) + 1), new Map<string, number>());

  const idf = (word: string): number =>
    Math.log(1 + corpus.tasks.length / (documentFrequency.get(word) ?? 1));
  const vectors = termCounts.map(({ task, counts: tally }) => ({
    task,
    vector: new Map([...tally].map(([word, count]) => [word, count * idf(word)])),
  }));

  const target = vectors.find(({ task }) => task.id === taskId);
  if (target === undefined) return [];
  return vectors
    .filter(({ task }) => task.id !== taskId)
    .map(({ task, vector }, index) => ({ task, index, similarity: cosine(target.vector, vector) }))
    .filter(({ similarity }) => similarity >= MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity || a.index - b.index)
    .slice(0, MAX_RELATED)
    .map(({ task }) => task);
};
