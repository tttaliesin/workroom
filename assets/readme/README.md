# README 스크린샷

[← README](../../README.md)

PNG는 격리된 프로필로 실행한 실제 Electron 앱의 다크 모드 캡처입니다. 소개용 프로젝트·작업·기록·포트폴리오이며 실제 사용자 성과가 아닙니다. 사용자 계정과 자료를 사용하지 않습니다.

```sh
pnpm docs:screenshots
pnpm docs:screenshots --english
node scripts/checks/check-project-management.cjs
```

첫 두 명령은 `assets/readme/`와 `assets/readme/en/`의 작업·기록·포트폴리오 화면을 갱신합니다. 크기는 1280×900이며, 포트폴리오 템플릿 미리보기는 1280×1080입니다. 실행을 일시 정지한 상태도 실제 UI 그대로 보입니다. DOM이나 CSS를 촬영용으로 바꾸지 않습니다.

프로젝트 화면은 세 번째 명령의 `outputs/project-management/` 캡처 중 아래 파일을 복사합니다. 1440×900이며 한국어 예제 원문을 유지한 영어 UI 캡처도 포함됩니다.

| 원본 | README 이미지 |
|---|---|
| `overview-dark.png` | `assets/readme/project-overview-dark.png` |
| `projects-dark.png` | `assets/readme/projects-dark.png` |
| `report-dark.png` | `assets/readme/project-report-dark.png` |
| `overview-en-dark.png` | `assets/readme/en/project-overview-dark.png` |
| `projects-en-dark.png` | `assets/readme/en/projects-dark.png` |
| `report-en-dark.png` | `assets/readme/en/project-report-dark.png` |

`check-project-management.cjs`는 저장·취소·미저장 보호·고정 보고서 내보내기와 작은 창 배치를 함께 검사합니다. 네이티브 파일 대화상자와 클립보드 출력 경계만 격리된 대역으로 처리하며, 실제 파일 저장과 보고서 생성은 앱 코드로 실행합니다. 사용자의 클립보드는 건드리지 않습니다.

프로젝트 0·1·여러 개, 긴 한영 제목, 라이트·다크 및 1440×900·1280×800·900×700·760×600은 `node scripts/checks/check-design-layout.cjs`로 촬영합니다. 결과는 로컬 전용 `outputs/design-layout/`에 있습니다. 본문·보조 글씨·주요 버튼의 대비와 키보드 포커스도 확인합니다. 이 자동 검사는 이미지의 시각 검토를 대신하지 않습니다.

각 명령은 자신이 만든 Electron 프로세스만 종료합니다. 성공한 임시 프로필은 자동 삭제하며 실패하거나 `WORKROOM_KEEP_FIXTURES=1`이면 보존합니다. README 촬영 결과 JSON은 `work/readme-capture-ko.json` 또는 `work/readme-capture-en.json`에 남습니다.
