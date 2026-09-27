# 작업실 (Workroom) — local alpha 0.1

개발 중인 제품 폴더를 등록해 두면, 내장 에이전트가 조사·수정안 작성·별도 검토를 이어서 하고, 그 과정에서 확인한 사실을 다음 작업에 쓸 기록과 지원 대상별 포트폴리오 초안으로 모으는 로컬 데스크톱 앱입니다. Electron 앱과 stdio MCP 서버가 같은 로컬 SQLite 데이터를 씁니다.

로컬 알파 단계입니다. 제품 이름은 임시이며 Windows에서 주로 확인했습니다.

## 할 수 있는 일

- **제품과 목표**: 폴더를 제품으로 등록하고 목표를 저장합니다. Git 상태·루트 README·`package.json` 스크립트 이름을 읽기 전용으로 점검합니다(스크립트는 실행하지 않음).
- **내장 에이전트**: ChatGPT 계정을 브라우저 또는 기기 코드 OAuth로 연결해 내장 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)로 조사·수정·검토·기록 정리 역할을 작업별 세션에서 실행합니다. 동시 실행은 최대 2개, 같은 제품의 수정은 1개씩입니다.
- **수정안과 반영**: 원본을 건드리지 않는 복사본에서 최대 16개 파일을 고칩니다. 앱이 JavaScript 문법·JSON 구문과 사용자가 고른 Node 테스트를 수정 전후로 실행하고, 별도 세션이 모든 변경 파일을 검토합니다. 사용자가 검토한 정확한 버전만 원본에 반영하며, 원본이 그 사이 바뀌면 멈춥니다.
- **판단과 복구**: 에이전트가 정할 수 없는 방침은 판단 요청으로 남깁니다. 작업 중지·단계별 재개·앱 재시작 후 복원을 지원합니다.
- **기록**: 작업 결과와 근거·한계·기여 범위를 저장하고, 적용 조건이 맞는 기록만 다음 작업과 MCP 조회에 제공합니다. 제공한 버전과 이력을 확인할 수 있습니다.
- **포트폴리오**: 지원 대상별 초안을 만들고, 구독한 제품의 새 결과를 자동으로 반영합니다. 직접 고친 문장과 제외한 사례는 보존하며, 공개할 내용만 검토해 독립 HTML로 내보냅니다.
- **지속 운영**(선택): 앱이 켜져 있는 동안 정해진 간격으로 변화를 살펴 조사와 허용된 수정안까지 이어갑니다. 변화가 없으면 모델을 호출하지 않습니다.
- **외부 에이전트 연결**: 외부 MCP 클라이언트가 같은 제품·기록을 조회하고 작업을 보고할 수 있습니다. Codex 훅으로 파일 변경·검사가 있었던 응답을 자동 수집할 수도 있습니다(Codex에서 최초 훅 신뢰 필요).

아직 없는 것: 앱을 끈 동안의 백그라운드·원격 실행, 임의 빌드 스크립트 실행과 의존성 설치, 호스팅 배포, 인스톨러와 자동 업데이트. 판단을 저장해도 에이전트가 자동으로 재개하지 않습니다.

## 시작하기

Node.js 24 이상과 pnpm이 필요합니다.

```sh
pnpm install --ignore-scripts
node node_modules/electron/install.js
pnpm start
```

Windows에서는 설치 후 `start-workroom.cmd`로도 실행할 수 있습니다. 처음에는 빈 데이터로 시작합니다.

1. **제품 폴더 연결**로 개발 폴더와 목표를 등록합니다.
2. 오른쪽 위 **일 맡기기**에서 원하는 결과를 적고 **먼저 조사** 또는 **수정안까지 작성**을 고릅니다. 계정을 연결하기 전에도 요청을 작성해 둘 수 있습니다.
3. **계정 연결**에서 ChatGPT 계정으로 로그인하고 모델을 저장하면, 보관한 요청으로 돌아와 실행합니다.
4. 수정안은 작업 상세에서 변경 전후 코드, 앱이 실행한 검사, 별도 검토 의견을 확인한 뒤 **검토한 수정본 반영**으로 원본에 적용합니다.

로그인하지 않아도 기존 데이터 열람과 MCP 수집은 됩니다. 창을 닫으면 실행기도 함께 종료됩니다.

## 데이터와 보안

- 데이터는 기본적으로 프로젝트의 `.workroom/`에 저장합니다. `WORKROOM_DATA_DIR`로 바꿀 수 있으며, 앱과 MCP 서버에 같은 값을 지정해야 합니다. 백업은 앱과 MCP를 종료한 뒤 이 폴더를 통째로 복사하세요.
- 로그인 정보는 운영체제 보호 저장소(Electron `safeStorage`)로 암호화해 `credentials/openai.credential`에 저장합니다. 보호 저장소를 쓸 수 없으면 저장하지 않습니다.
- SQLite WAL과 버전 검사를 사용해, 앱과 MCP가 동시에 고쳐도 조용히 덮어쓰지 않습니다.
- 렌더러는 Node에 직접 접근하지 않으며 context isolation·sandbox·CSP를 사용합니다. IPC는 앱 자체 화면에서 온 요청만 받고, 외부 페이지 이동과 새 창을 막습니다.
- 에이전트의 파일 도구는 등록한 제품 폴더 안으로 제한되며 `.env`·인증 파일 등은 읽지 않고, 흔한 비밀값 형식은 가립니다.
- 수정안 검사는 별도 복사본에서 파일 접근과 자식 프로세스를 제한해 실행하지만, 악의적인 코드를 안전하게 실행하는 OS·네트워크 샌드박스는 아닙니다. 선택한 테스트를 실행하려면 매번 명시적으로 허용해야 합니다. 의존성을 설치하지 않으므로 외부 패키지가 필요한 테스트는 실패할 수 있습니다.
- `WORKROOM_NODE`로 검사·MCP·Codex 훅에 쓸 Node.js 24+ 실행 파일을 지정할 수 있습니다.

## MCP

앱의 **MCP 연결 → 연결 설정 보기**에 현재 위치에 맞는 stdio 설정이 나옵니다. 외부 클라이언트 설정을 자동으로 바꾸지는 않습니다. MCP를 쓰기 전에 앱에서 접근할 제품 폴더를 등록하세요.

```sh
pnpm mcp
```

stdio 서버이므로 MCP 클라이언트가 프로토콜로 연결해야 하며, stdout에 로그를 쓰지 않습니다. 새 폴더 등록, 사용자 대신 결정, 코드 수정과 배포는 MCP에 노출하지 않습니다.

## 개발

| 명령 | 내용 |
|---|---|
| `pnpm test` | 저장·동시 수정·MCP stdio·실행 인계·수정 반영 등 단위·통합 테스트 |
| `pnpm check:app` | 예제 데이터로 실제 Electron 앱을 띄워 주요 화면 흐름 11개 검사(약 1분) |
| `pnpm lint` | ESLint: 가져오지 않은 이름, 쓰이지 않는 import·변수 |
| `pnpm format` / `pnpm format:check` | Prettier |

에이전트가 관여하는 테스트는 모델 대신 결정적 모의 응답을 쓰며, Node 검사와 파일 반영은 실제로 실행합니다. 검사 스크립트는 [`scripts/checks/README.md`](scripts/checks/README.md)에 설명이 있습니다.

화면 코드를 구조만 바꿀 때는 전후의 모든 화면 HTML을 비교할 수 있습니다. `pnpm check:app`이 `work/`에 남긴 예제 DB를 사용합니다.

```sh
node scripts/render-snapshot.mjs save before.json
node scripts/render-snapshot.mjs save after.json --same-as before.json
node scripts/render-snapshot.mjs compare before.json after.json
```

## 구조

```text
src/core/         저장·검증·제품·작업·기록·포트폴리오 (Node 내장 SQLite)
src/desktop/      Electron 메인 프로세스와 제한된 preload API
src/runtime/      Pi 실행기, OAuth, 실행 대기열, 소스 복사·검사·버전별 반영, 지속 운영
src/renderer/     화면: app.js 시작, controller.js 흐름과 render, *-actions.js·field-events.js 이벤트,
                  state.js 상태, shell.js·*-views.js·*-ui.js 화면 HTML, html.js 공통 조각
src/integrations/ Codex 훅 설정과 수집
src/mcp/          stdio MCP 서버
tests/            단위·통합 테스트
scripts/          Electron 화면 검사, 화면 HTML 스냅숏 비교
```

## 라이선스

[MIT](LICENSE). 함께 포함된 Pretendard 글꼴(SIL OFL 1.1)과 Radix Colors 값(MIT)은 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)를 참고하세요.
