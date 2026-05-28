# English Test Program

웹 기반 영어 단어 테스트 앱입니다. 로그인 없이 혼자 쓰는 기준이며, 서버에 단어장과 정답지가 계속 저장됩니다.

## 기능

- 다크모드 웹 UI
- JSON 파일 업로드로 단어장 추가
- 직접 입력으로 단어장 추가
- 단어장 이름과 메모 저장
- 단어장 관리 화면에서 테스트 시작 및 삭제
- `한글`, `영어`, `랜덤` 출제 모드
- 30개, 40개, 50개 테스트
- 3초, 5초, 6초 표시 시간
- 단어 수가 부족하면 섞어서 반복 출제
- 테스트 중단
- 이전 정답지 조회
- 정답지 CSV, TXT, JSON 다운로드

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
```

`WORD_TEST_DATA_DIR`를 지정하지 않으면 프로젝트의 `data/` 폴더에 저장됩니다. 기본 단어장은 포함하지 않으므로 웹 화면에서 JSON 업로드나 직접 입력으로 추가하면 됩니다.

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
Description=English Word Test
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/word-test
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=WORD_TEST_DATA_DIR=/opt/word-test/data
ExecStart=/usr/bin/node dist/server/index.js
Restart=always
RestartSec=5
User=www-data

[Install]
WantedBy=multi-user.target
```

외부 접속은 서버 방화벽에서 `3000/tcp`를 열거나, Nginx로 80/443에서 `localhost:3000`으로 프록시하면 됩니다.
