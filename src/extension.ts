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

			// const filePathUri = vscode.Uri.joinPath(rootPath, 'statusExample.json');
			const status = await ewm.getStatus();

			
			if (status) {
				const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(rootPath);

				
				if (activeWorkspaceFolder)
				{
					const workspaceName = status.workspaces[0].name;
					ewmDocumentContentProvider = new EwmDocumentContentProvider(ewm, workspaceName, activeWorkspaceFolder.uri);
					context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(EWM_SCHEME, ewmDocumentContentProvider));

					for(const component of status.workspaces[0].components) {
						ewmSourceControls.push(new EwmSourceControl(context, component, workspaceName, activeWorkspaceFolder, outputChannel));
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
			const ewm = new Ewm(rootPath, outputChannel);
			const status = await ewm.getStatus();
			if (status) {
				for (const ewmSourceControl of ewmSourceControls) {
					ewmSourceControl.tryUpdateChangedGroup(status);
				}
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
