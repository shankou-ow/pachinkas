const path = require('path');
const esbuild = require('esbuild');
const player = require('play-sound')({});

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** `npm run compile` 等の esbuild 成功時にターミナルから SE を鳴らすか。オフのときは false。 */
const ENABLE_ESBUILD_SUCCESS_SOUND = false;

/** watch 中の各リビルドでも鳴らす場合はタスク等で PACHINKAS_PLAY_ON_WATCH=1 */
function shouldPlayBuildSuccessSound() {
	if (!ENABLE_ESBUILD_SUCCESS_SOUND) {
		return false;
	}
	if (process.env.CI || process.env.PACHINKAS_ESBUILD_SILENT === '1') {
		return false;
	}
	if (!watch) {
		return true;
	}
	return process.env.PACHINKAS_PLAY_ON_WATCH === '1';
}

function playPachinkoSuccessAssets() {
	const base = path.join(__dirname, 'assets');
	const sound1 = path.join(base, 'ブラックアウト.mp3');
	const sound2 = path.join(base, 'セブンフラッシュ.mp3');
	return new Promise((resolve, reject) => {
		player.play(sound1, (err1) => {
			if (err1) {
				reject(err1);
				return;
			}
			player.play(sound2, (err2) => (err2 ? reject(err2) : resolve()));
		});
	});
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[esbuild] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[esbuild] build finished');
			if (result.errors.length === 0 && shouldPlayBuildSuccessSound()) {
				playPachinkoSuccessAssets().catch((err) => console.error('Sound:', err));
			}
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		// play-sound は VSIX に node_modules が入らないと実行時に解決できないためバンドルする（vscode のみ external）
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
