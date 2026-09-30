# Repository layout · 저장소 구조

[한국어 README](../../README.md) · [English README](../../README.en.md) · [MCP guide](mcp.md)

## Shared files · 공개 파일

| Location | Contents |
|---|---|
| `README.md`, `README.en.md` | Product introduction, setup and current limitations |
| `docs/public/mcp.md` | Codex and Claude connection, guidance, commands and recovery |
| `docs/public/repository.md` | File locations and Git tracking policy |
| `src/` | App, shared business rules, runtime and MCP implementation |
| `tests/` | Repeatable tests and committed input fixtures |
| `scripts/` | Development, evaluation and screen capture commands |
| `scripts/checks/` | Electron checks and their [usage notes](../../scripts/checks/README.md) |
| `assets/readme/` | Committed screenshots and [capture instructions](../../assets/readme/README.md) |
| `LICENSE`, `THIRD_PARTY_NOTICES.md` | Project license and dependency notices |

Source modules are grouped by responsibility: `control` defines shared commands and admission; `core` owns stored products, work and knowledge; `runtime` executes built-in work; `integrations` connects external tools; `desktop` hosts Electron; `renderer` renders the UI; `shared` contains shared presentation helpers; `mcp` exposes the local server.

## Local files · 로컬 전용 파일

| Location | Contents |
|---|---|
| `.workroom/` | Actual user data, local executor profile and authentication storage |
| `work/` | Isolated profiles, research inputs and model/evaluation caches |
| `outputs/` | Local results, screenshots, recovery evidence and one-time helpers |
| `docs/` outside `public/` | Private product/design plans, migration history and verification notes |
| `.codex/`, `.claude/`, `.agents/`, `.pi/` | Local agent instructions, hooks and session configuration |
| `.env`, `.env.*`, `.vercel/` | Machine-specific environment and hosting configuration |

`docs/` is private by default. `.gitignore` explicitly allows only this layout guide and `docs/public/mcp.md`; creating another document in `docs/public/` does not automatically publish it. Review its contents and add an explicit allowlist entry when it is intended for the repository. Do not force-add local plans or evidence.

Only example environment templates ending in `.example` are allowed through the environment ignore rules. Commit sample values, never actual credentials. Keep `pnpm-lock.yaml`, `pnpm-workspace.yaml`, test fixtures, app logos, screenshot assets and license files tracked.

Ignoring a file does not remove a file already tracked by Git. Before committing, review `git status --short` and `git diff --cached --name-status`; use `git check-ignore -v <path>` to check the matching rule for an untracked path.

## 정리와 보존

루트에는 한영 README, 라이선스, 프로젝트 설정과 시작 파일을 둡니다. 공개 사용 문서는 `docs/public/`, 로컬 기획·설계·검증 문서는 `docs/`에 보관합니다. 로컬 색인 `docs/README.md`에서 제품 기준, 계획, 검증 기록을 찾을 수 있으며 원격 저장소에는 포함되지 않습니다.

`work/`와 `outputs/`는 서로 다른 역할입니다. 전자는 검사 입력·임시 프로필·캐시, 후자는 재확인할 결과·근거입니다. 정규 검사는 자신이 만든 임시 프로필을 성공 종료 후 정리하고, 실패하거나 `WORKROOM_KEEP_FIXTURES=1`이면 보존합니다. 기존 자료는 폴더 이름만 보고 일괄 삭제하지 않습니다. 실제 `.workroom/` 데이터와 실행 중인 프로필은 정리 대상으로 취급하지 않습니다.

기존 계획·검증 파일의 위치는 저장된 작업 근거에서 사용하는 경로이므로 유지합니다. 루트에 있던 로컬 `PRODUCT.md`, `DESIGN.md`, `MIGRATION.md`는 같은 이름으로 `docs/`에 모았습니다. 공개 MCP 문서의 현재 위치는 `docs/public/mcp.md`입니다.
