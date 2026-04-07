import * as path from 'path';
import * as vscode from 'vscode';
import playSound = require('play-sound');
import { buildBlackoutPanelCsp, getBlackoutPanelHtml } from './blackoutWebviewHtml';
import {
	isCursorLikeAppName,
	resolveAssetEntryName,
	shouldConsiderRandomTypingTrigger,
} from './extensionLogic';

const player = playSound();

let pachinkasOutput: vscode.OutputChannel | undefined;

function pachinkasLogTimestamp(): string {
	return new Date().toISOString();
}

function pachinkasLog(message: string): void {
	// 先頭を `[ISO]` にすると出力ビューで 1 ブロックが省略され、時刻だけ消えることがあるため角括弧にしない
	const line = `[pachinkas] ${pachinkasLogTimestamp()} ${message}`;
	console.log(line);
	pachinkasOutput?.appendLine(line);
}

function pachinkasLogError(message: string, err?: unknown): void {
	const detail =
		err === undefined
			? ''
			: ` ${err instanceof Error ? err.stack ?? err.message : String(err)}`;
	const line = `[pachinkas] ${pachinkasLogTimestamp()} ${message}${detail}`;
	console.error(line);
	pachinkasOutput?.appendLine(line);
}

/** 1 回の SE 再生で区間・累計（performance.now）を出す */
type PlaybackTiming = {
	mark: (label: string) => void;
};

function createPlaybackTiming(): PlaybackTiming {
	const t0 = performance.now();
	let last = t0;
	return {
		mark(label: string): void {
			const now = performance.now();
			const segment = now - last;
			const total = now - t0;
			last = now;
			pachinkasLog(`[計測] ${label} 区間${segment.toFixed(1)}ms 累計${total.toFixed(1)}ms`);
		},
	};
}

/** ブラックアウト SE 終了後も暗転を維持する時間（ms）。好みで変更してください。 */
const BLACKOUT_HOLD_MS = 0;

/**
 * 映像の `--pach-audio-lead`。映像を遅らせない（0 固定）。
 */
const BLACKOUT_VISUAL_LEAD_MS = 0;

/**
 * 初回描画待ちのあと、ホスト音声だけをさらに遅らせて映像に合わせる（ms）。映像の CSS は触らない。
 */
const HOST_AUDIO_LAG_AFTER_PAINT_MS = 220;

/** `pachikasPaintReady` が届かないときのフォールバック待ち（ms）。`reveal` の直後から計測。 */
const WEBVIEW_PAINT_WAIT_TIMEOUT_MS = 700;

/**
 * Cursor では Webview→拡張の `postMessage` が届かないことが多いため、`reveal` 後にこの固定時間だけ待ってから音声へ進む。
 * VS Code の計測（約 200ms）より長めにして、Webview 側の CSS アニメが始まってから音に寄せる。
 * `HOST_AUDIO_LAG_AFTER_PAINT_MS` はその後に加算。
 */
const CURSOR_REVEAL_TO_AUDIO_BASE_DELAY_MS = 420;

/** ホスト再生が異常に長引いたときの安全タイムアウト（ms）。異常時のみ。 */
const BLACKOUT_SEQUENCE_MAX_MS = 180_000;

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
			pachinkasLogError('ランダム SE 再生失敗', err);
		});
	});
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
	const playerOpts: Record<string, string[]> =
		process.platform === 'darwin' ? { afplay: ['-v', '1'] } : {};
	return new Promise((resolve, reject) => {
		player.play(filePath, playerOpts, (err: Error | null) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

async function playHostAssetSequence(
	context: vscode.ExtensionContext,
	timing?: PlaybackTiming,
): Promise<void> {
	const p1 = resolveAssetFsPath(context.extensionPath, 'ブラックアウト.mp3');
	const p2 = resolveAssetFsPath(context.extensionPath, 'セブンフラッシュ.mp3');
	timing?.mark('ホスト: 1曲目 play() 直前');
	pachinkasLog(`ホスト再生: ${p1}`);
	await playAsync(p1);
	timing?.mark('ホスト: 1曲目 終了（プロセス close）');
	if (BLACKOUT_HOLD_MS > 0) {
		await sleep(BLACKOUT_HOLD_MS);
	}
	timing?.mark('ホスト: 2曲目 play() 直前');
	pachinkasLog(`ホスト再生: ${p2}`);
	await playAsync(p2);
	timing?.mark('ホスト: 2曲目 終了（プロセス close）');
}


function isPaintReadyMessage(msg: unknown): boolean {
	if (msg === null || msg === undefined) {
		return false;
	}
	if (typeof msg === 'string') {
		try {
			const o = JSON.parse(msg) as { type?: string };
			return o.type === 'pachikasPaintReady';
		} catch {
			return false;
		}
	}
	if (typeof msg === 'object' && msg !== null && 'type' in msg) {
		return (msg as { type: string }).type === 'pachikasPaintReady';
	}
	return false;
}

/**
 * Webview が初回描画を通知するか、`startPaintWaitTimeout()` 後にタイムアウトするまで待つ。
 * リスナーは `html` より前、`startPaintWaitTimeout` は `reveal` の直後に呼ぶこと。
 */
function createPaintReadyPromise(
	panel: vscode.WebviewPanel,
	timing?: PlaybackTiming,
): { promise: Promise<void>; startPaintWaitTimeout: () => void } {
	let startPaintWaitTimeoutImpl: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		let finished = false;
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		const finish = (from: 'paint' | 'timeout'): void => {
			if (finished) {
				return;
			}
			finished = true;
			sub.dispose();
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			if (from === 'timeout') {
				timing?.mark('Webview 描画待ち: タイムアウトで音声開始');
			}
			resolve();
		};
		const sub = panel.webview.onDidReceiveMessage((msg: unknown) => {
			if (isPaintReadyMessage(msg)) {
				timing?.mark('Webview→拡張: pachikasPaintReady');
				finish('paint');
			}
		});
		startPaintWaitTimeoutImpl = () => {
			if (finished) {
				return;
			}
			timeoutId = setTimeout(() => finish('timeout'), WEBVIEW_PAINT_WAIT_TIMEOUT_MS);
		};
	});
	return {
		promise,
		startPaintWaitTimeout: () => {
			startPaintWaitTimeoutImpl();
		},
	};
}

/**
 * 映像は Webview、音声は拡張ホスト（`play-sound`）のみ。初回描画後に音声を開始してラグを減らす。
 */
function runHostBlackoutSequence(
	context: vscode.ExtensionContext,
	timing: PlaybackTiming | undefined,
	paintReadyPromise: Promise<void>,
): Promise<void> {
	return new Promise<void>((resolve) => {
		let finished = false;
		let safetyTimer: ReturnType<typeof setTimeout> | undefined;

		const cleanup = (): void => {
			if (safetyTimer !== undefined) {
				clearTimeout(safetyTimer);
				safetyTimer = undefined;
			}
		};

		const complete = (): void => {
			if (finished) {
				return;
			}
			finished = true;
			cleanup();
			resolve();
		};

		safetyTimer = setTimeout(() => {
			pachinkasLog('安全タイムアウトで終了（異常・長時間）');
			complete();
		}, BLACKOUT_SEQUENCE_MAX_MS);

		void (async () => {
			try {
				await paintReadyPromise;
				timing?.mark('ホスト: シーケンス開始（初回描画待ち後）');
				if (HOST_AUDIO_LAG_AFTER_PAINT_MS > 0) {
					timing?.mark(`ホスト: 映像に合わせて音声遅延 sleep(${HOST_AUDIO_LAG_AFTER_PAINT_MS}ms) 直前`);
					await sleep(HOST_AUDIO_LAG_AFTER_PAINT_MS);
					timing?.mark('ホスト: 映像に合わせて音声遅延 sleep 完了');
				}
				await playHostAssetSequence(context, timing);
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
	});
}

/**
 * エディタ領域を黒く覆う Webview を開く。
 * VS Code API ではウィンドウ全体（アクティビティバー等）の暗転はできない。
 */
function createEditorBlackoutPanel(
	context: vscode.ExtensionContext,
	options?: { timing?: PlaybackTiming },
): {
	panel: vscode.WebviewPanel;
	whenSequenceDone: Promise<void>;
} {
	const timing = options?.timing;

	timing?.mark('createWebviewPanel 直前');
	const panel = vscode.window.createWebviewPanel(
		'pachinkasBlackout',
		' ',
		{
			viewColumn: vscode.ViewColumn.Active,
			preserveFocus: false,
		},
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [context.extensionUri],
		},
	);
	timing?.mark('createWebviewPanel 直後（HTML は未設定）');

	const useCursorPaintFallback = isCursorLikeAppName(vscode.env.appName ?? '');
	let paintReadyPromise: Promise<void>;
	let startPaintWaitTimeout: (() => void) | undefined;

	if (!useCursorPaintFallback) {
		const pr = createPaintReadyPromise(panel, timing);
		paintReadyPromise = pr.promise;
		startPaintWaitTimeout = pr.startPaintWaitTimeout;
	}

	timing?.mark('getBlackoutPanelHtml 代入直前');
	panel.webview.html = getBlackoutPanelHtml({
		csp: buildBlackoutPanelCsp(panel.webview.cspSource),
		syncAnimDelayMs: BLACKOUT_VISUAL_LEAD_MS,
	});
	timing?.mark('getBlackoutPanelHtml 代入直後（Webview 読み込みは非同期）');
	timing?.mark('即時 reveal 直前');
	panel.reveal(vscode.ViewColumn.Active, false);
	timing?.mark('即時 reveal 直後');

	/** Webview のスクリプトが走る前に届くと無視されるため、複数回アームする */
	function postPaintArm(): void {
		void panel.webview.postMessage({ type: 'pachikasArm' });
	}
	postPaintArm();
	setTimeout(postPaintArm, 0);
	setTimeout(postPaintArm, 50);
	setTimeout(postPaintArm, 120);
	setTimeout(postPaintArm, 280);

	if (useCursorPaintFallback) {
		paintReadyPromise = (async () => {
			timing?.mark(
				`Cursor: ${CURSOR_REVEAL_TO_AUDIO_BASE_DELAY_MS}ms 固定（Webview→拡張の描画信号は未使用）`,
			);
			await sleep(CURSOR_REVEAL_TO_AUDIO_BASE_DELAY_MS);
		})();
	} else {
		startPaintWaitTimeout!();
	}

	const whenSequenceDone = runHostBlackoutSequence(context, timing, paintReadyPromise!);

	return { panel, whenSequenceDone };
}


async function playPachinkoSounds(context: vscode.ExtensionContext): Promise<void> {
	if (pachinkaPlaybackBusy) {
		return;
	}
	pachinkaPlaybackBusy = true;
	const timing = createPlaybackTiming();
	timing.mark('SE再生開始（playPachinkoSounds）');
	try {
		const { panel: blackout, whenSequenceDone } = createEditorBlackoutPanel(context, {
			timing,
		});
		timing.mark('createEditorBlackoutPanel 復帰（await whenSequenceDone 直前）');
		try {
			await whenSequenceDone;
			timing.mark('whenSequenceDone 解決（パネル dispose 直前）');
		} finally {
			blackout.dispose();
			timing.mark('blackout.dispose 完了');
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
				pachinkasLogError('SE 再生失敗', err);
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
