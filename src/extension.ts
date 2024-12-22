// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EwmSourceControl, EwmDocumentContentProvider, EWM_SCHEME } from './EwmSourceControl';
import { Ewm } from './ewm';

let ewmDocumentContentProvider: EwmDocumentContentProvider;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {


	const outputChannel = vscode.window.createOutputChannel("EWM");
	vscode.commands.registerCommand("ewm-scm.showOutput", () => outputChannel.show());
	context.subscriptions.push(outputChannel);
	let ewmSourceControls: EwmSourceControl[] = [];

  	const showOutput = true; // configuration.get<boolean>("showOutput");

  	if (showOutput) {
    	outputChannel.show();
  	}

	const rootPath =
	vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
		? vscode.workspace.workspaceFolders[0].uri
		: undefined;

	outputChannel.append('Congratulations, your extension "ewm-scm" is now active!\n');

	const disposable = vscode.commands.registerCommand('ewm-scm.ewmInit', async () => {
		// The code you place here will be executed every time your command is executed
		if (rootPath) {
			const ewm = new Ewm(rootPath, outputChannel);
			const sandbox = await ewm.getSandbox();

			// Go through the sandbox and init components.
			if (sandbox) {
				const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(rootPath);
				if (activeWorkspaceFolder)
				{
					ewmDocumentContentProvider = new EwmDocumentContentProvider(ewm, sandbox.shares[0].remote.workspace.name, activeWorkspaceFolder.uri);
					context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EWM_SCHEME, ewmDocumentContentProvider));

					for (const sandboxShare of sandbox.shares) {
						const ewmSourceControl = new EwmSourceControl(context, sandboxShare, outputChannel);
						await ewmSourceControl.updateResourceGroups();
						ewmSourceControls.push(ewmSourceControl);
					}
				}
			}
		} else {
			vscode.window.showWarningMessage('No workspace open');
		}

		// Display a message box to the user
		vscode.window.showInformationMessage('The EWM is initialized.');

	});
	context.subscriptions.push(disposable);

	const disposableUpdate = vscode.commands.registerCommand('ewm-scm.ewmUpdate', async () => {
		if (rootPath) {
			for (const ewmSourceControl of ewmSourceControls) {
				await ewmSourceControl.updateResourceGroups();
			}
		} else {
			vscode.window.showWarningMessage('No workspace open');
		}

	});
	context.subscriptions.push(disposableUpdate);

	// if (vscode.window.activeTextEditor) {
	// 	const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
	// 	if (activeWorkspaceFolder)
	// 	{
	// 		const ewmSourceControl = new EwmSourceControl(context, activeWorkspaceFolder);
	// 	}
	// }
}

// This method is called when your extension is deactivated
export function deactivate() {}
