# Launcher icon proposals — for the owner's visual approval

**Audit (2026-10-17):** the customer app's icons (iOS and Android) are a rounded orange tile drawn on a **white square**, so phones show a smaller tile inside a white frame (iOS masks the square itself; Android adaptive icons crop to a shape). The driver app still ships the **stock Flutter icon**. Neither is a store-rejection reason by itself (the iOS icons have no alpha channel — verified), but both look unfinished. Nothing has been changed in the apps.

| Set | What it is | Look at |
|---|---|---|
| `customer-fixed/` | the same artwork, tile enlarged to full bleed (white corners filled with the tile's own gradient) | `customer-fixed/preview.png` (iOS-masked, Android circle, Android rounded square) and `store-icon-1024.png` / `play-store-icon-512.png` |
| `driver/` | the same mark with the palette inverted — dark tile, orange mark — so the two apps are told apart on a home screen | `driver/preview.png` |

Each set contains the complete iOS `AppIcon.appiconset` (same file names and sizes as the app), Android legacy `ic_launcher.png` per density, adaptive `ic_launcher_foreground.png` / `ic_launcher_background.png` and `mipmap-anydpi-v26/ic_launcher.xml`.

**Caveats:** generated from a raster, not from the designer's vector source — the iOS/Play icons are clean, the Android adaptive version is a faithful approximation (slight softness at the safe-zone edge). If a designer supplies vectors, regenerate properly. Dark-driver colours are `#181C26` / `#FF6A00`; changing them is two constants in `scripts/launch/generate_icon_proposals.py`.

**To apply** (after approving the look): `scripts/launch/apply_icon_proposal.sh customer-fixed` and/or `driver` (add `--dry-run` first). It copies the files into the app and saves everything it replaces in `apps/<app>/.icon-backup-<time>/`. Then rebuild; the preflight's stock-icon check turns PASS for the driver.
