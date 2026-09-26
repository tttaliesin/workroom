# 앱 검사 스크립트

실제 Electron 앱을 띄워 화면 흐름을 확인하는 검사와 실제 계정·모델 검증 보조 스크립트입니다. `pnpm test`의 단위·통합 테스트와 별도로 실행합니다.

- 저장소 루트에서 `node scripts/checks/<파일>`로 실행합니다.
- 격리된 예제 데이터, 임시 Electron 프로필, 결과 JSON·실패 화면은 `work/` 아래에 만들어집니다. `work/`는 Git에서 제외됩니다.
- 일부 검사는 `outputs/`의 문서용 화면을 다시 촬영합니다. 문서를 갱신할 때만 결과를 커밋하세요.
- Playwright는 `lib/playwright.cjs`가 찾습니다. `WORKROOM_PLAYWRIGHT` 경로, 프로젝트의 `playwright-core`(개발 의존성), Codex 런타임에 포함된 Playwright 순서입니다.
- `pnpm check:app`은 예제 데이터로 도는 `check-*.cjs` 11개를 차례로 실행합니다(약 1분). `pnpm check:ui`는 대표 흐름 검사인 `check-overview-app.cjs`만 실행합니다.
- `check-live-operations.cjs`는 실제 계정으로 띄운 앱 세션이 필요해 `check:app`에서 제외합니다. `review-*.cjs`는 표시 창을 띄워 두는 검토·촬영용이며 통과 여부를 판정하지 않습니다.
- 화면을 바꾸면 `pnpm check:app`을 함께 실행하세요. 버튼 이름이나 화면 위치가 바뀌면 검사도 같이 고쳐야 합니다.

| 종류 | 파일 |
|---|---|
| 예제 데이터로 앱 흐름 검사 | `check-*.cjs` |
| 표시 창 검토와 화면 촬영 | `review-*.cjs` |
| 실제 계정·모델 검증 보조 | `check-pi-oauth.mjs`, `prepare-live-check.mjs`, `verify-live-check.mjs`, `inspect-live-check.mjs` |
