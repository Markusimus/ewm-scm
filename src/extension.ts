// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EwmRepository, EwmDocumentContentProvider, EWM_SCHEME } from './ewmSourceControl';
import { Ewm } from './ewm';
// import { StatusDataI, WorkspaceI } from './ewmStatusInterface';
// import { StartupSnapshotCallbackFn } from 'v8';

let ewmDocumentContentProvider: EwmDocumentContentProvider;
let rootPath: vscode.Uri | undefined;
let ewmSourceControls: Map<string, EwmRepository> = new Map();
const outputChannel = vscode.window.createOutputChannel("EWM");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	vscode.commands.registerCommand("ewm-scm.showOutput", () => outputChannel.show());
	context.subscriptions.push(outputChannel);

	const showOutput = vscode.workspace.getConfiguration('ewm-scm').get('showOutput', true);
	if (showOutput) {
		outputChannel.show();
	}

	rootPath =
		vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
			? vscode.workspace.workspaceFolders[0].uri
			: undefined;

	const disposable = vscode.commands.registerCommand('ewm-scm.ewmInit', async () => {
		await initEwm(context);
	});
	context.subscriptions.push(disposable);

	const disposableUpdate = vscode.commands.registerCommand('ewm-scm.ewmUpdate', async () => {
		if (rootPath) {
			for (const [componentName, ewmSourceControl] of ewmSourceControls.entries()) {
				await ewmSourceControl.status();
			}
		} else {
			vscode.window.showWarningMessage('No workspace open');
		}
	});
	context.subscriptions.push(disposableUpdate);

	// context.subscriptions.push(vscode.commands.registerCommand("ewm-scm.checkin",
	// 	async (...resourceStates: vscode.SourceControlResourceState[]) => {
	// 		if (rootPath) {
				
	// 		}
	// 	}));

	let autoInit = vscode.workspace.getConfiguration('ewm-scm').get('autoInit', true);

	if (rootPath && autoInit && vscode.workspace.getWorkspaceFolder(rootPath)) {
		initEwm(context);
	}

	outputChannel.append('Congratulations, your extension "ewm-scm" is now active!\n');
}

async function initEwm(context: vscode.ExtensionContext) {

	if (rootPath) {
		const ewm = new Ewm(rootPath, outputChannel);
		const sandbox = await ewm.getSandbox();

		// Go through the sandbox and init components.
		if (sandbox) {
			const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(rootPath);
			if (activeWorkspaceFolder) {
				ewmDocumentContentProvider = new EwmDocumentContentProvider(ewm, sandbox.shares[0].remote.workspace.name, activeWorkspaceFolder.uri);
				context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EWM_SCHEME, ewmDocumentContentProvider));

				for (const sandboxShare of sandbox.shares) {
					const ewmSourceControl = new EwmRepository(context, sandboxShare, outputChannel);
					await ewmSourceControl.status();
					// ewmSourceControls.push(ewmSourceControl);
					ewmSourceControls.set(sandboxShare.remote.component.name, ewmSourceControl);
				}
			}

			// Display a message box to the user
			vscode.window.showInformationMessage('The EWM is initialized.');
		}
		else {
			vscode.window.showWarningMessage('No EWM sandbox found');
		}
	} else {
		vscode.window.showWarningMessage('No workspace open');
	}

}

// This method is called when your extension is deactivated
export function deactivate() { }
