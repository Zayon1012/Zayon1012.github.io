# GREENLIGHT — The Game Pass Review (web edition)
Static, dependency-free site. Content lives in `data/issue.json` (games, genres, tiers, issues).
To add games/issues: edit `data/issue.json`, add Steam art to `tools/image_manifest.json` (or add the Steam app id to `tools/make_manifest.py` and run it), run `python tools/build_images.py` (requests + Pillow) to emit responsive WebP files into `img/`, and `python tools/fetch_fonts.py` to refresh fonts. The GitHub Action does both automatically when `greenlight/tools/` changes.
Game art © the respective publishers; used for editorial review purposes.
