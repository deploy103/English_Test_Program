import "./styles.css";

type TestMode = "ko" | "en" | "rand";

interface WordbookSummary {
  id: string;
  name: string;
  group: string;
  description: string;
  wordCount: number;
  source: "manual" | "upload";
  sourceFilename?: string;
  createdAt: string;
  updatedAt: string;
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

type TabKey = "test" | "add" | "groups" | "manage" | "answers";
type ActivePhase = "countdown" | "running" | "done";

interface ActiveTest {
  phase: ActivePhase;
  result: TestResult;
  countdown: number;
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

let tab: TabKey = "test";
let wordbooks: WordbookSummary[] = [];
let groups: WordbookGroupSummary[] = [];
let results: ResultSummary[] = [];
let selectedWordbookId = "";
let selectedResult: TestResult | null = null;
let activeTest: ActiveTest | null = null;
let timer: number | null = null;
let toastMessage = "";
let isBusy = false;
let isSidebarOpen = false;

const DEFAULT_GROUP_NAME = "기본 그룹";
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
  await refreshAll();
  render();
}

async function refreshAll(): Promise<void> {
  const [groupList, bookList, resultList] = await Promise.all([
    api<WordbookGroupSummary[]>("/api/groups"),
    api<WordbookSummary[]>("/api/wordbooks"),
    api<ResultSummary[]>("/api/results")
  ]);

  groups = groupList;
  wordbooks = bookList;
  results = resultList;

  syncAddDraftGroups();

  if (!selectedWordbookId && wordbooks[0]) {
    selectedWordbookId = wordbooks[0].id;
  }

  if (selectedWordbookId && !wordbooks.some((book) => book.id === selectedWordbookId)) {
    selectedWordbookId = wordbooks[0]?.id ?? "";
  }
}

function render(): void {
  const isTesting = Boolean(activeTest);
  app.innerHTML = `
    <div class="app-shell ${isTesting ? "is-testing" : ""} ${isSidebarOpen ? "sidebar-open" : ""}">
      ${isTesting ? "" : renderAppBar()}
      ${isTesting ? "" : renderSidebar()}
      ${!isTesting && isSidebarOpen ? `<button class="sidebar-backdrop" id="sidebar-backdrop" type="button" aria-label="메뉴 닫기"></button>` : ""}
      <main class="main ${isTesting ? "test-main" : ""}">
        ${toastMessage ? `<div class="toast" role="status">${escapeHtml(toastMessage)}</div>` : ""}
        ${renderTopActions()}
        ${activeTest ? renderActiveTest() : renderCurrentTab()}
      </main>
    </div>
  `;

  bindEvents();
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
        <strong>Word Test</strong>
        <span>${tabLabel(tab)} · ${wordbooks.length}개 단어장</span>
      </div>
      <button class="ghost-button compact-home-button" id="home-button" type="button">홈</button>
    </header>
  `;
}

function renderSidebar(): string {
  return `
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">WT</div>
        <div>
          <h1>Word Test</h1>
          <p>${groups.length}개 그룹 · ${wordbooks.length}개 단어장</p>
        </div>
        <button class="icon-button close-button" id="close-menu-button" type="button" aria-label="메뉴 닫기">×</button>
      </div>

      <nav class="nav-tabs" aria-label="주요 메뉴">
        ${renderNavButton("test", "테스트")}
        ${renderNavButton("add", "추가")}
        ${renderNavButton("groups", "그룹관리")}
        ${renderNavButton("manage", "관리")}
        ${renderNavButton("answers", "정답지")}
      </nav>

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
  if (!activeTest) {
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
  return `<button class="nav-button ${tab === key ? "is-active" : ""}" data-tab="${key}" type="button">${label}</button>`;
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
      <div class="side-group-title">=== ${escapeHtml(section.group)} ===</div>
      ${section.books.map(renderWordbookItem).join("")}
    </div>
  `;
}

function renderCurrentTab(): string {
  if (tab === "add") {
    return renderAddTab();
  }
  if (tab === "manage") {
    return renderManageTab();
  }
  if (tab === "groups") {
    return renderGroupsTab();
  }
  if (tab === "answers") {
    return renderAnswersTab();
  }
  return renderTestTab();
}

function renderTestTab(): string {
  const selected = selectedWordbook();
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">새 테스트</p>
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

        <button class="primary-button" type="submit" ${selected ? "" : "disabled"}>${isBusy ? "시작 중..." : "테스트 시작"}</button>
      </form>

      <section class="panel detail-panel">
        <div class="metric-row">
          <div>
            <span class="metric-value">${selected?.wordCount ?? 0}</span>
            <span class="metric-label">단어</span>
          </div>
          <div>
            <span class="metric-value">${results.length}</span>
            <span class="metric-label">정답지</span>
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
      <p class="eyebrow">=== ${escapeHtml(book.group || DEFAULT_GROUP_NAME)} ===</p>
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
        <p class="eyebrow">단어장 추가</p>
        <h2>서버 저장 단어장</h2>
      </div>
      <div class="header-actions">
        <button class="ghost-button" data-tab="groups" type="button">그룹관리</button>
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

function renderManageTab(): string {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">단어장 관리</p>
        <h2>${wordbooks.length ? "저장된 단어장" : "단어장이 없습니다"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="manage-layout">
      <div class="panel manage-summary">
        <div class="metric-row">
          <div>
            <span class="metric-value">${wordbooks.length}</span>
            <span class="metric-label">단어장</span>
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
          <button class="primary-button" data-tab="add" type="button">단어장 추가</button>
          <button class="ghost-button" data-tab="groups" type="button">그룹관리</button>
        </div>
      </div>

      <div class="panel manage-list">
        ${wordbooks.length ? groupedWordbooks().map(renderManageGroup).join("") : `<div class="empty-note">JSON 업로드나 직접 입력으로 새 단어장을 추가하세요.</div>`}
      </div>
    </section>
  `;
}

function renderManageGroup(section: WordbookGroup): string {
  const wordCount = section.books.reduce((sum, book) => sum + book.wordCount, 0);
  return `
    <section class="manage-group">
      <div class="group-heading">
        <span>=== ${escapeHtml(section.group)} ===</span>
        <small>${section.books.length}개 단어장 · ${wordCount}개 단어</small>
      </div>
      ${section.books.map(renderManageItem).join("")}
    </section>
  `;
}

function renderManageItem(book: WordbookSummary): string {
  return `
    <article class="manage-item">
      <div>
        <h3>${escapeHtml(book.name)}</h3>
        <p>${escapeHtml(book.group || DEFAULT_GROUP_NAME)} · ${book.wordCount}개 · ${sourceLabel(book.source)} · ${formatDate(book.createdAt)}</p>
        ${book.description ? `<p class="muted">${escapeHtml(book.description)}</p>` : ""}
      </div>
      <div class="manage-actions">
        <button class="ghost-button" data-use-wordbook-id="${book.id}" type="button">테스트</button>
        <button class="danger-button" data-delete-wordbook-id="${book.id}" type="button">삭제</button>
      </div>
    </article>
  `;
}

function renderGroupsTab(): string {
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">그룹관리</p>
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
  const result = selectedResult;
  return `
    <section class="page-header">
      <div>
        <p class="eyebrow">이전 정답지</p>
        <h2>${result ? escapeHtml(result.wordbookName) : "저장된 정답지"}</h2>
      </div>
      <button class="ghost-button" id="refresh-button" type="button">새로고침</button>
    </section>

    <section class="answers-layout">
      <div class="panel answer-list">
        ${results.length ? results.map(renderResultItem).join("") : `<div class="empty-note">아직 정답지가 없습니다.</div>`}
      </div>
      <div class="panel answer-detail">
        ${result ? renderResultDetail(result) : `<div class="empty-note">왼쪽에서 정답지를 선택하세요.</div>`}
      </div>
    </section>
  `;
}

function renderResultItem(result: ResultSummary): string {
  const active = selectedResult?.id === result.id ? "is-active" : "";
  return `
    <button class="list-item ${active}" data-result-id="${result.id}" type="button">
      <span class="item-title">${escapeHtml(result.wordbookName)}</span>
      <span class="item-meta">${result.questionCount}개 · ${modeLabel(result.mode)} · ${formatDate(result.createdAt)}</span>
    </button>
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
          <h2>정답지를 저장했습니다.</h2>
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
        <span>${secondsLeft}s</span>
      </div>
      <div class="progress"><span style="width: ${progressPercent}%"></span></div>
      <div class="stage-center">
        <div class="prompt-word">${escapeHtml(entry.prompt)}</div>
      </div>
      <div class="time-gauge" aria-label="남은 시간">
        <span style="width: ${timePercent}%"></span>
      </div>
    </section>
  `;
}

function bindEvents(): void {
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

  document.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      tab = button.dataset.tab as TabKey;
      isSidebarOpen = false;
      clearToast();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedWordbookId = button.dataset.wordbookId ?? "";
      tab = "test";
      isSidebarOpen = false;
      clearToast();
      render();
    });
  });

  document.querySelector<HTMLSelectElement>("#wordbook-select")?.addEventListener("change", (event) => {
    selectedWordbookId = (event.currentTarget as HTMLSelectElement).value;
    clearToast();
    render();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-result-id]").forEach((button) => {
    button.addEventListener("click", () => {
      void selectResult(button.dataset.resultId ?? "");
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-use-wordbook-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedWordbookId = button.dataset.useWordbookId ?? "";
      selectedResult = null;
      tab = "test";
      isSidebarOpen = false;
      clearToast();
      render();
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
    void abortActiveTest();
  });

  document.querySelector<HTMLFormElement>("#start-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void beginTest(new FormData(event.currentTarget as HTMLFormElement));
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

async function uploadWordbook(formData: FormData): Promise<void> {
  await withBusy(async () => {
    const created = await api<WordbookSummary>("/api/wordbooks/upload", {
      method: "POST",
      body: formData
    });
    selectedWordbookId = created.id;
    tab = "test";
    resetUploadDraft();
    showToast("단어장을 저장했습니다.");
    await refreshAll();
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
    tab = "test";
    resetManualDraft();
    showToast("단어장을 저장했습니다.");
    await refreshAll();
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

async function selectResult(id: string): Promise<void> {
  if (!id) {
    return;
  }
  selectedResult = await api<TestResult>(`/api/results/${id}`);
  tab = "answers";
  clearToast();
  render();
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
    showToast("단어장을 삭제했습니다.");
    await refreshAll();
  });
}

async function goHome(): Promise<void> {
  if (activeTest) {
    const confirmed = window.confirm("테스트를 중단하고 홈으로 돌아갈까요?");
    if (!confirmed) {
      return;
    }
    await abortActiveTest();
    return;
  }

  selectedResult = null;
  tab = "test";
  clearToast();
  render();
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

    render();
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
  activeTest = null;
  tab = "answers";
  showToast("정답지를 저장했습니다.");
  await refreshAll();
  render();
}

async function abortActiveTest(): Promise<void> {
  if (!activeTest) {
    return;
  }

  const resultId = activeTest.result.id;
  clearTimer();
  activeTest = null;
  tab = "test";
  showToast("테스트를 중단했습니다.");
  await api<void>(`/api/results/${resultId}`, { method: "DELETE" }).catch(() => undefined);
  await refreshAll();
  render();
}

async function refreshAndRender(): Promise<void> {
  await refreshAll();
  if (selectedResult && !results.some((result) => result.id === selectedResult?.id)) {
    selectedResult = null;
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
  const response = await fetch(url, init);
  if (!response.ok) {
    let message = "요청에 실패했습니다.";
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message ?? message;
    } catch {
      message = response.statusText || message;
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

function groupedWordbooks(): WordbookGroup[] {
  const groups = new Map<string, WordbookSummary[]>();

  for (const book of wordbooks) {
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

function renderWordbookSelectOptions(): string {
  if (!wordbooks.length) {
    return `<option value="">단어장이 없습니다</option>`;
  }

  return groupedWordbooks().map((section) => `
    <optgroup label="=== ${escapeAttribute(section.group)} ===">
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

function modeLabel(mode: TestMode): string {
  if (mode === "ko") {
    return "한글";
  }
  if (mode === "en") {
    return "영어";
  }
  return "랜덤";
}

function tabLabel(value: TabKey): string {
  if (value === "add") {
    return "추가";
  }
  if (value === "manage") {
    return "관리";
  }
  if (value === "groups") {
    return "그룹관리";
  }
  if (value === "answers") {
    return "정답지";
  }
  return "테스트";
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
