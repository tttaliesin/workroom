<p align="center">
  <img src="src/desktop/assets/workroom.svg" width="76" height="76" alt="Workroom logo">
</p>

<h1 align="center">Workroom · 작업실</h1>

<p align="center"><a href="README.md">한국어</a> · <strong>English</strong></p>

<p align="center">
  <strong>Turn assigned work into results, and results into your own record.</strong><br>
  A local desktop app connecting development tasks, reusable knowledge and portfolio drafts.
</p>

<p align="center">
  <a href="#current-status"><img src="https://img.shields.io/badge/status-local_alpha-C56A3C?style=flat-square" alt="Status: local alpha"></a>
  <a href="#getting-started"><img src="https://img.shields.io/badge/Node.js-24%2B-5B7054?style=flat-square" alt="Node.js 24 or later"></a>
  <a href="#connect-your-tools"><img src="https://img.shields.io/badge/connect-MCP-716B64?style=flat-square" alt="MCP support"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-716B64?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="#getting-started">Get started</a> ·
  <a href="#a-look-inside">Screenshots</a> ·
  <a href="docs/guide.md">User guide (Korean)</a> ·
  <a href="docs/development.md">Development (Korean)</a> ·
  <a href="https://github.com/tttaliesin/workroom/issues">Report an issue</a>
</p>

<img src="docs/images/en/overview-dark.png" alt="Workroom overview: pending decisions, queued tasks, recent results and collected records" width="1280">

<p align="center"><sub>All screenshots are captured from the actual Electron app in dark mode. Products, tasks and portfolio content are illustrative examples.</sub></p>

## The next step in development, in one place

Connect a product folder and a goal, then describe the work you want done. The built-in agent investigates, prepares changes and runs an independent review. Reviewed results become records for future work and examples for portfolio drafts tailored to each target.

| Flow | What Workroom does |
| :--- | :--- |
| **Work and review** | Connects investigation, proposed changes and review by task. Shows decisions and changes awaiting your approval. |
| **Records and evidence** | Keeps sources and applicability together. The built-in agent and MCP use the same records. |
| **Experience and introduction** | Adds new results to target-specific drafts. Preserves your edits and exports standalone HTML. |

## Getting started

Requires **Node.js 24+ and pnpm**. Workroom currently runs from source and is primarily tested on Windows.

```sh
git clone https://github.com/tttaliesin/workroom.git
cd workroom
pnpm install --ignore-scripts
node node_modules/electron/install.js
pnpm start
```

On Windows, you can also launch `start-workroom.cmd` after installation.

Choose **English** or **한국어** at the top right of the app. Your choice persists across launches. Switching languages preserves unsaved input and the original text of your records. This changes Workroom's interface; existing reports, model responses and the external Codex terminal are not automatically translated.

1. **Connect a product folder** — Select a development folder and describe your goal.
2. **Assign a task** — Describe the result you want, then choose **Investigate first** or **Prepare changes too**.
3. **Connect an account** — Connect your ChatGPT account and select a model to run the saved request.
4. **Review and apply** — Inspect the diff, checks and review, then apply the reviewed version to the source.

Workroom starts empty. You can prepare requests before signing in, browse existing records and use MCP collection without connecting the built-in agent account.

## A look inside

### Keep decisions visible

See work in progress separately from tasks that need your judgment. Open a task to review the policy choices and their effects.

![Decision request with options to save a draft before navigation or ask for confirmation](docs/images/en/decision.png)

### Turn work results into your introduction

Choose the experience to emphasize for each target and collect new results in a draft. Automatic updates preserve wording you edited and examples you excluded. Review the content before saving it as standalone HTML.

![Portfolio draft with target-specific focus and work examples](docs/images/en/portfolio.png)

Choose **Studio · Editorial · Resume** on the portfolio screen, then **Save draft**. Save dark cards, an editorial layout, or a compact two-column resume for each target without losing your wording. Preview and HTML share the same design; exported files work offline and include print styles.

Design references: [DevPortfolio](https://github.com/RyanFitzgerald/devportfolio) and [minimalist CV](https://github.com/BartoszJarocki/cv). See [Third-party notices](THIRD_PARTY_NOTICES.md#portfolio-design-references) for attribution.

<details>
<summary><strong>Explore reusable records and their sources</strong></summary>

Each record includes applicability, sources and delivery history. The built-in agent and MCP share the same retrieval service. When linked file evidence changes, a record is withheld until it is rechecked.

![Records with sources, applicability and automatic reference controls](docs/images/en/records.png)

</details>

## Connect your tools

The built-in runner uses [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). External MCP clients can query the same products and records and report work results. Codex hooks can collect responses that involved file changes or check commands.

Open **Codex connection** at the bottom left of the app:

1. **Check environment and connection** — Discover Codex and Node.js 24+, or select their executables.
2. **Review MCP registration → Register MCP in Codex** — Preserve other settings and back up the existing file.
3. **Run connection check** — Verify the MCP tool list and product data access.
4. **Automatic Codex work collection → Review connection settings → Save connection settings for this product** — Install the product hooks while preserving existing hooks.
5. **Open Codex approval screen** — Complete any sign-in and project trust prompts, then open **Hook approval (/hooks)**. Review and trust the three `작업실 수집` (Workroom collection) hooks using the arrow keys and Enter.
6. Close the Codex window and **Recheck approval status**. The next completed task involving file changes or checks will update the collection status.

You do not need to edit configuration files or open a separate terminal. Initial account authentication uses Codex's official browser flow. Existing Codex chats may not immediately load new settings; verify in a new task. Closing the embedded Codex window ends that process, so wait for any work to finish first.

Generic stdio settings for other MCP clients are available under **Other MCP clients · Recent record changes → View connection settings**. Workroom and the MCP server use the same local SQLite data.

## Where does the data stay?

Records and settings are stored locally in `.workroom/` by default. The built-in agent's credentials are encrypted using OS-protected storage. Semantic retrieval and reranking run on the local CPU; public model files are downloaded on first use.

The built-in agent sends investigation and change requests to the connected model. Not every AI feature works offline. See the [user guide (Korean)](docs/guide.md#데이터와-보안) for data locations, backup and file-access scope.

## Current status

**Local alpha · 0.1** — The product name is provisional, and the workflow is being refined through use.

- **Available:** Product and goal management, agent investigation and proposed changes, independent review, decision records, reusable knowledge retrieval, target-specific portfolios, HTML export, MCP connection and Korean/English interface switching.
- **Optional:** Periodic investigations and permitted change preparation while the app is open. Model calls are skipped when nothing changes.
- **Not yet available:** Background or remote execution while the app is closed, arbitrary build scripts or dependency installation, web deployment, an installer or automatic updates.

Closing the app also ends its runner. After recording a decision, you resume work explicitly.

## Help improve Workroom

Report the screen involved and steps to reproduce in an [issue](https://github.com/tttaliesin/workroom/issues). For code changes, run:

```sh
pnpm test
pnpm lint
pnpm format:check
```

| Document | Contents |
| :--- | :--- |
| [User guide (Korean)](docs/guide.md) | Running tasks, data and security, MCP, retrieval and evidence |
| [Development and validation (Korean)](docs/development.md) | App checks, model evaluation and code structure |
| [Screenshot capture (Korean)](docs/images/README.md) | Recreate screenshots from illustrative data |

## License

[MIT](LICENSE). See [Third-party notices](THIRD_PARTY_NOTICES.md) for Pretendard, Radix Colors, models and other external components.

<p align="center"><sub>Electron · SQLite · Pi · MCP</sub></p>
