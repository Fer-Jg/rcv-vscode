import * as vscode from 'vscode';
import { previewFileAsCV } from '../utils/rcv';
import { runPlaceholderWorkflow } from '../utils/devTools';

export function installRequirements() {
    runPlaceholderWorkflow('🚨 WIP Installing requirements WIP 🚨', 
        '🚨 WIP Installation cancelled WIP 🚨', 
        '🚨 WIP Installation is not implemented yet 🚨');
};

export async function previewCvFile(uri: vscode.Uri | string) {
    if (typeof uri !== 'string') {
        uri = uri.fsPath;
    }
    vscode.window.showInformationMessage(`Previewing CV... (WIP) ${uri}`);
    previewFileAsCV(uri);
}