# Voca Studio

웹 기반 영어 단어 학습 앱입니다. 로그인한 사용자별로 단어장, 그룹, 학습 기록이 분리되어 서버에 저장됩니다.

## 기능

- 반응형 웹 UI와 슬라이드 메뉴
- 홈 대시보드에서 단어 테스트, 암기하러가기, 단어장 생성, 학습 기록 바로가기
- 이메일, 아이디, 비밀번호, 이름 기반 회원가입
- 로그인, 자동 로그인 유지, 로그아웃, 비밀번호 변경
- 설정 화면에서 계정, 다크모드, 로그인 세션 조회 및 다른 기기 종료
- 사용자별 단어장, 그룹, 학습 기록 관리
- JSON 파일 업로드로 단어장 추가
- 직접 입력으로 단어장 추가
- 단어장 이름, 그룹, 메모 저장 및 수정
- 단어장 관리 화면에서 검색, 퀴즈/암기 시작, JSON 내보내기 및 삭제
- 설정 화면에서 단어장 관리, 그룹관리, 비밀번호 변경
- 관리자 전용 페이지에서 사용자 계정 정보/권한 수정, 사용자 삭제, 서버 감사로그, 전체 사용자 단어장 조회
- 관리자 단어장 보관소에 단어장을 저장하고 원하는 사용자에게 복사 배포
- 암기 모드: 단어장 선택, 1초~10초 표시 시간, 영어/한국어/둘 다 표시 선택
- 암기 모드에서 선택한 시간 후 상대 언어를 3초 동안 표시
- `한글`, `영어`, `랜덤` 출제 모드
- 10개, 20개, 30개, 40개, 50개 테스트
- 3초, 5초, 6초 표시 시간
- 단어 수가 부족하면 섞어서 반복 출제
- 퀴즈 중단
- 이전 학습 기록 검색 및 조회
- 학습 기록 CSV, TXT, JSON 다운로드

## 개발 실행

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

## 프로덕션 실행

```bash
npm install
npm run build
npm start
```

환경변수:

```bash
PORT=3000
WORD_TEST_DATA_DIR=/opt/word-test/data
# 외부 도메인에서 접속할 때 명시
APP_ORIGINS=https://example.com
# Nginx 같은 프록시 뒤에서만 설정
TRUST_PROXY=1
# 특수 환경에서만 쿠키 Secure 강제/해제: COOKIE_SECURE=1 또는 COOKIE_SECURE=0
```

`WORD_TEST_DATA_DIR`를 지정하지 않으면 프로젝트의 `data/` 폴더에 저장됩니다. 기본 단어장은 포함하지 않으므로 웹 화면에서 JSON 업로드나 직접 입력으로 추가하면 됩니다.
서버 도메인과 브라우저 `Origin`이 프록시 설정 때문에 다르게 잡히면 `APP_ORIGINS`에 실제 접속 Origin을 쉼표로 구분해 넣으세요. 예: `APP_ORIGINS=https://english-test.shop,https://www.english-test.shop`
Nginx 같은 프록시 뒤에서 실제 클라이언트 IP 기반 로그인 제한을 적용하려면 `TRUST_PROXY=1`을 설정하세요. 프록시 없이 직접 실행할 때는 설정하지 않는 편이 안전합니다.
세션 쿠키의 `Secure` 속성은 요청이 HTTPS로 들어오면 자동 적용됩니다. 프록시 환경이 특수해서 자동 감지가 맞지 않으면 `COOKIE_SECURE=1` 또는 `COOKIE_SECURE=0`으로 강제할 수 있습니다.

비밀번호는 원문 저장 없이 Node.js `crypto.scrypt` 해시로 저장됩니다. 세션은 HttpOnly SameSite 쿠키와 서버 저장 토큰 해시를 사용하고, 로그인 후 상태 변경 요청은 CSRF 토큰과 Origin/Fetch Metadata 검사를 통과해야 합니다.

## Ubuntu 서버 기준

Node.js 22 이상을 권장합니다. Ubuntu 26.04 서버에서는 프로젝트를 `/opt/word-test` 같은 위치에 두고 아래처럼 실행하면 됩니다.

```bash
cd /opt/word-test
npm ci
npm run build
PORT=3000 WORD_TEST_DATA_DIR=/opt/word-test/data npm start
```

systemd 서비스 예시:

```ini
[Unit]
Description=Voca Studio
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/word-test
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=WORD_TEST_DATA_DIR=/opt/word-test/data
Environment=TRUST_PROXY=1
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

외부 접속은 서버 방화벽에서 `3000/tcp`를 열거나, Nginx로 80/443에서 `localhost:3000`으로 프록시하면 됩니다. 실제 외부 운영에서는 로그인 세션 보호를 위해 HTTPS(443)를 사용하세요.
