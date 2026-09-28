# README 스크린샷

[← README](../../README.md)

이 폴더의 PNG는 실제 Electron 앱의 렌더러를 촬영한 화면입니다. 사용자 데이터와 계정을 쓰지 않고, `scripts/capture-readme.cjs`가 만든 소개용 제품·작업·기록·포트폴리오를 사용합니다. 표시된 작업 결과는 실제 제품의 성과나 검사 결과를 의미하지 않습니다.

```sh
pnpm docs:screenshots
pnpm docs:screenshots --english
```

프로젝트 의존성과 Electron을 설치한 뒤 저장소 루트에서 실행하세요. 화면은 1280 × 900 CSS 픽셀, 포트폴리오는 템플릿 선택기와 Studio 미리보기가 보이는 위치로 스크롤해 1280 × 1080으로 촬영합니다. 모델 호출과 다운로드를 끄고, 새 실행을 일시 정지한 별도 데이터 디렉터리를 `work/readme-capture-*`에 만듭니다. 촬영이 끝나면 해당 Electron 프로세스는 종료됩니다. `assets/readme/*.png`를 갱신하므로 문서용 촬영에만 사용하세요.

성공한 촬영의 임시 데이터 디렉터리는 자동 삭제하며, 실패했거나 `WORKROOM_KEEP_FIXTURES=1`로 실행하면 보존합니다. 촬영 결과 JSON은 `work/readme-capture-ko.json` 또는 `work/readme-capture-en.json`에 남고, PNG는 유지됩니다.

| 파일 | 화면 |
|---|---|
| `overview-dark.png` | 제품 개요 |
| `decision.png` | 판단 요청과 방침 선택 |
| `portfolio.png` | 대상별 포트폴리오 초안과 작업 사례 |
| `records.png` | 재사용 기록, 출처, 적용 조건 |

모든 화면은 다크 모드로 촬영하며 README를 보는 사람의 테마와 관계없이 동일하게 표시합니다. 테마 전환과 화면 이동·스크롤만 사용하며, 촬영용으로 앱 DOM이나 CSS를 수정하지 않습니다.

`--english`는 영어 UI와 영어 예제 데이터로 같은 네 화면을 `assets/readme/en/`에 촬영합니다. 한국어판은 이 폴더의 이미지를, 영어 README는 `en/` 이미지를 사용합니다.
