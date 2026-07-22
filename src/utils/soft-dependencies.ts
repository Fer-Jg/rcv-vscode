import * as vscode from 'vscode';
import logger from './logging';

export function detectSoftDependencies() {
    const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");
    
    logger.info("Checking for soft dependencies...");

    if (yamlExtension) {
        logger.info("YAML extension is installed - Good :)");
    } else {
        logger.warn("YAML extension is not installed - Bad :(");
        
        vscode.window.showWarningMessage("YAML preview extension is not installed, it is recommended to have it for a better experience.", "View in Marketplace", "Dismiss").then(selection => {
            if (selection === "View in Marketplace") {
                // Lead the user to the extension marketplace to let them install the YAML extension by themselves
                vscode.commands.executeCommand("extension.open", "redhat.vscode-yaml");
            }
            if (selection === "Dismiss") {
                vscode.window.showInformationMessage("You can install the YAML extension later from the Extensions view.");
            }
        });
    }
}