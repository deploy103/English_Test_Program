import "./styles.css";

type TestMode = "ko" | "en" | "rand";
type UserRole = "admin" | "user";

interface CurrentUser {
  id: string;
  loginId: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

interface AuthResponse {
  authenticated: boolean;
  user?: CurrentUser;
  csrfToken?: string;
  hasUsers: boolean;
}

interface WordbookSummary {
  id: string;
  ownerId?: string;
  name: string;
  group: string;
  description: string;
  wordCount: number;
  source: "manual" | "upload";
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
}

interface WordbookDetail extends WordbookSummary {
  words: WordEntry[];
}

interface WordEntry {
  english: string;
  korean: string;
}

interface AnswerEntry {
  index: number;
  prompt: string;
  answer: string;
  promptLanguage: "english" | "korean";
  answerLanguage: "english" | "korean";
}

interface TestResult {
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

interface ResultSummary {
  id: string;
  ownerId?: string;
  wordbookId: string;
  wordbookName: string;
  questionCount: number;
  mode: TestMode;
  displaySeconds: number;
  createdAt: string;
  completedAt?: string;
}

interface WordbookGroupSummary {
  id: string;
  ownerId?: string;
  name: string;
  wordbookCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
}

interface AddDraft {
  uploadName: string;
  uploadGroup: string;
  uploadDescription: string;
  manualName: string;
  manualGroup: string;
  manualDescription: string;
  manualWords: string;
}

interface AdminUserSummary extends CurrentUser {}

interface AdminWordbookSummary extends WordbookSummary {
  ownerLoginId?: string;
  ownerEmail?: string;
  ownerName?: string;
}

interface AdminWordbookDetail extends AdminWordbookSummary {
  words: WordEntry[];
}

interface AuditLogEntry {
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

interface AuthSessionSummary {
  id: string;
  current: boolean;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent?: string;
  ipAddress?: string;
}

type AuthMode = "login" | "register";
type TabKey = "test" | "memorize" | "add" | "settings" | "groups" | "manage" | "answers" | "admin";
type PlayPageKey = "testPlay" | "memorizePlay";
type PageKey = TabKey | PlayPageKey | "answerDetail";
type ActivePhase = "countdown" | "running" | "done";
type MemorizeDisplayMode = "en" | "ko" | "both";
type MemorizePhase = "prompt" | "answer" | "done";
type ColorMode = "light" | "dark";

interface ActiveTest {
  phase: ActivePhase;
  result: TestResult;
  countdown: number;
  currentIndex: number;
  remainingMs: number;
}

interface ActiveMemorize {
  phase: MemorizePhase;
  wordbookId: string;
  wordbookName: string;
  words: WordEntry[];
  displaySeconds: number;
  mode: MemorizeDisplayMode;
  currentIndex: number;
  remainingMs: number;
}

interface WordbookGroup {
  group: string;
  books: WordbookSummary[];
}

const appRoot = document.querySelector<HTMLDivElement>("#app");

if (!appRoot) {
  throw new Error("App root not found");
}

const app = appRoot;

let page: PageKey = "test";
let tab: TabKey = "test";
let wordbooks: WordbookSummary[] = [];
let groups: WordbookGroupSummary[] = [];
let results: ResultSummary[] = [];
let selectedWordbookId = "";
let selectedResult: TestResult | null = null;
let selectedResultId = "";
let activeTest: ActiveTest | null = null;
let activeMemorize: ActiveMemorize | null = null;
let timer: number | null = null;
let toastMessage = "";
let isBusy = false;
let isSidebarOpen = false;
let isAnswerLoading = false;
let answerRequestToken = 0;
let currentUser: CurrentUser | null = null;
let csrfToken = "";
let authHasUsers = true;
let authMode: AuthMode = "login";
let adminUsers: AdminUserSummary[] = [];
let adminWordbooks: AdminWordbookSummary[] = [];
let adminLogs: AuditLogEntry[] = [];
let selectedAdminWordbook: AdminWordbookDetail | null = null;
let isAdminWordbookLoading = false;
let isAdminLoading = false;
let wordbookSearch = "";
let answerSearch = "";
let editingWordbookId = "";
let authSessions: AuthSessionSummary[] = [];
let colorMode: ColorMode = loadColorMode();
let lastRenderedPath = window.location.pathname;

applyColorMode();

const DEFAULT_GROUP_NAME = "기본 그룹";
const MEMORIZE_MIN_DISPLAY_SECONDS = 1;
const MEMORIZE_MAX_DISPLAY_SECONDS = 10;
const MEMORIZE_DEFAULT_DISPLAY_SECONDS = 3;
const MEMORIZE_ANSWER_SECONDS = 3;
const MEMORIZE_ANSWER_MS = MEMORIZE_ANSWER_SECONDS * 1000;
const TAB_ROUTES: Record<TabKey, string> = {
  test: "/test",
  memorize: "/memorize",
  add: "/wordbooks/new",
  settings: "/settings",
  groups: "/groups",
  manage: "/wordbooks",
  answers: "/answers",
  admin: "/admin"
};
const PLAY_ROUTES: Record<PlayPageKey, string> = {
  testPlay: "/test/play",
  memorizePlay: "/memorize/play"
};

const addDraft: AddDraft = {
  uploadName: "",
  uploadGroup: "",
  uploadDescription: "",
  manualName: "",
  manualGroup: DEFAULT_GROUP_NAME,
  manualDescription: "",
  manualWords: ""
};

void bootstrap();

async function bootstrap(): Promise<void> {
  window.addEventListener("popstate", () => {
    void handleLocationChange();
  });

  await loadAuthState();
  if (!currentUser) {
    render();
    return;
  }

  if (window.location.pathname === "/") {
    window.history.replaceState(null, "", TAB_ROUTES.test);
  }

  applyRouteFromLocation();
  await refreshAll();
  await syncPageData();
}

async function refreshAll(): Promise<void> {
  if (!currentUser) {
    return;
  }

  const [groupList, bookList, resultList, sessionList] = await Promise.all([
    api<WordbookGroupSummary[]>("/api/groups"),
    api<WordbookSummary[]>("/api/wordbooks"),
    api<ResultSummary[]>("/api/results"),
    api<AuthSessionSummary[]>("/api/auth/sessions")
  ]);

  groups = groupList;
  wordbooks = bookList;
  results = resultList;
  authSessions = sessionList;

  if (currentUser.role === "admin") {
    await refreshAdminData();
  } else {
    adminUsers = [];
    adminWordbooks = [];
    adminLogs = [];
    selectedAdminWordbook = null;
    isAdminWordbookLoading = false;
  }

  syncAddDraftGroups();

  if (!selectedWordbookId && wordbooks[0]) {
    selectedWordbookId = wordbooks[0].id;
  }

  if (selectedWordbookId && !wordbooks.some((book) => book.id === selectedWordbookId)) {
    selectedWordbookId = wordbooks[0]?.id ?? "";
  }
}

function render(): void {
  const renderPath = window.location.pathname;
  const shouldPreserveScroll = currentUser && renderPath === lastRenderedPath && !activeTest && !activeMemorize;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  if (!currentUser) {
    app.innerHTML = renderAuthPage();
    bindEvents();
    lastRenderedPath = renderPath;
    return;
  }

  const isSessionActive = Boolean(activeTest || activeMemorize);
  app.innerHTML = `
    <div class="app-shell ${isSessionActive ? "is-testing" : ""} ${isSidebarOpen ? "sidebar-open" : ""}">
      ${isSessionActive ? "" : renderAppBar()}
      ${isSessionActive ? "" : renderSidebar()}
      ${!isSessionActive && isSidebarOpen ? `<button class="sidebar-backdrop" id="sidebar-backdrop" type="button" aria-label="메뉴 닫기"></button>` : ""}
      <main class="main ${isSessionActive ? "test-main" : ""}">
        ${toastMessage ? `<div class="toast" role="status">${escapeHtml(toastMessage)}</div>` : ""}
        ${renderTopActions()}
        ${renderMainContent()}
      </main>
    </div>
  `;

  bindEvents();
  if (shouldPreserveScroll) {
    window.scrollTo(scrollX, scrollY);
  }
  lastRenderedPath = renderPath;
}

function renderMainContent(): string {
  if (activeTest) {
    return renderActiveTest();
  }
  if (activeMemorize) {
    return renderActiveMemorize();
  }
  return renderCurrentTab();
}

function renderAuthPage(): string {
  return `
    <main class="auth-page">
      ${toastMessage ? `<div class="toast" role="status">${escapeHtml(toastMessage)}</div>` : ""}
      <section class="auth-panel">
        <div class="auth-brand">
          <div class="brand-mark">VS</div>
          <div>
            <h1>Voca Studio</h1>
            <p>로그인 후 내 단어장을 관리하세요.</p>
          </div>
        </div>

        <div class="auth-switch" role="tablist" aria-label="인증 방식">
          <button class="${authMode === "login" ? "is-active" : ""}" data-auth-mode="login" type="button" ${authHasUsers ? "" : "disabled"}>로그인</button>
          <button class="${authMode === "register" ? "is-active" : ""}" data-auth-mode="register" type="button">회원가입</button>
        </div>

        ${authMode === "register" ? renderRegisterForm() : renderLoginForm()}
      </section>
    </main>
  `;
}

function renderLoginForm(): string {
  return `
    <form class="auth-form" id="login-form">
      <label class="field">
        <span>아이디 또는 이메일</span>
        <input name="identifier" type="text" autocomplete="username" required />
      </label>
      <label class="field">
        <span>비밀번호</span>
        <input name="password" type="password" autocomplete="current-password" required />
      </label>
      <label class="checkbox-field">
        <input name="rememberMe" type="checkbox" value="1" />
        <span>자동 로그인</span>
      </label>
      <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>${isBusy ? "확인 중..." : "로그인"}</button>
    </form>
  `;
}

function renderRegisterForm(): string {
  return `
    <form class="auth-form" id="register-form">
      <label class="field">
        <span>이메일</span>
        <input name="email" type="email" autocomplete="email" maxlength="254" required />
      </label>
      <label class="field">
        <span>아이디</span>
        <input name="loginId" type="text" autocomplete="username" maxlength="32" pattern="[A-Za-z0-9._-]{3,32}" required />
      </label>
      <label class="field">
        <span>이름</span>
        <input name="name" type="text" autocomplete="name" maxlength="60" required />
      </label>
      <label class="field">
        <span>비밀번호</span>
        <input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
      </label>
      <p class="auth-hint">비밀번호는 12자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.</p>
      <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>${isBusy ? "생성 중..." : "회원가입"}</button>
    </form>
  `;
}

function renderAppBar(): string {
  return `
    <header class="app-bar">
      <button class="icon-button menu-button" id="menu-button" type="button" aria-label="메뉴 열기" aria-expanded="${isSidebarOpen}">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <div class="app-title">
        <strong>Voca Studio</strong>
        <span>${pageLabel(page)} · ${wordbooks.length}개 단어장</span>
      </div>
      <div class="app-actions">
        <button class="ghost-button compact-home-button" id="home-button" type="button">홈</button>
        <button class="ghost-button compact-logout-button" id="app-logout-button" type="button">로그아웃</button>
      </div>
    </header>
  `;
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">VS</div>
        <div>
          <h1>Voca Studio</h1>
          <p>${escapeHtml(currentUser?.name ?? "")} · ${currentUser?.role === "admin" ? "관리자" : "사용자"}</p>
        </div>
        <button class="icon-button close-button" id="close-menu-button" type="button" aria-label="메뉴 닫기">×</button>
      </div>

      <nav class="nav-tabs" aria-label="주요 메뉴">
        ${renderNavButton("test", "퀴즈")}
        ${renderNavButton("memorize", "암기 모드")}
        ${renderNavButton("add", "새 단어장")}
        ${renderNavButton("manage", "단어장")}
        ${renderNavButton("groups", "그룹")}
        ${renderNavButton("answers", "기록")}
        ${renderNavButton("settings", "설정")}
        ${currentUser?.role === "admin" ? renderNavButton("admin", "관리자") : ""}
      </nav>

      <section class="side-section account-section">
        <div class="side-heading">
          <span>${escapeHtml(currentUser?.loginId ?? "")}</span>
          <span>${groups.length} groups</span>
        </div>
        <button class="ghost-button" id="logout-button" type="button">로그아웃</button>
      </section>

      <section class="side-section">
        <div class="side-heading">
          <span>그룹별 단어장</span>
          <span>${totalWords()} words</span>
        </div>
        <div class="side-list">
          ${wordbooks.length ? groupedWordbooks().map(renderSidebarGroup).join("") : `<div class="empty-note">단어장이 없습니다.</div>`}
        </div>
      </section>
    </aside>
  `;
}

function renderTopActions(): string {
  if (!activeTest && !activeMemorize) {
    return "";
  }

  return `
    <div class="top-actions">
      <button class="ghost-button" id="stop-test-button" type="button">중단</button>
      <button class="ghost-button home-button" id="home-button" type="button">홈</button>
    </div>
  `;
}

function renderNavButton(key: TabKey, label: string): string {
  return `<a class="nav-button ${tab === key ? "is-active" : ""}" href="${TAB_ROUTES[key]}" data-route data-tab="${key}">${label}</a>`;
}

function renderWordbookItem(book: WordbookSummary): string {
  const active = book.id === selectedWordbookId ? "is-active" : "";
  return `
    <button class="list-item ${active}" data-wordbook-id="${book.id}" type="button">
      <span class="item-title">${escapeHtml(book.name)}</span>
      <span class="item-meta">${book.wordCount}개 · ${sourceLabel(book.source)}</span>
    </button>
  `;
}

function renderSidebarGroup(section: WordbookGroup): string {
  return `
    <div class="side-group">
      <div class="side-group-title">${escapeHtml(section.group)}</div>
      ${section.books.map(renderWordbookItem).join("")}
    </div>
  `;
}

function renderCurrentTab(): string {
  if (page === "memorize") {
    return renderMemorizeTab();
  }
  if (page === "add") {
    return renderAddTab();
  }
  if (page === "settings") {
    return renderSettingsTab();
  }
  if (page === "admin") {
    return renderAdminPage();
  }
  if (page === "manage") {
    return renderManageTab();
  }
  if (page === "groups") {
    return renderGroupsTab();
  }
  if (page === "answers") {
    return renderAnswersTab();
  }
  if (page === "answerDetail") {
    return renderAnswerDetailPage();
  }
  return renderTestTab();
}

function renderMemorizeTab(): string {
  const selected = selectedWordbook();
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">암기 모드</p>
        <h2>${selected ? escapeHtml(selected.name) : "학습할 단어장을 선택하세요"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="work-grid memorize-grid">
      <form class="panel test-panel" id="memorize-form">
        <label class="field">
          <span>단어장 선택</span>
          <select name="wordbookId" id="wordbook-select" ${wordbooks.length ? "" : "disabled"}>
            ${renderWordbookSelectOptions()}
          </select>
        </label>

        <label class="field">
          <span>앞면 표시 시간</span>
          <select name="displaySeconds">
            ${range(MEMORIZE_MIN_DISPLAY_SECONDS, MEMORIZE_MAX_DISPLAY_SECONDS).map((seconds) => `<option value="${seconds}" ${seconds === MEMORIZE_DEFAULT_DISPLAY_SECONDS ? "selected" : ""}>${seconds}초</option>`).join("")}
          </select>
        </label>

        <fieldset class="segmented memorize-segmented">
          <legend>앞면 구성</legend>
          ${renderMemorizeModeOption("en", "영어", true)}
          ${renderMemorizeModeOption("ko", "한국어")}
          ${renderMemorizeModeOption("both", "둘 다")}
        </fieldset>

        <button class="primary-button" type="submit" ${selected ? "" : "disabled"}>${isBusy ? "준비 중..." : "세션 시작"}</button>
      </form>

      <section class="panel detail-panel">
        <div class="metric-row">
          <div>
            <span class="metric-value">${selected?.wordCount ?? 0}</span>
            <span class="metric-label">학습 단어</span>
          </div>
          <div>
            <span class="metric-value">${MEMORIZE_ANSWER_SECONDS}</span>
            <span class="metric-label">해설 표시 초</span>
          </div>
        </div>
        ${selected ? renderBookDetail(selected) : `<div class="empty-note">먼저 단어장을 추가한 뒤 암기 세션을 시작하세요.</div>`}
      </section>
    </section>
  `;
}

function renderMemorizeModeOption(value: MemorizeDisplayMode, label: string, checked = false): string {
  return `
    <label class="segment">
      <input type="radio" name="mode" value="${value}" ${checked ? "checked" : ""} />
      <span>${label}</span>
    </label>
  `;
}

function renderTestTab(): string {
  const selected = selectedWordbook();
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">퀴즈 설정</p>
        <h2>${selected ? escapeHtml(selected.name) : "단어장을 추가하세요"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="work-grid">
      <form class="panel test-panel" id="start-form">
        <label class="field">
          <span>단어장 선택</span>
          <select name="wordbookId" id="wordbook-select" ${wordbooks.length ? "" : "disabled"}>
            ${renderWordbookSelectOptions()}
          </select>
        </label>

        <label class="field">
          <span>문제 개수</span>
          <select name="questionCount">
            ${[10, 20, 30, 40, 50].map((count) => `<option value="${count}" ${count === 30 ? "selected" : ""}>${count}개</option>`).join("")}
          </select>
        </label>

        <fieldset class="segmented">
          <legend>출제 언어</legend>
          ${renderModeOption("ko", "한글")}
          ${renderModeOption("en", "영어")}
          ${renderModeOption("rand", "랜덤", true)}
        </fieldset>

        <label class="field">
          <span>표시 시간</span>
          <select name="displaySeconds">
            ${range(3, 15).map((seconds) => `<option value="${seconds}" ${seconds === 5 ? "selected" : ""}>${seconds}초</option>`).join("")}
          </select>
        </label>

        <button class="primary-button" type="submit" ${selected ? "" : "disabled"}>${isBusy ? "시작 중..." : "퀴즈 시작"}</button>
      </form>

      <section class="panel detail-panel">
        <div class="metric-row">
          <div>
            <span class="metric-value">${selected?.wordCount ?? 0}</span>
            <span class="metric-label">단어</span>
          </div>
          <div>
            <span class="metric-value">${results.length}</span>
            <span class="metric-label">학습 기록</span>
          </div>
        </div>
        ${selected ? renderBookDetail(selected) : `<div class="empty-note">단어장을 새로 추가하세요.</div>`}
      </section>
    </section>
  `;
}

function renderModeOption(value: TestMode, label: string, checked = false): string {
  return `
    <label class="segment">
      <input type="radio" name="mode" value="${value}" ${checked ? "checked" : ""} />
      <span>${label}</span>
    </label>
  `;
}

function renderBookDetail(book: WordbookSummary): string {
  return `
    <div class="book-detail">
      <p class="eyebrow">${escapeHtml(book.group || DEFAULT_GROUP_NAME)}</p>
      <h3>${escapeHtml(book.name)}</h3>
      ${book.description ? `<p>${escapeHtml(book.description)}</p>` : ""}
      ${book.sourceFilename ? `<p class="muted">${escapeHtml(book.sourceFilename)}</p>` : ""}
      <dl>
        <div><dt>유형</dt><dd>${sourceLabel(book.source)}</dd></div>
        <div><dt>생성</dt><dd>${formatDate(book.createdAt)}</dd></div>
        <div><dt>수정</dt><dd>${formatDate(book.updatedAt)}</dd></div>
      </dl>
    </div>
  `;
}

function renderAddTab(): string {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">새 단어장</p>
        <h2>단어장을 만들어 저장하세요</h2>
      </div>
      <div class="header-actions">
        <button class="ghost-button" data-tab="groups" type="button">그룹</button>
        <a class="ghost-button" href="/examples/wordbook-example.json" download>JSON 예시 다운로드</a>
      </div>
    </section>

    <section class="add-grid">
      <form class="panel" id="upload-form">
        <h3>JSON 업로드</h3>
        <label class="field">
          <span>이름</span>
          <input name="name" data-draft-field="uploadName" type="text" maxlength="80" value="${escapeAttribute(addDraft.uploadName)}" placeholder="비우면 JSON 또는 파일명 사용" />
        </label>
        <label class="field">
          <span>그룹</span>
          <select name="group" data-draft-field="uploadGroup">
            <option value="" ${addDraft.uploadGroup ? "" : "selected"}>JSON 파일 값 사용</option>
            ${renderGroupSelectOptions(addDraft.uploadGroup)}
          </select>
        </label>
        <label class="field">
          <span>메모</span>
          <input name="description" data-draft-field="uploadDescription" type="text" maxlength="500" value="${escapeAttribute(addDraft.uploadDescription)}" />
        </label>
        <div class="json-guide">
          <strong>JSON 기준</strong>
          <code>{ "group": "HS관련", "name": "2단원", "words": [{ "english": "apple", "korean": "사과" }] }</code>
        </div>
        <label class="file-field">
          <input name="file" type="file" accept="application/json,.json" required />
          <span>JSON 파일 선택</span>
        </label>
        <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>업로드</button>
      </form>

      <form class="panel" id="manual-form">
        <h3>직접 입력</h3>
        <label class="field">
          <span>이름</span>
          <input name="name" data-draft-field="manualName" type="text" maxlength="80" value="${escapeAttribute(addDraft.manualName)}" required />
        </label>
        <label class="field">
          <span>그룹</span>
          <select name="group" data-draft-field="manualGroup">
            ${renderGroupSelectOptions(addDraft.manualGroup)}
          </select>
        </label>
        <label class="field">
          <span>메모</span>
          <input name="description" data-draft-field="manualDescription" type="text" maxlength="500" value="${escapeAttribute(addDraft.manualDescription)}" />
        </label>
        <label class="field textarea-field">
          <span>단어</span>
          <textarea name="words" data-draft-field="manualWords" rows="12" spellcheck="false" placeholder="apple = 사과&#10;take place, 일어나다&#10;valid&#9;타당한">${escapeHtml(addDraft.manualWords)}</textarea>
        </label>
        <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>저장</button>
      </form>
    </section>
  `;
}

function renderSettingsTab(): string {
  const user = currentUser;
  if (!user) {
    return "";
  }

  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">설정</p>
        <h2>계정과 화면 설정</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="settings-layout">
      <section class="panel theme-panel">
        <h3>화면</h3>
        <div class="theme-choice" role="group" aria-label="화면 모드">
          <button class="theme-option ${colorMode === "light" ? "is-active" : ""}" data-theme-mode="light" type="button">
            <span>라이트</span>
            <small>밝은 화면</small>
          </button>
          <button class="theme-option ${colorMode === "dark" ? "is-active" : ""}" data-theme-mode="dark" type="button">
            <span>다크</span>
            <small>어두운 화면</small>
          </button>
        </div>
      </section>

      <article class="panel profile-panel">
        <h3>계정</h3>
        <dl class="profile-list">
          <div><dt>아이디</dt><dd>${escapeHtml(user.loginId)}</dd></div>
          <div><dt>이메일</dt><dd>${escapeHtml(user.email)}</dd></div>
          <div><dt>권한</dt><dd>${user.role === "admin" ? "관리자" : "사용자"}</dd></div>
          <div><dt>가입</dt><dd>${formatDate(user.createdAt)}</dd></div>
        </dl>
      </article>

      <form class="panel password-panel" id="password-form">
        <h3>비밀번호 변경</h3>
        <label class="field">
          <span>현재 비밀번호</span>
          <input name="currentPassword" type="password" autocomplete="current-password" required />
        </label>
        <label class="field">
          <span>새 비밀번호</span>
          <input name="nextPassword" type="password" autocomplete="new-password" minlength="12" maxlength="128" required />
        </label>
        <p class="auth-hint">새 비밀번호는 12자 이상이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.</p>
        <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>변경</button>
      </form>

      <section class="panel management-panel">
        <h3>바로가기</h3>
        <div class="management-actions">
          <button class="ghost-button" data-tab="manage" type="button">단어장</button>
          <button class="ghost-button" data-tab="groups" type="button">그룹</button>
          <button class="primary-button" data-tab="add" type="button">새 단어장</button>
        </div>
      </section>

      <section class="panel session-panel">
        <div class="panel-title-row">
          <h3>로그인 세션</h3>
          ${authSessions.some((session) => !session.current) ? `<button class="ghost-button mini-button" id="revoke-other-sessions" type="button">다른 기기 종료</button>` : ""}
        </div>
        <div class="session-list">
          ${authSessions.length ? authSessions.map(renderAuthSession).join("") : `<div class="empty-note">세션 정보가 없습니다.</div>`}
        </div>
      </section>
    </section>
  `;
}

function renderAuthSession(session: AuthSessionSummary): string {
  return `
    <article class="session-card ${session.current ? "is-current" : ""}">
      <div>
        <strong>${session.current ? "현재 로그인" : sessionDeviceLabel(session.userAgent)}</strong>
        <span>${session.ipAddress ? escapeHtml(session.ipAddress) : "IP 없음"} · 최근 ${formatDate(session.lastSeenAt)}</span>
        <small>만료 ${formatDate(session.expiresAt)}</small>
      </div>
      ${session.current
        ? `<span class="status-pill">현재</span>`
        : `<button class="danger-button mini-button" data-revoke-session-id="${session.id}" type="button">종료</button>`}
    </article>
  `;
}

function renderAdminDashboard(): string {
  return `
    <section class="admin-dashboard">
      <div class="page-header admin-header">
        <div>
          <p class="eyebrow">관리자</p>
          <h2>사용자 · 서버로그 · 전체 단어장</h2>
        </div>
      </div>
      ${isAdminLoading ? `<div class="panel empty-note">관리자 데이터를 불러오는 중입니다.</div>` : `
        <div class="admin-grid">
          <article class="panel admin-panel">
            <h3>사용자</h3>
            ${adminUsers.length ? adminUsers.map(renderAdminUser).join("") : `<div class="empty-note">사용자가 없습니다.</div>`}
          </article>
          <article class="panel admin-panel">
            <h3>사용자 단어장</h3>
            ${adminWordbooks.length ? adminWordbooks.map(renderAdminWordbook).join("") : `<div class="empty-note">단어장이 없습니다.</div>`}
          </article>
          <article class="panel admin-panel admin-log-panel">
            <h3>서버로그</h3>
            ${adminLogs.length ? adminLogs.map(renderAuditLog).join("") : `<div class="empty-note">로그가 없습니다.</div>`}
          </article>
        </div>
        ${renderAdminWordbookDetail()}
      `}
    </section>
  `;
}

function renderAdminPage(): string {
  if (currentUser?.role !== "admin") {
    return `
      <section class="page-header">
        <div>
          <p class="eyebrow">관리자</p>
          <h2>접근할 수 없습니다</h2>
        </div>
      </section>
      <section class="panel">
        <div class="empty-note">관리자 권한이 필요합니다.</div>
      </section>
    `;
  }

  return renderAdminDashboard();
}

function renderAdminUser(user: AdminUserSummary): string {
  return `
    <article class="admin-row">
      <div>
        <strong>${escapeHtml(user.name)}</strong>
        <span>${escapeHtml(user.loginId)} · ${escapeHtml(user.email)}</span>
      </div>
      <small>${user.role === "admin" ? "관리자" : "사용자"}</small>
    </article>
  `;
}

function renderAdminWordbook(book: AdminWordbookSummary): string {
  const owner = book.ownerLoginId
    ? `${book.ownerLoginId}${book.ownerName ? ` / ${book.ownerName}` : ""}`
    : book.ownerId ?? "unknown";
  return `
    <article class="admin-row">
      <div>
        <strong>${escapeHtml(book.name)}</strong>
        <span>${escapeHtml(owner)} · ${escapeHtml(book.group || DEFAULT_GROUP_NAME)} · ${book.wordCount}개</span>
      </div>
      <button class="ghost-button mini-button" data-admin-wordbook-id="${book.id}" type="button">내용</button>
    </article>
  `;
}

function renderAdminWordbookDetail(): string {
  if (isAdminWordbookLoading) {
    return `<article class="panel admin-wordbook-detail"><div class="empty-note">단어장을 불러오는 중입니다.</div></article>`;
  }

  if (!selectedAdminWordbook) {
    return "";
  }

  const owner = selectedAdminWordbook.ownerLoginId
    ? `${selectedAdminWordbook.ownerLoginId}${selectedAdminWordbook.ownerName ? ` / ${selectedAdminWordbook.ownerName}` : ""}`
    : selectedAdminWordbook.ownerId ?? "unknown";

  return `
    <article class="panel admin-wordbook-detail">
      <div class="answer-toolbar">
        <div>
          <p class="eyebrow">${escapeHtml(owner)}</p>
          <h3>${escapeHtml(selectedAdminWordbook.name)}</h3>
        </div>
        <span class="admin-detail-meta">${escapeHtml(selectedAdminWordbook.group || DEFAULT_GROUP_NAME)} · ${selectedAdminWordbook.wordCount}개</span>
      </div>
      ${selectedAdminWordbook.description ? `<p class="muted">${escapeHtml(selectedAdminWordbook.description)}</p>` : ""}
      <div class="answer-table-wrap">
        <table class="answer-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>영어</th>
              <th>한글</th>
            </tr>
          </thead>
          <tbody>
            ${selectedAdminWordbook.words.map((word, index) => `
              <tr>
                <td>${index + 1}</td>
                <td>${escapeHtml(word.english)}</td>
                <td>${escapeHtml(word.korean)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderAuditLog(log: AuditLogEntry): string {
  return `
    <article class="admin-row log-row">
      <div>
        <strong>${escapeHtml(log.event)} · ${log.result === "success" ? "성공" : "실패"}</strong>
        <span>${escapeHtml(log.actorLoginId ?? "system")} · ${escapeHtml(log.message ?? "")}</span>
      </div>
      <small>${formatDate(log.createdAt)}</small>
    </article>
  `;
}

function renderManageTab(): string {
  const visibleWordbooks = filteredWordbooks();
  const visibleGroups = groupedWordbooks(visibleWordbooks);
  const hasSearch = Boolean(wordbookSearch.trim());

  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">단어장</p>
        <h2>${wordbooks.length ? "저장된 단어장" : "단어장이 없습니다"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="manage-layout">
      <div class="panel manage-summary">
        <form class="search-form" id="wordbook-search-form">
          <label class="field search-field">
            <span>단어장 검색</span>
            <input name="query" type="search" maxlength="120" value="${escapeAttribute(wordbookSearch)}" placeholder="이름, 그룹, 메모" />
          </label>
          <div class="search-actions">
            <button class="primary-button mini-button" type="submit">검색</button>
            ${hasSearch ? `<button class="ghost-button mini-button" id="clear-wordbook-search" type="button">초기화</button>` : ""}
          </div>
        </form>
        <div class="metric-row">
          <div>
            <span class="metric-value">${hasSearch ? visibleWordbooks.length : wordbooks.length}</span>
            <span class="metric-label">${hasSearch ? "검색 결과" : "단어장"}</span>
          </div>
          <div>
            <span class="metric-value">${groups.length}</span>
            <span class="metric-label">그룹</span>
          </div>
        </div>
        <div class="metric-row single-metric">
          <div>
            <span class="metric-value">${totalWords()}</span>
            <span class="metric-label">총 단어</span>
          </div>
        </div>
        <div class="stacked-actions">
          <button class="primary-button" data-tab="add" type="button">새 단어장</button>
          <button class="ghost-button" data-tab="groups" type="button">그룹</button>
        </div>
      </div>

      <div class="panel manage-list">
        ${visibleWordbooks.length
          ? visibleGroups.map(renderManageGroup).join("")
          : `<div class="empty-note">${hasSearch ? "검색 결과가 없습니다." : "JSON 업로드나 직접 입력으로 새 단어장을 추가하세요."}</div>`}
      </div>
    </section>
  `;
}

function renderManageGroup(section: WordbookGroup): string {
  const wordCount = section.books.reduce((sum, book) => sum + book.wordCount, 0);
  return `
    <section class="manage-group">
      <div class="group-heading">
        <span>${escapeHtml(section.group)}</span>
        <small>${section.books.length}개 단어장 · ${wordCount}개 단어</small>
      </div>
      ${section.books.map(renderManageItem).join("")}
    </section>
  `;
}

function renderManageItem(book: WordbookSummary): string {
  if (editingWordbookId === book.id) {
    return renderWordbookEditForm(book);
  }

  return `
    <article class="manage-item">
      <div>
        <h3>${escapeHtml(book.name)}</h3>
        <p>${escapeHtml(book.group || DEFAULT_GROUP_NAME)} · ${book.wordCount}개 · ${sourceLabel(book.source)} · ${formatDate(book.createdAt)}</p>
        ${book.description ? `<p class="muted">${escapeHtml(book.description)}</p>` : ""}
      </div>
      <div class="manage-actions">
        <button class="ghost-button" data-use-wordbook-id="${book.id}" type="button">퀴즈</button>
        <button class="ghost-button" data-memorize-wordbook-id="${book.id}" type="button">암기</button>
        <button class="ghost-button" data-edit-wordbook-id="${book.id}" type="button">편집</button>
        <a class="ghost-button" href="/api/wordbooks/${book.id}/download" download>JSON</a>
        <button class="danger-button" data-delete-wordbook-id="${book.id}" type="button">삭제</button>
      </div>
    </article>
  `;
}

function renderWordbookEditForm(book: WordbookSummary): string {
  return `
    <form class="manage-item edit-wordbook-form" data-edit-wordbook-form="${book.id}">
      <div class="edit-wordbook-fields">
        <label class="field">
          <span>이름</span>
          <input name="name" type="text" maxlength="80" value="${escapeAttribute(book.name)}" required />
        </label>
        <label class="field">
          <span>그룹</span>
          <select name="group">
            ${renderGroupSelectOptions(book.group)}
          </select>
        </label>
        <label class="field">
          <span>메모</span>
          <input name="description" type="text" maxlength="500" value="${escapeAttribute(book.description)}" />
        </label>
      </div>
      <div class="manage-actions">
        <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>저장</button>
        <button class="ghost-button" data-cancel-edit-wordbook type="button">취소</button>
      </div>
    </form>
  `;
}

function renderGroupsTab(): string {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">그룹</p>
        <h2>${groups.length ? "단어장 그룹" : "그룹을 추가하세요"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="groups-layout">
      <form class="panel group-create-form" id="group-create-form">
        <h3>새 그룹</h3>
        <label class="field">
          <span>그룹 이름</span>
          <input name="name" type="text" maxlength="60" placeholder="예: HS관련" required />
        </label>
        <button class="primary-button" type="submit" ${isBusy ? "disabled" : ""}>그룹 추가</button>
      </form>

      <div class="panel group-list">
        ${groups.length ? groups.map(renderGroupManageItem).join("") : `<div class="empty-note">그룹을 먼저 만들면 단어장 추가 화면에서 선택할 수 있습니다.</div>`}
      </div>
    </section>
  `;
}

function renderGroupManageItem(group: WordbookGroupSummary): string {
  const canDelete = group.name !== DEFAULT_GROUP_NAME;
  return `
    <article class="group-card">
      <div class="group-card-main">
        <form class="group-rename-form" data-rename-group-id="${group.id}">
          <label>
            <span>그룹 이름</span>
            <input name="name" type="text" maxlength="60" value="${escapeAttribute(group.name)}" required />
          </label>
          <button class="ghost-button" type="submit">이름 변경</button>
        </form>
        <p>${group.wordbookCount}개 단어장 · ${group.wordCount}개 단어</p>
      </div>
      <div class="manage-actions">
        <button class="danger-button" data-delete-group-id="${group.id}" type="button" ${canDelete ? "" : "disabled"}>삭제</button>
      </div>
    </article>
  `;
}

function renderAnswersTab(): string {
  const visibleResults = filteredResults();
  const hasSearch = Boolean(answerSearch.trim());

  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">학습 기록</p>
        <h2>${results.length ? `${hasSearch ? visibleResults.length : results.length}개 저장됨` : "저장된 기록"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="answer-list-page">
      <div class="panel answer-index answer-list-panel">
        <div class="answer-index-top">
          <div>
            <p class="eyebrow">최근순</p>
            <h3>${visibleResults.length ? "기록 목록" : "기록 없음"}</h3>
          </div>
          ${visibleResults[0] ? `<span>${formatDate(visibleResults[0].createdAt)}</span>` : ""}
        </div>
        <form class="search-form answer-search-form" id="answer-search-form">
          <label class="field search-field">
            <span>기록 검색</span>
            <input name="query" type="search" maxlength="120" value="${escapeAttribute(answerSearch)}" placeholder="단어장, 출제 방식" />
          </label>
          <div class="search-actions">
            <button class="primary-button mini-button" type="submit">검색</button>
            ${hasSearch ? `<button class="ghost-button mini-button" id="clear-answer-search" type="button">초기화</button>` : ""}
          </div>
        </form>
        ${visibleResults.length ? `
          <div class="answer-list answer-list-full">
            ${visibleResults.map(renderResultItem).join("")}
          </div>
        ` : `<div class="empty-note">${hasSearch ? "검색 결과가 없습니다." : "아직 저장된 학습 기록이 없습니다."}</div>`}
      </div>
    </section>
  `;
}

function renderAnswerDetailPage(): string {
  const activeId = currentAnswerSelectionId();
  const result = selectedResult?.id === activeId ? selectedResult : null;

  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">기록 상세</p>
        <h2>${result ? escapeHtml(result.wordbookName) : "학습 기록"}</h2>
      </div>
      <div class="header-actions">
        <a class="ghost-button" href="${TAB_ROUTES.answers}" data-route>목록</a>
        <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
      </div>
    </section>

    <section class="answer-detail-layout">
      <article class="panel answer-detail">
        ${isAnswerLoading
          ? `<div class="empty-note">학습 기록을 불러오는 중입니다.</div>`
          : result
            ? renderResultDetail(result)
            : `<div class="empty-note">확인할 기록을 선택하세요.</div>`}
      </article>
    </section>
  `;
}

function renderResultItem(result: ResultSummary): string {
  const active = currentAnswerSelectionId() === result.id ? "is-active" : "";
  return `
    <a class="list-item ${active}" href="${answerDetailPath(result.id)}" data-route data-result-id="${result.id}">
      <span class="item-title">${escapeHtml(result.wordbookName)}</span>
      <span class="item-meta">${result.questionCount}개 · ${modeLabel(result.mode)} · ${formatDate(result.createdAt)}</span>
    </a>
  `;
}

function renderResultDetail(result: TestResult): string {
  return `
    <div class="answer-toolbar">
      <div>
        <p class="eyebrow">${formatDate(result.createdAt)}</p>
        <h3>${escapeHtml(result.wordbookName)}</h3>
      </div>
      <div class="download-group">
        <a class="ghost-button" href="/api/results/${result.id}/download?format=csv">CSV</a>
        <a class="ghost-button" href="/api/results/${result.id}/download?format=txt">TXT</a>
        <a class="ghost-button" href="/api/results/${result.id}/download?format=json">JSON</a>
      </div>
    </div>
    <div class="answer-summary">
      <span>${result.questionCount}문제</span>
      <span>${modeLabel(result.mode)} 출제</span>
      <span>${result.displaySeconds}초 표시</span>
    </div>
    <div class="answer-card-list">
      ${result.answers.map((entry) => `
        <article class="answer-card">
          <div class="answer-number">${entry.index}</div>
          <div class="answer-card-body">
            <div>
              <span>문제</span>
              <strong>${escapeHtml(entry.prompt)}</strong>
            </div>
            <div>
              <span>정답</span>
              <strong>${escapeHtml(entry.answer)}</strong>
            </div>
          </div>
        </article>
      `).join("")}
    </div>
    <div class="answer-table-wrap">
      <table class="answer-table">
        <thead>
          <tr>
            <th>번호</th>
            <th>문제</th>
            <th>정답</th>
          </tr>
        </thead>
        <tbody>
          ${result.answers.map((entry) => `
            <tr>
              <td>${entry.index}</td>
              <td>${escapeHtml(entry.prompt)}</td>
              <td>${escapeHtml(entry.answer)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderActiveTest(): string {
  if (!activeTest) {
    return "";
  }

  if (activeTest.phase === "countdown") {
    return `
      <section class="test-stage is-simple">
        <div class="stage-top">
          <span>${escapeHtml(activeTest.result.wordbookName)}</span>
        </div>
        <div class="stage-center">
          <p class="eyebrow">시작</p>
          <div class="countdown">${activeTest.countdown}</div>
        </div>
      </section>
    `;
  }

  if (activeTest.phase === "done") {
    return `
      <section class="test-stage is-simple">
        <div class="stage-center">
          <p class="eyebrow">완료</p>
          <h2>학습 기록을 저장했습니다.</h2>
        </div>
      </section>
    `;
  }

  const entry = activeTest.result.answers[activeTest.currentIndex];
  const progress = `${entry.index} / ${activeTest.result.questionCount}`;
  const progressPercent = Math.round((entry.index / activeTest.result.questionCount) * 100);
  const timePercent = Math.max(0, Math.min(100, (activeTest.remainingMs / (activeTest.result.displaySeconds * 1000)) * 100));
  const secondsLeft = Math.ceil(activeTest.remainingMs / 1000);

  return `
    <section class="test-stage">
      <div class="stage-top">
        <span>${progress}</span>
        <span data-time-left>${secondsLeft}s</span>
      </div>
      <div class="progress" aria-label="진행률">
        <progress value="${progressPercent}" max="100"></progress>
      </div>
      <div class="stage-center">
        <div class="prompt-word">${escapeHtml(entry.prompt)}</div>
      </div>
      <div class="time-gauge" aria-label="남은 시간">
        <progress data-time-progress value="${timePercent}" max="100"></progress>
      </div>
    </section>
  `;
}

function renderActiveMemorize(): string {
  if (!activeMemorize) {
    return "";
  }

  if (activeMemorize.phase === "done") {
    return `
      <section class="test-stage is-simple">
        <div class="stage-center">
          <p class="eyebrow">완료</p>
          <h2>단어장을 끝까지 봤습니다.</h2>
        </div>
      </section>
    `;
  }

  const word = activeMemorize.words[activeMemorize.currentIndex];
  const progress = `${activeMemorize.currentIndex + 1} / ${activeMemorize.words.length}`;
  const durationMs = activeMemorize.phase === "answer" ? MEMORIZE_ANSWER_MS : activeMemorize.displaySeconds * 1000;
  const progressPercent = Math.round(((activeMemorize.currentIndex + 1) / activeMemorize.words.length) * 100);
  const timePercent = Math.max(0, Math.min(100, (activeMemorize.remainingMs / durationMs) * 100));
  const secondsLeft = Math.ceil(activeMemorize.remainingMs / 1000);
  const prompt = memorizePromptFor(word, activeMemorize.mode);
  const answer = memorizeAnswerFor(word, activeMemorize.mode);

  return `
    <section class="test-stage memorize-stage">
      <div class="stage-top">
        <span>${escapeHtml(activeMemorize.wordbookName)} · ${progress}</span>
        <span data-time-left>${secondsLeft}s</span>
      </div>
      <div class="progress" aria-label="진행률">
        <progress value="${progressPercent}" max="100"></progress>
      </div>
      <div class="stage-center memorize-center">
        <div class="memory-card ${activeMemorize.phase === "answer" ? "is-answer" : ""}">
          <div class="prompt-word memory-prompt">${escapeHtml(prompt)}</div>
          ${activeMemorize.phase === "answer" ? `<div class="memory-answer">${escapeHtml(answer)}</div>` : ""}
        </div>
      </div>
      <div class="time-gauge" aria-label="남은 시간">
        <progress data-time-progress value="${timePercent}" max="100"></progress>
      </div>
    </section>
  `;
}

function bindEvents(): void {
  if (!currentUser) {
    bindAuthEvents();
    return;
  }

  document.querySelector<HTMLButtonElement>("#menu-button")?.addEventListener("click", () => {
    isSidebarOpen = !isSidebarOpen;
    render();
  });

  document.querySelector<HTMLButtonElement>("#close-menu-button")?.addEventListener("click", () => {
    isSidebarOpen = false;
    render();
  });

  document.querySelector<HTMLButtonElement>("#sidebar-backdrop")?.addEventListener("click", () => {
    isSidebarOpen = false;
    render();
  });

  document.querySelectorAll<HTMLAnchorElement>("a[data-route]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return;
      }
      event.preventDefault();
      navigateToPath(link.pathname);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("button[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      navigateToTab(button.dataset.tab as TabKey);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedWordbookId = button.dataset.wordbookId ?? "";
      isSidebarOpen = false;
      clearToast();
      navigateToTab("test");
    });
  });

  document.querySelector<HTMLSelectElement>("#wordbook-select")?.addEventListener("change", (event) => {
    selectedWordbookId = (event.currentTarget as HTMLSelectElement).value;
    clearToast();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-use-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedWordbookId = button.dataset.useWordbookId ?? "";
      selectedResult = null;
      selectedResultId = "";
      editingWordbookId = "";
      isSidebarOpen = false;
      clearToast();
      navigateToTab("test");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-memorize-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedWordbookId = button.dataset.memorizeWordbookId ?? "";
      selectedResult = null;
      selectedResultId = "";
      editingWordbookId = "";
      isSidebarOpen = false;
      clearToast();
      navigateToTab("memorize");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-edit-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      editingWordbookId = button.dataset.editWordbookId ?? "";
      clearToast();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-cancel-edit-wordbook]").forEach((button) => {
    button.addEventListener("click", () => {
      editingWordbookId = "";
      clearToast();
      render();
    });
  });

  document.querySelectorAll<HTMLFormElement>("[data-edit-wordbook-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void updateWordbookFromForm(form.dataset.editWordbookForm ?? "", new FormData(form));
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void deleteWordbookById(button.dataset.deleteWordbookId ?? "");
    });
  });

  document.querySelector<HTMLButtonElement>("#home-button")?.addEventListener("click", () => {
    void goHome();
  });

  document.querySelector<HTMLButtonElement>("#stop-test-button")?.addEventListener("click", () => {
    if (activeMemorize) {
      abortActiveMemorize();
      return;
    }
    void abortActiveTest();
  });

  document.querySelector<HTMLFormElement>("#start-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void beginTest(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelector<HTMLFormElement>("#memorize-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void beginMemorize(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelector<HTMLFormElement>("#upload-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void uploadWordbook(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelector<HTMLFormElement>("#manual-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveManualWordbook(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-draft-field]").forEach((field) => {
    field.addEventListener("input", () => updateAddDraftField(field));
    field.addEventListener("change", () => updateAddDraftField(field));
  });

  document.querySelector<HTMLFormElement>("#group-create-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void createGroupFromForm(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelectorAll<HTMLFormElement>("[data-rename-group-id]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void renameGroupFromForm(form.dataset.renameGroupId ?? "", new FormData(form));
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-group-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void deleteGroupById(button.dataset.deleteGroupId ?? "");
    });
  });

  document.querySelector<HTMLButtonElement>("#refresh-button")?.addEventListener("click", () => {
    void refreshAndRender();
  });

  document.querySelector<HTMLFormElement>("#wordbook-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    wordbookSearch = String(new FormData(event.currentTarget as HTMLFormElement).get("query") ?? "").trim();
    clearToast();
    render();
  });

  document.querySelector<HTMLButtonElement>("#clear-wordbook-search")?.addEventListener("click", () => {
    wordbookSearch = "";
    clearToast();
    render();
  });

  document.querySelector<HTMLFormElement>("#answer-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    answerSearch = String(new FormData(event.currentTarget as HTMLFormElement).get("query") ?? "").trim();
    clearToast();
    render();
  });

  document.querySelector<HTMLButtonElement>("#clear-answer-search")?.addEventListener("click", () => {
    answerSearch = "";
    clearToast();
    render();
  });

  document.querySelector<HTMLButtonElement>("#logout-button")?.addEventListener("click", () => {
    void logout();
  });

  document.querySelector<HTMLButtonElement>("#app-logout-button")?.addEventListener("click", () => {
    void logout();
  });

  document.querySelector<HTMLFormElement>("#password-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void changePasswordFromForm(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelectorAll<HTMLButtonElement>("[data-theme-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setColorMode(button.dataset.themeMode === "dark" ? "dark" : "light");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-revoke-session-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void revokeSessionById(button.dataset.revokeSessionId ?? "");
    });
  });

  document.querySelector<HTMLButtonElement>("#revoke-other-sessions")?.addEventListener("click", () => {
    void revokeOtherSessions();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-admin-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void loadAdminWordbookDetail(button.dataset.adminWordbookId ?? "");
    });
  });
}

function bindAuthEvents(): void {
  document.querySelectorAll<HTMLButtonElement>("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      authMode = button.dataset.authMode === "register" ? "register" : "login";
      clearToast();
      render();
    });
  });

  document.querySelector<HTMLFormElement>("#login-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void login(new FormData(event.currentTarget as HTMLFormElement));
  });

  document.querySelector<HTMLFormElement>("#register-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void register(new FormData(event.currentTarget as HTMLFormElement));
  });
}

async function loadAuthState(): Promise<void> {
  try {
    const auth = await api<AuthResponse>("/api/auth/me");
    currentUser = auth.authenticated ? auth.user ?? null : null;
    csrfToken = auth.csrfToken ?? "";
    authHasUsers = auth.hasUsers;
    authMode = auth.hasUsers ? "login" : "register";
  } catch {
    currentUser = null;
    csrfToken = "";
    authHasUsers = true;
    authMode = "login";
  }
}

async function login(formData: FormData): Promise<void> {
  await withBusy(async () => {
    const auth = await api<AuthResponse>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: String(formData.get("identifier") ?? ""),
        password: String(formData.get("password") ?? ""),
        rememberMe: formData.get("rememberMe") === "1"
      })
    });
    await applyAuthenticatedState(auth);
    showToast("로그인했습니다.");
  });
}

async function register(formData: FormData): Promise<void> {
  await withBusy(async () => {
    const auth = await api<AuthResponse>("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: String(formData.get("email") ?? ""),
        loginId: String(formData.get("loginId") ?? ""),
        name: String(formData.get("name") ?? ""),
        password: String(formData.get("password") ?? "")
      })
    });
    await applyAuthenticatedState(auth);
    showToast(currentUser?.role === "admin" ? "관리자 계정을 생성했습니다." : "회원가입을 완료했습니다.");
  });
}

async function applyAuthenticatedState(auth: AuthResponse): Promise<void> {
  currentUser = auth.user ?? null;
  csrfToken = auth.csrfToken ?? "";
  authHasUsers = auth.hasUsers;
  if (!currentUser) {
    throw new Error("인증 응답이 올바르지 않습니다.");
  }

  if (window.location.pathname === "/") {
    window.history.replaceState(null, "", TAB_ROUTES.test);
  }
  applyRouteFromLocation();
  await refreshAll();
  await syncPageData();
}

async function logout(): Promise<void> {
  await withBusy(async () => {
    await api<void>("/api/auth/logout", { method: "POST" });
    resetAuthenticatedState();
    window.history.replaceState(null, "", "/");
    showToast("로그아웃했습니다.");
  });
}

async function changePasswordFromForm(formData: FormData): Promise<void> {
  await withBusy(async () => {
    await api<void>("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: String(formData.get("currentPassword") ?? ""),
        nextPassword: String(formData.get("nextPassword") ?? "")
      })
    });
    showToast("비밀번호를 변경했습니다.");
    await refreshAll();
  });
}

async function refreshAdminData(): Promise<void> {
  if (!currentUser || currentUser.role !== "admin") {
    return;
  }

  isAdminLoading = true;
  try {
    const [users, wordbookList, logs] = await Promise.all([
      api<AdminUserSummary[]>("/api/admin/users"),
      api<AdminWordbookSummary[]>("/api/admin/wordbooks"),
      api<AuditLogEntry[]>("/api/admin/logs")
    ]);
    adminUsers = users;
    adminWordbooks = wordbookList;
    adminLogs = logs;
    if (selectedAdminWordbook && !adminWordbooks.some((book) => book.id === selectedAdminWordbook?.id)) {
      selectedAdminWordbook = null;
    }
  } finally {
    isAdminLoading = false;
  }
}

async function loadAdminWordbookDetail(id: string): Promise<void> {
  if (!id) {
    return;
  }

  isAdminWordbookLoading = true;
  render();
  try {
    selectedAdminWordbook = await api<AdminWordbookDetail>(`/api/admin/wordbooks/${id}`);
  } catch (error) {
    selectedAdminWordbook = null;
    showToast(error instanceof Error ? error.message : "단어장 내용을 불러오지 못했습니다.");
  } finally {
    isAdminWordbookLoading = false;
    render();
  }
}

function resetAuthenticatedState(): void {
  currentUser = null;
  csrfToken = "";
  wordbooks = [];
  groups = [];
  results = [];
  adminUsers = [];
  adminWordbooks = [];
  adminLogs = [];
  selectedAdminWordbook = null;
  isAdminWordbookLoading = false;
  selectedWordbookId = "";
  selectedResult = null;
  selectedResultId = "";
  activeTest = null;
  activeMemorize = null;
  wordbookSearch = "";
  answerSearch = "";
  editingWordbookId = "";
  authSessions = [];
  clearTimer();
}

async function beginTest(formData: FormData): Promise<void> {
  const formWordbookId = String(formData.get("wordbookId") ?? "");
  if (formWordbookId) {
    selectedWordbookId = formWordbookId;
  }

  if (!selectedWordbookId) {
    showToast("단어장을 선택하세요.");
    return;
  }

  await withBusy(async () => {
    const result = await api<TestResult>("/api/tests/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        wordbookId: selectedWordbookId,
        questionCount: Number(formData.get("questionCount")),
        mode: String(formData.get("mode") || "rand"),
        displaySeconds: Number(formData.get("displaySeconds"))
      })
    });
    startCountdown(result);
  });
}

async function beginMemorize(formData: FormData): Promise<void> {
  const formWordbookId = String(formData.get("wordbookId") ?? "");
  if (formWordbookId) {
    selectedWordbookId = formWordbookId;
  }

  if (!selectedWordbookId) {
    showToast("단어장을 선택하세요.");
    return;
  }

  const displaySeconds = Number(formData.get("displaySeconds"));
  if (!Number.isInteger(displaySeconds) || displaySeconds < MEMORIZE_MIN_DISPLAY_SECONDS || displaySeconds > MEMORIZE_MAX_DISPLAY_SECONDS) {
    showToast(`표시 시간은 ${MEMORIZE_MIN_DISPLAY_SECONDS}초 이상 ${MEMORIZE_MAX_DISPLAY_SECONDS}초 이하만 가능합니다.`);
    return;
  }

  const mode = parseMemorizeMode(formData.get("mode"));
  await withBusy(async () => {
    const wordbook = await api<WordbookDetail>(`/api/wordbooks/${selectedWordbookId}`);
    const words = shuffleWords(wordbook.words);
    if (!words.length) {
      showToast("암기할 단어가 없습니다.");
      return;
    }

    startMemorize({
      wordbookId: wordbook.id,
      wordbookName: wordbook.name,
      words,
      displaySeconds,
      mode
    });
  });
}

async function uploadWordbook(formData: FormData): Promise<void> {
  await withBusy(async () => {
    const created = await api<WordbookSummary>("/api/wordbooks/upload", {
      method: "POST",
      body: formData
    });
    selectedWordbookId = created.id;
    resetUploadDraft();
    showToast("단어장을 저장했습니다.");
    await refreshAll();
    navigateToTab("test");
  });
}

async function saveManualWordbook(formData: FormData): Promise<void> {
  const words = parseManualWords(String(formData.get("words") ?? ""));
  if (words.length === 0) {
    showToast("입력된 단어를 확인하세요.");
    return;
  }

  await withBusy(async () => {
    const created = await api<WordbookSummary>("/api/wordbooks/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        group: String(formData.get("group") ?? ""),
        description: String(formData.get("description") ?? ""),
        words
      })
    });
    selectedWordbookId = created.id;
    resetManualDraft();
    showToast("단어장을 저장했습니다.");
    await refreshAll();
    navigateToTab("test");
  });
}

async function createGroupFromForm(formData: FormData): Promise<void> {
  await withBusy(async () => {
    const created = await api<WordbookGroupSummary>("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(formData.get("name") ?? "") })
    });
    addDraft.manualGroup = created.name;
    showToast("그룹을 추가했습니다.");
    await refreshAll();
  });
}

async function renameGroupFromForm(id: string, formData: FormData): Promise<void> {
  if (!id) {
    return;
  }

  const group = groups.find((entry) => entry.id === id);
  if (!group) {
    return;
  }

  const nextName = String(formData.get("name") ?? "");
  await withBusy(async () => {
    const renamed = await api<WordbookGroupSummary>(`/api/groups/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nextName })
    });
    updateDraftGroupName(group.name, renamed.name);
    showToast("그룹 이름을 변경했습니다.");
    await refreshAll();
  });
}

async function deleteGroupById(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const group = groups.find((entry) => entry.id === id);
  const detail = group && group.wordbookCount > 0
    ? `\n\n이 그룹의 단어장 ${group.wordbookCount}개도 같이 삭제됩니다.`
    : "";
  const confirmed = window.confirm(`${group?.name ?? "그룹"}을 삭제할까요?${detail}`);
  if (!confirmed) {
    return;
  }

  await withBusy(async () => {
    await api<void>(`/api/groups/${id}`, { method: "DELETE" });
    showToast("그룹을 삭제했습니다.");
    await refreshAll();
  });
}

async function loadResultDetail(id: string): Promise<void> {
  const requestToken = ++answerRequestToken;
  selectedResultId = id;
  if (selectedResult?.id !== id) {
    selectedResult = null;
  }
  isAnswerLoading = true;
  clearToast();
  render();

  try {
    const result = await api<TestResult>(`/api/results/${id}`);
    if (requestToken !== answerRequestToken) {
      return;
    }
    selectedResult = result;
  } catch (error) {
    if (requestToken !== answerRequestToken) {
      return;
    }
    selectedResult = null;
    selectedResultId = "";
    showToast(error instanceof Error ? error.message : "학습 기록을 불러오지 못했습니다.");
    navigateToTab("answers", true);
  } finally {
    if (requestToken === answerRequestToken) {
      isAnswerLoading = false;
      render();
    }
  }
}

async function deleteWordbookById(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const book = wordbooks.find((entry) => entry.id === id);
  const confirmed = window.confirm(`${book?.name ?? "단어장"}을 삭제할까요?`);
  if (!confirmed) {
    return;
  }

  await withBusy(async () => {
    await api<void>(`/api/wordbooks/${id}`, { method: "DELETE" });
    if (selectedWordbookId === id) {
      selectedWordbookId = "";
    }
    if (editingWordbookId === id) {
      editingWordbookId = "";
    }
    showToast("단어장을 삭제했습니다.");
    await refreshAll();
  });
}

async function updateWordbookFromForm(id: string, formData: FormData): Promise<void> {
  if (!id) {
    return;
  }

  await withBusy(async () => {
    const updated = await api<WordbookSummary>(`/api/wordbooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(formData.get("name") ?? ""),
        group: String(formData.get("group") ?? ""),
        description: String(formData.get("description") ?? "")
      })
    });
    selectedWordbookId = updated.id;
    editingWordbookId = "";
    showToast("단어장을 수정했습니다.");
    await refreshAll();
  });
}

async function revokeSessionById(id: string): Promise<void> {
  if (!id) {
    return;
  }

  const session = authSessions.find((entry) => entry.id === id);
  const confirmed = window.confirm(`${sessionDeviceLabel(session?.userAgent)} 세션을 종료할까요?`);
  if (!confirmed) {
    return;
  }

  await withBusy(async () => {
    await api<void>(`/api/auth/sessions/${id}`, { method: "DELETE" });
    showToast("세션을 종료했습니다.");
    await refreshAll();
  });
}

async function revokeOtherSessions(): Promise<void> {
  const confirmed = window.confirm("현재 로그인 외의 모든 세션을 종료할까요?");
  if (!confirmed) {
    return;
  }

  await withBusy(async () => {
    await api<void>("/api/auth/sessions/revoke-others", { method: "POST" });
    showToast("다른 기기 로그인을 종료했습니다.");
    await refreshAll();
  });
}

async function goHome(): Promise<void> {
  if (activeTest) {
    const confirmed = window.confirm("퀴즈를 중단하고 홈으로 돌아갈까요?");
    if (!confirmed) {
      return;
    }
    await abortActiveTest();
    return;
  }

  if (activeMemorize) {
    const confirmed = window.confirm("암기를 중단하고 홈으로 돌아갈까요?");
    if (!confirmed) {
      return;
    }
    abortActiveMemorize("test");
    return;
  }

  selectedResult = null;
  selectedResultId = "";
  clearToast();
  navigateToTab("test");
}

function startCountdown(result: TestResult): void {
  clearTimer();
  activeTest = {
    phase: "countdown",
    result,
    countdown: 3,
    currentIndex: -1,
    remainingMs: result.displaySeconds * 1000
  };
  navigateToPath(PLAY_ROUTES.testPlay);
  render();
  timer = window.setInterval(() => {
    if (!activeTest) {
      clearTimer();
      return;
    }

    activeTest.countdown -= 1;
    if (activeTest.countdown <= 0) {
      clearTimer();
      showQuestion(0);
      return;
    }

    render();
  }, 1000);
}

function showQuestion(index: number): void {
  if (!activeTest) {
    return;
  }

  if (index >= activeTest.result.answers.length) {
    void finishActiveTest();
    return;
  }

  clearTimer();
  activeTest.phase = "running";
  activeTest.currentIndex = index;
  activeTest.remainingMs = activeTest.result.displaySeconds * 1000;
  render();

  const endAt = Date.now() + activeTest.result.displaySeconds * 1000;
  timer = window.setInterval(() => {
    if (!activeTest) {
      clearTimer();
      return;
    }

    activeTest.remainingMs = Math.max(0, endAt - Date.now());
    if (activeTest.remainingMs <= 0) {
      clearTimer();
      showQuestion(index + 1);
      return;
    }

    updateActiveTimerView(activeTest.remainingMs, activeTest.result.displaySeconds * 1000);
  }, 100);
}

async function finishActiveTest(): Promise<void> {
  if (!activeTest) {
    return;
  }

  clearTimer();
  activeTest.phase = "done";
  render();

  const completed = await api<TestResult>(`/api/results/${activeTest.result.id}/complete`, {
    method: "PATCH"
  });
  selectedResult = completed;
  selectedResultId = completed.id;
  activeTest = null;
  showToast("학습 기록을 저장했습니다.");
  await refreshAll();
  navigateToAnswerDetail(completed.id, true);
}

async function abortActiveTest(nextTab: TabKey = "test", replace = true): Promise<void> {
  if (!activeTest) {
    return;
  }

  const resultId = activeTest.result.id;
  clearTimer();
  activeTest = null;
  showToast("퀴즈를 중단했습니다.");
  render();
  await api<void>(`/api/results/${resultId}`, { method: "DELETE" }).catch(() => undefined);
  await refreshAll();
  navigateToTab(nextTab, replace);
}

function startMemorize(input: Omit<ActiveMemorize, "phase" | "currentIndex" | "remainingMs">): void {
  clearTimer();
  activeTest = null;
  activeMemorize = {
    ...input,
    phase: "prompt",
    currentIndex: 0,
    remainingMs: input.displaySeconds * 1000
  };
  navigateToPath(PLAY_ROUTES.memorizePlay);
  render();
  scheduleMemorizePrompt(0);
}

function scheduleMemorizePrompt(index: number): void {
  if (!activeMemorize) {
    return;
  }

  if (index >= activeMemorize.words.length) {
    finishActiveMemorize();
    return;
  }

  clearTimer();
  activeMemorize.phase = "prompt";
  activeMemorize.currentIndex = index;
  activeMemorize.remainingMs = activeMemorize.displaySeconds * 1000;
  render();

  runMemorizeTimer(activeMemorize.remainingMs, () => {
    scheduleMemorizeAnswer(index);
  });
}

function scheduleMemorizeAnswer(index: number): void {
  if (!activeMemorize) {
    return;
  }

  clearTimer();
  activeMemorize.phase = "answer";
  activeMemorize.currentIndex = index;
  activeMemorize.remainingMs = MEMORIZE_ANSWER_MS;
  render();

  runMemorizeTimer(MEMORIZE_ANSWER_MS, () => {
    scheduleMemorizePrompt(index + 1);
  });
}

function runMemorizeTimer(durationMs: number, onDone: () => void): void {
  const endAt = Date.now() + durationMs;
  timer = window.setInterval(() => {
    if (!activeMemorize) {
      clearTimer();
      return;
    }

    activeMemorize.remainingMs = Math.max(0, endAt - Date.now());
    if (activeMemorize.remainingMs <= 0) {
      clearTimer();
      onDone();
      return;
    }

    updateActiveTimerView(activeMemorize.remainingMs, durationMs);
  }, 100);
}

function updateActiveTimerView(remainingMs: number, durationMs: number): void {
  const secondsLeft = Math.ceil(remainingMs / 1000);
  const timePercent = Math.max(0, Math.min(100, (remainingMs / durationMs) * 100));
  const timeLeft = document.querySelector<HTMLElement>("[data-time-left]");
  const timeProgress = document.querySelector<HTMLProgressElement>("[data-time-progress]");

  if (timeLeft) {
    timeLeft.textContent = `${secondsLeft}s`;
  }
  if (timeProgress) {
    timeProgress.value = timePercent;
  }
}

function finishActiveMemorize(): void {
  if (!activeMemorize) {
    return;
  }

  clearTimer();
  activeMemorize.phase = "done";
  render();
  window.setTimeout(() => {
    if (activeMemorize?.phase === "done") {
      activeMemorize = null;
      showToast("암기를 완료했습니다.");
      navigateToTab("memorize", true);
    }
  }, 1200);
}

function abortActiveMemorize(nextTab: TabKey = "memorize", replace = true): void {
  if (!activeMemorize) {
    return;
  }

  clearTimer();
  activeMemorize = null;
  showToast("암기를 중단했습니다.");
  navigateToTab(nextTab, replace);
}

function navigateToTab(nextTab: TabKey, replace = false): void {
  navigateToPath(TAB_ROUTES[nextTab], replace);
}

function navigateToAnswerDetail(id: string, replace = false): void {
  if (!id) {
    return;
  }
  navigateToPath(answerDetailPath(id), replace);
}

function navigateToPath(path: string, replace = false): void {
  if (window.location.pathname !== path) {
    if (replace) {
      window.history.replaceState(null, "", path);
    } else {
      window.history.pushState(null, "", path);
    }
  }
  void handleLocationChange();
}

async function handleLocationChange(): Promise<void> {
  applyRouteFromLocation();
  if (await syncActiveSessionWithRoute()) {
    return;
  }
  await syncPageData();
}

async function syncActiveSessionWithRoute(): Promise<boolean> {
  if (activeTest && page !== "testPlay") {
    await abortActiveTest("test", true);
    return true;
  }

  if (activeMemorize && page !== "memorizePlay") {
    abortActiveMemorize("memorize", true);
    return true;
  }

  return false;
}

async function syncPageData(): Promise<void> {
  isSidebarOpen = false;

  if (page === "testPlay") {
    if (activeTest) {
      render();
    } else {
      navigateToTab("test", true);
    }
    return;
  }

  if (page === "memorizePlay") {
    if (activeMemorize) {
      render();
    } else {
      navigateToTab("memorize", true);
    }
    return;
  }

  if (page === "answerDetail") {
    if (!selectedResultId) {
      navigateToTab("answers", true);
      return;
    }
    await loadResultDetail(selectedResultId);
    return;
  }

  if (page === "answers") {
    selectedResult = null;
    selectedResultId = "";
    isAnswerLoading = false;
  }

  render();
}

function applyRouteFromLocation(): void {
  const parsed = parseRoute(window.location.pathname);
  page = parsed.page;
  tab = tabForPage(parsed.page);

  if (parsed.page === "answerDetail") {
    selectedResultId = parsed.resultId ?? "";
    return;
  }

  selectedResultId = "";
  if (parsed.page !== "answers") {
    selectedResult = null;
  }
}

function parseRoute(pathname: string): { page: PageKey; resultId?: string } {
  const segments = pathname.split("/").filter(Boolean).map(safeDecodePathSegment);

  if (segments[0] === "test" && segments[1] === "play") {
    return { page: "testPlay" };
  }
  if (segments.length === 0 || segments[0] === "test") {
    return { page: "test" };
  }
  if (segments[0] === "memorize" && segments[1] === "play") {
    return { page: "memorizePlay" };
  }
  if (segments[0] === "memorize") {
    return { page: "memorize" };
  }
  if (segments[0] === "wordbooks" && segments[1] === "new") {
    return { page: "add" };
  }
  if (segments[0] === "wordbooks" && segments.length === 1) {
    return { page: "manage" };
  }
  if (segments[0] === "settings" || segments[0] === "me") {
    return { page: "settings" };
  }
  if (segments[0] === "admin") {
    return { page: "admin" };
  }
  if (segments[0] === "groups") {
    return { page: "groups" };
  }
  if (segments[0] === "answers" && segments[1]) {
    return { page: "answerDetail", resultId: segments[1] };
  }
  if (segments[0] === "answers") {
    return { page: "answers" };
  }

  window.history.replaceState(null, "", TAB_ROUTES.test);
  return { page: "test" };
}

function safeDecodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function refreshAndRender(): Promise<void> {
  await refreshAll();
  if (selectedResult && !results.some((result) => result.id === selectedResult?.id)) {
    selectedResult = null;
    selectedResultId = "";
  }
  if (selectedResultId && !results.some((result) => result.id === selectedResultId)) {
    selectedResultId = "";
  }

  if (page === "answerDetail") {
    if (selectedResultId) {
      await loadResultDetail(selectedResultId);
    } else {
      navigateToTab("answers", true);
    }
    return;
  }

  if (page === "answers") {
    selectedResult = null;
    selectedResultId = "";
  }

  render();
}

async function withBusy(work: () => Promise<void>): Promise<void> {
  if (isBusy) {
    return;
  }

  isBusy = true;
  render();
  try {
    await work();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "작업에 실패했습니다.");
  } finally {
    isBusy = false;
    render();
  }
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers);
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken && !headers.has("X-CSRF-Token")) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(url, {
    ...init,
    method,
    headers,
    credentials: "same-origin"
  });
  if (!response.ok) {
    let message = "요청에 실패했습니다.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message ?? message;
    } catch {
      message = response.statusText || message;
    }
    if (response.status === 401 && !url.startsWith("/api/auth/")) {
      resetAuthenticatedState();
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function parseManualWords(value: string): WordEntry[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseManualLine)
    .filter((word): word is WordEntry => Boolean(word));
}

function parseManualLine(line: string): WordEntry | null {
  const separators = ["\t", "=", ",", "|"];
  for (const separator of separators) {
    const index = line.indexOf(separator);
    if (index > 0) {
      const english = line.slice(0, index).trim();
      const korean = line.slice(index + separator.length).trim();
      return english && korean ? { english, korean } : null;
    }
  }
  return null;
}

function selectedWordbook(): WordbookSummary | undefined {
  return wordbooks.find((book) => book.id === selectedWordbookId);
}

function currentAnswerSelectionId(): string {
  return selectedResultId || selectedResult?.id || results[0]?.id || "";
}

function groupedWordbooks(source: WordbookSummary[] = wordbooks): WordbookGroup[] {
  const groups = new Map<string, WordbookSummary[]>();

  for (const book of source) {
    const group = normalizeGroupName(book.group);
    groups.set(group, [...(groups.get(group) ?? []), book]);
  }

  return [...groups.entries()]
    .map(([group, books]) => ({
      group,
      books: [...books].sort((a, b) => a.name.localeCompare(b.name, "ko-KR"))
    }))
    .sort((a, b) => {
      if (a.group === DEFAULT_GROUP_NAME) {
        return 1;
      }
      if (b.group === DEFAULT_GROUP_NAME) {
        return -1;
      }
      return a.group.localeCompare(b.group, "ko-KR");
    });
}

function filteredWordbooks(): WordbookSummary[] {
  const query = normalizeSearch(wordbookSearch);
  if (!query) {
    return wordbooks;
  }
  return wordbooks.filter((book) => matchesSearch(query, [
    book.name,
    book.group,
    book.description,
    book.sourceFilename ?? "",
    sourceLabel(book.source)
  ]));
}

function filteredResults(): ResultSummary[] {
  const query = normalizeSearch(answerSearch);
  if (!query) {
    return results;
  }
  return results.filter((result) => matchesSearch(query, [
    result.wordbookName,
    modeLabel(result.mode),
    String(result.questionCount),
    formatDate(result.createdAt)
  ]));
}

function matchesSearch(query: string, values: string[]): boolean {
  return values.some((value) => normalizeSearch(value).includes(query));
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase("ko-KR");
}

function renderWordbookSelectOptions(): string {
  if (!wordbooks.length) {
    return `<option value="">단어장이 없습니다</option>`;
  }

  return groupedWordbooks().map((section) => `
    <optgroup label="${escapeAttribute(section.group)}">
      ${section.books.map((book) => `
        <option value="${book.id}" ${book.id === selectedWordbookId ? "selected" : ""}>
          ${escapeHtml(book.name)} (${book.wordCount}개)
        </option>
      `).join("")}
    </optgroup>
  `).join("");
}

function renderGroupSelectOptions(selectedGroup: string): string {
  const availableGroups = groups.length
    ? groups
    : [{ id: DEFAULT_GROUP_NAME, name: DEFAULT_GROUP_NAME, wordbookCount: 0, wordCount: 0, createdAt: "", updatedAt: "" }];

  return availableGroups.map((group) => `
    <option value="${escapeAttribute(group.name)}" ${normalizeGroupName(selectedGroup) === normalizeGroupName(group.name) ? "selected" : ""}>
      ${escapeHtml(group.name)}
    </option>
  `).join("");
}

function normalizeGroupName(value: string | undefined): string {
  const group = (value ?? "").trim();
  return group || DEFAULT_GROUP_NAME;
}

function updateAddDraftField(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
  const key = field.dataset.draftField as keyof AddDraft | undefined;
  if (!key) {
    return;
  }
  addDraft[key] = field.value;
}

function syncAddDraftGroups(): void {
  const names = new Set(groups.map((group) => group.name));
  if (!addDraft.manualGroup || !names.has(addDraft.manualGroup)) {
    addDraft.manualGroup = groups[0]?.name ?? DEFAULT_GROUP_NAME;
  }
  if (addDraft.uploadGroup && !names.has(addDraft.uploadGroup)) {
    addDraft.uploadGroup = "";
  }
}

function resetUploadDraft(): void {
  addDraft.uploadName = "";
  addDraft.uploadGroup = "";
  addDraft.uploadDescription = "";
}

function resetManualDraft(): void {
  addDraft.manualName = "";
  addDraft.manualGroup = groups[0]?.name ?? DEFAULT_GROUP_NAME;
  addDraft.manualDescription = "";
  addDraft.manualWords = "";
}

function updateDraftGroupName(previousName: string, nextName: string): void {
  if (addDraft.manualGroup === previousName) {
    addDraft.manualGroup = nextName;
  }
  if (addDraft.uploadGroup === previousName) {
    addDraft.uploadGroup = nextName;
  }
}

function totalWords(): number {
  return wordbooks.reduce((sum, book) => sum + book.wordCount, 0);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function sourceLabel(source: WordbookSummary["source"]): string {
  if (source === "manual") {
    return "직접 입력";
  }
  return "업로드";
}

function parseMemorizeMode(value: FormDataEntryValue | null): MemorizeDisplayMode {
  if (value === "ko" || value === "both") {
    return value;
  }
  return "en";
}

function memorizePromptFor(word: WordEntry, mode: MemorizeDisplayMode): string {
  if (mode === "ko") {
    return word.korean;
  }
  if (mode === "both") {
    return `${word.english} / ${word.korean}`;
  }
  return word.english;
}

function memorizeAnswerFor(word: WordEntry, mode: MemorizeDisplayMode): string {
  if (mode === "ko") {
    return word.english;
  }
  if (mode === "both") {
    return `${word.english} / ${word.korean}`;
  }
  return word.korean;
}

function shuffleWords(words: WordEntry[]): WordEntry[] {
  const copy = [...words];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function modeLabel(mode: TestMode): string {
  if (mode === "ko") {
    return "한글";
  }
  if (mode === "en") {
    return "영어";
  }
  return "랜덤";
}

function sessionDeviceLabel(userAgent: string | undefined): string {
  if (!userAgent) {
    return "알 수 없는 기기";
  }

  const lower = userAgent.toLowerCase();
  const browser = lower.includes("edg/")
    ? "Edge"
    : lower.includes("chrome/")
      ? "Chrome"
      : lower.includes("firefox/")
        ? "Firefox"
        : lower.includes("safari/")
          ? "Safari"
          : "브라우저";
  const platform = lower.includes("windows")
    ? "Windows"
    : lower.includes("android")
      ? "Android"
      : lower.includes("iphone") || lower.includes("ipad")
        ? "iOS"
        : lower.includes("mac os")
          ? "macOS"
          : lower.includes("linux")
            ? "Linux"
            : "기기";
  return `${browser} · ${platform}`;
}

function answerDetailPath(id: string): string {
  return `/answers/${encodeURIComponent(id)}`;
}

function tabForPage(value: PageKey): TabKey {
  if (value === "answerDetail") {
    return "answers";
  }
  if (value === "testPlay") {
    return "test";
  }
  if (value === "memorizePlay") {
    return "memorize";
  }
  return value;
}

function pageLabel(value: PageKey): string {
  if (value === "answerDetail") {
    return "기록 상세";
  }
  if (value === "testPlay") {
    return "퀴즈 진행";
  }
  if (value === "memorizePlay") {
    return "암기 진행";
  }
  return tabLabel(tabForPage(value));
}

function tabLabel(value: TabKey): string {
  if (value === "add") {
    return "새 단어장";
  }
  if (value === "memorize") {
    return "암기 모드";
  }
  if (value === "manage") {
    return "단어장";
  }
  if (value === "groups") {
    return "그룹";
  }
  if (value === "answers") {
    return "기록";
  }
  if (value === "settings") {
    return "설정";
  }
  if (value === "admin") {
    return "관리자";
  }
  return "퀴즈";
}

function setColorMode(nextMode: ColorMode): void {
  colorMode = nextMode;
  try {
    window.localStorage.setItem("voca-color-mode", nextMode);
  } catch {
    // Keep the live setting even if browser storage is blocked.
  }
  applyColorMode();
  render();
}

function loadColorMode(): ColorMode {
  try {
    return window.localStorage.getItem("voca-color-mode") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

function applyColorMode(): void {
  document.documentElement.dataset.theme = colorMode;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function showToast(message: string): void {
  toastMessage = message;
  window.setTimeout(() => {
    if (toastMessage === message) {
      toastMessage = "";
      render();
    }
  }, 2600);
}

function clearToast(): void {
  toastMessage = "";
}

function clearTimer(): void {
  if (timer !== null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[char];
  });
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
