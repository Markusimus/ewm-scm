// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {Model} from './model';
import { EwmDecorations } from './decorationProvider';
// import { StatusDataI, WorkspaceI } from './ewmStatusInterface';
// import { StartupSnapshotCallbackFn } from 'v8';


let rootPath: vscode.Uri | undefined;
const outputChannel = vscode.window.createOutputChannel("EWM");
let initDone = false;
let model: Model;
let ewmDecorations: EwmDecorations;

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
		// await model.initEwm();
		model = new Model(context, outputChannel);
		ewmDecorations = new EwmDecorations(model);
	});
	context.subscriptions.push(disposable);

	// context.subscriptions.push(vscode.commands.registerCommand("ewm-scm.checkin",
	// 	async (...resourceStates: vscode.SourceControlResourceState[]) => {
	// 		if (rootPath) {
				
	// 		}
	// 	}));


	// let autoInit = vscode.workspace.getConfiguration('ewm-scm').get('autoInit', true);

	// if ( rootPath && autoInit && vscode.workspace.getWorkspaceFolder(rootPath)) {
	// 	vscode.commands.executeCommand('ewm-scm.ewmInit');
	// }

	outputChannel.append('Congratulations, your extension "ewm-scm" is now active!\n');
}


// This method is called when your extension is deactivated
export function deactivate() { }
