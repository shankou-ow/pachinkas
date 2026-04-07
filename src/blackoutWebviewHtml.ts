/**
 * エディタ暗転 Webview の HTML。`extension.ts` から分離。
 */

export function buildBlackoutPanelCsp(cspSource: string): string {
	return [
		"default-src 'none'",
		"style-src 'unsafe-inline'",
		"script-src 'unsafe-inline'",
		`media-src ${cspSource} https: blob:`,
	].join('; ');
}

export type BlackoutPanelHtmlParams = {
	csp: string;
	hostAudioOnly: boolean;
	/** Cursor 向け: 拡張から `pachikasStartShow` を受け取るまで CSS アニメを止める */
	cursorDeferAnimationStart: boolean;
	sound1Uri: string;
	sound2Uri: string;
	blackoutHoldMs: number;
	blackoutPostReadyPadMs: number;
	blackoutReadyFallbackMs: number;
};

export function getBlackoutPanelHtml(params: BlackoutPanelHtmlParams): string {
	const {
		csp,
		hostAudioOnly,
		cursorDeferAnimationStart,
		sound1Uri,
		sound2Uri,
		blackoutHoldMs,
		blackoutPostReadyPadMs,
		blackoutReadyFallbackMs,
	} = params;
	const hostAudioOnlyFlag = hostAudioOnly;
	const deferClass =
		hostAudioOnlyFlag && cursorDeferAnimationStart ? ' class="pachikas-deferred"' : '';
	return `<!DOCTYPE html>
<html lang="ja"${deferClass}>
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title></title>
	<style>
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
			background: #000;
			animation: screenShake 0.32s steps(2, end) forwards;
		}
		@keyframes screenShake {
			0% { transform: translate(0, 0); }
			10% { transform: translate(-5px, 3px); }
			20% { transform: translate(6px, -4px); }
			35% { transform: translate(-4px, 5px); }
			50% { transform: translate(5px, 2px); }
			65% { transform: translate(-3px, -3px); }
			80% { transform: translate(2px, 4px); }
			100% { transform: translate(0, 0); }
		}
		/* 中央から黒が一気に飲み込む */
		#iris {
			position: fixed;
			inset: 0;
			background: #000;
			clip-path: circle(0 at 50% 50%);
			animation: irisSwallow 0.32s cubic-bezier(0.72, 0, 0.9, 0.35) forwards;
			will-change: clip-path;
		}
		@keyframes irisSwallow {
			to {
				clip-path: circle(200vmax at 50% 50%);
			}
		}
		/* 走査線＋チラつき */
		#scan {
			position: fixed;
			inset: 0;
			pointer-events: none;
			opacity: 0;
			background: repeating-linear-gradient(
				to bottom,
				transparent 0,
				transparent 1px,
				rgba(255, 255, 255, 0.14) 1px,
				rgba(255, 255, 255, 0.14) 2px
			);
			animation: scanIn 0.55s linear forwards;
		}
		@keyframes scanIn {
			0% {
				opacity: 0;
			}
			10% {
				opacity: 0.9;
			}
			16% {
				opacity: 0.35;
			}
			22% {
				opacity: 0.88;
			}
			100% {
				opacity: 0.38;
			}
		}
		/* 青→黒の光の芯＋外周へグラデーション（フラッシュ） */
		#vignette {
			position: fixed;
			inset: 0;
			pointer-events: none;
			opacity: 0;
			background:
				radial-gradient(
					ellipse 48% 44% at 50% 38%,
					rgba(210, 235, 255, 0.95) 0%,
					rgba(120, 185, 255, 0.55) 32%,
					transparent 58%
				),
				radial-gradient(
					ellipse 78% 72% at 50% 44%,
					rgba(70, 130, 255, 0.5) 0%,
					rgba(25, 55, 130, 0.55) 42%,
					rgba(0, 8, 28, 0.92) 72%,
					rgba(0, 0, 0, 1) 100%
				);
			animation: vignetteIn 0.42s cubic-bezier(0.4, 0, 0.2, 1) forwards;
		}
		@keyframes vignetteIn {
			0% {
				opacity: 0;
				transform: scale(1.18);
				filter: brightness(1.35) saturate(1.35);
			}
			22% {
				opacity: 1;
				filter: brightness(1.85) saturate(1.5);
			}
			52% {
				opacity: 0.55;
				filter: brightness(0.55) saturate(1.1);
			}
			100% {
				opacity: 0;
				transform: scale(0.96);
				filter: brightness(0.15) saturate(0.85);
			}
		}
		/* ブラウン管オフ：水平光（端は青みの黒→中心は青白の光） */
		#tvline {
			position: fixed;
			left: -10%;
			right: -10%;
			top: 50%;
			height: 8px;
			margin-top: -4px;
			pointer-events: none;
			opacity: 0;
			background: linear-gradient(
				90deg,
				rgba(0, 0, 0, 0) 0%,
				rgba(5, 20, 55, 0.95) 22%,
				rgba(90, 160, 255, 0.98) 42%,
				rgba(220, 240, 255, 1) 50%,
				rgba(90, 160, 255, 0.98) 58%,
				rgba(5, 20, 55, 0.95) 78%,
				rgba(0, 0, 0, 0) 100%
			);
			box-shadow:
				0 0 28px 12px rgba(130, 200, 255, 0.85),
				0 0 72px 28px rgba(60, 120, 255, 0.55),
				0 0 120px 48px rgba(20, 60, 160, 0.35);
			animation: tvline 0.42s ease-out 0.14s forwards;
		}
		@keyframes tvline {
			0% {
				opacity: 0;
				transform: scaleY(0.2);
			}
			35% {
				opacity: 1;
				transform: scaleY(1.4);
			}
			100% {
				opacity: 0;
				transform: scaleY(0.05);
			}
		}
		/* 四隅：透明→青みの闇→真っ黒 */
		#vignetteDark {
			position: fixed;
			inset: 0;
			pointer-events: none;
			opacity: 0;
			background: radial-gradient(
				ellipse 96% 96% at 50% 50%,
				transparent 0%,
				transparent 34%,
				rgba(0, 18, 45, 0.45) 58%,
				rgba(0, 0, 0, 0.78) 100%
			);
			animation: vignetteDarkIn 0.5s ease-in 0.1s forwards;
		}
		@keyframes vignetteDarkIn {
			0% {
				opacity: 0;
			}
			100% {
				opacity: 1;
			}
		}
		${
			hostAudioOnlyFlag && cursorDeferAnimationStart
				? `html.pachikas-deferred, html.pachikas-deferred * {
			animation: none !important;
		}`
				: ''
		}
	</style>
</head>
<body>
	${hostAudioOnlyFlag ? '' : `<audio id="pach-a1" preload="auto" src="${sound1Uri}"></audio>
	<audio id="pach-a2" preload="auto" src="${sound2Uri}"></audio>`}
	<div id="iris" aria-hidden="true"></div>
	<div id="vignetteDark" aria-hidden="true"></div>
	<div id="vignette" aria-hidden="true"></div>
	<div id="tvline" aria-hidden="true"></div>
	<div id="scan" aria-hidden="true"></div>
	${hostAudioOnlyFlag
		? cursorDeferAnimationStart
			? `<script>
		(function () {
			var api = acquireVsCodeApi();
			var fallbackMs = ${blackoutReadyFallbackMs};
			function armCursorAnchor() {
				var iris = document.getElementById('iris');
				var fallbackTimer = setTimeout(function () {
					api.postMessage({ type: 'pachinkasCursorVisualFallback' });
				}, fallbackMs);
				if (iris) {
					iris.addEventListener(
						'animationstart',
						function () {
							clearTimeout(fallbackTimer);
							api.postMessage({ type: 'pachinkasCursorVisualReady' });
						},
						{ once: true },
					);
				}
			}
			window.addEventListener('message', function (event) {
				var d = event.data;
				if (d && d.type === 'pachikasStartShow') {
					// 同期で外す（次のマイクロタスクまで遅らせない）
					document.documentElement.classList.remove('pachikas-deferred');
					armCursorAnchor();
				}
			});
			api.postMessage({ type: 'pachikasWebviewReady' });
		})();
	</script>`
			: `<script>
		(function () {
			var api = acquireVsCodeApi();
			var fallbackMs = ${blackoutReadyFallbackMs};
			var iris = document.getElementById('iris');
			var fallbackTimer = setTimeout(function () {
				api.postMessage({ type: 'pachinkasCursorVisualFallback' });
			}, fallbackMs);
			if (iris) {
				iris.addEventListener(
					'animationstart',
					function () {
						clearTimeout(fallbackTimer);
						api.postMessage({ type: 'pachinkasCursorVisualReady' });
					},
					{ once: true },
				);
			}
		})();
	</script>`
		: `<script>
		(function () {
			var api = acquireVsCodeApi();
			function requestHost(where, detail, mode) {
				api.postMessage({
					type: 'pachinkasRequestHostAudio',
					where: where,
					detail: detail != null ? String(detail) : '',
					mode: mode || 'full',
				});
			}
			var holdMs = ${blackoutHoldMs};
			var padMs = ${blackoutPostReadyPadMs};
			var fallbackMs = ${blackoutReadyFallbackMs};
			var a1 = document.getElementById('pach-a1');
			var a2 = document.getElementById('pach-a2');
			var sequenceStarted = false;
			function finish() {
				api.postMessage({ type: 'pachinkasSequenceDone' });
			}
			function whenPlayable(el, run, loadTag) {
				if (!el) {
					run();
					return;
				}
				if (el.readyState >= 2) {
					run();
					return;
				}
				function onOk() {
					el.removeEventListener('error', onErr);
					run();
				}
				function onErr() {
					el.removeEventListener('canplay', onOk);
					var code = el.error ? el.error.code : '';
					var mode = loadTag === 'a2' ? 'second-only' : 'full';
					requestHost('audio-load', 'code:' + code, mode);
				}
				el.addEventListener('canplay', onOk, { once: true });
				el.addEventListener('error', onErr, { once: true });
			}
			function startSequence() {
				if (sequenceStarted) {
					return;
				}
				sequenceStarted = true;
				if (!a1 || !a2) {
					requestHost('no-audio-element', '');
					return;
				}
				setTimeout(function () {
					whenPlayable(
						a1,
						function () {
							a1.play().catch(function (e) {
								requestHost('a1-play', e && e.name ? e.name : String(e), 'full');
							});
						},
						'a1',
					);
				}, padMs);
			}
			if (a1 && a2) {
				a1.addEventListener('ended', function () {
					setTimeout(function () {
						whenPlayable(
							a2,
							function () {
								a2.play().catch(function (e) {
									requestHost('a2-play', e && e.name ? e.name : String(e), 'second-only');
								});
							},
							'a2',
						);
					}, holdMs);
				});
				a2.addEventListener('ended', finish);
			}
			var iris = document.getElementById('iris');
			function onVisualAnchor() {
				requestAnimationFrame(function () {
					requestAnimationFrame(startSequence);
				});
			}
			if (iris) {
				iris.addEventListener('animationstart', onVisualAnchor, { once: true });
			}
			setTimeout(startSequence, fallbackMs);
		})();
	</script>`}
</body>
</html>`;
}
