import * as vscode from 'vscode';

export function installRequirements() {
	vscode.window.showInformationMessage('Installing requirements... (WIP)');
};

export async function previewCvFile(uri: vscode.Uri | string) {
    if (typeof uri !== 'string') {
        uri = uri.fsPath;
    }
    vscode.window.showInformationMessage(`Previewing CV... (WIP) ${uri}`);
    console.log(uri);
}