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
  deleteUserForAdmin,
  destroySession,
  getAuthenticatedSession,
  getUserMapByIds,
  initializeAuthStorage,
  listAuditLogs,
  listUserSessions,
  listUsers,
  loginUser,
  publicUser,
  registerUser,
  requestMetaFrom,
  revokeOtherUserSessions,
  revokeUserSession,
  rotateCsrfToken,
  updateUserForAdmin,
  usersExist,
  verifyCsrfToken
} from "./auth.js";
import {
  adoptLegacyDataForOwner,
  HttpError,
  MAX_JSON_UPLOAD_BYTES,
  UPLOAD_DIR,
  assignLibraryWordbookToUser,
  contentTypeFor,
  createGroup,
  createLibraryWordbook,
  createWordbook,
  deleteGroup,
  deleteLibraryWordbook,
  deleteOwnedDataForUser,
  deleteResult,
  deleteWordbook,
  extensionFor,
  formatResult,
  getLearningStats,
  getLibraryWordbook,
  getResult,
  getWordbook,
  getWordbookForAdmin,
  initializeStorage,
  listAllWordbooksForAdmin,
  listGroups,
  listLibraryWordbooks,
  listOwnerLearningStats,
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
import type { AnswerFormat, SessionRecord, StatsRange, TestMode, UserRecord, WordEntry } from "./types.js";

const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = 60;
const UPLOAD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const UPLOAD_RATE_LIMIT_MAX = 20;
const MAX_UPLOAD_FIELD_BYTES = 2048;
const MAX_UPLOAD_FIELD_NAME_BYTES = 64;
const MAX_UPLOAD_HEADER_PAIRS = 50;
const STATS_DEFAULT_DAYS = 7;
const STATS_MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const authRateLimits = new Map<string, { count: number; resetAt: number }>();
const uploadRateLimits = new Map<string, { count: number; resetAt: number }>();
const JSON_UPLOAD_MIME_TYPES = new Set(["application/json", "application/x-json", "text/json"]);

await initializeStorage();
await initializeAuthStorage();

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
const upload = multer({
  dest: UPLOAD_DIR,
  preservePath: false,
  limits: {
    fieldNameSize: MAX_UPLOAD_FIELD_NAME_BYTES,
    fieldSize: MAX_UPLOAD_FIELD_BYTES,
    fields: 3,
    fileSize: MAX_JSON_UPLOAD_BYTES,
    files: 1,
    parts: 4,
    headerPairs: MAX_UPLOAD_HEADER_PAIRS
  },
  fileFilter: (_request, file, callback) => {
    const error = validateJsonUploadMetadata(file);
    if (error) {
      callback(error);
      return;
    }
    callback(null, true);
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
app.use(rejectCrossSiteWrites);
app.use(rejectCrossOriginWrites);
app.use("/api", rejectUnsupportedApiContentType);
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

app.get("/api/auth/sessions", asyncRoute(async (request, response) => {
  response.json(await listUserSessions(authOf(request).user.id, authOf(request).session.id));
}));

app.post("/api/auth/sessions/revoke-others", asyncRoute(async (request, response) => {
  await revokeOtherUserSessions(authOf(request).user.id, authOf(request).session.id);
  await appendAuditLog(auditFrom(request, "auth.session_revoke_others", "success", "other sessions revoked"));
  response.status(204).end();
}));

app.delete("/api/auth/sessions/:id", asyncRoute(async (request, response) => {
  await revokeUserSession(
    authOf(request).user,
    authOf(request).session,
    request.params.id,
    requestMetaFrom(request)
  );
  response.status(204).end();
}));

app.get("/api/admin/users", requireAdmin, asyncRoute(async (_request, response) => {
  const users = await listUsers();
  const stats = await listOwnerLearningStats(users.map((user) => user.id));
  response.json(users.map((user) => ({
    ...user,
    wordbookCount: stats.get(user.id)?.wordbookCount ?? 0,
    wordCount: stats.get(user.id)?.wordCount ?? 0,
    groupCount: stats.get(user.id)?.groupCount ?? 0,
    resultCount: stats.get(user.id)?.resultCount ?? 0
  })));
}));

app.patch("/api/admin/users/:id", requireAdmin, asyncRoute(async (request, response) => {
  const body = request.body as { loginId?: string; email?: string; name?: string; role?: "admin" | "user" };
  const user = await updateUserForAdmin(authOf(request).user, request.params.id, {
    loginId: body.loginId,
    email: body.email,
    name: body.name,
    role: body.role
  }, requestMetaFrom(request));
  response.json(user);
}));

app.delete("/api/admin/users/:id", requireAdmin, asyncRoute(async (request, response) => {
  const deleted = await deleteUserForAdmin(authOf(request).user, request.params.id, requestMetaFrom(request));
  await deleteOwnedDataForUser(deleted.id);
  response.status(204).end();
}));

app.get("/api/admin/logs", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(await listAuditLogs());
}));

app.get("/api/admin/library-wordbooks", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(await listLibraryWordbooks());
}));

app.get("/api/admin/library-wordbooks/:id", requireAdmin, asyncRoute(async (request, response) => {
  const wordbook = await getLibraryWordbook(request.params.id);
  response.json({
    ...wordbook,
    wordCount: wordbook.words.length
  });
}));

app.post("/api/admin/library-wordbooks/upload", requireAdmin, rateLimitUpload, upload.single("file"), asyncRoute(async (request, response) => {
  const uploadedPath = request.file?.path;
  if (!uploadedPath || !request.file) {
    throw new HttpError(400, "업로드할 JSON 파일을 선택하세요.");
  }

  try {
    const parsed = await loadWordbookFromJsonFile(uploadedPath);
    const submittedName = normalizeOptionalFormText(request.body.name);
    const submittedGroup = normalizeOptionalFormText(request.body.group);
    const submittedDescription = normalizeOptionalFormText(request.body.description);
    const created = await createLibraryWordbook({
      name: submittedName ?? parsed.name ?? uploadWordbookNameFallback(request.file),
      group: submittedGroup ?? parsed.group,
      description: submittedDescription ?? parsed.description,
      words: parsed.words
    });
    await safeRemove(uploadedPath);
    await appendAuditLog(auditFrom(request, "admin.library_wordbook_upload", "success", created.name, created.id));
    response.status(201).json(created);
  } catch (error) {
    await safeRemove(uploadedPath);
    throw error;
  }
}));

app.delete("/api/admin/library-wordbooks/:id", requireAdmin, asyncRoute(async (request, response) => {
  await deleteLibraryWordbook(request.params.id);
  await appendAuditLog(auditFrom(request, "admin.library_wordbook_delete", "success", request.params.id, request.params.id));
  response.status(204).end();
}));

app.post("/api/admin/library-wordbooks/:id/assign", requireAdmin, asyncRoute(async (request, response) => {
  const body = request.body as { targetUserId?: string };
  const targetUserId = body.targetUserId ?? "";
  const target = await getUserMapByIds([targetUserId]);
  if (!target.has(targetUserId)) {
    throw new HttpError(404, "대상 사용자를 찾을 수 없습니다.");
  }
  const assigned = await assignLibraryWordbookToUser({
    libraryWordbookId: request.params.id,
    targetUserId
  });
  await appendAuditLog({
    ...auditFrom(request, "admin.library_wordbook_assign", "success", assigned.name, assigned.id),
    targetUserId
  });
  response.status(201).json(assigned);
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

app.get("/api/wordbooks/:id/download", asyncRoute(async (request, response) => {
  const wordbook = await getWordbook(request.params.id, authOf(request).user.id);
  const filename = `${sanitizeDownloadName(wordbook.name)}_${wordbook.updatedAt.slice(0, 10)}.json`;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.send(JSON.stringify({
    name: wordbook.name,
    group: wordbook.group,
    description: wordbook.description,
    words: wordbook.words
  }, null, 2));
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

app.post("/api/wordbooks/upload", rateLimitUpload, upload.single("file"), asyncRoute(async (request, response) => {
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
      name: submittedName ?? parsed.name ?? uploadWordbookNameFallback(request.file),
      group: submittedGroup ?? parsed.group,
      description: submittedDescription ?? parsed.description,
      words: parsed.words,
      source: "upload",
      sourceFilename: normalizedUploadFilename(request.file)
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
    writingSeconds?: number;
    answerInputEnabled?: boolean;
  };

  const result = await startTest({
    ownerId: authOf(request).user.id,
    wordbookId: body.wordbookId ?? "",
    questionCount: Number(body.questionCount),
    mode: body.mode ?? "rand",
    displaySeconds: Number(body.displaySeconds),
    writingSeconds: Number(body.writingSeconds),
    answerInputEnabled: body.answerInputEnabled === true
  });
  await appendAuditLog(auditFrom(request, "test.start", "success", result.wordbookName, result.wordbookId));
  response.status(201).json(result);
}));

app.get("/api/stats", asyncRoute(async (request, response) => {
  const range = parseStatsRange(request.query.from, request.query.to);
  response.json(await getLearningStats(authOf(request).user.id, range.output, range.fromInclusive, range.toExclusive));
}));

app.get("/api/results", asyncRoute(async (request, response) => {
  response.json(await listResults(authOf(request).user.id));
}));

app.get("/api/results/:id", asyncRoute(async (request, response) => {
  response.json(await getResult(request.params.id, authOf(request).user.id));
}));

app.patch("/api/results/:id/complete", asyncRoute(async (request, response) => {
  const body = request.body as { answers?: { index?: number; userAnswer?: string }[] };
  const submissions = Array.isArray(body.answers)
    ? body.answers.map((entry) => ({
      index: Number(entry.index),
      userAnswer: String(entry.userAnswer ?? "")
    }))
    : [];
  const result = await markResultComplete(request.params.id, authOf(request).user.id, submissions);
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
    response.status(400).json({ message: uploadLimitMessage(error) });
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
  console.log(`Voca Studio server listening on http://localhost:${PORT}`);
});

function securityHeaders(request: Request, response: Response, next: NextFunction): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-DNS-Prefetch-Control", "off");
  response.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  response.setHeader("Referrer-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Origin-Agent-Cluster", "?1");
  if (isHttpsRequest(request)) {
    response.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  const styleSrc = process.env.NODE_ENV === "production"
    ? "style-src 'self'"
    : "style-src 'self' 'unsafe-inline'";
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; script-src 'self'; ${styleSrc}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
  );
  next();
}

function rejectCrossSiteWrites(request: Request, response: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const fetchSite = request.get("sec-fetch-site");
  if (!fetchSite || fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none") {
    next();
    return;
  }

  void appendAuditLog({
    event: "security.fetch_metadata_reject",
    result: "failure",
    ipAddress: requestMetaFrom(request).ipAddress,
    userAgent: requestMetaFrom(request).userAgent,
    message: `sec-fetch-site=${fetchSite}`
  });
  response.status(403).json({ message: "허용되지 않은 요청 출처입니다." });
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

function rejectUnsupportedApiContentType(request: Request, response: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const contentType = request.get("content-type");
  if (!contentType) {
    next();
    return;
  }

  const mimeType = contentType.split(";")[0].trim().toLowerCase();
  if (mimeType === "application/json" || mimeType === "multipart/form-data") {
    next();
    return;
  }

  void appendAuditLog({
    event: "security.content_type_reject",
    result: "failure",
    ipAddress: requestMetaFrom(request).ipAddress,
    userAgent: requestMetaFrom(request).userAgent,
    message: `content-type=${contentType}`
  });
  response.status(415).json({ message: "지원하지 않는 요청 형식입니다." });
}

function validateJsonUploadMetadata(file: Express.Multer.File): Error | null {
  const originalName = file.originalname.normalize("NFKC").trim();
  const filename = normalizedUploadFilename(file);
  if (!originalName || !filename || /[\x00-\x1f\x7f]/.test(originalName)) {
    return new HttpError(400, "파일 이름이 올바르지 않습니다.");
  }
  if (filename.length > 180) {
    return new HttpError(400, "파일 이름은 180자 이하만 사용할 수 있습니다.");
  }
  if (path.extname(filename).toLowerCase() !== ".json") {
    return new HttpError(400, "JSON 파일만 업로드할 수 있습니다.");
  }

  const mimeType = normalizeMimeType(file.mimetype);
  if (!JSON_UPLOAD_MIME_TYPES.has(mimeType)) {
    return new HttpError(400, "JSON Content-Type 파일만 업로드할 수 있습니다.");
  }

  return null;
}

function normalizedUploadFilename(file: Express.Multer.File): string {
  return path.basename(file.originalname.replaceAll("\\", "/"))
    .normalize("NFKC")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
}

function uploadWordbookNameFallback(file: Express.Multer.File): string {
  const name = path.parse(normalizedUploadFilename(file)).name.trim().slice(0, 80);
  return name || "업로드 단어장";
}

function normalizeMimeType(value: string): string {
  return value.split(";")[0]?.trim().toLowerCase() ?? "";
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

function rateLimitUpload(request: Request, response: Response, next: NextFunction): void {
  const key = `${authOf(request).user.id}:${request.path}`;
  const now = Date.now();
  for (const [entryKey, entry] of uploadRateLimits) {
    if (entry.resetAt <= now) {
      uploadRateLimits.delete(entryKey);
    }
  }

  const current = uploadRateLimits.get(key);
  const bucket = current && current.resetAt > now
    ? current
    : { count: 0, resetAt: now + UPLOAD_RATE_LIMIT_WINDOW_MS };

  bucket.count += 1;
  uploadRateLimits.set(key, bucket);

  if (bucket.count > UPLOAD_RATE_LIMIT_MAX) {
    response.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
    void appendAuditLog(auditFrom(request, "security.upload_rate_limit", "failure", request.path));
    response.status(429).json({ message: "업로드 요청이 너무 많습니다. 잠시 후 다시 시도하세요." });
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
    const normalizedOrigin = normalizedHttpOrigin(originUrl);
    if (normalizedOrigin && configuredWriteOrigins().has(normalizedOrigin)) {
      return true;
    }

    return (
      originUrl.host === host &&
      (originUrl.protocol === "http:" || originUrl.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function configuredWriteOrigins(): Set<string> {
  const rawValues = [
    process.env.APP_ORIGIN,
    ...(process.env.APP_ORIGINS?.split(",") ?? [])
  ];
  return new Set(rawValues
    .map((value) => normalizeConfiguredOrigin(value))
    .filter((value): value is string => Boolean(value)));
}

function normalizeConfiguredOrigin(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return normalizedHttpOrigin(new URL(value.trim()));
  } catch {
    return null;
  }
}

function normalizedHttpOrigin(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return `${url.protocol}//${url.host}`;
}

function isHttpsRequest(request: Request): boolean {
  return (
    request.secure ||
    (process.env.TRUST_PROXY === "1" && firstForwardedValue(request.get("x-forwarded-proto")) === "https") ||
    process.env.COOKIE_SECURE === "1"
  );
}

function firstForwardedValue(value: string | undefined): string | undefined {
  return value?.split(",")[0]?.trim().toLowerCase();
}

function parseStatsRange(fromValue: unknown, toValue: unknown): { output: StatsRange; fromInclusive: Date; toExclusive: Date } {
  const today = dateOnlyUtc(new Date());
  const toInclusive = parseDateOnlyParam(toValue) ?? today;
  const fromInclusive = parseDateOnlyParam(fromValue) ?? addDaysUtc(toInclusive, -(STATS_DEFAULT_DAYS - 1));
  if (fromInclusive > toInclusive) {
    throw new HttpError(400, "시작일은 종료일보다 늦을 수 없습니다.");
  }

  const days = Math.floor((toInclusive.getTime() - fromInclusive.getTime()) / DAY_MS) + 1;
  if (days > STATS_MAX_DAYS) {
    throw new HttpError(400, "통계 기간은 최대 1년까지만 선택할 수 있습니다.");
  }

  return {
    output: {
      from: formatDateOnly(fromInclusive),
      to: formatDateOnly(toInclusive),
      days
    },
    fromInclusive,
    toExclusive: addDaysUtc(toInclusive, 1)
  };
}

function parseDateOnlyParam(value: unknown): Date | null {
  if (Array.isArray(value)) {
    return parseDateOnlyParam(value[0]);
  }
  if (typeof value !== "string" || !value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "날짜 형식은 YYYY-MM-DD여야 합니다.");
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, "날짜 값이 올바르지 않습니다.");
  }
  return date;
}

function dateOnlyUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addDaysUtc(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
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

function uploadLimitMessage(error: multer.MulterError): string {
  if (error.code === "LIMIT_FILE_SIZE") {
    return "JSON 파일은 2MB 이하만 업로드할 수 있습니다.";
  }
  if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
    return "JSON 파일은 하나만 업로드할 수 있습니다.";
  }
  if (error.code === "LIMIT_PART_COUNT" || error.code === "LIMIT_FIELD_COUNT" || error.code === "LIMIT_FIELD_KEY" || error.code === "LIMIT_FIELD_VALUE") {
    return "업로드 입력값이 허용 범위를 초과했습니다.";
  }
  return "파일 업로드에 실패했습니다.";
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
