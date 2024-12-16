// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EwmSourceControl } from './EwmSourceControl';
import { Ewm } from './ewm';

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

	const ewm = new Ewm(context, outputChannel);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	outputChannel.append('Congratulations, your extension "ewm-scm" is now active!\n');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('ewm-scm.ewmInit', async () => {
		// The code you place here will be executed every time your command is executed
		
		// let sandBoxJason = await ewm.getSandbox();

		// Check if rootPath is in the sandBox directory.
		// if (rootPath && sandBoxJason && vscode.Uri.file(sandBoxJason.sandbox).toString().includes(rootPath.toString())) {

		if (rootPath) {
			// const filePathUri = vscode.Uri.joinPath(rootPath, 'statusExample.json');
			const status = await ewm.getStatus();

			
			if (status) {
				const activeWorkspaceFolder = vscode.workspace.getWorkspaceFolder(rootPath);
				if (activeWorkspaceFolder)
				{
					for(const component of status.workspaces[0].components) {
						ewmSourceControls.push(new EwmSourceControl(context, component, activeWorkspaceFolder));
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
