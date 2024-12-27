import * as vscode from 'vscode';
import * as crypto from 'crypto'; // Import the Node.js crypto module
import * as fs from 'fs';
import {statusOut} from './status';
import { StatusDataI, ComponentI, ChangesetI, ChangeI, UnresolvedChangeI, WorkspaceI}  from './ewmStatusInterface';
import { EwmShareI } from './ewmSandboxInterface';
import { Ewm } from './ewm';
import os from 'os';
import { debounce, memoize, throttle } from './decorators';
import { Uri } from 'vscode';

export const CONFIGURATION_FILE = '.jsewm';
export const EWM_SCHEME = 'ewm';

export const enum Status {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED
}

export class EwmSourceControl implements vscode.Disposable, vscode.QuickDiffProvider {
	private jsEwmScm: vscode.SourceControl;
    private incommingResources: vscode.SourceControlResourceGroup;
	private outgoingResources: vscode.SourceControlResourceGroup;
	private unresolvedResources: vscode.SourceControlResourceGroup;
	private componentName : string;
	private workspaceName: string;
	private componentRootUri: Uri;
	private ewm : Ewm;
	// private rootPath: Uri;

    private timeout?: NodeJS.Timeout;

    constructor(context: vscode.ExtensionContext, ewmShare: EwmShareI, private outputChannel: vscode.OutputChannel) {
		
		this.componentName = ewmShare.remote.component.name;
		this.componentRootUri = Uri.file(ewmShare.local);
		this.workspaceName = ewmShare.remote.workspace.name;

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

			this.updateComponent(componentStatus);
		}
	}

	provideOriginalResource(uri: Uri, _token: vscode.CancellationToken): vscode.ProviderResult<Uri> {
		// Convert to EWM resource uri.
		return Uri.parse(`${EWM_SCHEME}:${uri.path}`);
	}

    private toSourceControlResourceState(change: ChangeI | UnresolvedChangeI, prefixDir?: string ): vscode.SourceControlResourceState {

		const repositoryFileUri = Uri.file(change.path);
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

		const localFileUri = Uri.joinPath(this.componentRootUri, repositoryFilePathStripped);
		let localFileUriPrefix = localFileUri;
		if( prefixDir )
		{
			localFileUriPrefix = Uri.joinPath( Uri.file(prefixDir), localFileUri.path);
		}
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
			resourceUri: localFileUriPrefix,
			command: command,
			decorations: {
				tooltip: 'File was changed.'
			}
		};

		return resourceState;
	}

	public async updateComponent(componentStatus: ComponentI): Promise<void> {
		let incommingChanges = componentStatus['incoming-changes'];
		let outgoingChanges = componentStatus['outgoing-changes'];		
		let unresolvedChanges = componentStatus.unresolved;

		let resourceStates = [];

		// Update incomming changes
		if (incommingChanges) {
			this.incommingResources.resourceStates = [];
			for (const changeSet of incommingChanges) {

				let changesetName = changeSet.uuid;

				for (const change of changeSet.changes) {
					resourceStates.push(this.toSourceControlResourceState(change));
				}
			}
			this.incommingResources.resourceStates = resourceStates;
		}

		// Update outgoing changes
		if (outgoingChanges) {
			this.outgoingResources.resourceStates = [];
			resourceStates = [];
			for (const changeSet of outgoingChanges) {
				for (const change of changeSet.changes) {
					resourceStates.push(this.toSourceControlResourceState(change, "1001"));
				}
			}
			this.outgoingResources.resourceStates = resourceStates;
		}

		// Update unresolved Changes
		if (unresolvedChanges) {
			this.unresolvedResources.resourceStates = [];
			resourceStates = [];
			for (const change of unresolvedChanges) {
				resourceStates.push(this.toSourceControlResourceState(change));
			}
			this.unresolvedResources.resourceStates = resourceStates;

			// this.unresolvedResources.resourceStates.
		}
	}

	public async checkin(resourceStates: vscode.SourceControlResourceState[]): void {
		this.outputChannel.appendLine('commit: ' + resourceStates);
		let uriList: Uri[] = [];
		for (const resourceState of resourceStates) {
			uriList.push(resourceState.resourceUri);
		}

		let workspaceUpdate: WorkspaceI = await this.ewm.checkin(uriList);
		this.updateResourceGroups();

		// for (const componentData of workspaceUpdate.components) {
		// 	this.outputChannel.appendLine('component: ' + componentData.name);

		// 	if (ewmSourceControls.has(componentData.name)) {
		// 		const ewmSourceControl = ewmSourceControls.get(componentData.name);
		// 		await ewmSourceControl?.updateResourceGroups();
		// 		// await ewmSourceControl?.updateComponent(componentData);
		// 	}
		// }
	}

    dispose() {
		// this._onRepositoryChange.dispose();
		this.jsEwmScm.dispose();
	}
}

// class ResourceCommandResolver {

// 	constructor(private repository: Repository) { }
// }


// export class Resource implements vscode.SourceControlResourceState {
	
// 	static getStatusLetter(type: Status): string {
// 		switch (type) {
// 			case Status.INDEX_MODIFIED:
// 			case Status.MODIFIED:
// 				return 'M';
// 			case Status.INDEX_ADDED:
// 			case Status.INTENT_TO_ADD:
// 				return 'A';
// 			case Status.INDEX_DELETED:
// 			case Status.DELETED:
// 				return 'D';
// 			case Status.INDEX_RENAMED:
// 			case Status.INTENT_TO_RENAME:
// 				return 'R';
// 			case Status.TYPE_CHANGED:
// 				return 'T';
// 			case Status.UNTRACKED:
// 				return 'U';
// 			case Status.IGNORED:
// 				return 'I';
// 			case Status.DELETED_BY_THEM:
// 				return 'D';
// 			case Status.DELETED_BY_US:
// 				return 'D';
// 			case Status.INDEX_COPIED:
// 				return 'C';
// 			case Status.BOTH_DELETED:
// 			case Status.ADDED_BY_US:
// 			case Status.ADDED_BY_THEM:
// 			case Status.BOTH_ADDED:
// 			case Status.BOTH_MODIFIED:
// 				return '!'; // Using ! instead of ⚠, because the latter looks really bad on windows
// 			default:
// 				throw new Error('Unknown git status: ' + type);
// 		}
// 	}

// 	static getStatusText(type: Status) {
// 		switch (type) {
// 			case Status.INDEX_MODIFIED: return 'Index Modified';
// 			case Status.MODIFIED: return 'Modified';
// 			case Status.INDEX_ADDED: return 'Index Added';
// 			case Status.INDEX_DELETED: return 'Index Deleted';
// 			case Status.DELETED: return 'Deleted';
// 			case Status.INDEX_RENAMED: return 'Index Renamed';
// 			case Status.INDEX_COPIED: return 'Index Copied';
// 			case Status.UNTRACKED: return 'Untracked';
// 			case Status.IGNORED: return 'Ignored';
// 			case Status.INTENT_TO_ADD: return 'Intent to Add';
// 			case Status.INTENT_TO_RENAME: return 'Intent to Rename';
// 			case Status.TYPE_CHANGED: return 'Type Changed';
// 			case Status.BOTH_DELETED: return 'Conflict: Both Deleted';
// 			case Status.ADDED_BY_US: return 'Conflict: Added By Us';
// 			case Status.DELETED_BY_THEM: return 'Conflict: Deleted By Them';
// 			case Status.ADDED_BY_THEM: return 'Conflict: Added By Them';
// 			case Status.DELETED_BY_US: return 'Conflict: Deleted By Us';
// 			case Status.BOTH_ADDED: return 'Conflict: Both Added';
// 			case Status.BOTH_MODIFIED: return 'Conflict: Both Modified';
// 			default: return '';
// 		}
// 	}

// 	@memoize
// 	get resourceUri(): Uri {
// 		if (this.renameResourceUri && (this._type === Status.MODIFIED || this._type === Status.DELETED || this._type === Status.INDEX_RENAMED || this._type === Status.INDEX_COPIED || this._type === Status.INTENT_TO_RENAME)) {
// 			return this.renameResourceUri;
// 		}

// 		return this._resourceUri;
// 	}


// 	constructor(
// 		private _commandResolver: ResourceCommandResolver,
// 		private _resourceGroupType: ResourceGroupType,
// 		private _resourceUri: Uri,
// 		private _type: Status,
// 		private _useIcons: boolean,
// 		private _renameResourceUri?: Uri,
// 	) { }
// }

/**
 * Provides the content of the JS Fiddle documents as fetched from the server i.e.  without the local edits.
 * This is used for the source control diff.
 */
export class EwmDocumentContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
	private _onDidChange = new vscode.EventEmitter<Uri>();
	private loadedFiles = new Map<string, string>(); // this assumes each fiddle is only open once per workspace

	constructor(private ewm: Ewm, private workspaceName: string, private activeWorkspaceFolder: Uri) { }

	get onDidChange(): vscode.Event<Uri> {
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
	provideTextDocumentContent(uri: Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
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
		const systemTempDir = Uri.file(os.tmpdir());
		const tempFileName = crypto.randomBytes(16).toString("hex");
		const tempFileUri = Uri.joinPath(systemTempDir, tempFileName);
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
