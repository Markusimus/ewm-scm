import * as vscode from 'vscode';
import {statusOut} from './status';
import { StatusDataI, ComponentI, ChangesetI, ChangeI, UnresolvedChangeI}  from './ewmStatusInterface';

export const CONFIGURATION_FILE = '.jsewm';

// function createResourceUri(relativePath: string): vscode.Uri {
//     // const absolutePath = path.join(vscode.workspace.rootPath, relativePath);
//     return vscode.Uri.file(relativePath);
//   }

export class EwmSourceControl implements vscode.Disposable {
	private jsEwmScm: vscode.SourceControl;
    private incommingResources: vscode.SourceControlResourceGroup;
	private outgoingResources: vscode.SourceControlResourceGroup;
	private unresolvedResources: vscode.SourceControlResourceGroup;
	private componentStatus: ComponentI;
	private componentName : string;

    private timeout?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, readonly component: ComponentI, private readonly workspaceFolder: vscode.WorkspaceFolder ) {
		this.componentStatus = component;
		this.jsEwmScm = vscode.scm.createSourceControl('ewm', component.name, workspaceFolder.uri);

        this.incommingResources = this.jsEwmScm.createResourceGroup("incoming", "incoming-changes");
		this.outgoingResources = this.jsEwmScm.createResourceGroup("outgoing", "outgoing-changes");
		this.unresolvedResources = this.jsEwmScm.createResourceGroup("unresolved", "unresolved-changes");

		this.componentName = component.name;
    
        // const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "*.*"));
		// fileSystemWatcher.onDidChange(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidCreate(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidDelete(uri => this.onResourceChange(uri), context.subscriptions);

        context.subscriptions.push(this.jsEwmScm);
        // context.subscriptions.push(fileSystemWatcher);

		this.updateResourceGroups();
    }

	public updateResourceGroups(): void {
		let incommingChanges = this.componentStatus['incoming-changes'];
		let outgoingChanges = this.componentStatus['outgoing-changes'];		
		let unresolvedChanges = this.componentStatus.unresolved;

		// Update incomming changes
		this.incommingResources.resourceStates = [];
		let resourceStates = [];
		for (const changeSet of incommingChanges) {

			for (const change of changeSet.changes) {
				resourceStates.push(this.toSourceControlResourceState(change));
			}
		}
		this.incommingResources.resourceStates = resourceStates;

		// Update outgoing changes
		this.outgoingResources.resourceStates = [];
		resourceStates = [];
		for (const changeSet of outgoingChanges) {
			for (const change of changeSet.changes) {
				resourceStates.push(this.toSourceControlResourceState(change));
			}
		}
		this.outgoingResources.resourceStates = resourceStates;

		// Update unresolved Changes
		this.unresolvedResources.resourceStates = [];
		resourceStates = [];
		if (!!unresolvedChanges) {
			for (const change of unresolvedChanges) {
				resourceStates.push(this.toSourceControlResourceState(change));
			}
			this.unresolvedResources.resourceStates = resourceStates;
		}
	}

    toSourceControlResourceState(change: ChangeI | UnresolvedChangeI ): vscode.SourceControlResourceState {

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

        // const command: vscode.Command = {
        //     title: "Show change",
        //     command: "vscode.diff",
        //     // arguments: ["TBD"],
        //     tooltip: "Diff your changes"
        // };
		let docUri = vscode.Uri.file(change.path);
        
		const resourceState: vscode.SourceControlResourceState = {
			resourceUri: docUri,
			// command: command,
			// decorations: {
			// 	tooltip: 'File was changed.'
			// }
		};

		return resourceState;
	}

    // onResourceChange(_uri: vscode.Uri): void {
	// 	if (this.timeout) { clearTimeout(this.timeout); }
	// 	this.timeout = setTimeout(() => this.tryUpdateChangedGroup(), 500);
	// }

    public tryUpdateChangedGroup( statusData: StatusDataI ) {
		const emptyStatus : ComponentI = {} as ComponentI;
		this.componentStatus = emptyStatus;
		// Find Component in statusData
		for (var component of statusData.workspaces[0].components)
		{
			if (component.name && component.name === this.componentName)
			{
				this.componentStatus = component;
				break;
			}
		}
		this.updateResourceGroups();
	}

    /** This is where the source control determines, which documents were updated, removed, and theoretically added. */
	// async updateChangedGroup(): Promise<void> {
	// 	// for simplicity we ignore which document was changed in this event and scan all of them
	// 	const changedResources: vscode.SourceControlResourceState[] = [];
        
    //     const unresolved = statusOut["workspaces"][0]["components"][0]["unresolved"];
    //     if (unresolved)
    //     {
    //         for (var change of unresolved)
    //         {

    //             const resourceState = this.toSourceControlResourceState( vscode.Uri.file( change["path"] ), false);
    //             changedResources.push(resourceState);
    //             // console.log(change["path"]);
    //         }
	// 		this.incommingResources.resourceStates = changedResources;
    //     }
    
    // }

    dispose() {
		// this._onRepositoryChange.dispose();
		this.jsEwmScm.dispose();
	}
}