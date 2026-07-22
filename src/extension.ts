// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as commands from './commands/global';
import { detectSoftDependencies } from './utils/soft-dependencies';
import SuperCoolSidebarProvider from './sidebar';
import * as sidebarActions from './commands/sidebarActions';

// This method is called when your extension is activated
// Your extension is activated the very first time a command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rendercv-vscode" is now active!');

	detectSoftDependencies();;

	context.subscriptions.push(
		vscode.commands.registerCommand('rendercv-vscode.installRequirements', commands.installRequirements), vscode.commands.registerCommand('rendercv-vscode.newCV', commands.newCV),
		vscode.commands.registerCommand('rendercv-vscode.previewFileAsCV', commands.previewCvFile),
		vscode.commands.registerCommand('rendercv-vscode.sendFeedback', commands.sendFeedback),
		vscode.commands.registerCommand('rendercv-vscode.previewSidebar', commands.previewCvSidebar),
		vscode.window.registerWebviewViewProvider(
			SuperCoolSidebarProvider.viewType,
			new SuperCoolSidebarProvider(context.extensionUri)
		),
		vscode.commands.registerCommand("rendercv-vscode.newGlobal", sidebarActions.newGlobal),
		vscode.commands.registerCommand("rendercv-vscode.globalSettings", sidebarActions.openGlobalSettings)
	);
}

// This method is called when your extension is deactivated
export function deactivate() { }
