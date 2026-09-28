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
| **작업과 검토** | 조사 → 수정안 → 수정 전후 검사 → 별도 검토를 연결합니다. 결과와 변경 내용을 확인하고 원본에 반영합니다. |
| **기록과 근거** | 출처와 적용 조건을 함께 저장합니다. 내장 에이전트와 MCP가 같은 기록을 조회합니다. |
| **경험과 소개** | 제품의 새 결과를 대상별 초안에 모읍니다. 직접 다듬은 문장은 보존하고 HTML로 내보내거나, Vercel을 연결해 검토한 내용을 공개합니다. |

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

왼쪽 아래 **앱 설정 → 화면 언어**에서 **한국어 / English**를 선택할 수 있습니다. 선택은 바로 적용되고 다음 실행에도 유지됩니다. 기존 기록의 원문은 보존하며, 작성 중인 내용이 있으면 저장하거나 취소한 뒤 설정으로 이동합니다.

1. **제품 등록** — 개발 폴더를 선택하고 이루고 싶은 목표를 적습니다.
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

**작성**에서 직접 **초안 편집**을 하거나 **AI로 초안 만들기**를 선택하세요. AI 실행에 필요한 계정·모델·강조점·작업 근거가 먼저 표시되며, 계정 설정 후 같은 대상으로 돌아올 수 있습니다. AI는 소개·사례 설명·기여를 작성하고 근거를 별도로 검토합니다.

![포트폴리오 AI 작성과 실행 준비 안내](docs/images/portfolio-ai.png)

**대상·근거**는 공고 원문과 사례를, **디자인**은 템플릿을, **공개**는 HTML 내보내기와 Vercel 공개를 관리합니다. 보고 자동 반영은 작업 결과를 모으는 기능이고, AI 자동 편집은 모델로 문장을 정리하는 기능입니다. 자동 편집을 켜도 준비가 부족하면 이유와 함께 대기 상태를 표시합니다.

![포트폴리오 화면: 대상별 강조점과 작업 사례가 담긴 로컬 초안](docs/images/portfolio.png)

포트폴리오 **디자인**에서 **Studio · Editorial · Resume** 중 하나를 고르고 **초안 저장**을 누르세요. 다크 카드형, 편집지형, 두 열 이력서형을 대상별로 저장합니다. 미저장 편집이 있으면 먼저 저장하거나 취소한 뒤 화면을 이동합니다. 미리보기와 HTML은 같은 디자인을 사용하고, 내보낸 파일은 인터넷 없이 열거나 인쇄할 수 있습니다.

디자인은 [DevPortfolio](https://github.com/RyanFitzgerald/devportfolio)와 [미니멀 CV](https://github.com/BartoszJarocki/cv)를 참고했습니다. 자세한 출처는 [Third-party notices](THIRD_PARTY_NOTICES.md#portfolio-design-references)에 정리했습니다.

<details>
<summary><strong>재사용할 기록과 출처도 살펴보기</strong></summary>

기록마다 적용 조건, 출처, 제공 이력을 확인할 수 있습니다. 내장 에이전트와 MCP는 공통 검색을 사용하고, 연결된 파일 근거가 바뀐 기록은 재확인할 때까지 제공을 보류합니다.

![기록 화면: 출처와 적용 조건, 자동 참조 여부를 함께 확인](docs/images/records.png)

</details>

## 내 도구와 연결하기

내장 실행기는 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)를 사용합니다. 외부 MCP 클라이언트도 같은 제품과 기록을 조회하고 작업 결과를 보고할 수 있습니다. Codex 훅을 연결하면 파일 변경·검사가 있었던 응답을 작업 기록으로 수집할 수 있습니다.

앱 왼쪽 아래 **Codex 연결**에서 실행 환경 확인 → MCP 등록 → 자동 수집 설정 → Codex 승인을 순서대로 진행하세요. 설정 파일을 직접 편집하거나 별도 터미널을 열 필요 없이, 앱 안의 Codex 화면에서 훅을 검토·승인할 수 있습니다. **실제 연결 검사**로 서버와 제품 데이터도 확인합니다. [연결 방법 →](docs/guide.md#mcp)

상단 **계정과 실행**은 Workroom AI를 실행하는 연결이며, **Codex 연결**은 외부 도구에서 기록을 읽고 결과를 보내는 연결입니다. 직접 보고하려면 제품의 **작업 → 작업 결과 기록 / 판단 요청 만들기**를 사용하세요.

### Jev Context와 함께 사용하기

Workroom은 작업과 결과를, [Jev Context](https://github.com/tttaliesin/jev-context)는 장기 기억을 관리합니다. **각 앱의 MCP를 Codex 또는 Claude Desktop에 독립적으로 연결**하면 에이전트가 Workroom의 결과를 읽고, 필요한 내용을 Jev에 기억시키거나 조회할 수 있습니다. 두 앱 사이에 별도 연결이나 전송 화면은 없습니다.

두 MCP를 등록하는 것만으로 자동 기억되지는 않습니다. 저장 시점과 범위는 사용자 요청이나 에이전트 작업 지침으로 정합니다. 저장소·DB·배포는 계속 분리되며 각 앱을 단독으로 사용할 수 있습니다. [에이전트 사용 안내](docs/agent-memory-workflow.md) · [독립 제품 원칙](docs/independent-products.md) · [수정 계획과 결과](docs/jev-integration-results.md)

## 데이터는 어디에 남나요?

기록과 설정은 기본적으로 내 컴퓨터의 `.workroom/`에 저장합니다. 로그인 정보는 운영체제 보호 저장소로 암호화합니다. 기록의 의미 검색과 재정렬은 로컬 CPU에서 실행하며, 첫 사용 때 공개 모델 파일을 다운로드합니다.

내장 에이전트의 조사·수정에는 연결한 모델로 요청을 보냅니다. 모든 AI 기능이 오프라인으로 실행되는 앱은 아닙니다. 데이터 위치, 백업, 파일 접근 범위는 [사용 가이드](docs/guide.md#데이터와-보안)를 확인하세요.

## 현재 단계

**Local alpha · 0.1** — 제품 이름은 임시이며, 직접 사용하면서 흐름을 다듬고 있습니다.

- **사용 가능**: 제품과 목표 관리, 에이전트 조사·수정안·별도 검토, 판단 기록, 재사용 지식 검색, 대상별 포트폴리오와 HTML 내보내기, MCP 연결, 한국어·영어 UI 전환.
- **선택 기능**: 주기적 조사와 허용된 수정안 작성, 제한된 실패 재시도, 판단 답변 후 연결 작업 재개, npm 의존성 설치·검사 프로필, 트레이 실행, 공고 원문 버전 보관, 검토한 포트폴리오의 Vercel 공개·상태 확인·이전 내용 복원.
- **아직 없음**: 앱 프로세스가 종료된 동안의 실행, 원격 실행, 인스톨러와 자동 업데이트. Vercel의 실제 계정 배포는 사용자 환경에서 확인해야 합니다.

기본은 창을 닫으면 종료됩니다. 앱 설정에서 트레이 실행을 켜면 창을 닫아도 계속 진행하며, 트레이의 **완전히 종료**로 멈춥니다. [새 기능 사용법 →](docs/quality-workflows.md) · [적용 계획과 검증 →](docs/quality-implementation-plan.md)

**최근 로컬 검증 · 2026-09-28**: 단위·통합 테스트 **113개**, 실제 Electron 앱 검사 **16개** 통과. lint와 포맷 검사도 통과했습니다. 공개 요청의 중단·복구는 모의 제공자 응답으로 검증했으며, 실제 Vercel 계정 배포를 확인한 결과는 아닙니다.

최근 정리에서는 검사 실행기의 순환 의존과 중복 저장 상태를 줄이고, 성공한 테스트의 임시 프로필이 자동으로 정리되도록 바꿨습니다. [정리 계획과 완료 결과 →](docs/cleanup-implementation-plan.md)

UX 검사에서 발견한 12개 항목은 계획 자체 검토 후 적용했습니다. AI 준비 상태, 포트폴리오 단계 분리, 화면에 남는 오류 안내와 복구 동선을 개선했습니다. [UX 개선 계획·검토·검증 결과 →](docs/ux-remediation-plan.md)

## 함께 다듬기

문제가 생긴 화면과 재현 순서를 [이슈](https://github.com/tttaliesin/workroom/issues)에 남겨 주세요. 코드 변경 전에는 아래 검사를 실행할 수 있습니다.

```sh
pnpm test
pnpm check:app
pnpm lint
pnpm format:check
```

앱 검사는 격리된 예제 데이터를 사용합니다. 성공한 검사의 임시 폴더는 자동 삭제하고, 실패한 검사는 진단을 위해 보존합니다. 화면 HTML 비교 등에 예제 DB가 필요하면 `WORKROOM_KEEP_FIXTURES=1`로 실행하세요. [실행 방법과 보존 설정 →](docs/development.md)

| 문서 | 내용 |
| :--- | :--- |
| [사용 가이드](docs/guide.md) | 작업 실행, 데이터·보안, MCP, 검색과 근거 확인 |
| [개발과 검증](docs/development.md) | 앱 검사, 실제 모델 평가, 코드 구조 |
| [복구·검사·공개](docs/quality-workflows.md) | 실패 재시도, 판단 후 재개, npm 검사, 트레이 실행, Vercel 공개 |
| [정리 계획과 결과](docs/cleanup-implementation-plan.md) | 테스트 잔여물 관리, 의존·상태 정리와 회귀 검증 |
| [스크린샷 촬영](docs/images/README.md) | 예제 데이터로 실제 앱 화면 재촬영 |

## 라이선스

[MIT](LICENSE). Pretendard, Radix Colors, 사용 모델 등 외부 구성 요소는 [Third-party notices](THIRD_PARTY_NOTICES.md)를 참고하세요.

<p align="center"><sub>Electron · SQLite · Pi · MCP</sub></p>
