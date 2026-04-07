import * as fs from 'fs';

/** 貼り付けとみなしてランダム抽選しない挿入文字数の目安（超えたらスキップ） */
export const RANDOM_TYPING_MAX_INSERT_CHARS = 120;

/** `vscode.env.appName` から Cursor 系かどうか */
export function isCursorLikeAppName(appName: string): boolean {
	return /cursor/i.test(appName);
}

export function isRandomTypingTargetScheme(scheme: string): boolean {
	return scheme === 'file' || scheme === 'untitled' || scheme === 'vscode-notebook-cell';
}

/**
 * タイピング時ランダム抽選の対象になる変更か（スキーム・変更サイズ）。
 * `vscode.TextDocumentChangeEvent` から呼び出す。
 */
export function shouldConsiderRandomTypingTrigger(params: {
	documentScheme: string;
	contentChanges: ReadonlyArray<{ text: string }>;
	maxInsertChars?: number;
}): boolean {
	const maxInsertChars = params.maxInsertChars ?? RANDOM_TYPING_MAX_INSERT_CHARS;
	if (!isRandomTypingTargetScheme(params.documentScheme)) {
		return false;
	}
	if (params.contentChanges.length === 0) {
		return false;
	}
	const inserted = params.contentChanges.reduce((sum, c) => sum + c.text.length, 0);
	if (inserted > maxInsertChars) {
		return false;
	}
	return true;
}

/**
 * assets 内のファイルを論理名で解決する。macOS の APFS ではファイル名が NFD になり、
 * ソース上の NFC と一致しないと Webview から読めず即終了するため、正規化して突き合わせる。
 */
export function resolveAssetEntryName(extensionAssetsDirFs: string, logicalFileName: string): string {
	let entries: string[];
	try {
		entries = fs.readdirSync(extensionAssetsDirFs);
	} catch {
		throw new Error(`pachinkas: assets を読めません: ${extensionAssetsDirFs}`);
	}
	const want = logicalFileName.normalize('NFC');
	const hit = entries.find((name) => name.normalize('NFC') === want);
	if (!hit) {
		throw new Error(`pachinkas: 音声ファイルが見つかりません: ${logicalFileName}`);
	}
	return hit;
}
