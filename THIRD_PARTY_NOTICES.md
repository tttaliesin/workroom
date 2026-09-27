# Third-party notices

The project's own code and documentation are licensed under the MIT License (see `LICENSE`).
The following bundled components keep their original licenses.

| Component | Files | License |
|---|---|---|
| [Pretendard](https://github.com/orioncactus/pretendard) v1.3.9 variable font, © 2021 Kil Hyung-jin, Reserved Font Name "Pretendard" | `src/renderer/assets/fonts/PretendardVariable.woff2` | SIL Open Font License 1.1, `src/renderer/assets/fonts/OFL.txt` |
| [Radix Colors](https://github.com/radix-ui/colors) Sand scale values, © 2021-2022 Modulz | `src/renderer/palette.css` | MIT, `src/renderer/assets/RADIX-COLORS-LICENSE.txt` |

The font is redistributed unmodified. Under the OFL it stays under that license and may not be sold by itself; the MIT License of this project does not apply to it.

## Portfolio design references

The portfolio templates in `src/shared/portfolio.mjs` and `src/shared/portfolio.css` are independently implemented for Workroom's public work examples. Their design references are:

- [Ryan Fitzgerald's DevPortfolio](https://github.com/RyanFitzgerald/devportfolio), [MIT](https://github.com/RyanFitzgerald/devportfolio/blob/master/LICENSE.md), © 2025 Ryan Fitzgerald: numbered project cards, strong introductory typography, and separated contribution details informed Studio.
- [Bartosz Jarocki's CV](https://github.com/BartoszJarocki/cv), [MIT](https://github.com/BartoszJarocki/cv/blob/main/LICENSE), © 2023 Bartosz Jarocki: restrained type hierarchy, compact project sections and print-friendly presentation informed Resume.
- Editorial is an original variation with a serif introduction, large case numbers and a paper palette.

No upstream source code, personal content, photographs, logos, fonts, or framework dependencies are bundled from those two projects. All three layouts share Workroom's offline preview/export renderer and use system fonts.

npm dependencies (listed in `package.json`, installed from the registry, not included in this repository) retain their own licenses. Pi, the MCP SDK, Zod, Electron, Prettier, ESLint and globals use MIT; Transformers.js and playwright-core use Apache-2.0. Transitive packages retain the licenses distributed in their packages.

The optional-at-runtime [multilingual MiniLM ONNX weights](https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2) are downloaded into the local model cache, not bundled in this source repository. Their upstream model license applies separately from this project's MIT license. The model repository and exact revision are pinned in `src/runtime/local-embeddings.mjs`.

The optional-at-runtime [mMARCO multilingual cross-encoder](https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1) is Apache-2.0 licensed upstream. Its official quantized ONNX export (`model_quint8_avx2.onnx`) and tokenizer are downloaded to the model cache, not bundled here. The exact repository revision is pinned in `src/runtime/reranking-model.mjs`.

The opt-in external retrieval evaluation downloads [KorQuAD 1.0 development data](https://github.com/korquad/korquad.github.io) to ignored `work/` storage. That dataset is not redistributed as part of this repository and retains its upstream terms; this project's MIT license does not apply to it. The script checks its SHA-256 and derives a deterministic passage-retrieval subset, not the official KorQuAD QA benchmark.
