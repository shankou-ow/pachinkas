# パチンカス（pachinkas）

パチンカス向けの効果音・暗転演出を VS Code / Cursor に追加する拡張機能です。

## できること

- **コマンド**「パチンカス: SE を再生」で手動再生
- **編集時**に低確率でランダム発動（既定は約 16384 分の 1）。設定でオン／オフでき、**ステータスバー**（表示は設定 `pachinkas.showRandomTypingInStatusBar` で非表示にできる）やコマンドからも切り替え可能
- 再生中は **エディタ領域の暗転**と演出用のビジュアルを表示（全体の UI は覆えません）
- **開発時のみ**（任意）: `esbuild.js` の `ENABLE_ESBUILD_SUCCESS_SOUND` を `true` にすると、`compile` / `package` 完了時にターミナルから SE を鳴らせます（**既定はオフ**）。CI では `CI` または `PACHINKAS_ESBUILD_SILENT=1` で無音になります

## 必要環境

- VS Code **1.105.0** 以降（`package.json` の `engines.vscode`: `^1.105.0` と同じ）

音声再生は OS のプレーヤー（例: macOS の `afplay`）に依存します。

**Cursor** では、Webview の DOM 準備ができてから**タブを前面化**し、拡張側が `postMessage` の配信完了を待ってから**ホスト音声**を開始します（映像の開始シグナルは Webview 内で同期的に処理します）。拡張 API では**キー入力をグローバルにロック**することはできません。

## インストール（開発者向け）

リポジトリをクローンし、プロジェクト直下で:

```bash
npm install
npm run package
npx @vscode/vsce package
```

生成された `.vsix` を **拡張機能 → メニュー → VSIX からのインストール** で入れてください。

## ライセンス

MIT License。全文はリポジトリ直下の [`LICENSE`](LICENSE) を参照してください。
