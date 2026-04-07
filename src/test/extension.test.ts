import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
	isCursorLikeAppName,
	resolveAssetEntryName,
	RANDOM_TYPING_MAX_INSERT_CHARS,
	shouldConsiderRandomTypingTrigger,
} from '../extensionLogic';

const EXTENSION_ID = 'yuu.pachinkas';

suite('extensionLogic', () => {
	test('isCursorLikeAppName: Cursor 系を検出', () => {
		assert.strictEqual(isCursorLikeAppName('Cursor'), true);
		assert.strictEqual(isCursorLikeAppName('cursor'), true);
		assert.strictEqual(isCursorLikeAppName('Cursor Nightly'), true);
		assert.strictEqual(isCursorLikeAppName('Visual Studio Code'), false);
		assert.strictEqual(isCursorLikeAppName(''), false);
	});

	test('shouldConsiderRandomTypingTrigger: 対象スキームと挿入量', () => {
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'file',
				contentChanges: [{ text: 'a' }],
			}),
			true,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'untitled',
				contentChanges: [{ text: 'x' }],
			}),
			true,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'vscode-notebook-cell',
				contentChanges: [{ text: 'y' }],
			}),
			true,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'vscode',
				contentChanges: [{ text: 'a' }],
			}),
			false,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'file',
				contentChanges: [],
			}),
			false,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'file',
				contentChanges: [{ text: 'x'.repeat(RANDOM_TYPING_MAX_INSERT_CHARS + 1) }],
			}),
			false,
		);
		assert.strictEqual(
			shouldConsiderRandomTypingTrigger({
				documentScheme: 'file',
				contentChanges: [{ text: 'abcde' }],
				maxInsertChars: 4,
			}),
			false,
		);
	});

	test('resolveAssetEntryName: 実在ファイルを解決', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pachinkas-asset-'));
		try {
			fs.writeFileSync(path.join(dir, 'sample.mp3'), '');
			assert.strictEqual(resolveAssetEntryName(dir, 'sample.mp3'), 'sample.mp3');
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('resolveAssetEntryName: NFC 論理名で NFD の実ファイルにマッチ', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pachinkas-nfc-'));
		try {
			const logical = 'テスト.mp3';
			const onDisk = logical.normalize('NFD');
			if (onDisk === logical) {
				// この環境では表現が同じなので通常パスのみ検証
				fs.writeFileSync(path.join(dir, logical), '');
				assert.strictEqual(resolveAssetEntryName(dir, logical), logical);
			} else {
				fs.writeFileSync(path.join(dir, onDisk), '');
				assert.strictEqual(resolveAssetEntryName(dir, logical.normalize('NFC')), onDisk);
			}
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('resolveAssetEntryName: 存在しないときはエラー', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pachinkas-miss-'));
		try {
			assert.throws(
				() => resolveAssetEntryName(dir, 'missing.mp3'),
				/音声ファイルが見つかりません/,
			);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

suite('パチンカス拡張（統合）', () => {
	test('拡張が読み込まれ、コマンドが登録されている', async () => {
		const ext = vscode.extensions.getExtension(EXTENSION_ID);
		assert.ok(ext, `拡張 ${EXTENSION_ID} が見つかりません（開発ホストで実行してください）`);
		await ext.activate();
		const cmds = await vscode.commands.getCommands(true);
		assert.ok(cmds.includes('pachinkas.demo'));
		assert.ok(cmds.includes('pachinkas.playPachinkoSounds'));
		assert.ok(cmds.includes('pachinkas.openExtensionSettings'));
		assert.ok(cmds.includes('pachinkas.toggleRandomTypingSound'));
	});
});
