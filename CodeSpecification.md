# MineMate Code Specification

本書は、MineMate（Minecraft AI Bot）を構成するすべてのコードとその仕様、およびシステム全体のアーキテクチャについて詳細に解説する仕様書です。

## 1. システムアーキテクチャ概要

MineMateは、Minecraftの世界を自律的に認識・判断・行動するAIエージェントです。以下の3つの主要コンポーネントから構成されています。

1. **デュアルAIエージェント** (`ai/`)
   * 高速な状況判断と行動生成を行う **Low-Level Agent (Gemini 3.1 Flash)**
   * 複雑な計画やマルチモーダル記憶の想起を行う **High-Level Agent (Gemini 3.1 Pro)**
2. **セキュアな実行サンドボックス** (`skills/`)
   * メモリ制限付きの別スレッド(`Worker`)でAIの生成したJSコードを実行し、本体のクラッシュを防ぐ機構
   * 抽象構文木(AST)を用いたセキュリティ検証
3. **マルチモーダル認識システム** (`vision/`, `index.js`)
   * ヘッドレスブラウザによる視覚（スクリーンショット）キャプチャ
   * 聴覚（音の方向・距離）、チャットログの収集

---

## 2. エントリポイントと設定

### `index.js`
* **役割:** アプリケーションのメインエントリポイント。
* **仕様:**
  * `mineflayer` を用いてMinecraftサーバーにBotを接続します。
  * `prismarine-viewer` を起動し、Webブラウザ上でBotの視界を描画します。
  * `bot.on('chat')` および `bot.on('soundEffectHeard')` イベントをリッスンし、チャット内容や音の発生源（距離とベクトル）をキャッチしてAIのコンテキストキューに送ります。
  * `vision/capture.js` と `ai/lowLevelAgent.js` のメインループを起動します。

### `.env` / `config.json`
* **役割:** 環境変数と基本設定。
* **仕様:**
  * `.env`: `GEMINI_API_KEY`, `MC_HOST`, `MC_PORT`, `MC_USERNAME` を管理。
  * `config.json`: `learningMode` (自己学習機能のオン/オフ) などを管理。

---

## 3. AIエージェント (`ai/`)

### `ai/lowLevelAgent.js`
* **役割:** メインの思考・行動ループを担う低レベルエージェント。使用モデルは `gemini-3.1-flash`。
* **仕様:**
  * **ポーリング間隔:** 平時は1.2秒間隔。HP減少や敵対モブ接近時、または手動で `EmergencyMode` がトリガーされた場合は0.2秒間隔の超高速ポーリングに移行します。
  * **JSONスキーマ応答:** 必ず定義されたJSONスキーマに沿って応答します。
    * `Thought`: 自分の行動理由や感情をメモし、次ループ以降のコンテキスト(`memoryContext`)に引き継ぎます。
    * `Chat`: ゲーム内チャットへの発言。
    * `Execute`: `Start` (コード実行), `Thinking` (高レベルAIへ委譲), `FlashBack` (空間記憶の想起), `LongMemory` (ベクトル検索/保存), `Stop` (行動停止), `None` (スクリプト待機) のいずれか。
    * `Code`: `Start` 時に記述される丸ごと一本のJavaScriptコード。
  * **コンテキスト管理:** 直近20件の記憶（Thoughtや行動結果）、直近55件のチャットログ、最新の音データをプロンプトとして維持します。

### `ai/highLevelAgent.js`
* **役割:** 複雑な推論が必要な場面で呼び出される高レベルエージェント。使用モデルは `gemini-3.1-pro`。
* **仕様:**
  * `Execute: "Thinking"` で呼び出される `executeHighLevel()` は、巨大なタスクツリー(`task_tree.json`)や過去の成功体験(`task_tree.ai_experience.json`)を読み込み、Google検索ツールを用いて長期的な計画を立てます。
  * `Execute: "FlashBack"` で呼び出される `executeFlashBack()` は、空間メモリ(`task_tree.spatial_memory.json`)に保存された全てのテキストと**スクリーンショット画像そのもの**をマルチモーダル入力として読み込み、視覚情報から詳細な道順や座標を思い出して返却します。

---

## 4. 実行環境とセキュリティ (`skills/`)

### `skills/executor.js`
* **役割:** メインスレッド側の実行インターフェースおよびIPC通信のハブ。
* **仕様:**
  * AIが生成したコード(`Execute: "Start"`)を受け取ると、新しい `Worker` スレッドを生成してコードを渡します。
  * Workerからは直接Botを操作できないため、Workerから送られてきたメッセージ（例: `bot.chat` してほしい）を受け取り、メインスレッド上の `bot` オブジェクトを使って安全に代理実行します。
  * 実行結果やエラーをWorkerへ送り返します。

### `skills/worker.js`
* **役割:** メモリ制限されたVM(Virtual Machine)隔離サンドボックス。
* **仕様:**
  * **メモリ制限:** `resourceLimits: { maxOldGenerationSizeMb: 50 }` のように厳しいメモリ制限がかけられており、AIが無限ループや巨大な配列を生成してメモリを枯渇させても、メインプロセスは死なずこのWorkerだけがクラッシュします（OOMエラーはAIにフィードバックされます）。
  * **IPCプロキシAPI:** Worker内には `mmskills` や `botAPI` といったプロキシオブジェクトが用意されており、これらを呼び出すと内部で `parentPort.postMessage` に変換され、メインスレッドの `executor.js` に処理を依頼します。

### `skills/validator.js`
* **役割:** AI生成コードの静的解析（ASTチェック）。
* **仕様:**
  * `acorn` および `acorn-walk` を用いて、コード実行前に抽象構文木(AST)を解析します。
  * `process`, `eval`, `Function`, `setTimeout` などの危険なグローバル変数・関数へのアクセスをブラックリストで弾きます。
  * `require()` はホワイトリスト制（現在は `vec3` のみ許可）となっており、悪意のあるモジュール読み込みを完全にブロックします。

---

## 5. 記憶システム (Memory & Knowledge)

### `skills/LongMemory.json`
* **役割:** AIが自由に書き込み・検索できるベクトル検索データベース。
* **仕様:**
  * `Execute: "LongMemory"` の `Action.Write` により、タイトル・内容・高画質スクショが保存されます。
  * 保存時、Gemini APIの `text-embedding-004` を用いてタイトルを数値ベクトル(`embedding`)に変換して格納します。
  * `Action.Query` で検索された際、検索クエリもベクトル化し、全記憶との間で**コサイン類似度(Cosine Similarity)**を計算して、最も意味の近い記憶をスクショ情報とともに返却します。

### `skills/task_tree.spatial_memory.json`
* **役割:** 場所とルートに関する空間記憶。
* **仕様:**
  * `mmskills.ai.saveSpatialMemory()` スキルによって記録されます。
  * `Execute: "FlashBack"` 実行時、ここのテキスト情報と画像ファイルがすべてGemini 3.1 Proに投げられ、視覚的な記憶想起に使われます。

### `skills/task_tree.ai_experience.json`
* **役割:** 自己学習による成功体験の記録。
* **仕様:**
  * `mmskills.ai.saveExperience()` スキルによって記録されます。`config.json` の学習モードがONの時、高レベルAIがこの過去の知見を読み込んで計画に活用します。

### `skills/tree.json` / `skills/task_tree.json`
* **役割:** システム側で用意された固定の知識ベース。
* **仕様:**
  * `tree.json`: `mmskills` の各種関数（移動、ブロック操作、インベントリ操作など）の仕様と使い方をAIに教えるマニュアル。
  * `task_tree.json`: Minecraftの攻略（木を切る、鉄を掘るなど）に関するマイルストーンや知識が体系化されたツリー構造データ。

---

## 6. 視覚システム (`vision/`)

### `vision/capture.js`
* **役割:** Puppeteerを用いた `mineflayer-viewer` のブラウザ画面キャプチャ。
* **仕様:**
  * メインループ用に7fps、低画質（JPEG Quality 14）で連続キャプチャを行い、BASE64エンコードして低レベルAIのプロンプトに毎ループ添付します。
  * `takeHighResScreenshot(filepath)` 関数を提供しており、これは LongMemory の保存時や `mmskills.vision.takeScreenshot()` が呼ばれた際に、JPEG Quality 90 の高画質スクショを指定パスに物理ファイルとして書き出します。

---

このアーキテクチャにより、MineMateは「高速な反射と行動」「高度な思考とマルチモーダル記憶」「クラッシュしない安全な自律コード実行環境」という3つの強力な基盤を併せ持っています。
