<p align="center">
  <img src="src/desktop/assets/workroom.svg" width="76" height="76" alt="작업실 로고">
</p>

<h1 align="center">작업실 · Workroom</h1>

<p align="center"><strong>한국어</strong> · <a href="README.en.md">English</a></p>

<p align="center">
  <strong>맡긴 일은 결과로, 쌓인 결과는 나의 기록으로.</strong><br>
  개발 작업부터 재사용할 지식, 포트폴리오 초안까지 이어지는 로컬 데스크톱 앱.
</p>

<p align="center">
  <a href="#현재-단계"><img src="https://img.shields.io/badge/status-local_alpha-C56A3C?style=flat-square" alt="Status: local alpha"></a>
  <a href="#시작하기"><img src="https://img.shields.io/badge/Node.js-24%2B-5B7054?style=flat-square" alt="Node.js 24 이상"></a>
  <a href="docs/guide.md#mcp"><img src="https://img.shields.io/badge/connect-MCP-716B64?style=flat-square" alt="MCP 연결 지원"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-716B64?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#시작하기">시작하기</a> ·
  <a href="#화면-둘러보기">화면 둘러보기</a> ·
  <a href="docs/guide.md">사용 가이드</a> ·
  <a href="docs/development.md">개발 문서</a> ·
  <a href="https://github.com/tttaliesin/workroom/issues">문제 제보</a>
</p>

<img src="docs/images/overview-dark.png" alt="작업실 개요: 확인할 일, 대기 중인 작업, 최근 결과와 쌓인 기록을 한 화면에서 확인" width="1280">

<p align="center"><sub>모든 스크린샷은 실제 Electron 앱의 다크 모드에서 촬영했습니다. 제품·작업·포트폴리오 내용은 소개용 예제입니다.</sub></p>

## 개발의 다음 단계가 한곳에

제품 폴더와 목표를 연결하고, 원하는 일을 맡기세요. 내장 에이전트가 조사와 수정안 작성, 별도 검토를 이어갑니다. 확인한 결과는 다음 작업에 쓸 기록으로 남고, 지원 대상에 맞춘 포트폴리오 초안으로 모입니다.

| 흐름 | 작업실이 하는 일 |
| :--- | :--- |
| **작업과 검토** | 조사 → 수정안 → 검토를 작업별로 연결합니다. 필요한 판단과 반영할 변경을 확인합니다. |
| **기록과 근거** | 출처와 적용 조건을 함께 저장합니다. 내장 에이전트와 MCP가 같은 기록을 조회합니다. |
| **경험과 소개** | 제품의 새 결과를 대상별 초안에 모읍니다. 직접 다듬은 문장은 보존하고 HTML로 내보냅니다. |

## 시작하기

**Node.js 24 이상과 pnpm**이 필요합니다. 현재는 소스에서 실행하며, Windows에서 주로 확인했습니다.

```sh
git clone https://github.com/tttaliesin/workroom.git
cd workroom
pnpm install --ignore-scripts
node node_modules/electron/install.js
pnpm start
```

Windows에서는 설치 후 `start-workroom.cmd`로도 열 수 있습니다.

앱 오른쪽 위에서 **한국어 / English**를 선택할 수 있습니다. 선택한 언어는 다음 실행에도 유지되며, 작성 중인 입력과 기존 기록의 원문은 보존됩니다.

1. **제품 폴더 연결** — 개발 폴더를 선택하고 이루고 싶은 목표를 적습니다.
2. **일 맡기기** — 원하는 결과를 쓰고 **먼저 조사** 또는 **수정안까지 작성**을 고릅니다.
3. **계정 연결** — ChatGPT 계정과 모델을 연결해 보관한 요청을 실행합니다.
4. **검토 후 반영** — 변경 전후 코드와 검사·검토 결과를 확인하고, 검토한 버전을 원본에 적용합니다.

처음에는 빈 작업실로 시작합니다. 로그인 전에도 요청을 작성해 둘 수 있고, 기존 기록 열람과 MCP 수집을 사용할 수 있습니다. [설치와 사용 방법 더 보기 →](docs/guide.md#시작하기)

## 화면 둘러보기

### 필요한 판단을 놓치지 않게

진행 상황과 사용자 판단이 필요한 일을 구분해 보여줍니다. 작업을 열면 방침과 선택에 따른 영향을 확인할 수 있습니다.

![판단 요청 화면: 초안을 보관하고 이동할지, 이동 전에 확인할지 선택](docs/images/decision.png)

### 작업 결과를 나의 소개로

지원 대상마다 강조할 경험을 정하고 새 결과를 초안에 모읍니다. 자동으로 갱신해도 직접 고친 문장과 제외한 사례는 보존합니다. 공개할 내용을 검토한 뒤 독립 HTML로 저장할 수 있습니다.

![포트폴리오 화면: 대상별 강조점과 작업 사례가 담긴 로컬 초안](docs/images/portfolio.png)

포트폴리오 화면에서 **Studio · Editorial · Resume** 중 하나를 고르고 **초안 저장**을 누르세요. 다크 카드형, 편집지형, 두 열 이력서형을 대상별로 저장하며, 편집 중인 문장은 그대로 유지됩니다. 미리보기와 HTML은 같은 디자인을 사용하고, 내보낸 파일은 인터넷 없이 열거나 인쇄할 수 있습니다.

디자인은 [DevPortfolio](https://github.com/RyanFitzgerald/devportfolio)와 [미니멀 CV](https://github.com/BartoszJarocki/cv)를 참고했습니다. 자세한 출처는 [Third-party notices](THIRD_PARTY_NOTICES.md#portfolio-design-references)에 정리했습니다.

<details>
<summary><strong>재사용할 기록과 출처도 살펴보기</strong></summary>

기록마다 적용 조건, 출처, 제공 이력을 확인할 수 있습니다. 내장 에이전트와 MCP는 공통 검색을 사용하고, 연결된 파일 근거가 바뀐 기록은 재확인할 때까지 제공을 보류합니다.

![기록 화면: 출처와 적용 조건, 자동 참조 여부를 함께 확인](docs/images/records.png)

</details>

## 내 도구와 연결하기

내장 실행기는 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)를 사용합니다. 외부 MCP 클라이언트도 같은 제품과 기록을 조회하고 작업 결과를 보고할 수 있습니다. Codex 훅을 연결하면 파일 변경·검사가 있었던 응답을 작업 기록으로 수집할 수 있습니다.

앱 왼쪽 아래 **Codex 연결**에서 실행 환경 확인 → MCP 등록 → 자동 수집 설정 → Codex 승인을 순서대로 진행하세요. 설정 파일을 직접 편집하거나 별도 터미널을 열 필요 없이, 앱 안의 Codex 화면에서 훅을 검토·승인할 수 있습니다. **실제 연결 검사**로 서버와 제품 데이터도 확인합니다. [연결 방법 →](docs/guide.md#mcp)

## 데이터는 어디에 남나요?

기록과 설정은 기본적으로 내 컴퓨터의 `.workroom/`에 저장합니다. 로그인 정보는 운영체제 보호 저장소로 암호화합니다. 기록의 의미 검색과 재정렬은 로컬 CPU에서 실행하며, 첫 사용 때 공개 모델 파일을 다운로드합니다.

내장 에이전트의 조사·수정에는 연결한 모델로 요청을 보냅니다. 모든 AI 기능이 오프라인으로 실행되는 앱은 아닙니다. 데이터 위치, 백업, 파일 접근 범위는 [사용 가이드](docs/guide.md#데이터와-보안)를 확인하세요.

## 현재 단계

**Local alpha · 0.1** — 제품 이름은 임시이며, 직접 사용하면서 흐름을 다듬고 있습니다.

- **사용 가능**: 제품과 목표 관리, 에이전트 조사·수정안·별도 검토, 판단 기록, 재사용 지식 검색, 대상별 포트폴리오와 HTML 내보내기, MCP 연결, 한국어·영어 UI 전환.
- **선택 기능**: 앱이 켜진 동안의 주기적 조사와 허용된 수정안 작성. 변화가 없으면 모델 호출을 건너뜁니다.
- **아직 없음**: 앱 종료 중의 백그라운드·원격 실행, 임의 빌드 스크립트 실행과 의존성 설치, 웹 배포, 인스톨러와 자동 업데이트.

창을 닫으면 실행기도 종료됩니다. 판단을 저장한 뒤 작업 재개는 직접 선택합니다. [지원 범위 자세히 보기 →](docs/guide.md#할-수-있는-일)

## 함께 다듬기

문제가 생긴 화면과 재현 순서를 [이슈](https://github.com/tttaliesin/workroom/issues)에 남겨 주세요. 코드 변경 전에는 아래 검사를 실행할 수 있습니다.

```sh
pnpm test
pnpm lint
pnpm format:check
```

| 문서 | 내용 |
| :--- | :--- |
| [사용 가이드](docs/guide.md) | 작업 실행, 데이터·보안, MCP, 검색과 근거 확인 |
| [개발과 검증](docs/development.md) | 앱 검사, 실제 모델 평가, 코드 구조 |
| [스크린샷 촬영](docs/images/README.md) | 예제 데이터로 실제 앱 화면 재촬영 |

## 라이선스

[MIT](LICENSE). Pretendard, Radix Colors, 사용 모델 등 외부 구성 요소는 [Third-party notices](THIRD_PARTY_NOTICES.md)를 참고하세요.

<p align="center"><sub>Electron · SQLite · Pi · MCP</sub></p>
