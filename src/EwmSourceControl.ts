import * as vscode from 'vscode';
import {statusOut} from './status';

export const CONFIGURATION_FILE = '.jsewm';

// function createResourceUri(relativePath: string): vscode.Uri {
//     // const absolutePath = path.join(vscode.workspace.rootPath, relativePath);
//     return vscode.Uri.file(relativePath);
//   }

export class EwmSourceControl implements vscode.Disposable {
	private jsEwmScm: vscode.SourceControl;
    private incommingResources: vscode.SourceControlResourceGroup;
    private timeout?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, private readonly workspaceFolder: vscode.WorkspaceFolder) {
		this.jsEwmScm = vscode.scm.createSourceControl('ewm', 'EWM #7.02', workspaceFolder.uri);
        this.incommingResources = this.jsEwmScm.createResourceGroup("incoming","incoming-changes");
    

        const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "*.*"));
		fileSystemWatcher.onDidChange(uri => this.onResourceChange(uri), context.subscriptions);
		fileSystemWatcher.onDidCreate(uri => this.onResourceChange(uri), context.subscriptions);
		fileSystemWatcher.onDidDelete(uri => this.onResourceChange(uri), context.subscriptions);


        context.subscriptions.push(this.jsEwmScm);
        context.subscriptions.push(fileSystemWatcher);
    }

    toSourceControlResourceState(docUri: vscode.Uri, deleted: boolean): vscode.SourceControlResourceState {

		// const repositoryUri = this.fiddleRepository.provideOriginalResource(docUri, null);
		// const fiddlePart = toExtension(docUri).toUpperCase();

		// const command: vscode.Command = !deleted
		// 	? {
		// 		title: "Show changes",
		// 		command: "vscode.diff",
		// 		arguments: [repositoryUri, docUri, `JSFiddle#${this.fiddle.slug} ${fiddlePart} ↔ Local changes`],
		// 		tooltip: "Diff your changes"
		// 	}
		// 	: null;

        const command: vscode.Command = {
            title: "Show change",
            command: "vscode.diff",
            // arguments: ["TBD"],
            tooltip: "Diff your changes"
        };

		const resourceState: vscode.SourceControlResourceState = {
			resourceUri: docUri,
			command: command,
			decorations: {
				tooltip: 'File was changed.'
			}
		};

		return resourceState;
	}

    onResourceChange(_uri: vscode.Uri): void {
		if (this.timeout) { clearTimeout(this.timeout); }
		this.timeout = setTimeout(() => this.tryUpdateChangedGroup(), 500);
	}

    async tryUpdateChangedGroup(): Promise<void> {
		try {
			await this.updateChangedGroup();
		}
		catch (ex) {
			vscode.window.showErrorMessage((<Error>ex).message);
		}
	}

    /** This is where the source control determines, which documents were updated, removed, and theoretically added. */
	async updateChangedGroup(): Promise<void> {
		// for simplicity we ignore which document was changed in this event and scan all of them
		const changedResources: vscode.SourceControlResourceState[] = [];
        
        const unresolved = statusOut["workspaces"][0]["components"][0]["unresolved"];
        if (unresolved)
        {
            for (var change of unresolved)
            {

                const resourceState = this.toSourceControlResourceState( vscode.Uri.file( change["path"] ), false);
                changedResources.push(resourceState);
                // console.log(change["path"]);
            }
			this.incommingResources.resourceStates = changedResources;
        }
    
    }

    loadData()
    {
        const changedResources: vscode.SourceControlResourceState[] = [];

        
        
    }

    dispose() {
		// this._onRepositoryChange.dispose();
		this.jsEwmScm.dispose();
	}
}