# 앱 검사 스크립트

실제 Electron 앱을 띄워 화면 흐름을 확인하는 검사와 실제 계정·모델 검증 보조 스크립트입니다. `pnpm test`의 단위·통합 테스트와 별도로 실행합니다.

- 저장소 루트에서 `node scripts/checks/<파일>`로 실행합니다.
- 격리된 예제 데이터, 임시 Electron 프로필, 결과 JSON·실패 화면은 `work/` 아래에 만들어집니다. `work/`는 Git에서 제외됩니다.
- 일부 검사는 화면과 결과 JSON을 `outputs/`에 저장합니다. 이 폴더도 Git에서 제외됩니다.
- Playwright는 `lib/playwright.cjs`가 찾습니다. `WORKROOM_PLAYWRIGHT` 경로, 프로젝트의 `playwright-core`(개발 의존성), Codex 런타임에 포함된 Playwright 순서입니다.
- `pnpm check:app`은 예제 데이터로 도는 `check-*.cjs` 15개를 차례로 실행합니다(약 1분). `pnpm check:ui`는 대표 흐름 검사인 `check-overview-app.cjs`만 실행합니다.
- `check-jev-bridge.cjs`는 Jev 저장소 없이 계약 fixture로 연결·명시적 전송·검색·언어·재시작을 확인합니다. 실제 Jev 설치와의 선택적 왕복 검사는 [`check-jev-live.mjs`](../check-jev-live.mjs)이며 [설명](../../docs/jev-integration-results.md)을 참고하세요.
- `check-live-operations.cjs`는 실제 계정으로 띄운 앱 세션이 필요해 `check:app`에서 제외합니다. `review-*.cjs`는 표시 창을 띄워 두는 검토·촬영용이며 통과 여부를 판정하지 않습니다.
- 화면을 바꾸면 `pnpm check:app`을 함께 실행하세요. 버튼 이름이나 화면 위치가 바뀌면 검사도 같이 고쳐야 합니다.
- 일반 검사는 로컬 모델 다운로드를 끕니다. `pnpm check:semantic`은 `scripts/check-semantic.mjs`와 `scripts/check-semantic-app.cjs`를 별도로 실행해 실제 임베딩·재정렬·오프라인 캐시·Electron/MCP 일치를 확인합니다. 첫 실행에 임베딩 약 135 MB와 재정렬 약 136 MB의 공개 모델 다운로드가 필요하며 합성 자료와 `work/semantic-models` 캐시만 사용합니다.
- `pnpm evaluate:retrieval`은 `tests/fixtures/knowledge-retrieval.json`의 고정 자료를 분리 DB에서 평가합니다. 정답 순위와 답이 없는 질문에 대한 반환 수를 `work/retrieval-holdout-*/result.json`에 남깁니다. 작은 합성 평가이며 임계값을 이 자료에 맞추기 위한 테스트가 아닙니다. 모델 캐시를 먼저 준비해야 하며 다운로드는 하지 않습니다.
- 실제 모델 검사에는 같은 텍스트를 단독 또는 다른 텍스트와 함께 요청했을 때 동일한 벡터를 반환하는지도 포함됩니다. 입력별 추론을 유지해 양자화 모델의 배치 구성에 따른 변동을 방지합니다.
- `pnpm evaluate:retrieval:external --download`는 공식 KorQuAD 개발 자료를 내려받아 SHA-256을 확인하고 고정 표본 91문단·21질문을 평가합니다. 이후에는 `--download` 없이 데이터·모델 캐시로 실행합니다. 결과는 `work/retrieval-external-*/result.json`에 저장하며 공식 독해 점수(EM/F1)가 아닌 문단 검색 평가입니다.

| 종류 | 파일 |
|---|---|
| 예제 데이터로 앱 흐름 검사 | `check-*.cjs` |
| 표시 창 검토와 화면 촬영 | `review-*.cjs` |
| 실제 계정·모델 검증 보조 | `check-pi-oauth.mjs`, `prepare-live-check.mjs`, `verify-live-check.mjs`, `inspect-live-check.mjs` |
