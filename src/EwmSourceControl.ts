import * as vscode from 'vscode';
import * as crypto from 'crypto'; // Import the Node.js crypto module
import * as fs from 'fs';
import {statusOut} from './status';
import { StatusDataI, ComponentI, ChangesetI, ChangeI, UnresolvedChangeI}  from './ewmStatusInterface';
import { EwmShareI } from './ewmSandboxInterface';
import { Ewm } from './ewm';
import os from 'os';

export const CONFIGURATION_FILE = '.jsewm';
export const EWM_SCHEME = 'ewm';


export class EwmSourceControl implements vscode.Disposable, vscode.QuickDiffProvider {
	private jsEwmScm: vscode.SourceControl;
    private incommingResources: vscode.SourceControlResourceGroup;
	private outgoingResources: vscode.SourceControlResourceGroup;
	private unresolvedResources: vscode.SourceControlResourceGroup;
	private componentName : string;
	private workspaceName: string;
	private componentRootUri: vscode.Uri;
	private ewm : Ewm;
	// private rootPath: vscode.Uri;

    private timeout?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, ewmShare: EwmShareI, outputChannel: vscode.OutputChannel) {
		// readonly component: ComponentI, private readonly workspaceName: string, private readonly workspaceFolder: vscode.WorkspaceFolder, private outputChannel: vscode.OutputChannel ) {
		
		this.componentName = ewmShare.remote.component.name;
		this.componentRootUri = vscode.Uri.file(ewmShare.local);
		this.workspaceName = ewmShare.remote.workspace.name;

		// this.rootPath = vscode.Uri.joinPath(workspaceFolder.uri, component.name);
		this.ewm = new Ewm(this.componentRootUri, outputChannel);


		this.jsEwmScm = vscode.scm.createSourceControl('ewm', this.componentName, this.componentRootUri);

        this.incommingResources = this.jsEwmScm.createResourceGroup("incoming", "incoming-changes");
		this.outgoingResources = this.jsEwmScm.createResourceGroup("outgoing", "outgoing-changes");
		this.unresolvedResources = this.jsEwmScm.createResourceGroup("unresolved", "unresolved-changes");
    
        // const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "*.*"));
		// fileSystemWatcher.onDidChange(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidCreate(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidDelete(uri => this.onResourceChange(uri), context.subscriptions);

        context.subscriptions.push(this.jsEwmScm);
        // context.subscriptions.push(fileSystemWatcher);

		this.jsEwmScm.quickDiffProvider = this;
    }

	public async updateResourceGroups(): Promise<void> {

		const workspaceStatus : StatusDataI | null = await this.ewm.getStatus();
		let componentsStatus : ComponentI[] = [] as ComponentI[];
		let componentStatus : ComponentI = {} as ComponentI;

		if (workspaceStatus) {
			// Find workspace in statusData
			for (var workspace of workspaceStatus.workspaces)
			{
				if (workspace.name && workspace.name === this.workspaceName)
				{
					componentsStatus = workspace.components;
					break;
				}
			}

			// Find Component in componentsStatus
			for (var _componentStatus of componentsStatus)
			{
				if (_componentStatus.name && _componentStatus.name === this.componentName)
				{
					componentStatus = _componentStatus;
					break;
				}
			}

			let incommingChanges = componentStatus['incoming-changes'];
			let outgoingChanges = componentStatus['outgoing-changes'];		
			let unresolvedChanges = componentStatus.unresolved;

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
	}

	provideOriginalResource(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.Uri> {
		// Convert to EWM resource uri.
		return vscode.Uri.parse(`${EWM_SCHEME}:${uri.path}`);
	}

    toSourceControlResourceState(change: ChangeI | UnresolvedChangeI ): vscode.SourceControlResourceState {

		const repositoryFileUri = vscode.Uri.file(change.path);
		let repositoryFilePathStripped = change.path;
		// Remove first folder from repositoryFilePath path.
		if ( repositoryFilePathStripped.startsWith( '/' + this.workspaceName ) )
		{
			repositoryFilePathStripped = repositoryFilePathStripped.substring(this.workspaceName.length +1);
		}

		if ( repositoryFilePathStripped.startsWith( '/' + this.componentName ) )
		{
			repositoryFilePathStripped = repositoryFilePathStripped.substring(this.componentName.length +1);
		}

		// const repositoryFilePathWithoutComponent = repositoryFilePath.fsPath.substring( repositoryFilePath.path.indexOf('/', 1) );

		const localFileUri = vscode.Uri.joinPath(this.componentRootUri, repositoryFilePathStripped);
		const cancelToken = new vscode.CancellationTokenSource();
		const repositoryUri = this.provideOriginalResource(repositoryFileUri, cancelToken.token);
		
		let command : vscode.Command | undefined;
		if (change.state.content_change)
		{
			// use last filename as title
			let title = repositoryFilePathStripped.split('/').pop();
			
			command = {
				title: "Show changes",
				command: "vscode.diff",
				arguments: [repositoryUri, localFileUri, title],
				tooltip: "Diff your changes"
			};
		}
	        
		const resourceState: vscode.SourceControlResourceState = {
			resourceUri: localFileUri,
			command: command,
			decorations: {
				tooltip: 'File was changed.'
			}
		};

		return resourceState;
	}

    // onResourceChange(_uri: vscode.Uri): void {
	// 	if (this.timeout) { clearTimeout(this.timeout); }
	// 	this.timeout = setTimeout(() => this.tryUpdateChangedGroup(), 500);
	// }

    // public tryUpdateChangedGroup( statusData: StatusDataI ) {
	// 	const emptyStatus : ComponentI = {} as ComponentI;
	// 	this.componentStatus = emptyStatus;
	// 	// Find Component in statusData
	// 	for (var component of statusData.workspaces[0].components)
	// 	{
	// 		if (component.name && component.name === this.componentName)
	// 		{
	// 			this.componentStatus = component;
	// 			break;
	// 		}
	// 	}
	// 	this.updateResourceGroups();
	// }

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
			relativeUri = relativeUri.substring(this.activeWorkspaceFolder.path.length);
		}

		// Check if starting with workspace name
		// TODO: Move to the toSourceControlResourceState.
		if (relativeUri.startsWith( '/' + this.workspaceName ))
		{
			relativeUri = relativeUri.substring(this.workspaceName.length + 1 );
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
		const docUri = relativeUri.substring( relativeUri.indexOf('/', 1) );
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
