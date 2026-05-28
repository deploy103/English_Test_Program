import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import {
  HttpError,
  UPLOAD_DIR,
  contentTypeFor,
  createWordbook,
  deleteResult,
  deleteWordbook,
  extensionFor,
  formatResult,
  getResult,
  getWordbook,
  initializeStorage,
  listResults,
  listWordbooks,
  loadWordsFromJsonFile,
  markResultComplete,
  normalizeWords,
  safeRemove,
  sanitizeDownloadName,
  startTest
} from "./storage.js";
import type { AnswerFormat, TestMode, WordEntry } from "./types.js";

const PORT = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

await initializeStorage();

const app = express();
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

app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/wordbooks", asyncRoute(async (_request, response) => {
  response.json(await listWordbooks());
}));

app.get("/api/wordbooks/:id", asyncRoute(async (request, response) => {
  response.json(await getWordbook(request.params.id));
}));

app.post("/api/wordbooks/manual", asyncRoute(async (request, response) => {
  const body = request.body as { name?: string; description?: string; words?: WordEntry[] };
  const created = await createWordbook({
    name: body.name ?? "",
    description: body.description,
    words: normalizeWords(body.words),
    source: "manual"
  });
  response.status(201).json(created);
}));

app.post("/api/wordbooks/upload", upload.single("file"), asyncRoute(async (request, response) => {
  const uploadedPath = request.file?.path;
  if (!uploadedPath || !request.file) {
    throw new HttpError(400, "업로드할 JSON 파일을 선택하세요.");
  }

  try {
    const words = await loadWordsFromJsonFile(uploadedPath);
    const created = await createWordbook({
      name: String(request.body.name ?? path.parse(request.file.originalname).name),
      description: typeof request.body.description === "string" ? request.body.description : undefined,
      words,
      source: "upload",
      sourceFilename: request.file.originalname,
      uploadPath: path.relative(process.cwd(), uploadedPath)
    });
    response.status(201).json(created);
  } catch (error) {
    await safeRemove(uploadedPath);
    throw error;
  }
}));

app.delete("/api/wordbooks/:id", asyncRoute(async (request, response) => {
  await deleteWordbook(request.params.id);
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
    wordbookId: body.wordbookId ?? "",
    questionCount: Number(body.questionCount),
    mode: body.mode ?? "rand",
    displaySeconds: Number(body.displaySeconds)
  });
  response.status(201).json(result);
}));

app.get("/api/results", asyncRoute(async (_request, response) => {
  response.json(await listResults());
}));

app.get("/api/results/:id", asyncRoute(async (request, response) => {
  response.json(await getResult(request.params.id));
}));

app.patch("/api/results/:id/complete", asyncRoute(async (request, response) => {
  response.json(await markResultComplete(request.params.id));
}));

app.delete("/api/results/:id", asyncRoute(async (request, response) => {
  await deleteResult(request.params.id);
  response.status(204).end();
}));

app.get("/api/results/:id/download", asyncRoute(async (request, response) => {
  const format = parseFormat(request.query.format);
  const result = await getResult(request.params.id);
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

  console.error(error);
  response.status(500).json({ message: "서버 오류가 발생했습니다." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Word Test server listening on http://localhost:${PORT}`);
});

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
