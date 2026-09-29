# 앱 검사 스크립트

실제 Electron 앱을 띄워 화면 흐름을 확인하는 검사와 실제 계정·모델 검증 보조 스크립트입니다. `pnpm test`의 단위·통합 테스트와 별도로 실행합니다.

- 저장소 루트에서 `node scripts/checks/<파일>`로 실행합니다.
- 격리된 예제 데이터와 임시 Electron 프로필은 `work/` 아래에 만들어지며 성공 종료 후 자동 삭제됩니다. 실패·강제 종료 시에는 진단을 위해 보존합니다. 결과 JSON과 스크린샷은 유지합니다. `work/`는 Git에서 제외됩니다.
- 예제 DB를 남기려면 `WORKROOM_KEEP_FIXTURES=1`로 실행하세요. 이 규칙은 개별 앱 검사, 의미 검색 검사, README 촬영에도 적용됩니다. 검색 평가 결과·모델 캐시는 자동 삭제하지 않습니다.
- 일부 검사는 화면과 결과 JSON을 `outputs/`에 저장합니다. 이 폴더도 Git에서 제외됩니다.
- Playwright는 `lib/playwright.cjs`가 찾습니다. `WORKROOM_PLAYWRIGHT` 경로, 프로젝트의 `playwright-core`(개발 의존성), Codex 런타임에 포함된 Playwright 순서입니다.
- `pnpm check:app`은 예제 데이터로 도는 `check-*.cjs`를 차례로 실행합니다. `pnpm check:ui`는 대표 흐름 검사인 `check-overview-app.cjs`만 실행합니다.
- `check-language.cjs`는 한영 전환과 재시작뿐 아니라 폐기한 Jev bridge 설정이 남은 DB의 데이터 보존과 전용 화면/API 제거도 확인합니다.
- `check-live-operations.cjs`는 실제 계정으로 띄운 앱 세션이 필요해 `check:app`에서 제외합니다. 화면 촬영에는 `pnpm docs:screenshots`를 사용합니다. 과거 UI를 전제로 작성한 일회성 `review-*.cjs` 4개는 제거했습니다.
- 화면 변경은 영향받는 흐름 검사를 먼저 실행하세요. 공통 동작을 폭넓게 바꿨다면 `pnpm check:app`으로 확장합니다. 버튼 이름이나 화면 위치가 바뀌면 검사도 같이 고쳐야 합니다.
- `check-project-management.cjs`는 현황·마일스톤 저장/취소, 미저장 보호, 실제 stdio MCP 경로, 고정 보고서 내보내기 및 네 가지 창 크기를 확인합니다. 클립보드 출력만 격리 대역을 사용하고 사용자의 클립보드는 변경하지 않습니다.
- `check-design-layout.cjs`는 프로젝트 0·1·여러 개, 긴 한영 제목, 다크·라이트, 1440×900·1280×800·900×700·760×600, 대비와 키보드 포커스를 확인합니다. 실제 캡처는 시각 검토와 함께 판단하며 자동 검사만으로 디자인 합격을 선언하지 않습니다.
- 일반 검사는 로컬 모델 다운로드를 끕니다. `pnpm check:semantic`은 `scripts/check-semantic.mjs`와 `scripts/check-semantic-app.cjs`를 별도로 실행해 실제 임베딩·재정렬·오프라인 캐시·Electron/MCP 일치를 확인합니다. 첫 실행에 임베딩 약 135 MB와 재정렬 약 136 MB의 공개 모델 다운로드가 필요하며 합성 자료와 `work/semantic-models` 캐시만 사용합니다.
- `pnpm evaluate:retrieval`은 `tests/fixtures/knowledge-retrieval.json`의 고정 자료를 분리 DB에서 평가합니다. 정답 순위와 답이 없는 질문에 대한 반환 수를 `work/retrieval-holdout-*/result.json`에 남깁니다. 작은 합성 평가이며 임계값을 이 자료에 맞추기 위한 테스트가 아닙니다. 모델 캐시를 먼저 준비해야 하며 다운로드는 하지 않습니다.
- 실제 모델 검사에는 같은 텍스트를 단독 또는 다른 텍스트와 함께 요청했을 때 동일한 벡터를 반환하는지도 포함됩니다. 입력별 추론을 유지해 양자화 모델의 배치 구성에 따른 변동을 방지합니다.
- `pnpm evaluate:retrieval:external --download`는 공식 KorQuAD 개발 자료를 내려받아 SHA-256을 확인하고 고정 표본 91문단·21질문을 평가합니다. 이후에는 `--download` 없이 데이터·모델 캐시로 실행합니다. 결과는 `work/retrieval-external-*/result.json`에 저장하며 공식 독해 점수(EM/F1)가 아닌 문단 검색 평가입니다.

| 종류 | 파일 |
|---|---|
| 예제 데이터로 앱 흐름 검사 | `check-*.cjs` |
| README용 실제 화면 촬영 | `../capture-readme.cjs` |
| 실제 계정·모델 검증 보조 | `check-pi-oauth.mjs`, `prepare-live-check.mjs`, `verify-live-check.mjs`, `inspect-live-check.mjs` |
