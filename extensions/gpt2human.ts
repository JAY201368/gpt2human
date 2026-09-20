/**
 * gpt2human — automatically refine model responses into clear, human-readable output.
 *
 * Use case: your main model (e.g. gpt-5.6-sol) is powerful but writes like a
 * "silicon intelligence"; a cheaper, better-written model (e.g. deepseek/deepseek-flash)
 * rewrites the final answer for readability.
 *
 * Features:
 *  - Independently configurable refine model (decoupled from the main chat model)
 *  - Several built-in style presets (Humanize / Concise / Friendly / Technical /
 *    Structured) plus a fully custom prompt option
 *  - Shortcut ctrl+shift+r toggles between the original and the refined rendering in place
 *  - /gpt2human command to inspect / change configuration
 *
 * Design note: refinement is display-only. A markdown transformer swaps the rendered
 * text while the original message stays intact in the session and in LLM context, so
 * follow-up questions and code/commands are never corrupted.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Message, TextContent } from "@earendil-works/pi-ai";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Types and presets
// ---------------------------------------------------------------------------

type StyleId = "humanize" | "concise" | "friendly" | "technical" | "structured" | "custom";

interface StylePreset {
	id: StyleId;
	label: string;
	prompt: string;
}

const PRESETS: Record<StyleId, StylePreset> = {
	humanize: {
		id: "humanize",
		label: "Humanize",
		prompt: [
			"You are a plain-language rewriter. Rewrite the provided text so it is easy to understand, concrete, and natural — the way a helpful human expert would explain it to a friend.",
			"",
			"Rules:",
			"- Keep ALL facts, numbers, code, commands, file paths, and technical accuracy exactly intact.",
			"- Replace jargon, buzzwords, and stiff 'AI-speak' with clear everyday wording.",
			"- Remove filler and hedging; be direct.",
			"- Keep the output in the same language as the input (Chinese stays Chinese, English stays English).",
			"- If the output is Chinese: when an English technical term or piece of jargon first appears, append a brief Chinese explanation in parentheses after it (e.g. 'trajectory(agent 完成任务过程中经历的状态、动作及观察/奖励的序列)'). Explain each term only once, at its first occurrence.",
			"- Preserve markdown structure (headings, lists, code blocks) where present.",
			"- Output ONLY the rewritten text. No preamble, no explanation, no surrounding quotes.",
		].join("\n"),
	},
	concise: {
		id: "concise",
		label: "Concise",
		prompt: [
			"Rewrite the provided text to be more concise and scannable.",
			"Remove redundancy and fluff while keeping all essential facts, code, and numbers.",
			"Prefer short sentences and bullet points where they help.",
			"Keep the output in the same language as the input.",
			"Output ONLY the rewritten text.",
		].join("\n"),
	},
	friendly: {
		id: "friendly",
		label: "Friendly",
		prompt: [
			"Rewrite the provided text in a warm, friendly, conversational tone.",
			"Stay professional and accurate, but approachable.",
			"Keep all facts, code, and numbers intact.",
			"Keep the output in the same language as the input.",
			"Output ONLY the rewritten text.",
		].join("\n"),
	},
	technical: {
		id: "technical",
		label: "Technical",
		prompt: [
			"Rewrite the provided text for a technical audience.",
			"Keep precision and terminology, but make the structure clearer and remove unnecessary filler.",
			"Preserve code, commands, and exact identifiers verbatim.",
			"Keep the output in the same language as the input.",
			"Output ONLY the rewritten text.",
		].join("\n"),
	},
	structured: {
		id: "structured",
		label: "Structured",
		prompt: [
			"Rewrite the provided text into a well-structured answer with clear headings, short paragraphs, and bullet/numbered lists where appropriate.",
			"Keep all facts and code intact.",
			"Keep the output in the same language as the input.",
			"Output ONLY the rewritten text.",
		].join("\n"),
	},
	custom: {
		id: "custom",
		label: "Custom",
		prompt: "",
	},
};

const DEFAULT_CUSTOM_TEMPLATE = [
	"Rewrite the text below to be clear, plain-spoken, and natural — the way a helpful human would say it.",
	"Keep all facts, numbers, code, commands, and file paths intact. Replace jargon and 'AI-speak' with everyday language.",
	"Match the input language. Output only the rewritten text, with no explanation.",
	"",
	"Text to rewrite:",
	"{{text}}",
].join("\n");

interface RefineConfig {
	enabled: boolean;
	/** "provider/modelId", e.g. "deepseek/deepseek-flash" */
	model: string;
	style: StyleId;
	customPrompt: string;
	/** Text blocks shorter than this are left untouched (skip "ok"/"sure" fragments). */
	minLength: number;
}

interface RefineRecord {
	original: string;
	refined: string;
}

const DEFAULT_CONFIG: RefineConfig = {
	enabled: true,
	model: "deepseek/deepseek-flash",
	style: "humanize",
	customPrompt: "",
	minLength: 30,
};

// ---------------------------------------------------------------------------
// State and config I/O
// ---------------------------------------------------------------------------

const CONFIG_PATH = join(getAgentDir(), "gpt2human.json");

// original -> refined mapping for the markdown transformer. The message content
// always keeps the original text (context untouched); the transformer only swaps
// the rendered text.
const originalToRefined = new Map<string, string>();
let showOriginal = false;
let pendingRecords: RefineRecord[] = [];
let capturedTui: { invalidate(): void; requestRender(force?: boolean): void } | undefined;
let warnedAboutModel = false;
let config: RefineConfig = loadConfig();

function loadConfig(): RefineConfig {
	try {
		if (existsSync(CONFIG_PATH)) {
			const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<RefineConfig>;
			return { ...DEFAULT_CONFIG, ...raw };
		}
	} catch (error) {
		console.error("[gpt2human] failed to load config:", error);
	}
	return { ...DEFAULT_CONFIG };
}

function saveConfig(): void {
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
	} catch (error) {
		console.error("[gpt2human] failed to save config:", error);
	}
}

function addRecord(original: string, refined: string): void {
	const o = original.trim();
	const r = refined.trim();
	if (!o || !r || o === r) return;
	originalToRefined.set(o, r);
}

function buildRefineRequest(original: string): { systemPrompt?: string; userContent: string } {
	if (config.style === "custom" && config.customPrompt.trim()) {
		if (config.customPrompt.includes("{{text}}")) {
			return { userContent: config.customPrompt.replaceAll("{{text}}", original) };
		}
		return { systemPrompt: config.customPrompt.trim(), userContent: original };
	}
	const preset = PRESETS[config.style] ?? PRESETS.humanize;
	return { systemPrompt: preset.prompt, userContent: original };
}

function forceTranscriptRerender(ctx: ExtensionContext): void {
	if (capturedTui) {
		try {
			capturedTui.invalidate();
			capturedTui.requestRender();
			return;
		} catch {
			/* fall through to fallback */
		}
	}
	// Fallback: setHiddenThinkingLabel rebuilds every assistant message component and triggers a re-render.
	ctx.ui.setHiddenThinkingLabel();
}

function updateStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const text = !config.enabled
		? "gpt2human: off"
		: `gpt2human: ${showOriginal ? "Original" : "Refined"}`;
	// Match the system footer's gray (dim) style. Only the TUI has a theme; other modes fall back to plain text.
	const styled = ctx.mode === "tui" ? ctx.ui.theme.fg("dim", text) : text;
	ctx.ui.setStatus("gpt2human", styled);
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	config = loadConfig();

	// Display-only swap: skip while streaming (avoids flicker / half-written text),
	// only transform finalized assistant text.
	pi.registerMarkdownTransformer((markdown, { messageType, isStreaming }) => {
		if (!config.enabled) return markdown;
		if (messageType !== "assistant" || isStreaming) return markdown;
		// Message content is already the original, so "show original" is a no-op.
		if (showOriginal) return markdown;
		const key = markdown.trim();
		if (!key) return markdown;
		return originalToRefined.get(key) ?? markdown;
	});

	pi.on("session_start", (_event, ctx) => {
		// Rebuild the mapping from persisted custom entries (not part of LLM context).
		originalToRefined.clear();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== "gpt2human") continue;
			const data = entry.data as { records?: RefineRecord[] } | undefined;
			for (const record of data?.records ?? []) {
				if (record && typeof record.original === "string" && typeof record.refined === "string") {
					addRecord(record.original, record.refined);
				}
			}
		}

		// Capture the TUI instance so the shortcut can force a full redraw.
		// The empty component occupies no visible space.
		if (ctx.mode === "tui") {
			ctx.ui.setWidget("gpt2human", (tui) => {
				capturedTui = tui;
				return { render: () => [], invalidate: () => {} };
			});
		}
		updateStatus(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		if (!config.enabled) return;
		// Display-only refinement only makes sense in the interactive TUI.
		if (ctx.mode !== "tui") return;
		if (event.message.role !== "assistant") return;

		// Only refine the final answer; skip tool-calling turns so the agent loop isn't slowed down.
		if (event.message.content.some((c) => c.type === "toolCall")) return;

		const textBlocks = event.message.content.filter(
			(c): c is TextContent => c.type === "text",
		);
		if (textBlocks.length === 0) return;

		ctx.ui.setStatus("gpt2human", ctx.ui.theme.fg("dim", "gpt2human: rewriting"));
		const newRecords: RefineRecord[] = [];

		for (const block of textBlocks) {
			const original = block.text.trim();
			if (original.length < config.minLength) continue;
			if (originalToRefined.has(original)) continue;

			const refined = await refineText(ctx, original);
			if (refined && refined.trim() !== original) {
				addRecord(original, refined);
				newRecords.push({ original, refined });
			}
		}

		ctx.ui.setStatus("gpt2human", undefined);
		updateStatus(ctx);

		if (newRecords.length > 0) {
			pendingRecords.push(...newRecords);
		}
	});

	pi.on("turn_end", () => {
		if (pendingRecords.length === 0) return;
		pi.appendEntry("gpt2human", { records: pendingRecords });
		pendingRecords = [];
	});

	pi.registerShortcut("ctrl+shift+r", {
		description: "Toggle original / refined assistant output",
		handler: async (ctx) => {
			showOriginal = !showOriginal;
			updateStatus(ctx);
			forceTranscriptRerender(ctx);
		},
	});

	pi.registerCommand("gpt2human", {
		description: "Configure gpt2human (readability refinement)",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const parts = trimmed.split(/\s+/).filter(Boolean);
			const sub = parts[0] ?? "";
			const rest = parts.slice(1).join(" ");

			if (!sub) {
				showStatus(ctx);
				return;
			}

			switch (sub) {
				case "on": {
					config.enabled = true;
					saveConfig();
					updateStatus(ctx);
					forceTranscriptRerender(ctx);
					ctx.ui.notify("gpt2human: enabled", "info");
					return;
				}
				case "off": {
					config.enabled = false;
					saveConfig();
					updateStatus(ctx);
					forceTranscriptRerender(ctx);
					ctx.ui.notify("gpt2human: disabled", "info");
					return;
				}
				case "status": {
					showStatus(ctx);
					return;
				}
				case "styles": {
					const lines = Object.values(PRESETS).map(
						(p) => `  ${p.id.padEnd(12)} ${p.label}`,
					);
					ctx.ui.notify(`Presets:\n${lines.join("\n")}`, "info");
					return;
				}
				case "model": {
					if (!rest || !rest.includes("/")) {
						ctx.ui.notify(
							"Usage: /gpt2human model <provider/modelId>\nExample: /gpt2human model deepseek/deepseek-flash",
							"warning",
						);
						return;
					}
					config.model = rest.trim();
					warnedAboutModel = false;
					saveConfig();
					updateStatus(ctx);
					ctx.ui.notify(`gpt2human: refine model → ${config.model}`, "info");
					return;
				}
				case "style": {
					const styleId = rest.trim() as StyleId;
					if (!(styleId in PRESETS)) {
						ctx.ui.notify(
							`Unknown style: ${styleId || "(empty)"}\nRun /gpt2human styles to list presets.`,
							"warning",
						);
						return;
					}
					config.style = styleId;
					saveConfig();
					updateStatus(ctx);
					ctx.ui.notify(`gpt2human: style → ${PRESETS[styleId].label}`, "info");
					return;
				}
				case "custom": {
					if (ctx.hasUI) {
						const current = config.customPrompt || DEFAULT_CUSTOM_TEMPLATE;
						const edited = await ctx.ui.editor("Custom refine prompt ({{text}} = text to rewrite)", current);
						if (edited === undefined) return; // cancelled
						config.customPrompt = edited.trim();
						config.style = "custom";
						saveConfig();
						updateStatus(ctx);
						ctx.ui.notify("gpt2human: custom prompt saved", "info");
						return;
					}
					if (!rest) {
						ctx.ui.notify(
							"Usage: /gpt2human custom <prompt>\nUse {{text}} as the placeholder for the original text.",
							"warning",
						);
						return;
					}
					config.customPrompt = rest.trim();
					config.style = "custom";
					saveConfig();
					updateStatus(ctx);
					ctx.ui.notify("gpt2human: custom prompt saved", "info");
					return;
				}
				default: {
					ctx.ui.notify(
						[
							"Usage: /gpt2human [status|on|off|model|style|styles|custom]",
							"  /gpt2human                    show current config",
							"  /gpt2human on|off             enable / disable",
							"  /gpt2human model <provider/id>  set refine model",
							"  /gpt2human style <preset>     set style preset",
							"  /gpt2human styles             list presets",
							"  /gpt2human custom             edit custom prompt",
							"Shortcut: ctrl+shift+r toggles original / refined.",
						].join("\n"),
						"info",
					);
				}
			}
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function refineText(ctx: ExtensionContext, original: string): Promise<string | undefined> {
	const [provider, ...restParts] = config.model.split("/");
	const modelId = restParts.join("/");
	const model = ctx.modelRegistry.find(provider, modelId);

	if (!model) {
		if (!warnedAboutModel && ctx.hasUI) {
			ctx.ui.notify(`gpt2human: model not found: ${config.model}`, "warning");
			warnedAboutModel = true;
		}
		return undefined;
	}
	if (!ctx.modelRegistry.hasConfiguredAuth(model)) {
		if (!warnedAboutModel && ctx.hasUI) {
			ctx.ui.notify(`gpt2human: no auth configured for ${config.model}`, "warning");
			warnedAboutModel = true;
		}
		return undefined;
	}

	const { systemPrompt, userContent } = buildRefineRequest(original);
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: userContent }],
		timestamp: Date.now(),
	};

	try {
		const response = await ctx.modelRegistry.complete(
			model,
			{ systemPrompt, messages: [userMessage] },
			{ signal: ctx.signal, cacheRetention: "none" },
		);
		const refined = response.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("\n")
			.trim();
		return refined || undefined;
	} catch (error) {
		if (!warnedAboutModel && ctx.hasUI) {
			ctx.ui.notify(
				`gpt2human: refine failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
			warnedAboutModel = true;
		}
		return undefined;
	}
}

function showStatus(ctx: ExtensionContext): void {
	const lines = [
		`Enabled:      ${config.enabled ? "yes" : "no"}`,
		`Refine model: ${config.model}`,
		`Style:        ${PRESETS[config.style]?.label ?? config.style}`,
		`Min length:   ${config.minLength} chars`,
		`Records:      ${originalToRefined.size} mapped`,
	];
	if (config.style === "custom") {
		lines.push("Custom prompt:" + (config.customPrompt ? `\n${config.customPrompt}` : " (empty)"));
	}
	if (ctx.hasUI) {
		ctx.ui.notify(`gpt2human config\n${lines.join("\n")}`, "info");
	} else {
		console.log(lines.join("\n"));
	}
}
