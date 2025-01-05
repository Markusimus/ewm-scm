// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
// import * as vscode from 'vscode';
import {ExtensionContext, Uri, window, Disposable, workspace, commands} from "vscode";
import {Model} from './model';
import { EwmDecorations } from './decorationProvider';
// import { StatusDataI, WorkspaceI } from './ewmStatusInterface';
// import { StartupSnapshotCallbackFn } from 'v8';
import { CommandCenter } from "./commands";
import { Ewm } from './ewm';

export async function _activate(context: ExtensionContext): Promise<void> {
	const disposables: Disposable[] = [];
	context.subscriptions.push(new Disposable(() => Disposable.from(...disposables).dispose()));

	const outputChannel = window.createOutputChannel("EWM");
	disposables.push(outputChannel);

	// Retrieve the 'showOutput' configuration setting from the 'ewm-scm' section
	const showOutput = workspace.getConfiguration('ewm-scm').get('showOutput', true);
	if (showOutput) {
		outputChannel.show();
	}

	const rootPath =
	workspace.workspaceFolders && workspace.workspaceFolders.length > 0
		? workspace.workspaceFolders[0].uri
		: undefined;

	if (rootPath)
	{
		const model = new Model(context, outputChannel);
		disposables.push(model);

		const ewmDecorations = new EwmDecorations(model);
		disposables.push(ewmDecorations);

		const ewm = new Ewm(rootPath, outputChannel);
		const cc = new CommandCenter(ewm, model, context.globalState, outputChannel);
		disposables.push(cc);

		const onRepository = () => commands.executeCommand('setContext', 'gitOpenRepositoryCount', `${model.repositories.length}`);
		model.onDidOpenRepository(onRepository, null, disposables);
		model.onDidCloseRepository(onRepository, null, disposables);
		onRepository();
	}

	outputChannel.appendLine('Congratulations, your extension "ewm-scm" is now active!\n');
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: ExtensionContext) {

	// vscode.commands.registerCommand("ewm-scm.showOutput", () => outputChannel.show());
	// context.subscriptions.push(outputChannel);

	await _activate(context);

	// const disposable = vscode.commands.registerCommand('ewm-scm.ewmInit', async () => {
	// 	// await model.initEwm();
	// 	if (rootPath)
	// 	{
	// 		model = new Model(context, outputChannel);
	// 		ewmDecorations = new EwmDecorations(model);
	// 		const ewm = new Ewm(rootPath, outputChannel);
	// 		const cc = new CommandCenter(ewm, model, context.globalState, outputChannel);
	// 		context.subscriptions.push(cc);
	// 	}
	// });
	// context.subscriptions.push(disposable);

	// context.subscriptions.push(vscode.commands.registerCommand("ewm-scm.checkin",
	// 	async (...resourceStates: vscode.SourceControlResourceState[]) => {
	// 		if (rootPath) {
				
	// 		}
	// 	}));


	// let autoInit = vscode.workspace.getConfiguration('ewm-scm').get('autoInit', true);

	// if ( rootPath && autoInit && vscode.workspace.getWorkspaceFolder(rootPath)) {
	// 	vscode.commands.executeCommand('ewm-scm.ewmInit');
	// }
}


// This method is called when your extension is deactivated
export function deactivate() { }
