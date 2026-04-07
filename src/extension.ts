import * as path from 'path';
import * as vscode from 'vscode';
import playSound = require('play-sound');
import { buildBlackoutPanelCsp, getBlackoutPanelHtml } from './blackoutWebviewHtml';
import {
	resolveAssetEntryName,
	shouldConsiderRandomTypingTrigger,
	isCursorLikeAppName,
} from './extensionLogic';

const player = playSound();

let pachinkasOutput: vscode.OutputChannel | undefined;

function pachinkasLog(message: string): void {
	const line = `[pachinkas] ${message}`;
	console.log(line);
	pachinkasOutput?.appendLine(line);
}

/** ブラックアウト SE 終了後も暗転を維持する時間（ms）。好みで変更してください。 */
const BLACKOUT_HOLD_MS = 0;

/**
 * Webview 内 `<audio>` 用: iris アンカー後の 1 曲目までの追加待ち（ms）。
 * Cursor ホスト再生は Webview 準備完了時に即開始するため、この遅延は主に VS Code 側 Webview 音声向け。
 */
const BLACKOUT_POST_READY_PAD_MS = 20;

/** Cursor ホスト: iris からの予備スケジュール時のみ（即時再生後は呼ばれないことが多い） */
const CURSOR_HOST_FALLBACK_PAD_MS = 0;

/** Webview がアニメ開始を検知できないとき、1 曲目開始までのフォールバック（ms） */
const BLACKOUT_READY_FALLBACK_MS = 320;

/** Webview が完了通知を送らないときの安全タイムアウト（ms）。異常時のみ。 */
const BLACKOUT_SEQUENCE_MAX_MS = 180_000;

/**
 * Cursor 向け: 暗転 Webview を Active 列のタブで開き（`preserveFocus` でフォーカスは編集側）、
 * ホスト側で前面化してから `pachikasStartShow` でアニメ開始。
 * エディタのキー入力を「ロック」する API はない。
 */
const CURSOR_BLACKOUT_DEFER_FLOW = true;

function getRandomTypingDenominator(): number {
	const raw = vscode.workspace
		.getConfiguration('pachinkas', null)
		.get<number>('randomTypingDenominator');
	if (raw === undefined || raw === null || Number.isNaN(raw)) {
		return 16384;
	}
	return Math.floor(raw);
}

/** `false` のときだけオフ。未設定はオン（従来どおり）。 */
function getRandomTypingSoundEnabled(): boolean {
	const v = vscode.workspace
		.getConfiguration('pachinkas', null)
		.get<boolean | undefined>('randomTypingSoundEnabled');
	return v !== false;
}

/** `false` のときだけステータスバーを隠す。未設定は表示。 */
function getShowRandomTypingInStatusBar(): boolean {
	const v = vscode.workspace
		.getConfiguration('pachinkas', null)
		.get<boolean | undefined>('showRandomTypingInStatusBar');
	return v !== false;
}

let pachinkaPlaybackBusy = false;

let randomTypingDocumentListener: vscode.Disposable | undefined;

let randomTypingStatusBar: vscode.StatusBarItem | undefined;

function updateRandomTypingStatusBar(): void {
	const sb = randomTypingStatusBar;
	if (!sb) {
		return;
	}
	const on = getRandomTypingSoundEnabled();
	sb.text = on ? '$(volume-high) パチンカス・ランダム' : '$(volume-mute) パチンカス・ランダム';
	sb.tooltip = on
		? 'タイピングのランダム SE はオンです。クリックでオフにします。'
		: 'タイピングのランダム SE はオフです。クリックでオンにします。';
	if (getShowRandomTypingInStatusBar()) {
		sb.show();
	} else {
		sb.hide();
	}
}

function syncRandomTypingDocumentListener(context: vscode.ExtensionContext): void {
	randomTypingDocumentListener?.dispose();
	randomTypingDocumentListener = undefined;
	if (!getRandomTypingSoundEnabled()) {
		return;
	}
	randomTypingDocumentListener = vscode.workspace.onDidChangeTextDocument((e) => {
		if (!shouldRollRandomTypingTrigger(e)) {
			return;
		}
		if (!rollRandomTypingTrigger()) {
			return;
		}
		void playPachinkoSounds(context).catch((err) => {
			console.error('pachinkas: ランダム SE 再生失敗', err);
		});
	});
}

/** Cursor 等では Webview 内メディア／メッセージが VS Code と異なることがあるため、音声はホストのみにする */
function isCursorLikeApp(): boolean {
	return isCursorLikeAppName(vscode.env.appName ?? '');
}

/** キー入力に近い変更だけ抽選する（巨大な貼り付けは除外） */
function shouldRollRandomTypingTrigger(e: vscode.TextDocumentChangeEvent): boolean {
	return shouldConsiderRandomTypingTrigger({
		documentScheme: e.document.uri.scheme,
		contentChanges: e.contentChanges,
	});
}

function rollRandomTypingTrigger(): boolean {
	const denominator = getRandomTypingDenominator();
	if (denominator < 1) {
		return false;
	}
	return Math.floor(Math.random() * denominator) === 0;
}

function resolveAssetUri(assetsRoot: vscode.Uri, assetsDirFs: string, logicalFileName: string): vscode.Uri {
	return vscode.Uri.joinPath(assetsRoot, resolveAssetEntryName(assetsDirFs, logicalFileName));
}

function resolveAssetFsPath(extensionPath: string, logicalFileName: string): string {
	const assetsDirFs = path.join(extensionPath, 'assets');
	return path.join(assetsDirFs, resolveAssetEntryName(assetsDirFs, logicalFileName));
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function playAsync(filePath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		player.play(filePath, (err: Error | null) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

async function playHostAssetSequence(context: vscode.ExtensionContext): Promise<void> {
	const p1 = resolveAssetFsPath(context.extensionPath, 'ブラックアウト.mp3');
	const p2 = resolveAssetFsPath(context.extensionPath, 'セブンフラッシュ.mp3');
	pachinkasLog(`ホスト再生: ${p1}`);
	await playAsync(p1);
	if (BLACKOUT_HOLD_MS > 0) {
		await sleep(BLACKOUT_HOLD_MS);
	}
	pachinkasLog(`ホスト再生: ${p2}`);
	await playAsync(p2);
}

/**
 * エディタ領域を黒く覆う Webview を開く。
 * VS Code API ではウィンドウ全体（アクティビティバー等）の暗転はできない。
 * 既定では SE は Webview 内 `<audio>`。Cursor では `hostAudioOnly` で映像はフル・音声のみホスト再生。
 */
function createEditorBlackoutPanel(
	context: vscode.ExtensionContext,
	options?: { hostAudioOnly?: boolean },
): {
	panel: vscode.WebviewPanel;
	whenSequenceDone: Promise<void>;
} {
	const hostAudioOnly = options?.hostAudioOnly === true;
	const useCursorDeferReveal = hostAudioOnly && CURSOR_BLACKOUT_DEFER_FLOW;
	const assetsRoot = vscode.Uri.joinPath(context.extensionUri, 'assets');
	const assetsDirFs = path.join(context.extensionPath, 'assets');

	const panel = vscode.window.createWebviewPanel(
		'pachinkasBlackout',
		' ',
		{
			// Beside は左右分割になるため使わない。Active + preserveFocus でタブは開くが編集フォーカスは残す
			viewColumn: vscode.ViewColumn.Active,
			preserveFocus: useCursorDeferReveal,
		},
		{
			// Cursor でも iris の animationstart を検知する最小スクリプトを載せる
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		},
	);

	let whenSequenceDone!: Promise<void>;
	let safetyTimer: ReturnType<typeof setTimeout> | undefined;
	let hostFallbackStarted = false;
	let sound1Uri = '';
	let sound2Uri = '';

	if (hostAudioOnly) {
		pachinkasLog(
			useCursorDeferReveal
				? 'Cursor: タブ起動（フォーカス維持）→reveal とアニメ同時（iris アンカー同期）'
				: 'Cursor: フル演出＋ホスト再生（iris アンカー同期）',
		);
		whenSequenceDone = new Promise<void>((resolve) => {
			let sub: vscode.Disposable | undefined;
			let deferStartSent = false;
			let webviewReadyHandled = false;
			let finished = false;
			let hostPlaybackTimer: ReturnType<typeof setTimeout> | undefined;
			let cursorHostScheduled = false;

			const cleanup = () => {
				if (safetyTimer !== undefined) {
					clearTimeout(safetyTimer);
					safetyTimer = undefined;
				}
				sub?.dispose();
				sub = undefined;
			};

			const finish = () => {
				if (finished) {
					return;
				}
				finished = true;
				if (hostPlaybackTimer !== undefined) {
					clearTimeout(hostPlaybackTimer);
					hostPlaybackTimer = undefined;
				}
				cleanup();
				resolve();
			};

			safetyTimer = setTimeout(() => {
				pachinkasLog('Cursor: 安全タイムアウトで終了');
				finish();
			}, BLACKOUT_SEQUENCE_MAX_MS);

			const runHostPlayback = (): void => {
				void (async () => {
					try {
						await playHostAssetSequence(context);
						pachinkasLog('Cursor: ホスト再生完了');
					} catch (e) {
						pachinkasLog(`Cursor: ホスト再生エラー: ${String(e)}`);
						void vscode.window.showErrorMessage(
							'パチンカス: 音声の再生に失敗しました。出力「パチンカス」を確認してください。',
						);
					} finally {
						finish();
					}
				})();
			};

			const scheduleHostPlayback = () => {
				if (cursorHostScheduled || finished) {
					return;
				}
				cursorHostScheduled = true;
				if (CURSOR_HOST_FALLBACK_PAD_MS <= 0) {
					runHostPlayback();
					return;
				}
				hostPlaybackTimer = setTimeout(() => {
					hostPlaybackTimer = undefined;
					runHostPlayback();
				}, CURSOR_HOST_FALLBACK_PAD_MS);
			};

			sub = panel.webview.onDidReceiveMessage((msg: { type?: string }) => {
				if (useCursorDeferReveal && msg?.type === 'pachikasWebviewReady') {
					if (webviewReadyHandled) {
						return;
					}
					webviewReadyHandled = true;
					void (async () => {
						pachinkasLog('Cursor: Webview 準備完了→タブ前面化');
						panel.reveal(vscode.ViewColumn.Active, false);
						if (finished) {
							return;
						}
						deferStartSent = true;
						pachinkasLog('Cursor: pachikasStartShow を Webview に配信（完了まで待機）');
						await panel.webview.postMessage({ type: 'pachikasStartShow' });
						if (finished) {
							return;
						}
						pachinkasLog('Cursor: Webview が受信→ホスト音声開始');
						scheduleHostPlayback();
					})().catch((e) => {
						pachinkasLog(`Cursor: 前面化／開始シグナル失敗: ${String(e)}`);
						if (!deferStartSent) {
							deferStartSent = true;
						}
						scheduleHostPlayback();
					});
					return;
				}
				if (
					msg?.type === 'pachinkasCursorVisualReady' ||
					msg?.type === 'pachinkasCursorVisualFallback'
				) {
					pachinkasLog(
						msg?.type === 'pachinkasCursorVisualReady'
							? 'Cursor: iris アンカーでホスト再生をスケジュール'
							: 'Cursor: フォールバックでホスト再生をスケジュール',
					);
					scheduleHostPlayback();
				}
			});
		});
	} else {
		sound1Uri = panel.webview.asWebviewUri(
			resolveAssetUri(assetsRoot, assetsDirFs, 'ブラックアウト.mp3'),
		).toString();
		sound2Uri = panel.webview.asWebviewUri(
			resolveAssetUri(assetsRoot, assetsDirFs, 'セブンフラッシュ.mp3'),
		).toString();
		pachinkasLog(`Webview 音声 URI1: ${sound1Uri}`);
		pachinkasLog(`Webview 音声 URI2: ${sound2Uri}`);

		whenSequenceDone = new Promise<void>((resolve) => {
			let sub: vscode.Disposable | undefined;
			let finished = false;
			const cleanup = () => {
				if (safetyTimer !== undefined) {
					clearTimeout(safetyTimer);
					safetyTimer = undefined;
				}
				sub?.dispose();
				sub = undefined;
			};
			const complete = () => {
				if (finished) {
					return;
				}
				finished = true;
				cleanup();
				resolve();
			};
			sub = panel.webview.onDidReceiveMessage(
				(msg: { type?: string; where?: string; detail?: string; mode?: string }) => {
					if (msg?.type === 'pachinkasSequenceDone') {
						pachinkasLog('Webview: シーケンス完了');
						complete();
						return;
					}
					if (msg?.type === 'pachinkasRequestHostAudio') {
						if (hostFallbackStarted) {
							return;
						}
						hostFallbackStarted = true;
						pachinkasLog(
							`Webview→ホスト再生 (${msg.where ?? '?'}, mode=${msg.mode ?? 'full'}): ${msg.detail ?? ''}`,
						);
						void (async () => {
							try {
								if (msg.mode === 'second-only') {
									const p2 = resolveAssetFsPath(context.extensionPath, 'セブンフラッシュ.mp3');
									pachinkasLog(`ホスト再生（2曲目のみ）: ${p2}`);
									await playAsync(p2);
								} else {
									await playHostAssetSequence(context);
								}
								pachinkasLog('ホスト再生完了');
							} catch (e) {
								pachinkasLog(`ホスト再生エラー: ${String(e)}`);
								void vscode.window.showErrorMessage(
									'パチンカス: 音声の再生に失敗しました。出力「パチンカス」を確認してください。',
								);
							} finally {
								complete();
							}
						})();
					}
				},
			);
			safetyTimer = setTimeout(() => {
				pachinkasLog('安全タイムアウトで終了（異常・長時間）');
				complete();
			}, BLACKOUT_SEQUENCE_MAX_MS);
		});
	}

	panel.webview.html = getBlackoutPanelHtml({
		csp: buildBlackoutPanelCsp(panel.webview.cspSource),
		hostAudioOnly,
		cursorDeferAnimationStart: useCursorDeferReveal,
		sound1Uri,
		sound2Uri,
		blackoutHoldMs: BLACKOUT_HOLD_MS,
		blackoutPostReadyPadMs: BLACKOUT_POST_READY_PAD_MS,
		blackoutReadyFallbackMs: BLACKOUT_READY_FALLBACK_MS,
	});
	if (!useCursorDeferReveal) {
		panel.reveal(vscode.ViewColumn.Active, false);
	}

	return { panel, whenSequenceDone };
}

async function playPachinkoSounds(context: vscode.ExtensionContext): Promise<void> {
	if (pachinkaPlaybackBusy) {
		return;
	}
	pachinkaPlaybackBusy = true;
	pachinkasLog('SE 再生開始');
	try {
		const { panel: blackout, whenSequenceDone } = createEditorBlackoutPanel(context, {
			hostAudioOnly: isCursorLikeApp(),
		});
		try {
			await whenSequenceDone;
		} finally {
			blackout.dispose();
		}
	} finally {
		pachinkaPlaybackBusy = false;
	}
}

export function activate(context: vscode.ExtensionContext) {
	pachinkasOutput = vscode.window.createOutputChannel('パチンカス');
	context.subscriptions.push(pachinkasOutput);
	pachinkasLog('拡張機能を有効化しました（出力は「表示」→「出力」→「パチンカス」）');

	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	statusBar.command = 'pachinkas.toggleRandomTypingSound';
	randomTypingStatusBar = statusBar;
	updateRandomTypingStatusBar();

	context.subscriptions.push(
		statusBar,
		vscode.commands.registerCommand('pachinkas.demo', () => {
			void vscode.window.showInformationMessage(
				'パチンカス拡張のデモです。「SE を再生」やステータスバーのランダム切替が使えます。',
			);
		}),
		vscode.commands.registerCommand('pachinkas.playPachinkoSounds', () => {
			void playPachinkoSounds(context).catch((err) => {
				console.error('pachinkas: SE 再生失敗', err);
				void vscode.window.showErrorMessage('パチンカス SE の再生に失敗しました。');
			});
		}),
		vscode.commands.registerCommand('pachinkas.openExtensionSettings', () => {
			// `@ext:…` は未公開・開発ホスト・Cursor ではヒットしないことがあるため、設定キーで絞り込む
			void vscode.commands.executeCommand('workbench.action.openSettings', 'pachinkas');
		}),
		vscode.commands.registerCommand('pachinkas.toggleRandomTypingSound', async () => {
			const config = vscode.workspace.getConfiguration('pachinkas', null);
			const next = !getRandomTypingSoundEnabled();
			const target =
				vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
					? vscode.ConfigurationTarget.Workspace
					: vscode.ConfigurationTarget.Global;
			await config.update('randomTypingSoundEnabled', next, target);
			syncRandomTypingDocumentListener(context);
			updateRandomTypingStatusBar();
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('pachinkas.randomTypingSoundEnabled')) {
				syncRandomTypingDocumentListener(context);
			}
			if (
				e.affectsConfiguration('pachinkas.randomTypingSoundEnabled') ||
				e.affectsConfiguration('pachinkas.showRandomTypingInStatusBar')
			) {
				updateRandomTypingStatusBar();
			}
		}),
		new vscode.Disposable(() => {
			randomTypingDocumentListener?.dispose();
			randomTypingDocumentListener = undefined;
			randomTypingStatusBar = undefined;
		}),
	);

	syncRandomTypingDocumentListener(context);
}

export function deactivate() {}
