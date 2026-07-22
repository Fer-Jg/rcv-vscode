// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as commands from './commands/global';
import { detectSoftDependencies } from './utils/soft-dependencies';
import SuperCoolSidebarProvider from './sidebar';

// This method is called when your extension is activated
// Your extension is activated the very first time a command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "rendercv-vscode" is now active!');

	detectSoftDependencies();
	
	const installRequirements = vscode.commands.registerCommand('rendercv-vscode.installRequirements', () => {
		commands.installRequirements();
	});

	const newCV = vscode.commands.registerCommand('rendercv-vscode.newCV', () => {
		commands.newCV();
	});

	const sendFeedback = vscode.commands.registerCommand('rendercv-vscode.sendFeedback', () => {
		commands.sendFeedback();
	});

	const previewSidebar = vscode.commands.registerCommand('rendercv-vscode.previewSidebar', (str: string) => {
		commands.previewCvSidebar(str);
	});

	const previewFile = vscode.commands.registerCommand('rendercv-vscode.previewFileAsCV', (uri: vscode.Uri) => {
		commands.previewCvFile(uri);
	});

	const mySidebarProvider = vscode.window.registerWebviewViewProvider(
		SuperCoolSidebarProvider.viewType,
		new SuperCoolSidebarProvider(context.extensionUri)
	);

	context.subscriptions.push(installRequirements, newCV, previewFile, sendFeedback, previewSidebar, mySidebarProvider);
}

// This method is called when your extension is deactivated
export function deactivate() { }
