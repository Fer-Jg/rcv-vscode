import * as path from "path";
import * as vscode from "vscode";
import { logger } from "./logging";
import { renderFileAsCV } from "./rcv";

type AutoRenderType = "auto" | "on-save" | "on-click";
type TimerHandle = ReturnType<typeof setTimeout>;
const USE_RENDER_ON_SAVE_ACTION = "Use render on save";
const IGNORE_AUTO_RENDER_ON_EDIT_ACTION = "Ignore";

interface AutoRenderSettings {
	mode: AutoRenderType;
	cooldownMs: number;
}

interface SchedulerState {
	timer?: TimerHandle;
	isRendering: boolean;
	renderAgain: boolean;
}

export interface AutoRenderSchedulerOptions {
	render: (filePath: string) => Promise<unknown>;
	setTimer?: (callback: () => void, delayMs: number) => TimerHandle;
	clearTimer?: (timer: TimerHandle) => void;
	onRenderStart?: (filePath: string) => void;
	onRenderSuccess?: (filePath: string) => void;
	onRenderFailure?: (filePath: string, error: unknown) => void;
}

export class AutoRenderScheduler {
	private readonly render: (filePath: string) => Promise<unknown>;
	private readonly setTimer: (callback: () => void, delayMs: number) => TimerHandle;
	private readonly clearTimer: (timer: TimerHandle) => void;
	private readonly onRenderStart: (filePath: string) => void;
	private readonly onRenderSuccess: (filePath: string) => void;
	private readonly onRenderFailure: (filePath: string, error: unknown) => void;
	private readonly states = new Map<string, SchedulerState>();

	public constructor(options: AutoRenderSchedulerOptions) {
		this.render = options.render;
		this.setTimer = options.setTimer ?? setTimeout;
		this.clearTimer = options.clearTimer ?? clearTimeout;
		this.onRenderStart = options.onRenderStart ?? (() => undefined);
		this.onRenderSuccess = options.onRenderSuccess ?? (() => undefined);
		this.onRenderFailure = options.onRenderFailure ?? (() => undefined);
	}

	public schedule(filePath: string, cooldownMs: number): void {
		const normalizedPath = normalizeFilePath(filePath);
		const state = this.getState(normalizedPath);

		if (state.timer) {
			this.clearTimer(state.timer);
		}

		state.timer = this.setTimer(() => {
			state.timer = undefined;
			void this.renderNow(normalizedPath);
		}, cooldownMs);
	}

	public dispose(): void {
		for (const state of this.states.values()) {
			if (state.timer) {
				this.clearTimer(state.timer);
			}
		}
		this.states.clear();
	}

	private async renderNow(filePath: string): Promise<void> {
		const state = this.getState(filePath);

		if (state.isRendering) {
			state.renderAgain = true;
			return;
		}

		state.isRendering = true;
		do {
			state.renderAgain = false;
			this.onRenderStart(filePath);
			try {
				await this.render(filePath);
				this.onRenderSuccess(filePath);
			} catch (error) {
				this.onRenderFailure(filePath, error);
			}
		} while (state.renderAgain);

		state.isRendering = false;
		if (!state.timer) {
			this.states.delete(filePath);
		}
	}

	private getState(filePath: string): SchedulerState {
		let state = this.states.get(filePath);
		if (!state) {
			state = {
				isRendering: false,
				renderAgain: false,
			};
			this.states.set(filePath, state);
		}
		return state;
	}
}

export function registerAutoRender(): vscode.Disposable {
	return new AutoRenderController();
}

export function isCvYamlFile(filePath: string): boolean {
	const basename = path.basename(filePath).toLowerCase();
	return basename === "cv.yaml" || basename === "cv.yml";
}

class AutoRenderController implements vscode.Disposable {
	private readonly disposables: vscode.Disposable[] = [];
	private readonly renderDisposables: vscode.Disposable[] = [];
	private readonly scheduler = new AutoRenderScheduler({
		render: renderFileAsCV,
		onRenderStart: (filePath) => logger.info(`Auto-rendering CV: ${filePath}`),
		onRenderSuccess: (filePath) => logger.info(`Auto-rendered CV: ${filePath}`),
		onRenderFailure: (filePath, error) => {
			logger.error(`Failed to auto-render CV ${filePath}: ${error}`);
			vscode.window.showErrorMessage(`Failed to auto-render CV: ${error}`);
		},
	});
	private settings = getAutoRenderSettings();

	public constructor() {
		this.rebuildListeners();
		this.disposables.push(vscode.workspace.onDidChangeConfiguration(event => {
			if (!event.affectsConfiguration("rendercv-vscode.autoRenderType")
				&& !event.affectsConfiguration("rendercv-vscode.autoRenderCooldown")) {
				return;
			}

			this.settings = getAutoRenderSettings();
			this.scheduler.dispose();
			this.rebuildListeners();
		}));
	}

	public dispose(): void {
		this.scheduler.dispose();
		this.disposeRenderListeners();
		while (this.disposables.length > 0) {
			this.disposables.pop()?.dispose();
		}
	}

	private rebuildListeners(): void {
		this.disposeRenderListeners();
		if (this.settings.mode === "on-click") {
			logger.info("Auto-render is disabled.");
			return;
		}

		if (this.settings.mode === "auto") {
			this.renderDisposables.push(vscode.workspace.onDidChangeTextDocument(event => {
				this.scheduleDocument(event.document);
			}));
			logger.info(`Auto-render is watching CV changes with ${this.settings.cooldownMs}ms cooldown.`);
			return;
		}

		this.renderDisposables.push(vscode.workspace.onDidSaveTextDocument(document => {
			this.scheduleDocument(document);
		}));
		logger.info(`Auto-render is watching CV saves with ${this.settings.cooldownMs}ms cooldown.`);
	}

	private disposeRenderListeners(): void {
		while (this.renderDisposables.length > 0) {
			this.renderDisposables.pop()?.dispose();
		}
	}

	private scheduleDocument(document: vscode.TextDocument): void {
		if (document.uri.scheme !== "file" || !isCvYamlFile(document.uri.fsPath)) {
			return;
		}

		if (this.settings.mode === "auto") {
			void warnAutoRenderOnEditTemporarilyDisabled(document.uri.fsPath);
			return;
		}

		this.scheduler.schedule(document.uri.fsPath, this.settings.cooldownMs);
	}
}

export async function warnAutoRenderOnEditTemporarilyDisabled(filePath: string): Promise<void> {
	logger.warn(`The "auto-render on edit" feature is a work in progress. Skipped auto-render for ${filePath}.`);
	const selection = await vscode.window.showWarningMessage(
		"The \"auto-render on edit\" feature is a work in progress, so this CV was not rendered. You can switch to render on save instead.",
		USE_RENDER_ON_SAVE_ACTION,
		IGNORE_AUTO_RENDER_ON_EDIT_ACTION
	);

	if (selection !== USE_RENDER_ON_SAVE_ACTION) {
		return;
	}

	await vscode.workspace
		.getConfiguration("rendercv-vscode")
		.update("autoRenderType", "on-save", vscode.ConfigurationTarget.Workspace);
}

function getAutoRenderSettings(): AutoRenderSettings {
	const config = vscode.workspace.getConfiguration("rendercv-vscode");
	const configuredMode = config.get<string>("autoRenderType", "auto");

	return {
		mode: isAutoRenderType(configuredMode) ? configuredMode : "auto",
		cooldownMs: normalizeCooldown(config.get<number>("autoRenderCooldown", 400)),
	};
}

function isAutoRenderType(value: string): value is AutoRenderType {
	return value === "auto" || value === "on-save" || value === "on-click";
}

function normalizeCooldown(value: number): number {
	if (!Number.isFinite(value) || value < 0) {
		return 400;
	}
	return value;
}

function normalizeFilePath(filePath: string): string {
	return process.platform === "win32" ? filePath.toLowerCase() : filePath;
}
