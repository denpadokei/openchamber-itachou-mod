# OpenChamber 痛PC MOD

OpenChamber（デスクトップ版）に「全面の背景画像 + 半透明パネル + ピンクのアクセント」を当てる非公式 MOD です。
平成初期の「痛○○」っぽい見た目を、テーマ機能の制約を回避して実現します。

適用方法は2つあります。OpenChamber の拡張機能パネルからボタンで適用するか、PowerShell を直接実行します。

An unofficial skin for the [OpenChamber](https://openchamber.dev) desktop app: a full-screen background image with
translucent panels, implemented by patching the packaged renderer (`web-dist`).

> 背景画像は同梱していません。お好みの画像を `bg.jpg` として置くか、`-Image` で指定してください。

## 仕組み

OpenChamber のテーマ（`~/.config/openchamber/themes/*.json`）は色・フォント・遷移時間しか扱えず、
色の検証が `url(` / `image(` / `@import` を明示的に拒否します。そのため画像をテーマに入れることはできません。

この MOD は代わりに、ビルド済みレンダラへ CSS を 1 枚足します。

拡張機能版では、この処理をパネルからローカルサービス経由で `install.ps1` / `uninstall.ps1` に渡します。MOD のロジックは PowerShell 側にだけあり、JavaScript で二重実装していません。

1. `mod.css` と画像を `<app>\resources\web-dist\assets\` にコピー
2. `web-dist\index.html` の `</head>` 直前に `<link rel="stylesheet">` を 1 行追加
   （`?v=<内容ハッシュ>` 付き。アプリは `/assets/*` を 1 年 `immutable` で
   キャッシュするため、内容が変われば URL も変えてキャッシュを避ける）
3. CSS 側で背景レイヤー（`body::before`）と暗幕（`body::after`）を敷き、
   メッセージ領域には専用のパネルを敷き、
   `:root:root:root { --background: transparent !important; ... }` で
   テーマが出力する不透明な背景色を上書きする

`:root:root:root` はテーマ側の `:root`（詳細度 0,1,0）とライトテーマの `:root:not(.dark)`（同 0,2,0）より詳細度が高いため、
テーマの `!important` にも勝てます。テーマの `<style>` は起動時に `<head>` へ追加され、この CSS の `<link>` より後になるため、
詳細度が同じだと後勝ちで上書きされていました（2.7.3 対応）。2.8.0 と 2.8.1 のテーマ注入も `:root` / `:root:not(.dark)` のままで、本 CSS が勝つことを実 web-dist で実測確認済みです。テーマファイル自体は変更しないため、テーマを切り替えても背景は維持されます。

## 拡張機能として使う

このリポジトリは、そのまま OpenChamber の拡張機能パッケージになっています。
パネルの「適用」「解除」は、ローカルサービス経由で `install.ps1` / `uninstall.ps1` を実行するだけです。

1. OpenChamber の **Settings → Extensions** を開く
2. Git URL か、このリポジトリのフォルダ（絶対パス）を追加
   - Git URL: `https://github.com/denpadokei/openchamber-itachou-mod.git`
   - まだ push していない変更を試す場合は、Git URL ではなくフォルダを指定してください。
     Git URL は `package.json` / `panel/` / `service/` が origin に push された後で使えます。
3. 権限ダイアログのローカルサービス（PowerShell の実行）を承認する
   — ユーザー権限でプロセスを起動するため、フルアクセスの警告が出ます
4. 右レールの **痛PC MOD** を開く
5. 背景画像の絶対パス（jpg / jpeg / png / webp）を入れて **適用**
6. OpenChamber で `Ctrl+R`

画像を空欄にすると、パッケージ内の `bg.jpg` を使います。Git から入れた場合は `bg.jpg` が含まれないので、必ずパスを指定してください。
最後に使ったパスは拡張のデータフォルダに保存され、次に開いたときに復元されます。
ローカルサービスが書き込める `webDist` は、自動検出できたインストール先、`settings.json` に保存済みの `webDist`、および設定ファイルがあるデータフォルダ配下だけです（任意のフォルダを指定して `index.html` を書き換えることはできません）。既定と違う場所に入れている場合は `settings.json` に `webDist` を設定してください。PowerShell から直接 `install.ps1` を実行する場合は、従来どおり `-WebDist` で任意の場所を指定できます。

アプリを更新すると `web-dist` が置き換わり MOD は消えます。更新後にパネルを開いてもう一度「適用」してください
（`apply-on-launch.ps1` をショートカットにしている場合は、そちらでも復元できます）。

> 拡張機能は OpenChamber のデスクトップ版 / Web サーバー版で動きます。VS Code とモバイルでは読み込まれません。

## 必要なもの

- Windows
- OpenChamber デスクトップ版（既定のインストール先を自動検出します）
- PowerShell 5.1 以降（7 推奨）

## PowerShell から使う

拡張機能を使わず、直接スクリプトを実行する場合です。

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
| `--itachou-veil` | 画像の上に敷く暗幕の濃さ。上げると落ち着く（中央がやや濃い二層構造） |
| `--itachou-stream` | メッセージ領域だけに敷くパネルの濃さ（既定 `rgba(10, 5, 14, 0.8)`） |
| `--itachou-stream-width` | そのパネルの幅（既定 `min(100%, 48rem)`。`100%` で全幅） |
| `--itachou-panel` / `--itachou-panel-soft` | パネルの透け具合 |
| `--itachou-dialog` | 設定ダイアログの地色（不透明。既定 `#1a0e20`） |
| `--itachou-muted` | 補助テキスト（ツール行・所要時間など）の明るさ。読みにくければ上げる |
| `--itachou-bubble` | ユーザーメッセージの色 |
| `--itachou-accent` 系 | アクセント色（既定 `#ff6fb5`。シアンなら `#6fd6ff`） |

末尾には、パネルにすりガラス効果（`backdrop-filter`）を足す任意ブロックがコメントで置いてあります。

## 注意

- 非公式の改造です。OpenChamber 本体とは無関係です。
- アプリの内部 CSS 変数に依存しているため、将来のバージョンで効かなくなる可能性があります。
- `web-dist\index.html` の初回バックアップは `index.html.itachou-backup` に残ります。
- アンインストールは `uninstall.ps1`。OS やユーザーデータには影響しません。
- 拡張機能のローカルサービスは、ユーザー権限のフルアクセスで動きます。個人利用を前提にしてください。
- 適用後の `Ctrl+R` はサービスから自動化できません。手動でリロードしてください。
- 同梱していない背景画像の権利は、利用者自身で確認してください。

## 開発

拡張機能パッケージとしての構成と確認方法です。

```powershell
npm install
npm run build   # panel/main.src.js -> panel/main.js
npm run check   # service/main.js と panel/main.js の構文チェック
npm test        # 一時フォルダの web-dist に対して適用/解除を実行
```

`npm test` は実際の OpenChamber には触れません。一時フォルダにダミーの `web-dist` を作り、サービス経由で `install.ps1` / `uninstall.ps1` を実行して、マーカー・CSS・画像・冪等性・解除を確認します。

パッケージ全体の検証（Bun が必要）:

```powershell
bun node_modules/@openchamber/sdk/scripts/check-guest.ts .
```

| パス | 役割 |
| --- | --- |
| `package.json` | 拡張のマニフェスト（`openchamber` ブロック） |
| `panel/` | 右レールの UI。`main.js` は esbuild のビルド成果物で、コミット対象 |
| `service/main.js` | PowerShell を呼ぶローカルサービス。固定の `/health` `/status` `/apply` `/uninstall` `/log` だけを公開 |
| `install.ps1` / `uninstall.ps1` | MOD 本体。拡張はこれを呼ぶだけ |
| `scripts/selftest.mjs` | `npm test` の実体 |

## License

MIT（`LICENSE` 参照）。背景画像は含まれないため、ライセンス対象外です。