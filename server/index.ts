import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import {
  CSRF_HEADER,
  appendAuditLog,
  changePassword,
  clearSessionCookie,
  destroySession,
  getAuthenticatedSession,
  getUserMapByIds,
  initializeAuthStorage,
  listAuditLogs,
  listUsers,
  loginUser,
  publicUser,
  registerUser,
  requestMetaFrom,
  revokeOtherUserSessions,
  rotateCsrfToken,
  usersExist,
  verifyCsrfToken
} from "./auth.js";
import {
  adoptLegacyDataForOwner,
  HttpError,
  UPLOAD_DIR,
  contentTypeFor,
  createGroup,
  createWordbook,
  deleteGroup,
  deleteResult,
  deleteWordbook,
  extensionFor,
  formatResult,
  getResult,
  getWordbook,
  getWordbookForAdmin,
  initializeStorage,
  listAllWordbooksForAdmin,
  listGroups,
  listResults,
  listWordbooks,
  loadWordbookFromJsonFile,
  markResultComplete,
  renameGroup,
  normalizeWords,
  safeRemove,
  sanitizeDownloadName,
  startTest,
  updateWordbook
} from "./storage.js";
import type { AnswerFormat, SessionRecord, TestMode, UserRecord, WordEntry } from "./types.js";

const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 60;
const authRateLimits = new Map<string, { count: number; resetAt: number }>();

await initializeStorage();
await initializeAuthStorage();

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (file.mimetype === "application/json" || file.originalname.toLowerCase().endsWith(".json")) {
      callback(null, true);
      return;
    }
    callback(new HttpError(400, "JSON 파일만 업로드할 수 있습니다."));
  }
});

interface AuthState {
  user: UserRecord;
  session: SessionRecord;
}

interface AuthedRequest extends Request {
  auth: AuthState;
}

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(rejectCrossOriginWrites);
app.use(express.json({ limit: "2mb" }));
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/auth/me", asyncRoute(async (request, response) => {
  const auth = await getAuthenticatedSession(request.headers.cookie);
  if (!auth) {
    response.json({ authenticated: false, hasUsers: await usersExist() });
    return;
  }

  const csrfToken = await rotateCsrfToken(auth.session);
  response.json({
    authenticated: true,
    user: publicUser(auth.user),
    csrfToken,
    hasUsers: true
  });
}));

app.post("/api/auth/register", rateLimitAuth, asyncRoute(async (request, response) => {
  const body = request.body as { email?: string; loginId?: string; password?: string; name?: string };
  const registered = await registerUser({
    email: body.email ?? "",
    loginId: body.loginId ?? "",
    password: body.password ?? "",
    name: body.name ?? ""
  }, requestMetaFrom(request));

  if (registered.isFirstUser) {
    await adoptLegacyDataForOwner(registered.user.id);
  }

  response.setHeader("Set-Cookie", registered.session.cookie);
  response.status(201).json({
    authenticated: true,
    user: publicUser(registered.user),
    csrfToken: registered.session.csrfToken,
    hasUsers: true
  });
}));

app.post("/api/auth/login", rateLimitAuth, asyncRoute(async (request, response) => {
  const body = request.body as { identifier?: string; password?: string; rememberMe?: boolean };
  const loggedIn = await loginUser({
    identifier: body.identifier ?? "",
    password: body.password ?? "",
    rememberMe: body.rememberMe === true
  }, requestMetaFrom(request));

  response.setHeader("Set-Cookie", loggedIn.session.cookie);
  response.json({
    authenticated: true,
    user: publicUser(loggedIn.user),
    csrfToken: loggedIn.session.csrfToken,
    hasUsers: true
  });
}));

app.use("/api", requireAuth);
app.use("/api", requireCsrfForUnsafeMethods);

app.post("/api/auth/logout", asyncRoute(async (request, response) => {
  await destroySession(authOf(request).session, authOf(request).user, requestMetaFrom(request));
  response.setHeader("Set-Cookie", clearSessionCookie(requestMetaFrom(request).secureCookie ?? false));
  response.status(204).end();
}));

app.post("/api/auth/password", asyncRoute(async (request, response) => {
  const body = request.body as { currentPassword?: string; nextPassword?: string };
  await changePassword(
    authOf(request).user,
    body.currentPassword ?? "",
    body.nextPassword ?? "",
    requestMetaFrom(request)
  );
  await revokeOtherUserSessions(authOf(request).user.id, authOf(request).session.id);
  response.status(204).end();
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(await listUsers());
}));

app.get("/api/admin/logs", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(await listAuditLogs());
}));

app.get("/api/admin/wordbooks", requireAdmin, asyncRoute(async (_request, response) => {
  const wordbooks = await listAllWordbooksForAdmin();
  const owners = await getUserMapByIds(wordbooks.map((wordbook) => wordbook.ownerId));
  response.json(wordbooks.map((wordbook) => {
    const owner = owners.get(wordbook.ownerId);
    return {
      ...wordbook,
      ownerLoginId: owner?.loginId,
      ownerEmail: owner?.email,
      ownerName: owner?.name
    };
  }));
}));

app.get("/api/admin/wordbooks/:id", requireAdmin, asyncRoute(async (request, response) => {
  const wordbook = await getWordbookForAdmin(request.params.id);
  const owners = await getUserMapByIds([wordbook.ownerId]);
  const owner = owners.get(wordbook.ownerId);
  response.json({
    ...wordbook,
    wordCount: wordbook.words.length,
    ownerLoginId: owner?.loginId,
    ownerEmail: owner?.email,
    ownerName: owner?.name
  });
}));

app.get("/api/groups", asyncRoute(async (request, response) => {
  response.json(await listGroups(authOf(request).user.id));
}));

app.post("/api/groups", asyncRoute(async (request, response) => {
  const body = request.body as { name?: string };
  const group = await createGroup(body.name ?? "", authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "group.create", "success", `group=${group.name}`));
  response.status(201).json(group);
}));

app.patch("/api/groups/:id", asyncRoute(async (request, response) => {
  const body = request.body as { name?: string };
  const group = await renameGroup(request.params.id, body.name ?? "", authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "group.rename", "success", `group=${group.name}`));
  response.json(group);
}));

app.delete("/api/groups/:id", asyncRoute(async (request, response) => {
  await deleteGroup(request.params.id, authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "group.delete", "success", `group=${request.params.id}`));
  response.status(204).end();
}));

app.get("/api/wordbooks", asyncRoute(async (request, response) => {
  response.json(await listWordbooks(authOf(request).user.id));
}));

app.get("/api/wordbooks/:id", asyncRoute(async (request, response) => {
  response.json(await getWordbook(request.params.id, authOf(request).user.id));
}));

app.post("/api/wordbooks/manual", asyncRoute(async (request, response) => {
  const body = request.body as { name?: string; group?: string; description?: string; words?: WordEntry[] };
  const created = await createWordbook({
    ownerId: authOf(request).user.id,
    name: body.name ?? "",
    group: body.group,
    description: body.description,
    words: normalizeWords(body.words),
    source: "manual"
  });
  await appendAuditLog(auditFrom(request, "wordbook.create", "success", created.name, created.id));
  response.status(201).json(created);
}));

app.post("/api/wordbooks/upload", upload.single("file"), asyncRoute(async (request, response) => {
  const uploadedPath = request.file?.path;
  if (!uploadedPath || !request.file) {
    throw new HttpError(400, "업로드할 JSON 파일을 선택하세요.");
  }

  try {
    const parsed = await loadWordbookFromJsonFile(uploadedPath);
    const submittedName = normalizeOptionalFormText(request.body.name);
    const submittedGroup = normalizeOptionalFormText(request.body.group);
    const submittedDescription = normalizeOptionalFormText(request.body.description);
    const created = await createWordbook({
      ownerId: authOf(request).user.id,
      name: submittedName ?? parsed.name ?? path.parse(request.file.originalname).name,
      group: submittedGroup ?? parsed.group,
      description: submittedDescription ?? parsed.description,
      words: parsed.words,
      source: "upload",
      sourceFilename: request.file.originalname
    });
    await safeRemove(uploadedPath);
    await appendAuditLog(auditFrom(request, "wordbook.upload", "success", created.name, created.id));
    response.status(201).json(created);
  } catch (error) {
    await safeRemove(uploadedPath);
    throw error;
  }
}));

app.patch("/api/wordbooks/:id", asyncRoute(async (request, response) => {
  const body = request.body as { name?: string; group?: string; description?: string };
  const updated = await updateWordbook(request.params.id, {
    name: body.name,
    group: body.group,
    description: body.description
  }, authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "wordbook.update", "success", updated.name, updated.id));
  response.json(updated);
}));

app.delete("/api/wordbooks/:id", asyncRoute(async (request, response) => {
  await deleteWordbook(request.params.id, authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "wordbook.delete", "success", request.params.id, request.params.id));
  response.status(204).end();
}));

app.post("/api/tests/start", asyncRoute(async (request, response) => {
  const body = request.body as {
    wordbookId?: string;
    questionCount?: number;
    mode?: TestMode;
    displaySeconds?: number;
  };

  const result = await startTest({
    ownerId: authOf(request).user.id,
    wordbookId: body.wordbookId ?? "",
    questionCount: Number(body.questionCount),
    mode: body.mode ?? "rand",
    displaySeconds: Number(body.displaySeconds)
  });
  await appendAuditLog(auditFrom(request, "test.start", "success", result.wordbookName, result.wordbookId));
  response.status(201).json(result);
}));

app.get("/api/results", asyncRoute(async (request, response) => {
  response.json(await listResults(authOf(request).user.id));
}));

app.get("/api/results/:id", asyncRoute(async (request, response) => {
  response.json(await getResult(request.params.id, authOf(request).user.id));
}));

app.patch("/api/results/:id/complete", asyncRoute(async (request, response) => {
  const result = await markResultComplete(request.params.id, authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "test.complete", "success", result.wordbookName, result.wordbookId));
  response.json(result);
}));

app.delete("/api/results/:id", asyncRoute(async (request, response) => {
  await deleteResult(request.params.id, authOf(request).user.id);
  await appendAuditLog(auditFrom(request, "test.delete", "success", request.params.id));
  response.status(204).end();
}));

app.get("/api/results/:id/download", asyncRoute(async (request, response) => {
  const format = parseFormat(request.query.format);
  const result = await getResult(request.params.id, authOf(request).user.id);
  const filename = `${sanitizeDownloadName(result.wordbookName)}_${result.createdAt.slice(0, 10)}.${extensionFor(format)}`;

  response.setHeader("Content-Type", contentTypeFor(format));
  response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.send(formatResult(result, format));
}));

app.use("/api", (_request, response) => {
  response.status(404).json({ message: "API 경로를 찾을 수 없습니다." });
});

if (process.env.NODE_ENV === "production") {
  const clientDir = path.resolve(__dirname, "../client");
  app.use(express.static(clientDir));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(clientDir, "index.html"));
  });
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    appType: "spa",
    server: { middlewareMode: true }
  });
  app.use(vite.middlewares);
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    response.status(400).json({ message: error.message });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({ message: error.message });
    return;
  }

  const parserStatus = parserErrorStatus(error);
  if (parserStatus) {
    response.status(parserStatus).json({
      message: parserStatus === 413 ? "요청 본문이 너무 큽니다." : "요청 본문 형식이 올바르지 않습니다."
    });
    return;
  }

  console.error(error);
  response.status(500).json({ message: "서버 오류가 발생했습니다." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Word Test server listening on http://localhost:${PORT}`);
});

function securityHeaders(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
}

function rejectCrossOriginWrites(request: Request, response: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const origin = request.headers.origin;
  if (typeof origin === "string" && !isAllowedWriteOrigin(origin, request)) {
    void appendAuditLog({
      event: "security.origin_reject",
      result: "failure",
      ipAddress: requestMetaFrom(request).ipAddress,
      userAgent: requestMetaFrom(request).userAgent,
      message: `origin=${origin}`
    });
    response.status(403).json({ message: "허용되지 않은 요청 출처입니다." });
    return;
  }

  next();
}

function rateLimitAuth(request: Request, response: Response, next: NextFunction): void {
  const meta = requestMetaFrom(request);
  const key = `${meta.ipAddress ?? "unknown"}:${request.path}`;
  const now = Date.now();
  for (const [entryKey, entry] of authRateLimits) {
    if (entry.resetAt <= now) {
      authRateLimits.delete(entryKey);
    }
  }

  const current = authRateLimits.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + AUTH_RATE_LIMIT_WINDOW_MS };

  bucket.count += 1;
  authRateLimits.set(key, bucket);

  if (bucket.count > AUTH_RATE_LIMIT_MAX) {
    response.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    void appendAuditLog({
      event: "security.auth_rate_limit",
      result: "failure",
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      message: request.path
    });
    response.status(429).json({ message: "요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
    return;
  }

  next();
}

function requireAuth(request: Request, response: Response, next: NextFunction): void {
  void getAuthenticatedSession(request.headers.cookie)
    .then((auth) => {
      if (!auth) {
        response.status(401).json({ message: "로그인이 필요합니다." });
        return;
      }
      (request as AuthedRequest).auth = auth;
      next();
    })
    .catch(next);
}

function requireCsrfForUnsafeMethods(request: Request, response: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const token = request.header(CSRF_HEADER);
  if (!verifyCsrfToken(authOf(request).session, token)) {
    void appendAuditLog(auditFrom(request, "security.csrf_reject", "failure", "missing or invalid csrf token"));
    response.status(403).json({ message: "보안 토큰이 올바르지 않습니다. 새로고침 후 다시 시도하세요." });
    return;
  }

  next();
}

function requireAdmin(request: Request, response: Response, next: NextFunction): void {
  if (authOf(request).user.role !== "admin") {
    response.status(403).json({ message: "관리자 권한이 필요합니다." });
    return;
  }
  next();
}

function authOf(request: Request): AuthState {
  return (request as AuthedRequest).auth;
}

function auditFrom(
  request: Request,
  event: string,
  result: "success" | "failure",
  message?: string,
  targetWordbookId?: string
) {
  const meta = requestMetaFrom(request);
  return {
    event,
    result,
    actorUserId: authOf(request).user.id,
    actorLoginId: authOf(request).user.loginId,
    targetWordbookId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    message
  };
}

function isAllowedWriteOrigin(origin: string, request: Request): boolean {
  const host = request.get("host");
  if (!host) {
    return false;
  }

  try {
    const originUrl = new URL(origin);
    return (
      originUrl.host === host &&
      (originUrl.protocol === "http:" || originUrl.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function parserErrorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  const status = "status" in error ? (error as { status?: unknown }).status : undefined;
  const statusCode = "statusCode" in error ? (error as { statusCode?: unknown }).statusCode : undefined;
  const value = typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : null;
  if (value && value >= 400 && value < 500) {
    return value;
  }
  return null;
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>
) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response, next).catch(next);
  };
}

function parseFormat(value: unknown): AnswerFormat {
  if (value === "txt" || value === "json" || value === "csv") {
    return value;
  }
  return "csv";
}

function normalizeOptionalFormText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}
