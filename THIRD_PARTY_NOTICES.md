# Third-party notices

The root [MIT license](LICENSE) applies to Horizon Remade's original code and
documentation. It does not replace the licenses of third-party software, models,
textures or fonts. Those materials remain with their respective copyright holders.
Screenshots and preview images depict the credited models and may contain third-party
marks; the code license does not grant rights to those underlying materials or marks.

## Car models and traffic

The following assets are documented as **Creative Commons Attribution 4.0
International (CC BY 4.0)** in their bundled attribution files. Follow each linked
file for its original source, creator, modifications and available checksums.

| Asset directory | Work / creator | Detailed attribution |
| --- | --- | --- |
| `public/models/ferrari-458/` | Ferrari 458 Italia — vicent091036 | [Attribution](public/models/ferrari-458/ATTRIBUTION.md) |
| `public/models/shelby-gt500/` | Ford Mustang Shelby GT500 — Jiaxing | [Attribution](public/models/shelby-gt500/ATTRIBUTION.md) |
| `public/models/porsche-911-gt3/` | Porsche 911 GT3 — kevin (ケビン) | [Attribution](public/models/porsche-911-gt3/ATTRIBUTION.md) |
| `public/models/mustang-fastback/` | 1967 Ford Mustang Fastback — Mark Peters | [Attribution](public/models/mustang-fastback/ATTRIBUTION.md) |
| `public/models/mclaren-mcl60/` | McLaren MCL60 — Redgrund | [Attribution](public/models/mclaren-mcl60/ATTRIBUTION.md) |
| `public/models/ferrari-sf23/` | Ferrari SF23 — Redgrund | [Attribution](public/models/ferrari-sf23/ATTRIBUTION.md) |
| `public/models/redbull-rb19/` | Red Bull RB19 — Redgrund | [Attribution](public/models/redbull-rb19/ATTRIBUTION.md) |
| `public/models/mclaren-mp45/` | McLaren MP4/5 — dark_igorek (legacy asset, not in the current garage) | [Attribution](public/models/mclaren-mp45/ATTRIBUTION.md) |
| `public/models/civilian-traffic/` | Generic passenger car pack — Comrade1280 | [Attribution](public/models/civilian-traffic/ATTRIBUTION.md) |

When redistributing these assets, retain creator/source credits, the license link
and existing modification notices, and describe any further changes. Do not imply
that an artist endorses your project. See the [CC BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/)
and [legal text](https://creativecommons.org/licenses/by/4.0/legalcode.en).

Vehicle names, designs, team liveries and sponsor marks are separate from the
model copyright permissions. CC BY does not license trademark rights. These are
community models, not endorsements from manufacturers or racing teams.

## Environment textures

`public/environment/surfaces/` contains **CC0 1.0 Universal** photographic textures
from Poly Haven. The [surface attribution](public/environment/surfaces/ATTRIBUTION.md)
lists all eleven source assets and artists; the [manifest](public/environment/surfaces/manifest.json)
records source URLs and checksums. Local recompression and runtime material
adaptations are described there.

See [Poly Haven's license statement](https://polyhaven.com/license) and the
[CC0 legal text](https://creativecommons.org/publicdomain/zero/1.0/legalcode).

## Runtime software and fonts

Full notices are retained under `public/licenses/` so a static deployment includes
them. Versions below match `package-lock.json` when these notices were prepared;
update them when changing dependencies.

| Component | Version | License / bundled notice |
| --- | --- | --- |
| [Three.js](https://github.com/mrdoob/three.js) | 0.186.1 | [MIT](public/licenses/three.txt) |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | 0.15.7 | [MIT](public/licenses/polygon-clipping.txt) |
| [splaytree](https://github.com/w8r/splaytree) | 3.2.3 | [MIT](public/licenses/splaytree.txt) |
| [robust-predicates](https://github.com/mourner/robust-predicates) | 3.0.3 | [Unlicense](public/licenses/robust-predicates.txt) |
| [ws](https://github.com/websockets/ws) (Node server) | 8.22.0 | [MIT](public/licenses/ws.txt) |
| [Barlow](https://github.com/jpt/barlow), distributed by `@fontsource/barlow` | 5.3.0 | [SIL Open Font License 1.1](public/licenses/barlow.txt) |
| Barlow Condensed, distributed by `@fontsource/barlow-condensed` | 5.3.0 | [SIL Open Font License 1.1](public/licenses/barlow-condensed.txt) |
| [Draco](https://github.com/google/draco) decoder | Bundled decoder files | [Apache License 2.0](public/draco/LICENSE) |

The root `package.json` and lockfile describe the build/deployment tools as well.
Those packages keep their own notices in their distributions. This table covers
runtime dependencies and separately bundled decoder/font assets; it does not
relicense development tools or their dependencies.

## Redistributing the project

- **Source:** retain `LICENSE`, this notice, each asset's attribution, and the
  original dependency notices applicable to the material you distribute.
- **Built website:** keep `licenses/`, `draco/LICENSE`, `models/credits.html`,
  per-model attribution files and the environment attribution with the files in
  `dist/`. Vite copies these from `public/` during a normal build.
- **A fork:** credit the relevant creators, document asset changes, and choose
  branding that does not imply official affiliation. A code license does not
  grant permission to use another party's trademarks.

The in-game credits link to the [website license index](public/licenses/index.html).
