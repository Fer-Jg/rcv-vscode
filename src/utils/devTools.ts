import * as vscode from 'vscode';
import { logger } from './logging';

export function temporaryNotification(message: string, duration: number = 3000) {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: true,
        },
        async () => {
            await new Promise(resolve => setTimeout(resolve, duration));
        }
    );
}

export function runPlaceholderWorkflow(startMessage: string, cancelledMessage: string, completedMessage: string) {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: startMessage,
            cancellable: true,
        },
        async (_progress, token) => {
            logger.info(startMessage);
            logger.info("Starting simulated workflow execution...");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("1 second delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("2 seconds delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("3 seconds delay completed.");
            await new Promise(resolve => setTimeout(resolve, 1000));
            logger.info("Workflow simulation completed.");

            if (token.isCancellationRequested) {
                temporaryNotification(cancelledMessage);
                return;
            }

            temporaryNotification(completedMessage, 3000);
        }
    );
}