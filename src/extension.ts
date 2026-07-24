// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as commands from './commands/global';
import { detectSoftDependencies } from './utils/soft-dependencies';
import SuperCoolSidebarProvider from './sidebar';
import * as sidebarActions from './commands/sidebarActions';
import * as rcv from './utils/rcv';
import { registerAutoRender } from './utils/autoRender';

// This method is called when your extension is activated
// Your extension is activated the very first time a command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rendercv-vscode" is now active!');

	detectSoftDependencies();;
	sidebarActions.setExtensionUri(context.extensionUri);

	context.subscriptions.push(
		vscode.commands.registerCommand('rendercv-vscode.previewFileAsCV', commands.previewCvFile),
		vscode.commands.registerCommand('rendercv-vscode.installRequirements', commands.installRequirements),
		vscode.window.registerWebviewViewProvider(
			SuperCoolSidebarProvider.viewType,
			new SuperCoolSidebarProvider(context)
		),
		vscode.commands.registerCommand('rendercv-vscode.newCV', sidebarActions.newCv),
		vscode.commands.registerCommand('rendercv-vscode.sendFeedback', sidebarActions.sendFeedback),
		vscode.commands.registerCommand('rendercv-vscode.previewSidebar', sidebarActions.previewCvSidebar),
		vscode.commands.registerCommand('rendercv-vscode.duplicateCV', sidebarActions.duplicateCV),
		vscode.commands.registerCommand('rendercv-vscode.revealOutputPdf', sidebarActions.revealOutputPdf),
		vscode.commands.registerCommand("rendercv-vscode.newGlobal", sidebarActions.newCvFromGlobal),
		vscode.commands.registerCommand("rendercv-vscode.globalSettings", sidebarActions.openGlobalSettings),
		vscode.commands.registerCommand("rendercv-vscode.extensionLogs", sidebarActions.extensionLogs),
		registerAutoRender()
	);

	rcv.detectRenderCVCliPath(true).then((detected) => {
		context.workspaceState.update("rendercv.hasDetectedCliPath", detected);
	});
}

// This method is called when your extension is deactivated
export function deactivate() { }
