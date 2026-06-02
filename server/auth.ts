import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, HttpError, badRequest } from "./storage.js";
import type {
  AuditLogEntry,
  PasswordParams,
  PublicUser,
  SessionRecord,
  UserRecord
} from "./types.js";

const SESSION_COOKIE = "wt_session";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_AUDIT_LINES = 300;
const MAX_AUDIT_FILE_LINES = 5000;
const PASSWORD_PARAMS: PasswordParams = {
  algorithm: "scrypt",
  keyLength: 64,
  N: 32768,
  r: 8,
  p: 1
};

export const CSRF_HEADER = "x-csrf-token";
export const USER_DIR = path.join(DATA_DIR, "users");
export const SESSION_DIR = path.join(DATA_DIR, "sessions");
export const AUDIT_LOG_PATH = path.join(DATA_DIR, "audit-log.jsonl");

export interface AuthRequestMeta {
  ipAddress?: string;
  userAgent?: string;
  secureCookie?: boolean;
}

export interface IssuedSession {
  cookie: string;
  csrfToken: string;
  expiresAt: string;
}

export interface AuthenticatedSession {
  user: UserRecord;
  session: SessionRecord;
}

export interface RegisterUserInput {
  email: string;
  loginId: string;
  password: string;
  name: string;
}

export interface LoginInput {
  identifier: string;
  password: string;
}

export interface RegistrationResult {
  user: UserRecord;
  session: IssuedSession;
  isFirstUser: boolean;
}

let userWriteQueue = Promise.resolve();

export async function initializeAuthStorage(): Promise<void> {
  await Promise.all([
    fs.mkdir(USER_DIR, { recursive: true }),
    fs.mkdir(SESSION_DIR, { recursive: true }),
    fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true })
  ]);
  await pruneExpiredSessions();
}

export async function usersExist(): Promise<boolean> {
  const users = await readRecords<UserRecord>(USER_DIR);
  return users.length > 0;
}

export async function registerUser(input: RegisterUserInput, meta: AuthRequestMeta): Promise<RegistrationResult> {
  return withUserWriteLock(async () => {
    const users = await readRecords<UserRecord>(USER_DIR);
    const email = normalizeEmail(input.email);
    const loginId = normalizeLoginId(input.loginId);
    const name = normalizeName(input.name);
    assertStrongPassword(input.password);

    const duplicate = users.some((user) => user.email === email || user.loginId === loginId);
    if (duplicate) {
      await appendAuditLog({
        event: "auth.register",
        result: "failure",
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        message: "duplicate email or id"
      });
      badRequest("이미 사용 중인 이메일 또는 아이디입니다.");
    }

    const isFirstUser = users.length === 0;
    const now = new Date().toISOString();
    const password = await hashPassword(input.password);
    const user: UserRecord = {
      id: crypto.randomUUID(),
      loginId,
      email,
      name,
      role: isFirstUser ? "admin" : "user",
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordParams: PASSWORD_PARAMS,
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now
    };

    await writeJson(userPath(user.id), user);
    const session = await createSession(user, meta);
    await appendAuditLog({
      event: "auth.register",
      result: "success",
      actorUserId: user.id,
      actorLoginId: user.loginId,
      targetUserId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      message: isFirstUser ? "initial account registered" : "user registered"
    });

    return { user, session, isFirstUser };
  });
}

export async function loginUser(input: LoginInput, meta: AuthRequestMeta): Promise<{ user: UserRecord; session: IssuedSession }> {
  return withUserWriteLock(async () => {
    const identifier = input.identifier.trim();
    if (!identifier || !input.password) {
      throwInvalidCredentials(meta);
    }

    const users = await readRecords<UserRecord>(USER_DIR);
    const user = findUserByIdentifier(users, identifier);
    if (!user) {
      await delayInvalidLogin();
      await appendAuditLog({
        event: "auth.login",
        result: "failure",
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        message: "unknown identifier"
      });
      throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    if (user.lockedUntil && new Date(user.lockedUntil).getTime() > Date.now()) {
      await appendAuditLog({
        event: "auth.login",
        result: "failure",
        actorUserId: user.id,
        actorLoginId: user.loginId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        message: "account locked"
      });
      throw new HttpError(429, "로그인 실패가 많아 잠시 잠겼습니다. 15분 후 다시 시도하세요.");
    }

    const isValid = await verifyPassword(input.password, user);
    if (!isValid) {
      user.failedLoginCount += 1;
      if (user.failedLoginCount >= MAX_LOGIN_FAILURES) {
        user.lockedUntil = new Date(Date.now() + LOGIN_LOCK_MS).toISOString();
      }
      user.updatedAt = new Date().toISOString();
      await writeJson(userPath(user.id), user);
      await appendAuditLog({
        event: "auth.login",
        result: "failure",
        actorUserId: user.id,
        actorLoginId: user.loginId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        message: "invalid password"
      });
      throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    const now = new Date().toISOString();
    user.failedLoginCount = 0;
    user.lockedUntil = undefined;
    user.lastLoginAt = now;
    user.updatedAt = now;
    await writeJson(userPath(user.id), user);

    const session = await createSession(user, meta);
    await appendAuditLog({
      event: "auth.login",
      result: "success",
      actorUserId: user.id,
      actorLoginId: user.loginId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      message: "login success"
    });
    return { user, session };
  });
}

export async function getAuthenticatedSession(cookieHeader: string | undefined): Promise<AuthenticatedSession | null> {
  const parsed = parseSessionCookie(cookieHeader);
  if (!parsed) {
    return null;
  }

  const session = await readRecord<SessionRecord>(sessionPath(parsed.sessionId), "").catch(() => null);
  if (!session || !timingSafeEqual(session.tokenHash, hashToken(parsed.token))) {
    return null;
  }

  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    await fs.rm(sessionPath(session.id), { force: true }).catch(() => undefined);
    return null;
  }

  const user = await readRecord<UserRecord>(userPath(session.userId), "").catch(() => null);
  if (!user) {
    await fs.rm(sessionPath(session.id), { force: true }).catch(() => undefined);
    return null;
  }

  return { user, session };
}

export async function rotateCsrfToken(session: SessionRecord): Promise<string> {
  const csrfToken = randomToken();
  session.csrfTokenHash = hashToken(csrfToken);
  session.lastSeenAt = new Date().toISOString();
  await writeJson(sessionPath(session.id), session);
  return csrfToken;
}

export function verifyCsrfToken(session: SessionRecord, token: string | undefined): boolean {
  if (!token) {
    return false;
  }
  return timingSafeEqual(hashToken(token), session.csrfTokenHash);
}

export async function changePassword(
  user: UserRecord,
  currentPassword: string,
  nextPassword: string,
  meta: AuthRequestMeta
): Promise<void> {
  assertStrongPassword(nextPassword);
  const isValid = await verifyPassword(currentPassword, user);
  if (!isValid) {
    await appendAuditLog({
      event: "auth.password_change",
      result: "failure",
      actorUserId: user.id,
      actorLoginId: user.loginId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      message: "invalid current password"
    });
    throw new HttpError(401, "현재 비밀번호가 올바르지 않습니다.");
  }

  const password = await hashPassword(nextPassword);
  user.passwordHash = password.hash;
  user.passwordSalt = password.salt;
  user.passwordParams = PASSWORD_PARAMS;
  user.failedLoginCount = 0;
  user.lockedUntil = undefined;
  user.updatedAt = new Date().toISOString();
  await writeJson(userPath(user.id), user);
  await appendAuditLog({
    event: "auth.password_change",
    result: "success",
    actorUserId: user.id,
    actorLoginId: user.loginId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    message: "password changed"
  });
}

export async function revokeOtherUserSessions(userId: string, keepSessionId: string): Promise<void> {
  const sessions = await readRecords<SessionRecord>(SESSION_DIR);
  await Promise.all(sessions
    .filter((session) => session.userId === userId && session.id !== keepSessionId)
    .map((session) => fs.rm(sessionPath(session.id), { force: true })));
}

export async function destroySession(session: SessionRecord, user: UserRecord, meta: AuthRequestMeta): Promise<void> {
  await fs.rm(sessionPath(session.id), { force: true });
  await appendAuditLog({
    event: "auth.logout",
    result: "success",
    actorUserId: user.id,
    actorLoginId: user.loginId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    message: "logout"
  });
}

export function clearSessionCookie(secureCookie: boolean): string {
  return serializeCookie(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "Strict",
    secure: shouldUseSecureCookie({ secureCookie }),
    path: "/",
    maxAge: 0
  });
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await readRecords<UserRecord>(USER_DIR);
  return users
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(publicUser);
}

export async function getUserMapByIds(ids: Iterable<string>): Promise<Map<string, PublicUser>> {
  const needed = new Set(ids);
  const users = await readRecords<UserRecord>(USER_DIR);
  return new Map(users
    .filter((user) => needed.has(user.id))
    .map((user) => [user.id, publicUser(user)]));
}

export async function listAuditLogs(): Promise<AuditLogEntry[]> {
  const text = await fs.readFile(AUDIT_LOG_PATH, "utf-8").catch(() => "");
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-MAX_AUDIT_LINES)
    .map(parseAuditLogLine)
    .filter((entry): entry is AuditLogEntry => Boolean(entry))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function appendAuditLog(input: Omit<AuditLogEntry, "id" | "createdAt">): Promise<void> {
  const entry: AuditLogEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    ...input,
    userAgent: truncateText(input.userAgent, 180),
    message: truncateText(input.message, 500)
  };
  await fs.mkdir(path.dirname(AUDIT_LOG_PATH), { recursive: true });
  await fs.appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf-8");
  await pruneAuditLog().catch(() => undefined);
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    loginId: user.loginId,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  };
}

export function requestMetaFrom(request: { ip?: string; secure?: boolean; headers: { [key: string]: string | string[] | undefined } }): AuthRequestMeta {
  return {
    ipAddress: truncateText(request.ip, 80),
    userAgent: truncateText(firstHeader(request.headers["user-agent"]), 180),
    secureCookie: Boolean(request.secure)
  };
}

export function normalizeLoginId(value: string): string {
  const loginId = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(loginId)) {
    badRequest("아이디는 영문 소문자, 숫자, '.', '_', '-' 조합 3~32자로 입력하세요.");
  }
  return loginId;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    badRequest("올바른 이메일을 입력하세요.");
  }
  return email;
}

function normalizeName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 60) {
    badRequest("이름은 1자 이상 60자 이하로 입력하세요.");
  }
  return name;
}

function assertStrongPassword(value: string): void {
  if (value.length < 12 || value.length > 128) {
    badRequest("비밀번호는 12자 이상 128자 이하로 입력하세요.");
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    badRequest("비밀번호에는 영문, 숫자, 특수문자를 모두 포함하세요.");
  }
}

async function createSession(user: UserRecord, meta: AuthRequestMeta): Promise<IssuedSession> {
  const now = new Date();
  const token = randomToken();
  const csrfToken = randomToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const session: SessionRecord = {
    id: crypto.randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    csrfTokenHash: hashToken(csrfToken),
    createdAt: now.toISOString(),
    expiresAt,
    lastSeenAt: now.toISOString(),
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent
  };
  await writeJson(sessionPath(session.id), session);
  return {
    csrfToken,
    expiresAt,
    cookie: serializeCookie(SESSION_COOKIE, `${session.id}.${token}`, {
      httpOnly: true,
      sameSite: "Strict",
      secure: shouldUseSecureCookie(meta),
      path: "/",
      maxAge: Math.floor(SESSION_TTL_MS / 1000)
    })
  };
}

async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomToken(24);
  const derived = await deriveScrypt(password, salt, PASSWORD_PARAMS);
  return { hash: derived.toString("base64url"), salt };
}

async function verifyPassword(password: string, user: UserRecord): Promise<boolean> {
  const params = user.passwordParams;
  if (params.algorithm !== "scrypt") {
    return false;
  }
  const derived = await deriveScrypt(password, user.passwordSalt, params);
  return timingSafeEqual(derived.toString("base64url"), user.passwordHash);
}

function deriveScrypt(password: string, salt: string, params: PasswordParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keyLength, {
      N: params.N,
      r: params.r,
      p: params.p,
      maxmem: 64 * 1024 * 1024
    }, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function findUserByIdentifier(users: UserRecord[], identifier: string): UserRecord | undefined {
  const normalized = identifier.trim().toLowerCase();
  return users.find((user) => user.loginId === normalized || user.email === normalized);
}

async function pruneExpiredSessions(): Promise<void> {
  const sessions = await readRecords<SessionRecord>(SESSION_DIR);
  const now = Date.now();
  await Promise.all(sessions
    .filter((session) => new Date(session.expiresAt).getTime() <= now)
    .map((session) => fs.rm(sessionPath(session.id), { force: true })));
}

function parseSessionCookie(cookieHeader: string | undefined): { sessionId: string; token: string } | null {
  const cookies = parseCookies(cookieHeader);
  const value = cookies.get(SESSION_COOKIE);
  if (!value) {
    return null;
  }

  const [sessionId, token] = value.split(".");
  if (!sessionId || !token || !/^[a-f0-9-]{36}$/i.test(sessionId)) {
    return null;
  }
  return { sessionId, token };
}

function parseCookies(cookieHeader: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies.set(key, decodeURIComponent(value));
    } catch {
      continue;
    }
  }
  return cookies;
}

function serializeCookie(
  name: string,
  value: string,
  options: { httpOnly: boolean; sameSite: "Strict"; secure: boolean; path: string; maxAge: number }
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`
  ];
  if (options.httpOnly) {
    parts.push("HttpOnly");
  }
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

function randomToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString("base64url");
}

function hashToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("base64url");
}

function shouldUseSecureCookie(meta: Pick<AuthRequestMeta, "secureCookie">): boolean {
  if (process.env.COOKIE_SECURE === "1") {
    return true;
  }
  if (process.env.COOKIE_SECURE === "0") {
    return false;
  }
  return Boolean(meta.secureCookie);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function userPath(id: string): string {
  assertSafeId(id);
  return path.join(USER_DIR, `${id}.json`);
}

function sessionPath(id: string): string {
  assertSafeId(id);
  return path.join(SESSION_DIR, `${id}.json`);
}

function assertSafeId(id: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(id)) {
    throw new HttpError(404, "항목을 찾을 수 없습니다.");
  }
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
    return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HttpError(404, missingMessage);
    }
    throw error;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  await fs.rename(tmp, filePath);
}

function withUserWriteLock<T>(work: () => Promise<T>): Promise<T> {
  const run = userWriteQueue.then(work, work);
  userWriteQueue = run.then(() => undefined, () => undefined);
  return run;
}

function throwInvalidCredentials(meta: AuthRequestMeta): never {
  void appendAuditLog({
    event: "auth.login",
    result: "failure",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    message: "missing credentials"
  });
  throw new HttpError(401, "아이디 또는 비밀번호가 올바르지 않습니다.");
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function truncateText(value: string | undefined, max = 200): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}

function delayInvalidLogin(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 250);
  });
}

function parseAuditLogLine(line: string): AuditLogEntry | null {
  try {
    return JSON.parse(line) as AuditLogEntry;
  } catch {
    return null;
  }
}

async function pruneAuditLog(): Promise<void> {
  const text = await fs.readFile(AUDIT_LOG_PATH, "utf-8").catch(() => "");
  const lines = text.trim().split("\n").filter(Boolean);
  if (lines.length <= MAX_AUDIT_FILE_LINES) {
    return;
  }
  await fs.writeFile(AUDIT_LOG_PATH, `${lines.slice(-MAX_AUDIT_FILE_LINES).join("\n")}\n`, "utf-8");
}
