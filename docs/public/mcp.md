# Control Workroom from Codex and Claude Desktop

[한국어 README](../../README.md) · [English README](../../README.en.md)

Workroom 앱과 MCP는 같은 명령·검토·실행 규칙을 사용합니다. Codex에서 자료 조회 → 검토 의견 → 실행 결정 → 반영 → 결과 확인까지 진행할 수 있습니다. 앱의 승인 화면을 별도로 열 필요가 없습니다.

## 연결과 계약 버전

`workroom_control_catalog`에서 명령별 입력·결과·오류 스키마와 `reviewRequired`를 확인합니다. 기존 조회·보고와 제어 도구를 유지하며 `workroom_guide`가 업무 절차를 제공합니다. 명령 계약은 **protocol 2 / contractVersion 1**, 지침은 **guidanceVersion 2**입니다. 선택적 실행 출처와 결과 연결 상태가 추가되어 `schemaHash`가 변경됐으므로 어댑터와 실행기를 함께 갱신해야 합니다. 과거 저장된 명령 결과는 당시 형태를 유지합니다.

### 일반 작업의 기본 행동

v2 검증 상태: 격리 stdio MCP의 직접 파일 수정·실제 Node 검사·보고 수정·저장 확인·관련 현황 갱신, 합성 훅 연결과 실제 프로세스 중단 복구, 기존 Electron 현황·보고 내보내기 회귀를 확인했습니다. **2026-09-30 현재 Codex의 실제 연결에서 지침 v2, 최신 어댑터·실행기의 계약·프로필 일치와 `readyForControl:true`를 확인했습니다.** 기존 프로젝트 훅 설치·사용자 신뢰 뒤 실제 설정 작업의 보고 저장·재조회, PostToolUse 요청 연결과 Stop 요약 연결을 확인했습니다. 작업 목록은 구조화 보고 한 건에 훅 요약을 근거로 연결하며 중복 성과에서 제외합니다. Claude의 실제 자료용 연결과 양쪽 격리 검증 연결도 준비했습니다. **새 Claude Desktop 대화의 조사 정리 → 자발적 보고 → 저장 재조회는 실제로 확인했습니다. Codex 새 대화의 v2 자발적 사용과 프로젝트 보고서·포트폴리오의 실제 중복 집계는 아직 미검증**이며 설정 작업의 성공·SDK 준비와 구분합니다.

Claude 확인에서는 Workroom이나 기록 절차 없이 프로젝트의 조사 결과와 다음 할 일만 요청했습니다. 클라이언트 도구 승인은 사용자가 수행했고, 모델은 격리 프로필의 저장된 자료를 읽어 근거와 한계를 정리한 작업 보고 한 건을 저장·재조회했습니다. 별도 읽기 전용 MCP 클라이언트로 저장 결과를 대조한 과정은 모델의 자발적 실행 증거와 구분합니다. 내장 AI는 미연결이었으며 실제 코드 수정·검사 실행·공개를 수행했다고 주장하지 않았습니다. 잡담·미등록 대상·기록 거부는 보고를 추가하지 않았고, 같은 요청·보고 식별자의 재전송은 작업 1건과 원래 버전·내용을 유지했습니다. 이 결과는 Claude 조사 정리·제외·동일 요청 재전송의 확인이며 양쪽 클라이언트의 전체 수용 완료가 아닙니다.

등록한 폴더에서 “이 버그 고쳐줘”, “이 조사 결과 정리해줘”처럼 요청해도 지침은 시작 시 맥락 조회, 의미 있는 작업 종료 시 결과 기록과 근거 있는 현황 갱신을 요구합니다. 가장 구체적인 등록 폴더를 선택하며 미등록 프로젝트를 자동 생성하지 않습니다. 실패·부분 완료를 완료로 바꾸거나 담당자·일정·다른 위험을 추정하지 않습니다. 일반 개발은 클라이언트의 파일 도구로 수행하고 결과만 보고합니다. 이미 고친 파일을 `external.submit`으로 재제출하지 않습니다.

업무 시작 전 등록 여부를 이미 안다고 가정하지 않습니다. `workroom_list_products`로 실제 작업 폴더나 사용자가 지정한 대상을 먼저 대조하고, 일치한 등록 대상에만 맥락 조회·결과 보고를 수행합니다. 잡담은 이 업무 절차에서 제외하며 미등록 대상을 자동 생성·보고하지 않습니다. 기록 거부는 아래 수집 중지 규칙까지 따릅니다. 이 첫 조회 규칙은 서버 초기 안내·도구 설명·한영 guide·리소스·프롬프트의 공통 원본에 들어 있습니다. 지침만 바뀌며 protocol 2와 업무 계약은 바뀌지 않습니다. 이미 연결된 MCP 어댑터는 갱신해야 수정한 안내를 읽습니다.

2026-09-30 실제 Codex 버그 요청에서는 코드 수정과 Node 검사 성공 뒤에도 Workroom 조회·보고가 없었습니다. 후속 도구 목록 진단은 두 Workroom 서버의 노출을 확인했으나 실제 연결·자발적 사용의 성공 증거가 아닙니다. 격리 폴더의 훅 신뢰를 확인하고 첫 등록 조회 규칙을 보완했습니다. 원래 실패와 MCP를 언급한 진단 대화를 새로운 자발적 수용으로 재사용하지 않으며, 새 실제 대화 확인은 아직 남아 있습니다.

잡담·단순 설명·반복 조회는 보고 대상이 아닙니다. “기록하지 마라”는 지시를 우선합니다. 해당 프로젝트의 Codex 훅 수집이 켜져 있으면 파일 작업 전에 `core.setCodexCapture(enabled:false)`로 끄고 저장을 확인하도록 안내합니다. 이는 프로젝트 단위 설정이며 임의로 다시 켜지 않습니다. 지침 전달은 모델의 자발적 실행을 보장하는 강제 실행기가 아닙니다. 양쪽 실제 대화의 v2 자발적 사용은 아래 검증 상태와 구분하세요.

### 실행 출처와 중복 기록

`core.reportWork`와 `workroom_report_work`는 선택적 `execution: { client: "codex" | "claude", sessionId?, turnId? }`를 받습니다. 실제 아는 식별자만 보내고 모르면 생략합니다.

| 식별자 | 용도 |
|---|---|
| `requestId` | 명령 재전송과 응답 유실 조회. 같은 요청은 같은 인수와 UUID 사용 |
| `externalId` / `sourceVersion` | 문제별 보고 식별과 전체 내용 수정. 별개 문제는 별도 ID |
| `execution` | 실행 출처의 클라이언트 진술. 인증·권한·승인 증명이 아님 |

업데이트된 Codex PostToolUse 훅은 보고 도구와 `core.reportWork` 호출의 실제 세션·턴·도구 호출 ID를 관측합니다. 모델이 호스트 ID를 몰라도 명시한 `requestId`를 영속 보고 영수증·명령 결과·프로젝트·보고 해시와 대조할 수 있습니다. 코드 모드의 중첩 MCP 호출도 공식 훅 관측 대상입니다. [Codex 훅 문서](https://learn.chatgpt.com/docs/hooks)

명령 처리 전 관측은 대기 상태로 남기고 명령 종료·후속 이벤트·실행기 복구 때 재대조합니다. 보고 저장 뒤 명령 완료 전에 중단되면 저장 효과만 연결하며 명령의 `uncertain`은 유지합니다. 잘못된 요청·내용·프로젝트·출처는 자동 연결하지 않습니다. 호스트 ID를 적은 클라이언트 주장만으로 훅과 합치지 않으며 과거 기록을 제목·시간 유사도로 합치지 않습니다.

보고 결과의 `executionLink`는 당시 스냅샷입니다. 최신 `workroom_control_read(kind:"task", id:...)`와 `workroom_control_read(kind:"execution-link", productId:...)`로 `unlinked/pending/linked/conflict` 및 관측별 상태를 확인하세요. 응답 유실은 같은 요청을 먼저 조회하고 새 ID로 재실행하지 않습니다. `unmatched` 관측은 저장된 보고 효과가 없는 종료 요청입니다.

연결된 훅 요약은 별도 성과에서 제외하고 구조화 보고의 공통 근거로 제공합니다. 원본 보고·훅·보고 수정 이력은 유지합니다. 같은 턴의 서로 다른 문제는 별개 작업입니다. 사용자 편집 포트폴리오 문장과 수동 작업 연결은 자동 제거하지 않습니다. 편집된 초안에 남긴 항목은 사용자 검토가 필요할 수 있습니다. Claude는 안정적인 보고 ID로 재전송·수정을 처리하며 Claude 대화 자동 수집은 제공하지 않습니다.

기존 훅 설정은 자동 변경하지 않습니다. 제품 설정에서 훅 연결을 다시 설치하면 새 MCP matcher가 들어갑니다. 변경된 훅 정의는 Codex에서 `/hooks`로 다시 검토·신뢰해야 합니다. 기존 사용자 앱·미저장 입력을 확인하고 실행기를 정상 갱신한 뒤 클라이언트 MCP도 갱신하세요.

### MCP에 포함된 사용 지침

별도 Skill 설치 없이 다음과 같이 요청할 수 있습니다.

> Workroom 사용 지침을 읽고 연결 상태를 확인해줘. 이 저장소의 프로젝트 현황과 다음 할 일을 정리해줘.

MCP 초기화 `instructions`, `workroom_guide`, `workroom://guides/{language}/{topic}` 리소스, `workroom_workflow` 프롬프트가 같은 지침 원본을 사용합니다. 호스트가 리소스나 프롬프트를 노출하지 않아도 조회 도구로 읽을 수 있습니다. instructions의 전달과 모델의 준수 여부는 호스트에 따라 달라질 수 있으며 업무 제한은 서버에서 검증합니다.

| topic | 내용 |
|---|---|
| `start` (기본) | 연결·프로필·버전 확인과 지침 목차 |
| `projects` | 현황·마일스톤·고정 보고서 |
| `records` | 기록·맥락·작업 보고·사용자 판단 |
| `development` | 외부 수정안·검사·검토·결정·원본 반영 |
| `portfolio` | 초안·고정 HTML·내보내기·공개 |
| `capture` | Codex 훅 자동 수집 설정과 수신 확인 |
| `recovery` | 충돌·중복·응답 유실·부분 효과 복구 |

`language`는 `ko`(기본) 또는 `en`입니다. 예를 들어 다음 도구 호출로 영어 개발 지침과 필요한 계약만 읽습니다.

```json
{"name":"workroom_guide","arguments":{"topic":"development","language":"en"}}
```

```json
{"name":"workroom_control_catalog","arguments":{"commands":["external.submit","runtime.applyChange","review.submit","review.decide"]}}
```

catalog의 선택적 `commands`는 1~20개 명령을 받습니다. 생략하면 기존 전체 응답을 반환합니다. `usage`는 명령 목적과 지침 URI를 연결하고, 입력·결과·오류·reviewRequired는 기존 계약 정의를 사용합니다. 지침 문구는 업무 계약 `schemaHash`에 포함하지 않습니다.

`workroom_workflow` 프롬프트 인수는 `workflow`(topic 중 하나), `goal`, 선택적 `productId`와 `language`입니다. 프롬프트는 안내만 생성하며 명령을 실행하거나 승인하지 않습니다. 사용자 지시와 권한은 실제 대화에서 확인합니다.

### Claude Desktop 연결

앱의 **설정 → 외부 도구 → 다른 MCP 클라이언트 연결 → 연결 설정 보기 → MCP 설정 복사**에서 JSON을 복사합니다. Codex 설치와 동일한 Node 실행 파일·서버 경로·명시적 자료 폴더를 사용합니다. Node.js 24 이상이 필요합니다.

Claude Desktop의 개발자 설정에서 설정 파일을 열고 기존 `mcpServers`에 `workroom` 항목만 병합하세요. Windows 설정 파일은 `%APPDATA%\Claude\claude_desktop_config.json`이며 설치 방식에 따라 개발자 설정에 표시된 실제 경로를 우선합니다. 기존 서버와 다른 환경 변수는 보존하세요. 작업을 마친 뒤 Claude 연결을 갱신하고 새 대화에서 위 요청을 실행합니다. MCP 확장 패키지나 별도 Skill 설치는 필요하지 않습니다. [공식 로컬 MCP 연결 안내](https://modelcontextprotocol.io/docs/develop/connect-local-servers)

MCP 연결은 자동 수집과 별개입니다. 자동 수집은 별도 Codex 훅을 사용하며 Claude 대화를 자동 수집하지 않습니다. 일반 조회·편집·외부 검토는 Workroom 내장 AI 계정 없이 가능합니다.

`workroom_control_connect`는 실행기와 실제로 통신합니다. 앱이 꺼져 있으면 `start:true`로 같은 프로필의 실행기를 백그라운드에서 시작합니다. `liveConnection:true`와 `compatible:true`를 확인하세요. `compatible:false`는 구버전 실행기를 정상 종료하고 다시 시작해야 한다는 뜻입니다. 새 계약이 현재 대화에 없으면 MCP도 재연결합니다.

`runtime`은 내장 AI 계정·모델의 준비 상태입니다. 연결 성공은 모델 응답 성공을 의미하지 않습니다. **일반 조회·편집·외부 수정안 검사·검토·반영에는 내장 AI 계정이 필요하지 않습니다.** 내장 AI에 개발을 맡기는 `runtime.start` 등에는 계정과 모델이 필요합니다.

### 명령별 결과 계약

protocol 2의 입력과 반환 형태를 유지하면서 **contractVersion 1**의 명령별 결과 검증을 적용합니다. catalog의 output은 완료한 명령의 `operation.result` 스키마입니다. 제품·작업·초안 등의 ID와 revision, 명령별 상태와 핵심 필드를 검사하며, 외부 수정안 결과에는 검사 증거·산출물 해시·changeSetId, 반영 결과에는 appliedAt이 필요합니다. 확장 필드는 보존합니다. `runtime.stop`과 내부 스케줄러 등 기존에 결과가 없던 명령은 명시적인 null 계약을 유지하므로 대상 작업의 종료 상태를 따로 조회하세요.

catalog는 MCP 어댑터가 로드한 계약입니다. connect는 실행기의 `contractVersion`, `schemaHash`, 시작 시각·PID·dataDirectory를 반환합니다. `compatible`는 protocol 호환성, **`contractCompatible`는 어댑터와 실행기의 계약 일치**입니다. 도구가 보이거나 catalog 조회가 성공해도 실행기 연결을 증명하지 않습니다. 새 필드가 없거나 contractCompatible이 false이면 실행 중인 구성 요소가 예전 코드일 수 있습니다.

새 Operation에는 적용한 계약 버전·해시를 보관합니다. 이전 저장 결과는 `contractVersion:0`으로 조회하며 새 스키마를 소급 적용하지 않습니다. 같은 요청 ID는 당시 결과를 반환합니다. 향후 호환성을 깨는 입력·반환 형태 변경에는 별도 protocol 전환이 필요합니다.

오류는 code/message 외에 phase, effectMayHaveOccurred, recovery를 제공합니다. 앱 IPC와 MCP, 저장된 Operation의 failure가 같은 계약을 사용합니다. 기존 error/errorCode 필드는 유지합니다. 알 수 없는 하위 시스템 오류는 DOMAIN_REJECTED로 분류하고 안전한 causeCode를 남깁니다.

| 오류 단계·코드 | 의미와 후속 행동 |
|---|---|
| admission · INVALID_INPUT/REVIEW_STALE 등 | 실행 전에 거절. 자료와 요청을 수정 |
| execution · DOMAIN_REJECTED 등 | 업무 처리 중 실패. 부분 효과 가능성을 확인하고 같은 requestId 조회 |
| result · RESULT_CONTRACT_INVALID | 효과 발생 후 반환 형식이 계약과 불일치. uncertain으로 보존, 자동 재실행 금지 |
| persistence · RESULT_PERSISTENCE_FAILED | 완료 결과 저장 실패. uncertain으로 응답. DB가 계속 실패하면 디스크의 running은 재시작 후 uncertain으로 복구 |
| transport · EXECUTOR_UNREACHABLE | 전송 후 응답 유실이면 실행 실패로 단정하지 않고 같은 requestId 조회 |

recovery는 action, 가능한 requestId, `automaticRetry:false`를 담습니다. 잘못된 결과 원문은 오류에 보관하지 않습니다. `operation.reconcile`도 결과 스키마를 통과한 증거만 confirmed로 기록하며, 입증 불가·형식 불일치는 unresolved로 유지합니다.

명령 완료 뒤 응답이 전송 크기 제한을 넘는 경우에도 transport 오류에 효과 가능성과 원래 requestId를 제공합니다. 이는 저장된 명령의 실패를 뜻하지 않습니다. 큰 결과의 전체 조회가 다시 제한에 걸리면 알려진 대상 ID로 필요한 자료를 개별 조회하세요. 요청 인수가 잘못되어 접수 전 거절된 경우와 구분합니다.

### 연결 갱신과 확인

1. 현재 대화에서 `workroom_control_connect(start:false)`를 호출합니다. 선택적 `expectedDataDirectory`에 의도한 절대 자료 경로를 넣으면 다른 프로필의 실행을 시작하지 않습니다.
2. `adapter`, `executor`, `installed`의 소스 식별과 계약을 비교합니다. `ADAPTER_OUTDATED`이면 해당 클라이언트의 MCP 연결을 갱신합니다. 연결 갱신 기능이 보이지 않으면 진행 중 작업을 저장하고 클라이언트를 다시 시작합니다. 설정 파일이 최신이어도 이미 실행 중인 어댑터는 이전 코드를 유지할 수 있습니다. [Codex 공식 MCP 문서](https://learn.chatgpt.com/docs/extend/mcp)
3. `EXECUTOR_OUTDATED`이면 Workroom의 진행 중 작업과 미저장 입력을 확인·저장한 뒤 정상 종료하고 다시 시작합니다. 상태를 확인할 수 없으면 임의 종료하지 않습니다. `runtime.restart`는 내장 AI 런타임 명령이며 이 실행기 갱신 절차를 대신하지 않습니다.
4. 현재 대화에서 다시 조회해 `liveConnection`, `compatible`, `contractCompatible`, `profileCompatible`, `readyForControl`과 자료 경로를 확인합니다. 구형 실행기의 소스 식별은 `unknown`일 수 있으며 이를 최신 버전의 증거로 사용하지 않습니다. 계약 해시가 다르다는 이유만으로 어느 쪽이 오래됐는지 추정하지 않습니다.

엔드포인트가 없거나 실행기가 듣고 있지 않을 때만 `start:true`로 창 없이 시작합니다. 접근 거부·설정 파일 손상·프로토콜 오류는 시작으로 해결하지 않으며 `failure.code/details`와 복구 안내를 따릅니다. 연결 확인 자체는 AI 로그인이나 공개 배포를 수행하지 않습니다.

호환성: 기존 도구명·입력·명령 결과와 protocol 2/contractVersion 1을 유지합니다. catalog 필터, guide와 진단 필드는 추가 기능입니다. 접속 전 `ENOENT`/`ECONNREFUSED`는 이제 `EXECUTOR_OFFLINE`으로 구분하고, 파일 접근·JSON 손상은 `EXECUTOR_UNREACHABLE`에 `details.causeCode`를 보존합니다. 전송 후 불확실성 처리와 요청 ID 조회 규칙은 유지합니다.

별도 테스트 MCP 클라이언트나 직접 소켓 호출 성공은 현재 Codex 대화의 도구 연결 성공이 아닙니다. 사용자 자료를 변경하는 검증에는 실제 프로필 대신 격리된 프로필이 필요합니다. 현재 대화가 그 프로필을 가리키지 않으면 연결 검증과 격리 흐름 검증을 따로 기록하세요.

2026-09-29에는 Codex를 다시 연 뒤 별도 `workroom_acceptance` 연결이 실제 대화 도구 목록에 표시되는 것을 확인했습니다. 그 도구로 지침 조회, 외부 수정안 검사·검토·결정·반영, 저널과 실제 파일 해시 대조, 현황·마일스톤 저장, 고정 보고서 조회·저장을 수행했습니다. 검증 도중 실행기가 한 번 연결 해제되어 재접속하고 요청 ID 미접수를 확인한 뒤 동일 ID로 이어갔습니다. 종료 원인은 확인되지 않았습니다. 테스트 연결은 사용자 자료용 `workroom`의 대체가 아닙니다. Claude는 지침 발견과 안내 도구 선택까지 확인했으며, 도구 사용 승인 뒤의 전체 흐름은 별도 미검증입니다.

## 검토·결정·실행

1. `workroom_control_read`로 대상과 최신 revision을 조회합니다. `kind`, `id` 또는 `productId`, `offset`, `limit`를 사용합니다.
2. 실행할 `{command,args}`를 `workroom_control_prepare`에 보냅니다. 응답의 `id`를 다음 호출의 `packageId`로 사용합니다. `packageHash`, 관련 버전·근거가 함께 저장되며 이 호출은 승인하지 않습니다.
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

수정안 작성에는 실제 원문·기준 해시·검사 파일이 필요합니다. 클라이언트의 파일 도구 또는 제공된 원본 자료를 사용하세요. 현재 Workroom MCP의 엔티티 조회는 임의 저장소 파일 탐색 API가 아니므로 자료에 접근할 수 없으면 필요한 원본을 요청하고 추측으로 채우지 않습니다.

Workroom이 기준 복사본과 수정 복사본을 만들고, 전달받은 파일 내용을 적용한 뒤 실제 검사를 수행합니다. 외부의 ‘검사 통과’ 주장으로 결과를 채우지 않습니다. 실패한 검사는 반영을 차단합니다. 검사가 미확인인 경우에만 `acceptUnconfirmed:true`를 포함한 정확한 명령을 검토·결정할 수 있습니다.

제출 명령이 완료되면 task의 `outputs.check`, 연결된 `change-set`의 변경 전후 내용을 읽습니다. 반영할 인수는 `{id:task.id, revision:task.revision, artifactHash}`입니다. `runtime.applyChange`에 대해 검토·결정·실행 절차를 수행합니다. 원본 파일·수정본·제품 범위·검사 정책은 실행 시 다시 검사합니다. 결과와 검토 이력은 앱에도 표시됩니다.

내장 AI에게 개발을 맡기되 Codex가 검토하려면 `runtime.start`의 `reviewMode:"external"`을 사용합니다. 검사 후 `awaiting_review`에서 대기하며 내장 `change_review`를 자동 실행하지 않습니다. 기본값 `builtin`은 기존 내장 검토 흐름입니다.

## 명령 영역

### 프로젝트 현황·계획·보고

다음 명령은 내장 AI 계정이나 별도 승인 화면 없이 `workroom_control_execute`로 실행합니다. `requestId`를 유지하고 `workroom_control_operation`에서 완료 결과를 확인합니다. 앱의 계획 화면도 동일한 명령과 버전 검사를 사용합니다.

| 명령 | 입력과 결과 |
|---|---|
| `core.updateProjectStatus` | 제품 `id/revision`, `lead`, `targetDate`(YYYY-MM-DD 또는 빈 문자열), `phase`(planned/active/paused/completed), `health`(not_set/on_track/at_risk/off_track), `summary/risks/nextStep` → 새 revision과 management를 포함한 제품 |
| `core.saveMilestone` | `productId/title/assignee/targetDate/status/note/taskIds`; 수정 시 `id/revision` 필수 → milestone ID·revision·저장 내용 |
| `core.projectReport` | `productId`, `days`(7/30/0=전체), `language`(ko/en) → Markdown·독립 HTML·보고 섹션·생성 시각·원본 ID/revision 목록 |

`workroom_control_read`의 `kind:"milestone"`과 `productId`로 계획을 조회합니다. milestone status는 planned/in_progress/blocked/done/cancelled입니다. done/blocked에는 근거 또는 사유 메모가 필요하며, taskIds에는 같은 제품의 작업만 연결할 수 있습니다. 오래된 revision은 거절합니다. 작성자의 완료 보고를 실제 검사·반영·배포 완료로 취급하지 않습니다.

보고 생성은 현재 자료의 불변 결과를 요청 이력에 저장합니다. 해당 requestId를 조회하면 같은 보고서를 받습니다. Markdown 복사와 HTML 저장은 앱에서 사용자가 수행하며 MCP 결과 자체가 외부 발송이나 공개를 수행하지 않습니다. 보고서에는 자동으로 원본 경로·전체 도구 출력·계정 정보를 넣지 않지만 작성한 요약·메모는 포함되므로 공유 전에 확인하세요.

이 명령은 기존 protocol 2 / contractVersion 1에 추가됩니다. 새 catalog 및 milestone 조회가 보이지 않으면 MCP 어댑터와 Workroom 실행기를 갱신해야 합니다. source만 갱신해도 이미 실행 중인 프로세스의 계약은 바뀌지 않습니다.

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

On 2026-09-30, the current Codex connection directly confirmed guidance v2, matching contracts/profile and readiness for control. Actual setup reports, host requests and the Stop summary are linked; the work list counts one structured report with hook evidence. A fresh Claude Desktop conversation autonomously retrieved research context, summarized it, saved a report and read it back after user-granted tool permission. No Workroom or recording instructions were added to its request. Its saved report was separately compared through a read-only MCP client; that comparison is not the autonomous model. The built-in AI was disconnected, and no code edits, newly executed checks or publication were claimed. Chat, an unregistered target and a recording opt-out added no report. Replaying the same request and report IDs retained one task with its original revision and content. Fresh Codex ordinary-request acceptance and live deduplication in project reports and portfolios remain unverified.

Guidance v2 applies to ordinary work in registered folders, even without a Workroom mention: read context at the start, report meaningful outcomes and evidenced status changes, then confirm stored content. Use the most specific registered folder; do not create missing projects automatically. Preserve current owners, dates and unrelated risks. Report partial or failed work honestly. Ordinary edits use client file tools; the managed proposal/review/apply workflow is only for explicitly delegated Workroom proposals.

Do not assume registration is already known. Before project work, call `workroom_list_products` and match the actual folder or user-specified target; only matched registered projects receive context reads and reports. Skip chat, never auto-create unregistered targets, and follow the capture opt-out rules below. The common source delivers this initial lookup through server instructions, tool descriptions, bilingual guides, resources and prompts. Protocol 2 and business contracts are unchanged; refresh connected adapters to receive revised guidance.

The actual Codex bug request on 2026-09-30 fixed code and passed Node checks, but made no Workroom context or report call. A subsequent tool inventory diagnosis confirmed exposure of both servers, not successful connection or autonomous recording. Isolated hook trust was confirmed and the initial registration lookup was clarified. The failed request and MCP-primed diagnosis do not replace acceptance in a fresh actual conversation, which remains pending.

Skip chat, simple explanations and repeated status reads. Respect recording opt-outs. If Codex capture is enabled, disable it with `core.setCodexCapture(enabled:false)` before file work, verify that change and explain that project capture remains off. Do not silently re-enable it. This is a project-wide setting, not a per-turn privacy switch.

Reports accept optional `execution: { client: "codex" | "claude", sessionId?, turnId? }`. Do not invent unknown host IDs. `requestId` identifies a command, `externalId/sourceVersion` identifies a per-problem report and its corrections, and execution describes provenance rather than authenticated identity. Always send a stable request ID for MCP reporting. The updated Codex PostToolUse hook observes report tool calls, including nested code-mode MCP calls, and matches the request against the durable operation and report receipt. Pending observations are retried on completion, later events and startup; commands are never re-executed by linkage recovery. An interrupted command stays uncertain even when its report effect is found.

Read current task `executionLink` and `workroom_control_read(kind:"execution-link", productId:...)`; the original command result retains its snapshot. Linked hook summaries are shared evidence instead of separate achievements. Distinct problems in one turn, original records, user-edited portfolio text and manual link corrections remain intact. Historical records are never merged by title/time similarity. Claude uses stable report IDs and has no automatic conversation capture.

Protocol 2 and omitted optional inputs remain supported, but the added input/output schemas change `schemaHash`: refresh both adapter and executor. Reinstall existing hooks and review the changed definition in Codex `/hooks`; old hooks do not gain the new matcher automatically. **The ordinary Claude research-summary scenario is confirmed; fresh Codex autonomous recording and its host linkage remain pending.** The existing explicit Codex setup report has actual host and Stop linkage. SDK transport and synthetic hook tests are distinct evidence. Earlier v1 live-client validation does not prove the new ordinary-work scenario.

External proposal authoring requires actual source contents, base hashes and test files from client file tools or supplied material. Workroom entity reads do not expose arbitrary repository browsing. Request missing source material rather than inventing it.

Start with “Read the Workroom guide, check the connection and summarize this repository’s project status and next steps.” No separate Skill is needed. The server provides initialization instructions, the read-only `workroom_guide` tool, `workroom://guides/en/{topic}` resources and a `workroom_workflow` prompt from one source. Topics are start, projects, records, development, portfolio, capture and recovery. Guidance remains available without a live executor or built-in AI account.

Use `language:"en"`; the default is Korean. Filter catalog with `commands:["external.submit","runtime.applyChange"]`, or omit it for the existing full response. `usage` links commands to guides; `guidanceVersion` is independent of the business schema hash. Prompts generate instructions only and cannot grant authority.

For Claude Desktop, copy JSON from **Settings → External tools → Other MCP clients → View connection settings → Copy MCP configuration**, merge only the workroom entry into the existing mcpServers in Developer settings, then refresh the connection after existing work finishes. Node.js 24+ is required. The same server path and explicit data directory are used for Codex and Claude. Automatic capture is a separate Codex hook feature, not automatic capture of Claude conversations.

Connect optionally accepts `expectedDataDirectory`. Compare adapter/executor/installed identities, profileCompatible and readyForControl. Refresh the MCP client for ADAPTER_OUTDATED; inspect active work and unsaved state before restarting an EXECUTOR_OUTDATED process. Unknown build identity is not proof of freshness. Access/configuration errors preserve their causes and must not trigger blind startup. Separate SDK probes do not prove live conversation connectivity.

Protocol 2 adds persistent review packages, review records and execution decisions. Discover schemas with `workroom_control_catalog`; connect with `workroom_control_connect` and check both `liveConnection` and `compatible`. `start:true` starts the shared local executor without opening its window.

Contract version 1 adds command-specific result schemas while preserving protocol 2 inputs and result shapes. Compare the adapter catalog and executor `schemaHash`; `contractCompatible` must be true for matching result contracts. Old stored results retain their original shape with contractVersion 0. Result validation or completion-storage failure after execution becomes uncertain, with a structured failure phase, possible-effect flag and recovery instructions. Never treat it as permission to repeat the effect. Reconciled results are validated before confirmation.

For an older running Workroom instance, check active work and save unsaved input before exiting normally and starting updated code. Refresh the client's MCP connection; if no refresh action is available, save ongoing work and restart the client. Then call connect directly in the current conversation and verify the profile and compatibility/connection flags. A separate test MCP client's success does not prove that your current conversation has reconnected. [Official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

Prepare the exact command and arguments, then execute `review.submit` with the packageId, verdict, assessment, limitations and every changed file's resulting hash. Execute `review.decide` with the reviewId, choice and the user's instruction or delegated authority reference. Finally execute the original command with unchanged arguments, reviewId, decisionId and a UUID requestId. A review hash alone never authorizes execution. Poll `workroom_control_operation`; task and deployment completion are separate.

`external.submit` accepts explicit file contents and original SHA256 hashes, creates isolated copies and runs actual selected checks. It requires no built-in AI account. Review and apply through `runtime.applyChange`. For built-in development followed by external review, start with `reviewMode:"external"`. Failed checks, changed scope and conflicting source files remain blocking.

Keep the same request ID on retries. `operation.reconcile` records evidence when resolving interrupted operations; unverifiable effects stay unresolved. Reviews and decisions are visible in the app. Legacy mutating MCP tools and enabled Codex collection hooks also use the shared executor. The hook may start it in the background. These local checks do not establish successful live paid-model calls or real Vercel deployments.
