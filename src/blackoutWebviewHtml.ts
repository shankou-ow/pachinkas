/**
 * エディタ暗転 Webview の HTML。音声は拡張ホスト（`play-sound`）で再生し、ここは映像のみ。
 */

export function buildBlackoutPanelCsp(_cspSource: string): string {
	return [
		"default-src 'none'",
		"style-src 'unsafe-inline'",
		"script-src 'unsafe-inline'",
	].join('; ');
}

export type BlackoutPanelHtmlParams = {
	csp: string;
	/** 映像の `--pach-audio-lead`。ホスト音声開始との粗い合わせ（ms） */
	syncAnimDelayMs: number;
};

export function getBlackoutPanelHtml(params: BlackoutPanelHtmlParams): string {
	const { csp, syncAnimDelayMs } = params;
	return `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8" />
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<title></title>
	<style>
		html {
			--pach-audio-lead: ${syncAnimDelayMs}ms;
		}
		html, body {
			margin: 0;
			padding: 0;
			width: 100%;
			height: 100%;
			overflow: hidden;
			background: #000;
			animation: screenShake 0.32s steps(2, end) forwards;
			animation-delay: var(--pach-audio-lead);
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
		#iris {
			position: fixed;
			inset: 0;
			background: #000;
			clip-path: circle(0 at 50% 50%);
			animation: irisSwallow 0.32s cubic-bezier(0.72, 0, 0.9, 0.35) forwards;
			animation-delay: var(--pach-audio-lead);
			will-change: clip-path;
		}
		@keyframes irisSwallow {
			to {
				clip-path: circle(200vmax at 50% 50%);
			}
		}
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
			animation-delay: var(--pach-audio-lead);
		}
		@keyframes scanIn {
			0% { opacity: 0; }
			10% { opacity: 0.9; }
			16% { opacity: 0.35; }
			22% { opacity: 0.88; }
			100% { opacity: 0.38; }
		}
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
			animation-delay: var(--pach-audio-lead);
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
			animation: tvline 0.42s ease-out forwards;
			animation-delay: calc(var(--pach-audio-lead) + 0.14s);
		}
		@keyframes tvline {
			0% { opacity: 0; transform: scaleY(0.2); }
			35% { opacity: 1; transform: scaleY(1.4); }
			100% { opacity: 0; transform: scaleY(0.05); }
		}
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
			animation: vignetteDarkIn 0.5s ease-in forwards;
			animation-delay: calc(var(--pach-audio-lead) + 0.1s);
		}
		@keyframes vignetteDarkIn {
			0% { opacity: 0; }
			100% { opacity: 1; }
		}
	</style>
</head>
<body>
	<div id="iris" aria-hidden="true"></div>
	<div id="vignetteDark" aria-hidden="true"></div>
	<div id="vignette" aria-hidden="true"></div>
	<div id="tvline" aria-hidden="true"></div>
	<div id="scan" aria-hidden="true"></div>
	<script>
		(function () {
			var api;
			try {
				api = acquireVsCodeApi();
			} catch (e) {
				api = null;
			}
			var sent = false;
			function trySend() {
				if (sent || !api) {
					return;
				}
				try {
					api.postMessage({ type: 'pachikasPaintReady' });
					sent = true;
				} catch (e) {}
			}
			function afterFrames() {
				requestAnimationFrame(function () {
					requestAnimationFrame(function () {
						requestAnimationFrame(trySend);
					});
				});
			}
			// 拡張からの pachikasArm（複数回）で起動。reveal 直後は未ロードのことがあるため。
			window.addEventListener('message', function (event) {
				var d = event.data;
				if (d && d.type === 'pachikasArm') {
					afterFrames();
				}
			});
			if (document.readyState === 'complete') {
				afterFrames();
			} else {
				window.addEventListener('load', afterFrames);
			}
			var n = 0;
			var tick = setInterval(function () {
				if (sent || n++ >= 24) {
					clearInterval(tick);
					return;
				}
				trySend();
			}, 80);
		})();
	</script>
</body>
</html>`;
}
