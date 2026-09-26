# 앱 검사 스크립트

실제 Electron 앱을 띄워 화면 흐름을 확인하는 검사와 실제 계정·모델 검증 보조 스크립트입니다. `pnpm test`의 단위·통합 테스트와 별도로 실행합니다.

- 저장소 루트에서 `node scripts/checks/<파일>`로 실행합니다.
- 격리된 예제 데이터, 임시 Electron 프로필, 결과 JSON·실패 화면은 `work/` 아래에 만들어집니다. `work/`는 Git에서 제외됩니다.
- 일부 검사는 `outputs/`의 문서용 화면을 다시 촬영합니다. 문서를 갱신할 때만 결과를 커밋하세요.
- Electron 검사는 현재 Codex 런타임에 포함된 Playwright를 절대 경로로 불러옵니다. 다른 환경에서는 그 경로를 바꿔야 실행됩니다.

| 종류 | 파일 |
|---|---|
| 예제 데이터로 앱 흐름 검사 | `check-*.cjs` |
| 표시 창 검토와 화면 촬영 | `review-*.cjs` |
| 실제 계정·모델 검증 보조 | `check-pi-oauth.mjs`, `prepare-live-check.mjs`, `verify-live-check.mjs`, `inspect-live-check.mjs` |
