import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AnswerEntry,
  AnswerFormat,
  ResultSummary,
  TestMode,
  TestResult,
  WordEntry,
  WordbookRecord,
  WordbookSource,
  WordbookSummary
} from "./types.js";

const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");

export const DATA_DIR = path.resolve(process.env.WORD_TEST_DATA_DIR || DEFAULT_DATA_DIR);
export const WORDBOOK_DIR = path.join(DATA_DIR, "wordbooks");
export const RESULT_DIR = path.join(DATA_DIR, "results");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

interface CreateWordbookInput {
  name: string;
  description?: string;
  words: WordEntry[];
  source: WordbookSource;
  sourceFilename?: string;
  uploadPath?: string;
}

interface StartTestInput {
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
}

export async function ensureDataDirs(): Promise<void> {
  await Promise.all([
    fs.mkdir(WORDBOOK_DIR, { recursive: true }),
    fs.mkdir(RESULT_DIR, { recursive: true }),
    fs.mkdir(UPLOAD_DIR, { recursive: true })
  ]);
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

    if (english && korean) {
      words.push({ english, korean });
    }
  }

  return words;
}

export async function loadWordsFromJsonFile(filePath: string): Promise<WordEntry[]> {
  const raw = await readJson(filePath);
  return normalizeWords(raw);
}

export async function createWordbook(input: CreateWordbookInput): Promise<WordbookSummary> {
  const words = normalizeWords(input.words);
  if (words.length === 0) {
    badRequest("english/korean 단어가 1개 이상 필요합니다.");
  }

  const name = normalizeName(input.name);
  const now = new Date().toISOString();
  const record: WordbookRecord = {
    id: crypto.randomUUID(),
    name,
    description: normalizeDescription(input.description),
    words,
    source: input.source,
    sourceFilename: input.sourceFilename,
    uploadPath: input.uploadPath,
    createdAt: now,
    updatedAt: now
  };

  await writeJson(wordbookPath(record.id), record);
  return summarizeWordbook(record);
}

export async function listWordbooks(): Promise<WordbookSummary[]> {
  const records = await readRecords<WordbookRecord>(WORDBOOK_DIR);
  return records
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(summarizeWordbook);
}

export async function getWordbook(id: string): Promise<WordbookRecord> {
  return readRecord<WordbookRecord>(wordbookPath(id), "단어장을 찾을 수 없습니다.");
}

export async function deleteWordbook(id: string): Promise<void> {
  await fs.rm(wordbookPath(id), { force: true });
}

export async function startTest(input: StartTestInput): Promise<TestResult> {
  if (!["ko", "en", "rand"].includes(input.mode)) {
    badRequest("출제 모드가 올바르지 않습니다.");
  }

  if (!Number.isInteger(input.questionCount) || input.questionCount < 1 || input.questionCount > 300) {
    badRequest("문제 개수는 1개 이상 300개 이하만 가능합니다.");
  }

  if (!Number.isInteger(input.displaySeconds) || input.displaySeconds < 1 || input.displaySeconds > 30) {
    badRequest("표시 시간은 1초 이상 30초 이하만 가능합니다.");
  }

  const wordbook = await getWordbook(input.wordbookId);
  const selected = takeWordsWithRepeats(wordbook.words, input.questionCount);
  const answers = selected.map((word, index) => makeAnswerEntry(word, index + 1, input.mode));
  const now = new Date().toISOString();
  const result: TestResult = {
    id: crypto.randomUUID(),
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

export async function markResultComplete(id: string): Promise<TestResult> {
  const result = await getResult(id);
  result.completedAt = result.completedAt ?? new Date().toISOString();
  await writeJson(resultPath(id), result);
  return result;
}

export async function deleteResult(id: string): Promise<void> {
  await fs.rm(resultPath(id), { force: true });
}

export async function listResults(): Promise<ResultSummary[]> {
  const records = await readRecords<TestResult>(RESULT_DIR);
  return records
    .filter((result) => Boolean(result.completedAt))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((result) => ({
      id: result.id,
      wordbookId: result.wordbookId,
      wordbookName: result.wordbookName,
      questionCount: result.questionCount,
      mode: result.mode,
      displaySeconds: result.displaySeconds,
      createdAt: result.createdAt,
      completedAt: result.completedAt
    }));
}

export async function getResult(id: string): Promise<TestResult> {
  return readRecord<TestResult>(resultPath(id), "정답지를 찾을 수 없습니다.");
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

  return `\ufeff${rows.map((row) => row.map(escapeCsv).join(",")).join("\n")}`;
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
    name: record.name,
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}

function wordbookPath(id: string): string {
  assertSafeId(id);
  return path.join(WORDBOOK_DIR, `${id}.json`);
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(new Date(value));
}
