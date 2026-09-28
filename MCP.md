# Control Workroom from Codex

[한국어 README](README.md) · [English README](README.en.md)

Workroom 앱과 MCP는 같은 명령·검토·실행 규칙을 사용합니다. Codex에서 자료 조회 → 검토 의견 → 실행 결정 → 반영 → 결과 확인까지 진행할 수 있습니다. 앱의 승인 화면을 별도로 열 필요가 없습니다.

## 연결과 계약 버전

`workroom_control_catalog`에서 명령별 입력·결과·오류 스키마와 `reviewRequired`를 확인합니다. 도구는 기존 조회·보고 10개와 제어 7개, 총 17개입니다. 명령 계약은 **protocol 2**입니다.

`workroom_control_connect`는 실행기와 실제로 통신합니다. 앱이 꺼져 있으면 `start:true`로 같은 프로필의 실행기를 백그라운드에서 시작합니다. `liveConnection:true`와 `compatible:true`를 확인하세요. `compatible:false`는 구버전 실행기를 정상 종료하고 다시 시작해야 한다는 뜻입니다. 새 계약이 현재 대화에 없으면 MCP도 재연결합니다.

`runtime`은 내장 AI 계정·모델의 준비 상태입니다. 연결 성공은 모델 응답 성공을 의미하지 않습니다. **일반 조회·편집·외부 수정안 검사·검토·반영에는 내장 AI 계정이 필요하지 않습니다.** 내장 AI에 개발을 맡기는 `runtime.start` 등에는 계정과 모델이 필요합니다.

## 검토·결정·실행

1. `workroom_control_read`로 대상과 최신 revision을 조회합니다. `kind`, `id` 또는 `productId`, `offset`, `limit`를 사용합니다.
2. 실행할 `{command,args}`를 `workroom_control_prepare`에 보냅니다. 고정된 검토 자료와 `packageId`, `packageHash`, 관련 버전·근거가 저장됩니다. 이 호출은 승인하지 않습니다.
3. `workroom_control_execute`에서 `review.submit`을 실행합니다. `packageId`, `verdict` (`supported/changes_requested/inconclusive`), `assessment`, `limitations`를 전달합니다. 코드 반영의 긍정적인 검토에는 **변경한 모든 파일의 `path`와 수정 후 `hash`**를 `files`에 넣어야 합니다. 결과의 `id`가 reviewId입니다.
4. 같은 도구로 `review.decide`를 실행합니다. `reviewId`, `choice` (`execute/revise/reject`), `authority:{basis,reference}`를 전달합니다. basis는 `user_instruction` 또는 `delegated`이고 reference에는 해당 지시·위임의 근거를 적습니다. 결과의 `id`가 decisionId입니다.
5. 원래 명령과 **같은 args**, `reviewId`, `decisionId`, 새 UUID `requestId`를 `workroom_control_execute`에 전달합니다. `reviewHash`만으로는 실행할 수 없습니다.
6. `workroom_control_operation`에 requestId를 보내 결과를 조회합니다. `accepted/running`은 완료가 아닙니다. 완료한 명령이 작업이나 배포를 시작한 경우, 반환된 task/publication 상태를 별도로 확인합니다.

각 `review.submit`, `review.decide` 호출에도 고유한 requestId가 필요합니다. 일반 초안 수정·조회에는 이 검토 단계를 강제하지 않습니다. 실제로 읽고 판단한 의견을 기록해야 하며, 해시나 모델의 긍정적인 의견은 검사 실행 증거를 대신하지 않습니다.

검토 자료가 바뀌면 기존 결정은 무효입니다. 같은 자료에 더 최근 검토나 결정이 생겨도 이전 것으로 실행할 수 없습니다. 검토 자료는 명령별 관련 버전에 연결되므로 무관한 화면 언어 변경으로 코드 검토를 무효화하지 않습니다.

지시·위임 근거는 연결된 클라이언트의 진술로 저장하며, 사용자 신원의 암호학적 증명으로 표시하지 않습니다 (`authorityVerified:false`). 사용자의 지시 또는 위임 범위 안에서 요청하세요. 앱의 실행 버튼 역시 같은 자료·검토·결정 계약으로 기록되며, 앱 사용자 액션을 독립 AI 검토로 표시하지 않습니다.

## 내장 AI 없이 외부 수정안 반영하기

`external.submit`에 다음 내용을 전달합니다. 이 명령도 위의 검토·결정 절차를 거칩니다.

```text
productId, productRevision
goal, source, limitations
files: [{path, beforeHash, content}, ...]
testFiles: [실행할 Node 테스트 파일 경로, ...]
allowTests: true  // testFiles를 실행하도록 사용자가 허용한 경우
```

기존 파일의 beforeHash는 현재 원문 바이트의 SHA256이고 새 파일은 null입니다. 최대 16개 텍스트 파일, 파일당 48,000자, 명시적인 Node 테스트 파일 최대 8개를 지원합니다. 기존 경로·비밀값·검사 파일 보호 규칙을 적용합니다. 외부에서 이미 수정한 원본을 사전 검토 후 반영한 것으로 꾸미지 마세요.

Workroom이 기준 복사본과 수정 복사본을 만들고, 전달받은 파일 내용을 적용한 뒤 실제 검사를 수행합니다. 외부의 ‘검사 통과’ 주장으로 결과를 채우지 않습니다. 실패한 검사는 반영을 차단합니다. 검사가 미확인인 경우에만 `acceptUnconfirmed:true`를 포함한 정확한 명령을 검토·결정할 수 있습니다.

제출 명령이 완료되면 task의 `outputs.check`, 연결된 `change-set`의 변경 전후 내용을 읽습니다. 반영할 인수는 `{id:task.id, revision:task.revision, artifactHash}`입니다. `runtime.applyChange`에 대해 검토·결정·실행 절차를 수행합니다. 원본 파일·수정본·제품 범위·검사 정책은 실행 시 다시 검사합니다. 결과와 검토 이력은 앱에도 표시됩니다.

내장 AI에게 개발을 맡기되 Codex가 검토하려면 `runtime.start`의 `reviewMode:"external"`을 사용합니다. 검사 후 `awaiting_review`에서 대기하며 내장 `change_review`를 자동 실행하지 않습니다. 기본값 `builtin`은 기존 내장 검토 흐름입니다.

## 명령 영역

| 영역 | 명령 예 |
|---|---|
| 제품·판단·기록 | `core.createProduct/updateProduct/resolveDecision/reportWork/reviewRecord` |
| 작업·계정·설정 | `runtime.start/stop/resume/configure/login/verify` |
| 운영·검사 범위 | `runtime.configureOperations/checkOperations/configureVerification` |
| 외부 수정안 | `external.submit`, `runtime.applyChange` |
| 검토·결정 | `review.submit`, `review.decide` |
| 초안·AI 편집 | `core.createPortfolio/savePortfolio/saveJobSource`, `runtime.editPortfolio/applyPortfolioEdit` |
| 공개 | `publication.credentials/configure/prepare/publish/reconcile` |
| 연결·수집 | `connection.prepare/install/probe/prepareHooks/installHooks`, `core.setCodexCapture`, `capture.event` |
| 언어·산출물 | `settings.language`, `artifact.export`, `workroom_control_export` |
| 복구·접수 취소 | `operation.reconcile`, `operation.cancel` |

정확한 인수는 catalog의 스키마를 사용하세요. 포트폴리오 상세 조회에는 AI 준비 조건 `execution`도 포함합니다. HTML 내보내기는 고정 산출물과 원문 SHA256을 반환하며 웹 공개나 클라이언트 파일 저장을 뜻하지 않습니다.

## 재전송과 실패 복구

| 상황 | 동작 |
|---|---|
| 같은 requestId·같은 명령 내용 | 기존 상태·결과 반환. 객체 키 순서는 무관 |
| 같은 requestId·다른 내용 | `REQUEST_ID_CONFLICT` |
| 변경된 검토 대상 | `REVIEW_STALE`; 새 자료를 읽고 검토 |
| 응답 유실 | 같은 ID 조회 또는 같은 ID 재전송. 연결 종료는 취소가 아님 |
| 실행 전 접수 상태 | `operation.cancel` 가능. 이미 실행 중인 AI 작업은 `runtime.stop` 사용 |
| 실행 중 프로세스 종료 | `uncertain` 보존, 자동 재실행 없음 |
| failed와 effectMayHaveOccurred:true | 일부 효과가 있었을 수 있음. 대상·저널 조사 후 다음 행동 결정 |

`operation.reconcile`에 기존 requestId를 전달하면 실제 반영 저널·파일 버전, 배포 결과, 외부 제출 작업을 대조하고 `operation-resolution`에 근거를 남깁니다. 입증할 수 없는 결과는 `unresolved`로 남깁니다. 원본 일부만 반영됐다면 최신 task·change-set·apply-journal을 검토하고 새 결정으로 남은 반영을 요청합니다. 파일별 해시 검사로 이미 반영한 파일을 대조합니다.

공개의 `building/uncertain/unverified/failed`는 명령 완료와 별개의 상태입니다. `publication.reconcile`로 확인하며 같은 공개 요청을 무조건 다시 배포하지 않습니다. 모든 외부 효과의 ‘정확히 한 번 완료’를 보장한다고 주장하지 않습니다.

## 기존 도구와 자동 수집

기존 조회·보고 도구의 이름과 결과 형태는 유지합니다. 보고·판단 요청·점검·조회 이력 저장도 같은 실행기로 전달합니다. 변경 도구는 선택적인 requestId를 받습니다. 재전송을 제어하려면 클라이언트가 ID를 정하세요. 실행기가 꺼져 있으면 먼저 연결·시작해야 하며, 별도 MCP 프로세스에서 DB를 직접 변경하지 않습니다. 저장된 상태의 읽기 도구는 오프라인에서도 사용할 수 있습니다.

사용자가 켜 둔 Codex 자동 수집 훅도 같은 제어 경로를 사용합니다. 실행기가 없으면 같은 프로필에서 백그라운드로 시작합니다. 훅의 오류는 개발 대화를 중단하거나 지시를 주입하지 않고 수집 실패로 알립니다. 수집 설정과 기존 훅의 신뢰 절차는 유지합니다.

## 실행과 저장 경계

프로필별 Electron 단일 실행기가 작업·계정·한도·공개를 소유합니다. 앱, MCP, 스케줄러와 수집 훅은 같은 업무 명령을 전달하고, 작업 내부의 역할 전이·파일별 저널·원자적 예약은 기존 도메인이 관리합니다. 창을 숨긴 실행도 같은 프로필이며, 컴퓨터 종료 뒤 동작하는 원격 서비스는 아닙니다.

로컬 named pipe/Unix socket과 `auth.control.json`의 프로필 키를 사용합니다. 이 파일은 에이전트 소스 읽기·복사에서 제외하며 HTTP 제어 포트를 열지 않습니다. OS 사용자와 데이터 폴더 권한을 신뢰 경계로 삼습니다. 요청·응답은 16 MiB, 소켓 대기는 15초로 제한합니다. 큰 목록은 페이지나 항목 ID로 조회하세요.

명령 이력은 요청 ID·지문·출처·안전한 대상 참조·상태·결과를 보관합니다. 비밀 명령의 원문·오류·결과에 토큰이나 수동 인증 코드를 남기지 않습니다. 검토 자료에는 검토에 필요한 비밀을 제외한 인수와 근거가 저장됩니다. 브라우저 인증은 사용자가 해당 인증 시스템에서 완료합니다.

## English workflow

Protocol 2 adds persistent review packages, review records and execution decisions. Discover schemas with `workroom_control_catalog`; connect with `workroom_control_connect` and check both `liveConnection` and `compatible`. `start:true` starts the shared local executor without opening its window.

Prepare the exact command and arguments, then execute `review.submit` with the packageId, verdict, assessment, limitations and every changed file's resulting hash. Execute `review.decide` with the reviewId, choice and the user's instruction or delegated authority reference. Finally execute the original command with unchanged arguments, reviewId, decisionId and a UUID requestId. A review hash alone never authorizes execution. Poll `workroom_control_operation`; task and deployment completion are separate.

`external.submit` accepts explicit file contents and original SHA256 hashes, creates isolated copies and runs actual selected checks. It requires no built-in AI account. Review and apply through `runtime.applyChange`. For built-in development followed by external review, start with `reviewMode:"external"`. Failed checks, changed scope and conflicting source files remain blocking.

Keep the same request ID on retries. `operation.reconcile` records evidence when resolving interrupted operations; unverifiable effects stay unresolved. Reviews and decisions are visible in the app. Legacy mutating MCP tools and enabled Codex collection hooks also use the shared executor. The hook may start it in the background. These local checks do not establish successful live paid-model calls or real Vercel deployments.
