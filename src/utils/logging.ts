import * as vscode from 'vscode';

export const logger = vscode.window.createOutputChannel(
    "RenderCV - VSCode",
    { log: true }
);

export default logger;