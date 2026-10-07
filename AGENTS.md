# AXIS Studio

- React / TypeScript / Three.jsのローカルWebアプリ。`src/core` はNodeとWeb Workerで共用するためDOM・Three.jsに依存させない。
- 操作はREADME、設定例は`examples/`。ブラウザーのJSON設定はそのまま `npm run simulate -- <path> output/<case>` で実行可能。
- 長さはmm、設定角度は度、エンジン・結果JSONの関節角はラジアン。CSVは度。
- 逆運動学の解を調べる場合は同じ入力でCLI実行し、未収束と領域違反を分けて調べる。失敗を隠すために許容誤差や領域を変更しない。`NG`/`UNVERIFIED`は終了コード2。
- 描画はカプセルモデルに一致させる。領域判定は端点中心だけでなく、半径・両端球を含む全リンクに適用する。
- 再生の関節角線形補間を変更したら、フレーム間検証も同じ運動に合わせる。検査上限では安全を推測せず`UNVERIFIED`を返す。
- 数値変更は `npm test`、UI/型変更は `npm run build`。必要な画面検証は `npm run test:e2e`。既存Chromeを使う場合は `PLAYWRIGHT_CHANNEL=chrome`。
- 生成物は`output/`。`dist/`, `node_modules/`, `test-results/`はコミットしない。
