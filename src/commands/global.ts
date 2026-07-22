import * as vscode from 'vscode';

export function newCV() {
    vscode.window.showInformationMessage('Creating a new CV... (WIP)');
}

export function installRequirements() {
	vscode.window.showInformationMessage('Installing requirements... (WIP)');
};

export async function previewCvSidebar(str: string) {
    vscode.window.showInformationMessage(`Previewing CV sidebar... (WIP) ${str}`);
}

export async function previewCvFile(uri: vscode.Uri | string) {
    if (typeof uri !== 'string') {
        uri = uri.fsPath;
    }
    vscode.window.showInformationMessage(`Previewing CV... (WIP) ${uri}`);
    console.log(uri);
}

export async function sendFeedback() {
    vscode.window.showInformationMessage(`Sending feedback... (WIP)`);
}