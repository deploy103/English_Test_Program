import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AdminWordbookSummary,
  AnswerEntry,
  AnswerFormat,
  ResultSummary,
  TestMode,
  TestResult,
  WordEntry,
  WordbookGroupRecord,
  WordbookGroupSummary,
  WordbookRecord,
  WordbookSource,
  WordbookSummary
} from "./types.js";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
const DEFAULT_GROUP_NAME = "기본 그룹";
const MAX_COMPLETED_RESULTS = 20;
const MAX_WORDS_PER_BOOK = 5000;
const MAX_WORD_CELL_LENGTH = 200;

export const DATA_DIR = path.resolve(process.env.WORD_TEST_DATA_DIR || DEFAULT_DATA_DIR);
export const WORDBOOK_DIR = path.join(DATA_DIR, "wordbooks");
export const GROUP_DIR = path.join(DATA_DIR, "groups");
export const RESULT_DIR = path.join(DATA_DIR, "results");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

interface CreateWordbookInput {
  ownerId: string;
  name: string;
  group?: string;
  description?: string;
  words: WordEntry[];
  source: WordbookSource;
  sourceFilename?: string;
}

interface UpdateWordbookInput {
  name?: string;
  group?: string;
  description?: string;
}

interface LoadedWordbookJson {
  name?: string;
  group?: string;
  description?: string;
  words: WordEntry[];
}

interface StartTestInput {
  ownerId: string;
  wordbookId: string;
  questionCount: number;
  mode: TestMode;
  displaySeconds: number;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function badRequest(message: string): never {
  throw new HttpError(400, message);
}

export async function initializeStorage(): Promise<void> {
  await ensureDataDirs();
  await pruneCompletedResults();
}

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(WORDBOOK_DIR, { recursive: true }),
    fs.mkdir(GROUP_DIR, { recursive: true }),
    fs.mkdir(RESULT_DIR, { recursive: true }),
    fs.mkdir(UPLOAD_DIR, { recursive: true })
  ]);
}

export async function adoptLegacyDataForOwner(ownerId: string): Promise<void> {
  const owner = normalizeOwnerId(ownerId);
  await Promise.all([
    adoptLegacyWordbooks(owner),
    adoptLegacyGroups(owner),
    adoptLegacyResults(owner)
  ]);
  await ensureGroupsForWordbooks(owner);
  await pruneCompletedResults(owner);
}

export function normalizeWords(raw: unknown): WordEntry[] {
  const rows = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.words)
      ? raw.words
      : [];

  const words: WordEntry[] = [];
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }

    const lower = new Map<string, unknown>();
    for (const [key, value] of Object.entries(row)) {
      lower.set(key.toLowerCase(), value);
    }

    const english = normalizeCell(lower.get("english") ?? lower.get("en"));
    const korean = normalizeCell(lower.get("korean") ?? lower.get("ko"));

    if (english.length > MAX_WORD_CELL_LENGTH || korean.length > MAX_WORD_CELL_LENGTH) {
      badRequest(`단어와 뜻은 각각 ${MAX_WORD_CELL_LENGTH}자 이하로 입력하세요.`);
    }

    if (english && korean) {
      words.push({ english, korean });
      if (words.length > MAX_WORDS_PER_BOOK) {
        badRequest(`단어장은 최대 ${MAX_WORDS_PER_BOOK}개 단어까지만 저장할 수 있습니다.`);
      }
    }
  }

  return words;
}

export async function loadWordsFromJsonFile(filePath: string): Promise<WordEntry[]> {
  const raw = await readUploadedJson(filePath);
  return normalizeWords(raw);
}

export async function loadWordbookFromJsonFile(filePath: string): Promise<LoadedWordbookJson> {
  const raw = await readUploadedJson(filePath);
  const record = isRecord(raw) ? raw : {};

  return {
    name: normalizeOptionalText(record.name ?? record.title),
    group: normalizeOptionalText(record.group ?? record.groupName ?? record.category),
    description: normalizeOptionalText(record.description ?? record.memo),
    words: normalizeWords(raw)
  };
}

export async function createWordbook(input: CreateWordbookInput): Promise<WordbookSummary> {
  const ownerId = normalizeOwnerId(input.ownerId);
  const words = normalizeWords(input.words);
  if (words.length === 0) {
    badRequest("english/korean 단어가 1개 이상 필요합니다.");
  }

  const name = normalizeName(input.name);
  const now = new Date().toISOString();
  const group = normalizeGroup(input.group);
  await ensureGroupByName(group, ownerId);

  const record: WordbookRecord = {
    id: crypto.randomUUID(),
    ownerId,
    name,
    group,
    description: normalizeDescription(input.description),
    words,
    source: input.source,
    sourceFilename: input.sourceFilename,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(wordbookPath(record.id), record);
  return summarizeWordbook(record);
}

export async function listWordbooks(ownerId: string): Promise<WordbookSummary[]> {
  const owner = normalizeOwnerId(ownerId);
  await ensureGroupsForWordbooks(owner);
  const records = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  return records
    .filter((record) => record.ownerId === owner)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeWordbook);
}

export async function listAllWordbooksForAdmin(): Promise<AdminWordbookSummary[]> {
  const records = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  return records
    .filter((record) => Boolean(record.ownerId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeWordbook);
}

export async function getWordbookForAdmin(id: string): Promise<WordbookRecord> {
  const record = await readRecord<WordbookRecord>(wordbookPath(id), "단어장을 찾을 수 없습니다.");
  if (!record.ownerId) {
    throw new HttpError(404, "단어장을 찾을 수 없습니다.");
  }
  return record;
}

export async function listGroups(ownerId: string): Promise<WordbookGroupSummary[]> {
  const owner = normalizeOwnerId(ownerId);
  await ensureGroupsForWordbooks(owner);
  const [groups, wordbooks] = await Promise.all([
    readRecords<WordbookGroupRecord>(GROUP_DIR),
    readRecords<WordbookRecord>(WORDBOOK_DIR)
  ]);
  return summarizeGroups(
    groups.filter((group) => group.ownerId === owner),
    wordbooks.filter((book) => book.ownerId === owner)
  );
}

export async function createGroup(name: string, ownerId: string): Promise<WordbookGroupSummary> {
  const owner = normalizeOwnerId(ownerId);
  const normalized = normalizeGroup(name);
  await ensureGroupsForWordbooks(owner);
  await assertUniqueGroupName(normalized, owner);

  const now = new Date().toISOString();
  const record: WordbookGroupRecord = {
    id: crypto.randomUUID(),
    ownerId: owner,
    name: normalized,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(groupPath(record.id), record);
  const groups = await listGroups(owner);
  return groups.find((group) => group.id === record.id) ?? summarizeGroups([record], [])[0];
}

export async function renameGroup(id: string, name: string, ownerId: string): Promise<WordbookGroupSummary> {
  const owner = normalizeOwnerId(ownerId);
  const record = await getGroupRecord(id, owner);
  const previousName = normalizeGroup(record.name);
  const nextName = normalizeGroup(name);

  if (previousName !== nextName) {
    await assertUniqueGroupName(nextName, owner, id);
    record.name = nextName;
    record.updatedAt = new Date().toISOString();
    await writeJson(groupPath(id), record);
    await moveWordbooksToGroup(previousName, nextName, owner);
  }

  const groups = await listGroups(owner);
  return groups.find((group) => group.id === id) ?? summarizeGroups([record], [])[0];
}

export async function deleteGroup(id: string, ownerId: string): Promise<void> {
  const owner = normalizeOwnerId(ownerId);
  const record = await getGroupRecord(id, owner);
  const groupName = normalizeGroup(record.name);
  const [wordbooks, groups] = await Promise.all([
    readRecords<WordbookRecord>(WORDBOOK_DIR),
    readRecords<WordbookGroupRecord>(GROUP_DIR)
  ]);

  if (groupName === DEFAULT_GROUP_NAME) {
    badRequest("기본 그룹은 삭제할 수 없습니다.");
  }

  await Promise.all([
    ...wordbooks
      .filter((book) => book.ownerId === owner && normalizeGroup(book.group) === groupName)
      .map((book) => fs.rm(wordbookPath(book.id), { force: true })),
    ...groups
      .filter((group) => group.ownerId === owner && normalizeGroup(group.name) === groupName)
      .map((group) => fs.rm(groupPath(group.id), { force: true }))
  ]);
}

export async function getWordbook(id: string, ownerId: string): Promise<WordbookRecord> {
  const owner = normalizeOwnerId(ownerId);
  const record = await readRecord<WordbookRecord>(wordbookPath(id), "단어장을 찾을 수 없습니다.");
  assertOwner(record.ownerId, owner, "단어장을 찾을 수 없습니다.");
  return record;
}

export async function updateWordbook(id: string, input: UpdateWordbookInput, ownerId: string): Promise<WordbookSummary> {
  const owner = normalizeOwnerId(ownerId);
  const record = await getWordbook(id, owner);

  if (typeof input.name === "string") {
    record.name = normalizeName(input.name);
  }
  if (typeof input.group === "string") {
    record.group = normalizeGroup(input.group);
  } else {
    record.group = normalizeGroup(record.group);
  }
  if (typeof input.description === "string") {
    record.description = normalizeDescription(input.description);
  }

  record.updatedAt = new Date().toISOString();
  await ensureGroupByName(record.group, owner);
  await writeJson(wordbookPath(id), record);
  return summarizeWordbook(record);
}

export async function deleteWordbook(id: string, ownerId: string): Promise<void> {
  await getWordbook(id, ownerId);
  await fs.rm(wordbookPath(id), { force: true });
}

export async function startTest(input: StartTestInput): Promise<TestResult> {
  const ownerId = normalizeOwnerId(input.ownerId);
  if (!["ko", "en", "rand"].includes(input.mode)) {
    badRequest("출제 모드가 올바르지 않습니다.");
  }

  if (!Number.isInteger(input.questionCount) || input.questionCount < 10 || input.questionCount > 50) {
    badRequest("문제 개수는 10개 이상 50개 이하만 가능합니다.");
  }

  if (!Number.isInteger(input.displaySeconds) || input.displaySeconds < 3 || input.displaySeconds > 15) {
    badRequest("표시 시간은 3초 이상 15초 이하만 가능합니다.");
  }

  const wordbook = await getWordbook(input.wordbookId, ownerId);
  const selected = takeWordsWithRepeats(wordbook.words, input.questionCount);
  const answers = selected.map((word, index) => makeAnswerEntry(word, index + 1, input.mode));
  const now = new Date().toISOString();
  const result: TestResult = {
    id: crypto.randomUUID(),
    ownerId,
    wordbookId: wordbook.id,
    wordbookName: wordbook.name,
    questionCount: answers.length,
    mode: input.mode,
    displaySeconds: input.displaySeconds,
    answers,
    createdAt: now
  };

  await writeJson(resultPath(result.id), result);
  return result;
}

export async function markResultComplete(id: string, ownerId: string): Promise<TestResult> {
  const result = await getResult(id, ownerId);
  result.completedAt = result.completedAt ?? new Date().toISOString();
  await writeJson(resultPath(id), result);
  await pruneCompletedResults(result.ownerId);
  return result;
}

export async function deleteResult(id: string, ownerId: string): Promise<void> {
  await getResult(id, ownerId);
  await fs.rm(resultPath(id), { force: true });
}

export async function listResults(ownerId: string): Promise<ResultSummary[]> {
  const owner = normalizeOwnerId(ownerId);
  const records = await readRecords<TestResult>(RESULT_DIR);
  return records
    .filter((result) => result.ownerId === owner && Boolean(result.completedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((result) => ({
      id: result.id,
      ownerId: result.ownerId,
      wordbookId: result.wordbookId,
      wordbookName: result.wordbookName,
      questionCount: result.questionCount,
      mode: result.mode,
      displaySeconds: result.displaySeconds,
      createdAt: result.createdAt,
      completedAt: result.completedAt
    }));
}

export async function getResult(id: string, ownerId: string): Promise<TestResult> {
  const owner = normalizeOwnerId(ownerId);
  const result = await readRecord<TestResult>(resultPath(id), "정답지를 찾을 수 없습니다.");
  assertOwner(result.ownerId, owner, "정답지를 찾을 수 없습니다.");
  return result;
}

async function pruneCompletedResults(ownerId?: string): Promise<void> {
  const completedResults = (await readRecords<TestResult>(RESULT_DIR))
    .filter((result) => Boolean(result.completedAt) && Boolean(result.ownerId))
    .filter((result) => !ownerId || result.ownerId === ownerId);

  const byOwner = new Map<string, TestResult[]>();
  for (const result of completedResults) {
    byOwner.set(result.ownerId, [...(byOwner.get(result.ownerId) ?? []), result]);
  }

  const removals: Promise<void>[] = [];
  for (const records of byOwner.values()) {
    if (records.length <= MAX_COMPLETED_RESULTS) {
      continue;
    }

    const removeCount = records.length - MAX_COMPLETED_RESULTS;
    const oldestResults = records
      .sort((a, b) => resultStoredAt(a).localeCompare(resultStoredAt(b)) || a.id.localeCompare(b.id))
      .slice(0, removeCount);
    removals.push(...oldestResults.map((result) => fs.rm(resultPath(result.id), { force: true })));
  }

  await Promise.all(removals);
}

export function formatResult(result: TestResult, format: AnswerFormat): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }

  if (format === "txt") {
    const lines = [
      `${result.wordbookName} 정답지`,
      `테스트 ID: ${result.id}`,
      `생성: ${formatDate(result.createdAt)}`,
      `문제 수: ${result.questionCount}`,
      "",
      "번호\t문제\t정답",
      ...result.answers.map((entry) => `${entry.index}\t${entry.prompt}\t${entry.answer}`)
    ];
    return lines.join("\n");
  }

  const rows = [
    ["번호", "문제", "정답", "문제 언어", "정답 언어"],
    ...result.answers.map((entry) => [
      String(entry.index),
      entry.prompt,
      entry.answer,
      entry.promptLanguage,
      entry.answerLanguage
    ])
  ];

  return `\ufeff${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n")}`;
}

export function contentTypeFor(format: AnswerFormat): string {
  if (format === "json") {
    return "application/json; charset=utf-8";
  }
  if (format === "txt") {
    return "text/plain; charset=utf-8";
  }
  return "text/csv; charset=utf-8";
}

export function extensionFor(format: AnswerFormat): string {
  return format;
}

export function sanitizeDownloadName(name: string): string {
  const safe = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .trim();
  return safe || "answer-sheet";
}

export async function safeRemove(filePath: string | undefined): Promise<void> {
  if (!filePath) {
    return;
  }
  await fs.rm(filePath, { force: true }).catch(() => undefined);
}

function summarizeWordbook(record: WordbookRecord): WordbookSummary {
  return {
    id: record.id,
    ownerId: record.ownerId,
    name: record.name,
    group: normalizeGroup(record.group),
    description: record.description,
    wordCount: record.words.length,
    source: record.source,
    sourceFilename: record.sourceFilename,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

async function readRecords<T>(dir: string): Promise<T[]> {
  const files = (await fs.readdir(dir).catch(() => [])).filter((file) => file.endsWith(".json"));
  const records: T[] = [];

  for (const file of files) {
    const record = await readRecord<T>(path.join(dir, file), "").catch(() => undefined);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

async function adoptLegacyWordbooks(ownerId: string): Promise<void> {
  const records = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  await Promise.all(records.map(async (record) => {
    if (record.ownerId) {
      return;
    }
    record.ownerId = ownerId;
    await writeJson(wordbookPath(record.id), record);
  }));
}

async function adoptLegacyGroups(ownerId: string): Promise<void> {
  const records = await readRecords<WordbookGroupRecord>(GROUP_DIR);
  await Promise.all(records.map(async (record) => {
    if (record.ownerId) {
      return;
    }
    record.ownerId = ownerId;
    await writeJson(groupPath(record.id), record);
  }));
}

async function adoptLegacyResults(ownerId: string): Promise<void> {
  const records = await readRecords<TestResult>(RESULT_DIR);
  await Promise.all(records.map(async (record) => {
    if (record.ownerId) {
      return;
    }
    record.ownerId = ownerId;
    await writeJson(resultPath(record.id), record);
  }));
}

async function readRecord<T>(filePath: string, missingMessage: string): Promise<T> {
  try {
    return (await readJson(filePath)) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, missingMessage);
    }
    throw error;
  }
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, "utf-8");
  return JSON.parse(text) as unknown;
}

async function readUploadedJson(filePath: string): Promise<unknown> {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error instanceof SyntaxError) {
      badRequest("JSON 형식이 올바르지 않습니다.");
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}

function wordbookPath(id: string): string {
  assertSafeId(id);
  return path.join(WORDBOOK_DIR, `${id}.json`);
}

function groupPath(id: string): string {
  assertSafeId(id);
  return path.join(GROUP_DIR, `${id}.json`);
}

function resultPath(id: string): string {
  assertSafeId(id);
  return path.join(RESULT_DIR, `${id}.json`);
}

function assertSafeId(id: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new HttpError(404, "항목을 찾을 수 없습니다.");
  }
}

function normalizeOwnerId(ownerId: string): string {
  assertSafeId(ownerId);
  return ownerId;
}

function assertOwner(actualOwnerId: string | undefined, expectedOwnerId: string, message: string): void {
  if (actualOwnerId !== expectedOwnerId) {
    throw new HttpError(404, message);
  }
}

function makeAnswerEntry(word: WordEntry, index: number, mode: TestMode): AnswerEntry {
  const promptLanguage = mode === "rand" ? (Math.random() < 0.5 ? "english" : "korean") : mode === "en" ? "english" : "korean";

  if (promptLanguage === "english") {
    return {
      index,
      prompt: word.english,
      answer: word.korean,
      promptLanguage,
      answerLanguage: "korean"
    };
  }

  return {
    index,
    prompt: word.korean,
    answer: word.english,
    promptLanguage,
    answerLanguage: "english"
  };
}

function shuffle<T>(values: T[]): T[] {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function takeWordsWithRepeats(words: WordEntry[], count: number): WordEntry[] {
  const selected: WordEntry[] = [];
  while (selected.length < count) {
    const round = shuffle(words);
    for (const word of round) {
      selected.push(word);
      if (selected.length === count) {
        break;
      }
    }
  }
  return selected;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name) {
    badRequest("단어장 이름을 입력하세요.");
  }
  if (name.length > 80) {
    badRequest("단어장 이름은 80자 이하로 입력하세요.");
  }
  return name;
}

function normalizeDescription(value: string | undefined): string {
  return (value ?? "").trim().slice(0, 500);
}

function normalizeGroup(value: string | undefined): string {
  const group = (value ?? "").trim();
  if (!group) {
    return DEFAULT_GROUP_NAME;
  }
  if (group.length > 60) {
    badRequest("그룹 이름은 60자 이하로 입력하세요.");
  }
  return group;
}

async function ensureGroupsForWordbooks(ownerId: string): Promise<void> {
  const wordbooks = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  const groups = new Set(wordbooks
    .filter((book) => book.ownerId === ownerId)
    .map((book) => normalizeGroup(book.group)));
  groups.add(DEFAULT_GROUP_NAME);

  for (const group of groups) {
    await ensureGroupByName(group, ownerId);
  }
}

async function ensureGroupByName(name: string, ownerId: string): Promise<WordbookGroupRecord> {
  const normalized = normalizeGroup(name);
  const records = await readRecords<WordbookGroupRecord>(GROUP_DIR);
  const existing = records.find((record) => record.ownerId === ownerId && normalizeGroup(record.name) === normalized);
  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const record: WordbookGroupRecord = {
    id: crypto.randomUUID(),
    ownerId,
    name: normalized,
    createdAt: now,
    updatedAt: now
  };
  await writeJson(groupPath(record.id), record);
  return record;
}

async function getGroupRecord(id: string, ownerId: string): Promise<WordbookGroupRecord> {
  const record = await readRecord<WordbookGroupRecord>(groupPath(id), "그룹을 찾을 수 없습니다.");
  assertOwner(record.ownerId, ownerId, "그룹을 찾을 수 없습니다.");
  return record;
}

async function assertUniqueGroupName(name: string, ownerId: string, exceptId?: string): Promise<void> {
  const normalized = normalizeGroup(name);
  const records = await readRecords<WordbookGroupRecord>(GROUP_DIR);
  const duplicate = records.some((record) => (
    record.ownerId === ownerId &&
    record.id !== exceptId &&
    normalizeGroup(record.name) === normalized
  ));
  if (duplicate) {
    badRequest("이미 같은 이름의 그룹이 있습니다.");
  }
}

async function moveWordbooksToGroup(previousName: string, nextName: string, ownerId: string): Promise<void> {
  const records = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  const now = new Date().toISOString();

  await Promise.all(records.map(async (record) => {
    if (record.ownerId !== ownerId || normalizeGroup(record.group) !== previousName) {
      return;
    }

    record.group = nextName;
    record.updatedAt = now;
    await writeJson(wordbookPath(record.id), record);
  }));
}

function summarizeGroups(groups: WordbookGroupRecord[], wordbooks: WordbookRecord[]): WordbookGroupSummary[] {
  const uniqueGroups = new Map<string, WordbookGroupRecord>();

  for (const group of groups) {
    const name = normalizeGroup(group.name);
    const existing = uniqueGroups.get(name);
    if (!existing || group.createdAt < existing.createdAt) {
      uniqueGroups.set(name, group);
    }
  }

  return [...uniqueGroups.values()]
    .map((group) => {
      const name = normalizeGroup(group.name);
      const books = wordbooks.filter((book) => normalizeGroup(book.group) === name);

      return {
        id: group.id,
        ownerId: group.ownerId,
        name,
        wordbookCount: books.length,
        wordCount: books.reduce((sum, book) => sum + book.words.length, 0),
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      };
    })
    .sort((a, b) => {
      if (a.name === DEFAULT_GROUP_NAME) {
        return 1;
      }
      if (b.name === DEFAULT_GROUP_NAME) {
        return -1;
      }
      return a.name.localeCompare(b.name, "ko-KR");
    });
}

function normalizeOptionalText(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized || undefined;
}

function normalizeCell(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }
  return String(value).trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeCsv(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function escapeCsvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
  return escapeCsv(safe);
}

function resultStoredAt(result: TestResult): string {
  return result.completedAt ?? result.createdAt;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
