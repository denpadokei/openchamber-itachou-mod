# OpenChamber 痛PC MOD

OpenChamber（デスクトップ版）に「全面の背景画像 + 半透明パネル + ピンクのアクセント」を当てる非公式 MOD です。
平成初期の「痛○○」っぽい見た目を、テーマ機能の制約を回避して実現します。

An unofficial skin for the [OpenChamber](https://openchamber.dev) desktop app: a full-screen background image with
translucent panels, implemented by patching the packaged renderer (`web-dist`).

> 背景画像は同梱していません。お好みの画像を `bg.jpg` として置くか、`-Image` で指定してください。

## 仕組み

OpenChamber のテーマ（`~/.config/openchamber/themes/*.json`）は色・フォント・遷移時間しか扱えず、
色の検証が `url(` / `image(` / `@import` を明示的に拒否します。そのため画像をテーマに入れることはできません。

この MOD は代わりに、ビルド済みレンダラへ CSS を 1 枚足します。

1. `mod.css` と画像を `<app>\resources\web-dist\assets\` にコピー
2. `web-dist\index.html` の `</head>` 直前に `<link rel="stylesheet">` を 1 行追加
3. CSS 側で背景レイヤー（`body::before`）と暗幕（`body::after`）を敷き、
   `:root:root { --background: transparent !important; ... }` で
   テーマが出力する不透明な背景色を上書きする

`:root:root` はテーマ側の `:root` より詳細度が高いので、テーマの `!important` にも勝てます。
テーマファイル自体は変更しないため、テーマを切り替えても背景は維持されます。

## 必要なもの

- Windows
- OpenChamber デスクトップ版（既定のインストール先を自動検出します）
- PowerShell 5.1 以降（7 推奨）

## 使い方

```powershell
git clone https://github.com/denpadokei/openchamber-itachou-mod.git
cd openchamber-itachou-mod

# 背景画像を用意する（どちらでも）
Copy-Item "E:\pictures\wallpaper.jpg" .\bg.jpg
.\install.ps1 -Image "E:\pictures\wallpaper.jpg"
```

適用後、起動中のアプリでは `Ctrl+R` でリロードしてください。

```powershell
# 解除
.\uninstall.ps1

# 適用してから起動（更新で消えた分を貼り直す）
.\apply-on-launch.ps1
```

インストール先が既定と違う場合:

```powershell
.\install.ps1 -WebDist "D:\apps\@openchamberelectron\resources\web-dist"
```

## アプリ更新への対策

OpenChamber を更新すると `resources\web-dist` が置き換わり、MOD は消えます。
ショートカットの向き先を次のように変えておくと、起動のたびに貼り直してから起動します。

```
pwsh -NoProfile -ExecutionPolicy Bypass -File "<path>\apply-on-launch.ps1"
```

## 見た目の調整

`mod.css` 冒頭の変数を書き換えて、もう一度 `install.ps1` を実行します。

| 変数 | 効果 |
| --- | --- |
| `--itachou-veil` | 画像の上に敷く暗幕の濃さ。上げると落ち着く |
| `--itachou-panel` / `--itachou-panel-soft` | パネルの透け具合 |
| `--itachou-bubble` | ユーザーメッセージの色 |
| `--itachou-accent` 系 | アクセント色（既定 `#ff6fb5`。シアンなら `#6fd6ff`） |

末尾には、パネルにすりガラス効果（`backdrop-filter`）を足す任意ブロックがコメントで置いてあります。

## 注意

- 非公式の改造です。OpenChamber 本体とは無関係です。
- アプリの内部 CSS 変数に依存しているため、将来のバージョンで効かなくなる可能性があります。
- `web-dist\index.html` の初回バックアップは `index.html.itachou-backup` に残ります。
- アンインストールは `uninstall.ps1`。OS やユーザーデータには影響しません。
- 同梱していない背景画像の権利は、利用者自身で確認してください。

## License

MIT（`LICENSE` 参照）。背景画像は含まれないため、ライセンス対象外です。