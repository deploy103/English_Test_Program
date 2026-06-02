export type TestMode = "ko" | "en" | "rand";
export type WordbookSource = "manual" | "upload";
export type AnswerFormat = "csv" | "txt" | "json";
export type UserRole = "admin" | "user";

export interface PasswordParams {
  algorithm: "scrypt";
  keyLength: number;
  N: number;
  r: number;
  p: number;
}

export interface UserRecord {
  id: string;
  loginId: string;
  email: string;
  name: string;
  role: UserRole;
  passwordHash: string;
  passwordSalt: string;
  passwordParams: PasswordParams;
  failedLoginCount: number;
  lockedUntil?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface PublicUser {
  id: string;
  loginId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface AdminUserSummary extends PublicUser {
  wordbookCount: number;
  wordCount: number;
  groupCount: number;
  resultCount: number;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  event: string;
  result: "success" | "failure";
  actorUserId?: string;
  actorLoginId?: string;
  targetUserId?: string;
  targetWordbookId?: string;
  ipAddress?: string;
  userAgent?: string;
  message?: string;
}

export interface WordEntry {
  english: string;
  korean: string;
}

export interface WordbookRecord {
  id: string;
  ownerId: string;
  name: string;
  group: string;
  description: string;
  words: WordEntry[];
  source: WordbookSource;
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookSummary {
  id: string;
  ownerId: string;
  name: string;
  group: string;
  description: string;
  wordCount: number;
  source: WordbookSource;
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWordbookSummary extends WordbookSummary {
  ownerLoginId?: string;
  ownerEmail?: string;
  ownerName?: string;
}

export interface LibraryWordbookRecord {
  id: string;
  name: string;
  group: string;
  description: string;
  words: WordEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface LibraryWordbookSummary {
  id: string;
  name: string;
  group: string;
  description: string;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookGroupRecord {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface WordbookGroupSummary {
  id: string;
  ownerId: string;
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
  ownerId: string;
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
  ownerId: string;
  wordbookId: string;
  wordbookName: string;
  questionCount: number;
  mode: TestMode;
  displaySeconds: number;
  createdAt: string;
  completedAt?: string;
}
