# Licences for third-party assets in this kit

Everything here is free to use in a commercial product. Nothing is paid, nothing is a copy of another company's logo.

## Fonts (self-hosted woff2 in assets/fonts)

| Family | Files | Author | Licence | Source |
|---|---|---|---|---|
| General Sans | GeneralSans-500/600/700.woff2 (Pulse) | Indian Type Foundry | ITF Free Font License (free for personal and commercial use) | https://www.fontshare.com/fonts/general-sans |
| Geist, Geist Mono | Geist-latin*.woff2, GeistMono-latin.woff2 | Vercel | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Geist |
| Inter (one glyph) | Inter-tugrik.woff2 (Pulse): a subset holding only U+20AE (₮), which Geist and General Sans lack | Rasmus Andersson | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Inter |
| Nunito | Nunito-latin*.woff2 (Receipt) | Vernon Adams, Cyreal, Jacques Le Bailly | SIL Open Font License 1.1 | https://fonts.google.com/specimen/Nunito |
| Amstelvar | amstelvar-roman/italic.woff2, used only for quoted Wikipedia sentences | Font Bureau (David Berlow) | SIL Open Font License 1.1 | https://github.com/googlefonts/amstelvar |

## Icons (assets/icons)

| Files | Author | Licence | Source |
|---|---|---|---|
| coin-usdt, coin-eth, coin-uni, coin-dai, coin-btc (.svg) | spothq, cryptocurrency-icons | CC0 1.0 (public domain), see cryptocurrency-icons-CC0-LICENSE.md | https://github.com/spothq/cryptocurrency-icons |

The monograms for Polymarket (Pm), Kalshi (Ka), Augur (Au), NEAR (N) and DeFi (DF) are our own letters set in the kit's type, in neutral colours. They are not those companies' logos.

## Imagery (assets/art)

- Topic art: generated for this kit with FLUX.2 [pro] through fal.ai, one prompt template per direction (see _pr/gen-art.mjs), then graded in _pr/post-art.py. Abstract objects only: no people, no logos, no text.
- Pulse dial and app-icon render: modelled and rendered in Blender 5.2 from the logo's own geometry (_pr/blender-pulse.py).
- Light set (art/light): the same objects and the same dial geometry, modelled and rendered in Blender 5.2 on a white sweep (_pr/blender-topics-light.py, _pr/blender-pulse.py dial-light), graded in _pr/post-art-light.py. Abstract objects only: no people, no logos, no text.
- Everything else (marks, wordmarks, icons, UI) is drawn by hand in SVG and CSS for this kit.
