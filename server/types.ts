export type TestMode = "ko" | "en" | "rand";
export type WordbookSource = "manual" | "upload";
export type AnswerFormat = "csv" | "txt" | "json";

export interface WordEntry {
  english: string;
  korean: string;
}

export interface WordbookRecord {
  id: string;
  name: string;
  group: string;
  description: string;
  words: WordEntry[];
  source: WordbookSource;
  sourceFilename?: string;
  uploadPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookSummary {
  id: string;
  name: string;
  group: string;
  description: string;
  wordCount: number;
  source: WordbookSource;
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookGroupRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookGroupSummary {
  id: string;
  name: string;
  wordbookCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AnswerEntry {
  index: number;
  prompt: string;
  answer: string;
  promptLanguage: "english" | "korean";
  answerLanguage: "english" | "korean";
}

export interface TestResult {
  id: string;
  wordbookId: string;
  wordbookName: string;
  questionCount: number;
  mode: TestMode;
  displaySeconds: number;
  answers: AnswerEntry[];
  createdAt: string;
  completedAt?: string;
}

export interface ResultSummary {
  id: string;
  wordbookId: string;
  wordbookName: string;
  questionCount: number;
  mode: TestMode;
  displaySeconds: number;
  createdAt: string;
  completedAt?: string;
}
