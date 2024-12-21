import * as vscode from 'vscode';
import * as crypto from 'crypto'; // Import the Node.js crypto module
import * as fs from 'fs';
import {statusOut} from './status';
import { StatusDataI, ComponentI, ChangesetI, ChangeI, UnresolvedChangeI}  from './ewmStatusInterface';
import { Ewm } from './ewm';
import os from 'os';

export const CONFIGURATION_FILE = '.jsewm';

export const EWM_SCHEME = 'ewm';

// function createResourceUri(relativePath: string): vscode.Uri {
//     // const absolutePath = path.join(vscode.workspace.rootPath, relativePath);
//     return vscode.Uri.file(relativePath);
//   }

export class EwmSourceControl implements vscode.Disposable, vscode.QuickDiffProvider {
	private jsEwmScm: vscode.SourceControl;
    private incommingResources: vscode.SourceControlResourceGroup;
	private outgoingResources: vscode.SourceControlResourceGroup;
	private unresolvedResources: vscode.SourceControlResourceGroup;
	private componentStatus: ComponentI;
	private componentName : string;
	private rootPath: vscode.Uri;
	private ewm : Ewm;
	// private rootPath: vscode.Uri;

    private timeout?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, readonly component: ComponentI, private readonly workspaceName: string, private readonly workspaceFolder: vscode.WorkspaceFolder, private outputChannel: vscode.OutputChannel ) {
		this.componentStatus = component;
		this.rootPath = vscode.Uri.joinPath(workspaceFolder.uri, component.name);
		this.ewm = new Ewm(this.rootPath, outputChannel);


		this.jsEwmScm = vscode.scm.createSourceControl('ewm', component.name, this.rootPath);

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
		this.jsEwmScm.quickDiffProvider = this;
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

	provideOriginalResource(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.Uri> {
		// converts the local file uri to jsfiddle:file.ext
		// const relativePath = workspace.asRelativePath(uri.fsPath);
		return vscode.Uri.parse(`${EWM_SCHEME}:${uri.fsPath}`);
	}

    toSourceControlResourceState(change: ChangeI | UnresolvedChangeI ): vscode.SourceControlResourceState {

		const changePath = vscode.Uri.parse(change.path);
		const docUri = vscode.Uri.joinPath(this.workspaceFolder.uri, change.path);
		const cancelToken = new vscode.CancellationTokenSource();
		// const fiddlePart = toExtension(docUri).toUpperCase();


		const repositoryUri = this.provideOriginalResource(changePath, cancelToken.token);

		let command : vscode.Command | undefined;
		if (change.state.content_change)
		{
			command = {
				title: "Show changes",
				command: "vscode.diff",
				arguments: [repositoryUri, docUri, `EWM#${docUri.path} ${docUri.path} ↔ Local changes`],
				tooltip: "Diff your changes"
			};
		}
        // const command: vscode.Command = {
        //     title: "Show change",
        //     command: "vscode.diff",
        //     // arguments: ["TBD"],
        //     tooltip: "Diff your changes"
        // };
		
        
		const resourceState: vscode.SourceControlResourceState = {
			resourceUri: docUri,
			command: command
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


/**
 * Provides the content of the JS Fiddle documents as fetched from the server i.e.  without the local edits.
 * This is used for the source control diff.
 */
export class EwmDocumentContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	private loadedFiles = new Map<string, string>(); // this assumes each fiddle is only open once per workspace

	constructor(private ewm: Ewm, private workspaceName: string, private activeWorkspaceFolder: vscode.Uri) { }

	get onDidChange(): vscode.Event<vscode.Uri> {
		return this._onDidChange.event;
	}

	dispose(): void {
		this._onDidChange.dispose();
	}

	/**
	 * Provides the content of a text document for a given URI.
	 *
	 * @param uri - The URI of the text document.
	 * @param token - A cancellation token.
	 * @returns A promise that resolves to the content of the text document, or a string indicating the status.
	 *
	 * This method checks if the document content is already loaded. If so, it returns the cached content.
	 * Otherwise, it retrieves the file from the EWM system, stores it in a temporary directory, reads its content,
	 * caches it, and then returns the content. If the file is not found or an error occurs during the retrieval,
	 * appropriate messages are returned.
	 *
	 * The method also handles cancellation requests and logs various stages of the process for debugging purposes.
	 */
	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		if (token.isCancellationRequested) { return "Canceled"; }

		let relativeUri = uri.path;
		// Check if string starts with activeWorkspaceFolder.
		if (relativeUri.startsWith(this.activeWorkspaceFolder.path)) {
			// Remove activeWorkspaceFolder name from uri.
			relativeUri = '/' + relativeUri.substring(this.activeWorkspaceFolder.path.length + 1);
		}

		console.log(`provideTextDocumentContent uri: ${uri.path}  relativeUri: ${relativeUri}  activeWorkspaceFolder: ${this.activeWorkspaceFolder.path}`);

		// Check if uri is already present in the loadedFiles.
		// If so then return the tempUri.If not then get file from ewm and store it in system tempdir.
		const documentContent = this.loadedFiles.get(relativeUri);
		if (documentContent) {
			console.log(`provideTextDocumentContent using the already loaded file: ${relativeUri}`);
			return documentContent;
		}

		// Remove first folder from the docUri path.
		const docUri = '/' + relativeUri.substring(relativeUri.indexOf('/', 1) + 1);
		// Get first folder name from the relativeUri path.
		const componentName = relativeUri.split('/')[1];

		// Get Temporary directory of the operating system.
		const systemTempDir = vscode.Uri.file(os.tmpdir());
		const tempFileName = crypto.randomBytes(16).toString("hex");
		const tempFileUri = vscode.Uri.joinPath(systemTempDir, tempFileName);
		console.log(`doc uri: ${docUri}  componentName: ${componentName} workspaceName: ${this.workspaceName}`);
		this.ewm.getFile(docUri, componentName, this.workspaceName, tempFileUri).then(() => {
            // Code to execute after the file is downloaded
            console.log(`File ${docUri} has been downloaded to ${tempFileUri.path}`);
			// Check if file exist or not.
			if (!fs.existsSync(tempFileUri.fsPath)) {
				return "Resource not found: " + tempFileUri.toString();
			}

			// Open and read content of the file
			const fileContent = fs.readFileSync(tempFileUri.fsPath, 'utf-8');
			this.loadedFiles.set(relativeUri, fileContent);
			// Remove the temp file after reading the content.
			fs.unlinkSync(tempFileUri.fsPath);
			this._onDidChange.fire(uri);
        }).catch((error) => {
            // Handle any errors that occur during the execution
            console.error(`Failed to download file ${docUri}:`, error);
        });

		return "Downloading file...";
	}
}
