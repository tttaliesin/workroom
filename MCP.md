# Control Workroom from Codex

[한국어 README](README.md) · [English README](README.en.md)

Workroom의 MCP는 조회·보고와 실행 제어를 함께 제공합니다. 아래 제어는 앱과 동일한 서비스 및 단일 실행기를 사용합니다. 검토·승인은 Codex 대화에서 처리할 수 있습니다.

## 시작과 완료 확인

1. `workroom_control_catalog`로 지원 명령과 입력 계약을 읽습니다.
2. `workroom_control_connect`로 실제 실행기 상태를 확인합니다. `liveConnection:false`면 `start:true`로 백그라운드 실행기를 시작할 수 있습니다. `runtime`에서 AI 계정·모델·일시 정지를 확인합니다. 연결 성공 자체는 실제 모델 응답 확인이 아닙니다.
3. `workroom_control_read`로 제품·작업·초안 ID와 최신 revision을 받습니다. `kind`, `id` 또는 `productId`, `offset`, `limit`를 지정합니다. 목록 조회는 동시에 변경될 수 있으므로 실행 전 개별 항목의 최신 버전을 확인합니다. 포트폴리오 상세에는 AI 준비 조건인 `execution`도 포함합니다.
4. 명령에 필요한 인수를 구성하고 UUID `requestId`를 생성합니다. `reviewRequired:true` 명령은 `workroom_control_prepare`의 인수·영향·근거를 먼저 검토하고 반환된 `reviewHash`를 함께 전달합니다. 준비 호출은 승인이나 실행을 의미하지 않습니다.
5. `workroom_control_execute`로 접수합니다. `running`은 명령 처리 중이라는 뜻입니다. `workroom_control_operation`에 같은 요청 ID를 보내 `completed/failed/uncertain`과 결과를 확인합니다. 작업 시작 명령의 완료는 작업 접수 완료이며, AI 작업 자체의 완료는 반환된 task ID를 계속 조회해야 합니다.

## 가능한 일

| 영역 | 명령 예 |
|---|---|
| 제품·목표 | `core.createProduct`, `core.updateProduct`, `core.inspect` |
| 판단·기록 | `core.resolveDecision`, `core.deferDecision`, `core.reportWork`, `core.reviewRecord`, `core.changeWorkLink` |
| AI 작업 | `runtime.start`, `runtime.stop`, `runtime.resume`, `runtime.applyChange` |
| 계정·모델 | `runtime.login`, `runtime.manualCode`, `runtime.verify`, `runtime.configure`, `runtime.logout` |
| 지속 운영·검사 | `runtime.configureOperations`, `runtime.checkOperations`, `runtime.issueAction`, `runtime.configureVerification` |
| 포트폴리오 | `core.createPortfolio`, `core.savePortfolio`, `core.saveJobSource`, `runtime.editPortfolio`, `runtime.applyPortfolioEdit`, `runtime.configurePortfolioEditor` |
| 공개 | `publication.credentials`, `publication.configure`, `publication.prepare`, `publication.publish`, `publication.reconcile`, `publication.disconnect` |
| Codex 연결·수집 | `connection.prepare/install/probe/select`, `connection.prepareHooks/installHooks`, `core.setCodexCapture` |
| 앱 언어 | `settings.language` |
| HTML 산출물 | `workroom_control_export` — 공개 가능한 고정 HTML·원문 바이트 SHA256 반환. 클라이언트에서 원하는 파일로 저장 |

정확한 인수는 catalog가 제공하는 현재 계약을 사용하세요. 기존 조회·보고 도구 10개도 호환성을 위해 유지합니다. 제어 도구 7개를 합쳐 총 17개입니다.

로그인은 MCP에서 시작하지만 브라우저 인증은 사용자가 완료합니다. 코드 실행·자동화·공개는 사용자 지시 또는 명시적으로 위임된 범위에서 요청합니다. 검토 해시는 내용과 버전을 결합할 뿐, 사용자 승인을 증명하거나 대신하지 않습니다. Codex 자체의 프로젝트·훅 신뢰 절차는 Codex가 관리합니다.

## 검토 후 적용 예

`runtime.applyChange`를 예로 들면:

1. `kind:"task"`와 `kind:"change-set"`으로 작업, 변경 전후 내용, 검사 및 별도 검토 결과를 읽습니다.
2. `prepare`에 `{command:"runtime.applyChange", args:{id, revision, artifactHash}}`를 보냅니다.
3. 사용자가 검토하거나 위임한 기준에 따라 Codex가 검토합니다.
4. **같은 args**와 `reviewHash`, 새 `requestId`를 `execute`에 전달합니다.
5. `operation`으로 명령 결과를, task와 `apply-journal`로 파일별 반영 결과를 확인합니다.

앱에서 상태가 바뀌거나 원본 파일이 달라지면 다시 검토해야 합니다. 검토 해시 검사와 기존 원본 파일·아티팩트 해시 검사를 모두 수행합니다. 공개 역시 고정 HTML·목적지·출처 버전을 검증합니다.

## 연결 중단과 재전송

- 동일 `requestId`와 동일 내용: 기존 상태·결과를 반환합니다. 인수 객체의 키 순서는 관계없습니다.
- 동일 `requestId`와 다른 내용: 거절합니다. 의도적으로 다른 작업을 할 때만 새 ID를 사용합니다.
- 응답 유실: 먼저 기존 ID를 조회하거나 **동일 ID로** 재전송합니다. 소켓 종료는 실행 취소가 아닙니다.
- 프로세스 종료 중이던 명령: 다음 시작에서 `uncertain`으로 복원하고 자동 재실행하지 않습니다. task·apply-journal·publication을 조사한 뒤 결정합니다.
- `failed`와 `effectMayHaveOccurred:true`: 호출 중 오류가 났으며 일부 효과가 있었을 수 있습니다. 새로운 ID로 반복하기 전에 관련 기록을 확인합니다.
- 공개의 `uncertain/building/unverified` 상태는 명령의 완료 상태와 별개입니다. `publication.reconcile`로 확인하며 불확실한 요청을 무조건 다시 배포하지 않습니다.

## 실행 범위와 저장

MCP 프로세스마다 AI 실행기를 만들지 않습니다. 기존 Electron 단일 인스턴스가 실행·인증·일일 한도·재시도·공개를 소유합니다. 창 없는 시작도 같은 프로필을 사용하며 일반 앱 실행으로 그 창을 열 수 있습니다. 컴퓨터 종료 뒤 독립적으로 실행하는 원격 서비스는 아닙니다.

제어 채널은 Windows named pipe 또는 로컬 Unix socket을 사용합니다. 프로필별 임의 키를 `auth.control.json`에 저장하고 요청을 인증합니다. 이 파일은 에이전트 소스 읽기·복사에서 제외합니다. 운영체제 사용자와 데이터 폴더 권한을 신뢰 경계로 삼으며 네트워크 HTTP 제어 포트를 열지 않습니다. 요청·응답은 16 MiB, 연결 대기는 15초로 제한합니다.

명령 이력에는 요청 ID·지문·상태·결과를 저장하며 인수 원문은 저장하지 않습니다. 토큰과 수동 인증 코드는 검토 응답과 실행 결과 이력에서도 제외합니다. 자동 인증 정보는 기존 OS 보호 저장소에 저장합니다. HTML 반환은 파일 저장 기록이나 실제 웹 공개를 의미하지 않습니다.

구버전 앱이 이미 실행 중이면 명령을 받지 못합니다. 정상 종료 후 업데이트된 실행기를 시작하세요. 새 도구가 현재 Codex 대화에 없으면 MCP를 재연결하거나 새 대화를 여세요.

## English summary

Discover commands with `workroom_control_catalog`, connect with `workroom_control_connect` (`start:true` starts the shared executor without a visible window), and inspect entities with `workroom_control_read`. Review consequential operations with `workroom_control_prepare`, then send the unchanged command and arguments, `reviewHash` and a UUID `requestId` to `workroom_control_execute`. Poll `workroom_control_operation` for the result. No app approval screen is required.

Retries must retain the same request ID and content. `completed` means the command completed, not that an asynchronously started AI task or deployment finished. Query the returned task or publication separately. Interrupted operations become `uncertain` after restart and are never blindly replayed. A failed operation may have had partial effects; inspect its journals before issuing a new request. Account login can start through MCP, while the user completes browser authentication. These controls share the app's execution, version checks and protected credential storage.
