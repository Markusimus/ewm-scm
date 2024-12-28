import * as vscode from 'vscode';
import * as crypto from 'crypto'; // Import the Node.js crypto module
import * as fs from 'fs';
import {statusOut} from './status';
import { StatusDataI, ComponentI, ChangesetI, ChangeI, UnresolvedChangeI, WorkspaceI}  from './ewmStatusInterface';
import { EwmShareI } from './ewmSandboxInterface';
import { Ewm } from './ewm';
import os from 'os';
import * as path from 'path';
import { debounce, memoize, throttle } from './decorators';
import { Uri, SourceControlResourceGroup, Disposable, SourceControlResourceState, Command, SourceControlResourceDecorations, workspace, l10n, CancellationToken, CancellationError, Event, EventEmitter, CancellationTokenSource } from 'vscode';

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

export const enum ResourceGroupType {
	Incomming,
	Outgoing,
	Unresolved
}

const iconsRootPath = path.join(path.dirname(__dirname), 'resources', 'icons');
function getIconUri(iconName: string, theme: string): Uri {
	return Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}

export interface EwmResourceGroup extends SourceControlResourceGroup {
	resourceStates: Resource[];
}

interface EwmResourceGroups {
	incommingGroup?: Resource[];
	outgoingGroup?: Resource[];
	unresolvedGroup?: Resource[];
}

export class EwmRepository implements Disposable, vscode.QuickDiffProvider {
	private _sourceControl: vscode.SourceControl;
	private componentName : string;
	private workspaceName: string;
	private _componentRootUri: Uri;
	private ewm : Ewm;
	private disposables: Disposable[] = [];
	private updateModelStateCancellationTokenSource: CancellationTokenSource | undefined;

	private _onDidChangeStatus = new EventEmitter<void>();
		readonly onDidRunGitStatus: Event<void> = this._onDidChangeStatus.event;

	private _incommingGroup: SourceControlResourceGroup;
	get incommingGroup(): EwmResourceGroup { return this._incommingGroup as EwmResourceGroup; }

	private _outgoingGroup: SourceControlResourceGroup;
	get outgoingGroup(): EwmResourceGroup { return this._outgoingGroup as EwmResourceGroup; }

	private _unresolvedGroup: SourceControlResourceGroup;
	get unresolvedGroup(): EwmResourceGroup { return this._unresolvedGroup as EwmResourceGroup; }

	get componentRootUri(): Uri {
		return this._componentRootUri;
	}

    private timeout?: NodeJS.Timeout;

	private resourceCommandResolver = new ResourceCommandResolver(this);

    constructor(context: vscode.ExtensionContext, ewmShare: EwmShareI, private outputChannel: vscode.OutputChannel) {
		
		this.componentName = ewmShare.remote.component.name;
		this._componentRootUri = Uri.file(ewmShare.local);
		this.workspaceName = ewmShare.remote.workspace.name;

		this.ewm = new Ewm(this._componentRootUri, outputChannel);
		// this._sourceControl = vscode.scm.createSourceControl('ewm', this.componentName, this._componentRootUri);
		this._sourceControl = vscode.scm.createSourceControl('ewm', 'EWM', this._componentRootUri);
		this.disposables.push(this._sourceControl);

		this._sourceControl.acceptInputCommand = { command: 'ewm-scm.commit', title: 'Commit', arguments: [this._sourceControl] };
		// this._sourceControl.inputBox.validateInput = this.validateInput.bind(this);

		this._incommingGroup = this._sourceControl.createResourceGroup('incoming', 'Incoming Changes');
		this._outgoingGroup = this._sourceControl.createResourceGroup('outgoing', 'Outgoing Changes');
		this._unresolvedGroup = this._sourceControl.createResourceGroup('unresolved', 'Unresolved Changes');
    
        // const fileSystemWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(workspaceFolder, "*.*"));
		// fileSystemWatcher.onDidChange(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidCreate(uri => this.onResourceChange(uri), context.subscriptions);
		// fileSystemWatcher.onDidDelete(uri => this.onResourceChange(uri), context.subscriptions);

        context.subscriptions.push(this._sourceControl);
        // context.subscriptions.push(fileSystemWatcher);

		this._sourceControl.quickDiffProvider = this;
    }


	provideOriginalResource(uri: Uri, _token: vscode.CancellationToken): vscode.ProviderResult<Uri> {
		// Convert to EWM resource uri.
		return Uri.parse(`${EWM_SCHEME}:${uri.path}`);
	}


	public async checkin(resourceStates: SourceControlResourceState[]): Promise<void> {
		this.outputChannel.appendLine('commit: ' + resourceStates);
		let uriList: Uri[] = [];
		for (const resourceState of resourceStates) {
			uriList.push(resourceState.resourceUri);
		}

		let workspaceUpdate: WorkspaceI = await this.ewm.checkin(uriList);
		this.updateModelState();

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
		this._sourceControl.dispose();
	}


	// @throttle
	async status(): Promise<void> {
		// await this.run(Operation.Status);
		await this.updateModelState();
	}

	private async updateModelState(optimisticResourcesGroups?: EwmResourceGroups) {
		this.updateModelStateCancellationTokenSource?.cancel();

		this.updateModelStateCancellationTokenSource = new CancellationTokenSource();
		await this._updateModelState(optimisticResourcesGroups, this.updateModelStateCancellationTokenSource.token);
	}

	private async _updateModelState(optimisticResourcesGroups?: EwmResourceGroups, cancellationToken?: CancellationToken): Promise<void> {
		try {
			// Optimistically update resource groups
			if (optimisticResourcesGroups) {
				this._updateResourceGroupsState(optimisticResourcesGroups);
			}

			// const [HEAD, remotes, submodules, rebaseCommit, mergeInProgress, cherryPickInProgress, commitTemplate] =
			// 	await Promise.all([
			// 		this.repository.getHEADRef(),
			// 		this.repository.getRemotes(),
			// 		this.repository.getSubmodules(),
			// 		this.getRebaseCommit(),
			// 		this.isMergeInProgress(),
			// 		this.isCherryPickInProgress(),
			// 		this.getInputTemplate()]);

			// this._HEAD = HEAD;
			// this._remotes = remotes!;
			// this._submodules = submodules!;
			// this.rebaseCommit = rebaseCommit;
			// this.mergeInProgress = mergeInProgress;
			// this.cherryPickInProgress = cherryPickInProgress;

			// this._sourceControl.commitTemplate = commitTemplate;

			// Execute cancellable long-running operation
			// const [resourceGroups, refs] =
			// 	await Promise.all([
			// 		this.getStatus(cancellationToken),
			// 		this.getRefs({}, cancellationToken)]);

			// this._refs = refs;

			const resourceGroups = await this.getStatus(cancellationToken);
			this._updateResourceGroupsState(resourceGroups);

			this._onDidChangeStatus.fire();
		}
		catch (err) {
			if (err instanceof CancellationError) {
				return;
			}

			throw err;
		}
	}

	private _updateResourceGroupsState(resourcesGroups: EwmResourceGroups): void {
		// set resource groups
		if (resourcesGroups.incommingGroup) { this.incommingGroup.resourceStates = resourcesGroups.incommingGroup; }
		if (resourcesGroups.outgoingGroup) { this.outgoingGroup.resourceStates = resourcesGroups.outgoingGroup; }
		if (resourcesGroups.unresolvedGroup) { this.unresolvedGroup.resourceStates = resourcesGroups.unresolvedGroup; }

		// set count badge
		// this.setCountBadge();
	}

	private async getStatus(cancellationToken?: CancellationToken): Promise<EwmResourceGroups> {
		if (cancellationToken && cancellationToken.isCancellationRequested) {
			throw new CancellationError();
		}

		const config = workspace.getConfiguration('ewm-scm');
		const useIcons = !config.get<boolean>('decorations.enabled', true);

		const incommingGroup: Resource[] = [],
		outgoingGroup: Resource[] = [],
		unresolvedGroup: Resource[] = [];

		const workspaceStatus : StatusDataI | null = await this.ewm.getStatus();
		let componentsStatus : ComponentI[] = [] as ComponentI[];
		let componentStatus : ComponentI = {} as ComponentI;

		if (workspaceStatus) {
			// Find workspace in statusData
			for (var ewmWorkspace of workspaceStatus.workspaces)
			{
				if (ewmWorkspace.name && ewmWorkspace.name === this.workspaceName)
				{
					componentsStatus = ewmWorkspace.components;
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
			if (incommingChanges) {
				for (const changeSet of incommingChanges) {
					for (const change of changeSet.changes) {
						incommingGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Incomming, Uri.file(change.path), Status.MODIFIED, useIcons, this.workspaceName, this.componentName, this._componentRootUri));
					}
				}
			}
	
			// Update outgoing changes
			if (outgoingChanges) {
				for (const changeSet of outgoingChanges) {
					for (const change of changeSet.changes) {
						outgoingGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Outgoing, Uri.file(change.path), Status.MODIFIED, useIcons, this.workspaceName, this.componentName, this._componentRootUri));
					}
				}
			}
	
			// Update unresolved Changes
			if (unresolvedChanges) {
				for (const change of unresolvedChanges) {
					unresolvedGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Unresolved, Uri.file(change.path), Status.MODIFIED, useIcons, this.workspaceName, this.componentName, this._componentRootUri));
				}
			}
		}

		return { incommingGroup, outgoingGroup, unresolvedGroup };
	}
}

class ResourceCommandResolver {

	constructor(private repository: EwmRepository) { }

	resolveDefaultCommand(resource: Resource): Command {
		const config = workspace.getConfiguration('ewm-scm', this.repository.componentRootUri);
		const openDiffOnClick = config.get<boolean>('openDiffOnClick', true);
		return openDiffOnClick ? this.resolveChangeCommand(resource) : this.resolveFileCommand(resource);
	}

	resolveFileCommand(resource: Resource): Command {
		return {
			command: 'vscode.open',
			title: l10n.t('Open'),
			arguments: [resource.resourceUri]
		};
	}

	resolveChangeCommand(resource: Resource): Command {
		const title = this.getTitle(resource);

		if (!resource.leftUri) {
			const bothModified = resource.type === Status.BOTH_MODIFIED;
			if (resource.rightUri && workspace.getConfiguration('ewm-scm').get<boolean>('mergeEditor', false) && (bothModified || resource.type === Status.BOTH_ADDED)) {
				return {
					command: 'git.openMergeEditor',
					title: l10n.t('Open Merge'),
					arguments: [resource.rightUri]
				};
			} else {
				return {
					command: 'vscode.open',
					title: l10n.t('Open'),
					arguments: [resource.rightUri, { override: bothModified ? false : undefined }, title]
				};
			}
		} else {
			return {
				command: 'vscode.diff',
				title: l10n.t('Open'),
				arguments: [resource.leftUri, resource.rightUri, title]
			};
		}
	}


	private getTitle(resource: Resource): string {
		const basename = path.basename(resource.resourceUri.fsPath);

		switch (resource.type) {
			case Status.INDEX_MODIFIED:
			case Status.INDEX_RENAMED:
			case Status.INDEX_ADDED:
				return l10n.t('{0} (Index)', basename);

			case Status.MODIFIED:
			case Status.BOTH_ADDED:
			case Status.BOTH_MODIFIED:
				return l10n.t('{0} (Working Tree)', basename);

			case Status.INDEX_DELETED:
			case Status.DELETED:
				return l10n.t('{0} (Deleted)', basename);

			case Status.DELETED_BY_US:
				return l10n.t('{0} (Theirs)', basename);

			case Status.DELETED_BY_THEM:
				return l10n.t('{0} (Ours)', basename);

			case Status.UNTRACKED:
				return l10n.t('{0} (Untracked)', basename);

			case Status.INTENT_TO_ADD:
			case Status.INTENT_TO_RENAME:
				return l10n.t('{0} (Intent to add)', basename);

			case Status.TYPE_CHANGED:
				return l10n.t('{0} (Type changed)', basename);

			default:
				return '';
		}
	}

}


export class Resource implements SourceControlResourceState {
	
	private _leftUri?: Uri;		// The repository URI of the resource
	private _rightUri?: Uri; 	// The Local workspace URI of the resource

	constructor(
		private _commandResolver: ResourceCommandResolver,
		private _resourceGroupType: ResourceGroupType,
		private _resourceUri: Uri,
		private _type: Status,
		private _useIcons: boolean,
		private _workspaceName: string,
		private _componentName: string,
		private _componentRootUri: Uri,
		private _renameResourceUri?: Uri,		
	) { 
		let repositoryFilePathStripped = this._resourceUri.path;
		// Remove first folder from repositoryFilePath path.
		if ( repositoryFilePathStripped.startsWith( '/' + this._workspaceName ) )
		{
			repositoryFilePathStripped = repositoryFilePathStripped.substring(this._workspaceName.length +1);
		}

		if ( repositoryFilePathStripped.startsWith( '/' + this._componentName ) )
		{
			repositoryFilePathStripped = repositoryFilePathStripped.substring(this._componentName.length +1);
		}

		this._rightUri = Uri.joinPath(this._componentRootUri, repositoryFilePathStripped);
		
		// Add component name to the path if not present.
		let repositoryPathWithComponent = this._resourceUri.path;
		if ( !repositoryPathWithComponent.startsWith( '/' + this._componentName ) )
		{
			repositoryPathWithComponent = '/' + this._componentName + repositoryPathWithComponent;
		}
		this._leftUri = Uri.parse(`${EWM_SCHEME}:${repositoryPathWithComponent}`);
	 }

	static getStatusLetter(type: Status): string {
		switch (type) {
			case Status.INDEX_MODIFIED:
			case Status.MODIFIED:
				return 'M';
			case Status.INDEX_ADDED:
			case Status.INTENT_TO_ADD:
				return 'A';
			case Status.INDEX_DELETED:
			case Status.DELETED:
				return 'D';
			case Status.INDEX_RENAMED:
			case Status.INTENT_TO_RENAME:
				return 'R';
			case Status.TYPE_CHANGED:
				return 'T';
			case Status.UNTRACKED:
				return 'U';
			case Status.IGNORED:
				return 'I';
			case Status.DELETED_BY_THEM:
				return 'D';
			case Status.DELETED_BY_US:
				return 'D';
			case Status.INDEX_COPIED:
				return 'C';
			case Status.BOTH_DELETED:
			case Status.ADDED_BY_US:
			case Status.ADDED_BY_THEM:
			case Status.BOTH_ADDED:
			case Status.BOTH_MODIFIED:
				return '!'; // Using ! instead of ⚠, because the latter looks really bad on windows
			default:
				throw new Error('Unknown git status: ' + type);
		}
	}

	static getStatusText(type: Status) {
		switch (type) {
			case Status.INDEX_MODIFIED: return 'Index Modified';
			case Status.MODIFIED: return 'Modified';
			case Status.INDEX_ADDED: return 'Index Added';
			case Status.INDEX_DELETED: return 'Index Deleted';
			case Status.DELETED: return 'Deleted';
			case Status.INDEX_RENAMED: return 'Index Renamed';
			case Status.INDEX_COPIED: return 'Index Copied';
			case Status.UNTRACKED: return 'Untracked';
			case Status.IGNORED: return 'Ignored';
			case Status.INTENT_TO_ADD: return 'Intent to Add';
			case Status.INTENT_TO_RENAME: return 'Intent to Rename';
			case Status.TYPE_CHANGED: return 'Type Changed';
			case Status.BOTH_DELETED: return 'Conflict: Both Deleted';
			case Status.ADDED_BY_US: return 'Conflict: Added By Us';
			case Status.DELETED_BY_THEM: return 'Conflict: Deleted By Them';
			case Status.ADDED_BY_THEM: return 'Conflict: Added By Them';
			case Status.DELETED_BY_US: return 'Conflict: Deleted By Us';
			case Status.BOTH_ADDED: return 'Conflict: Both Added';
			case Status.BOTH_MODIFIED: return 'Conflict: Both Modified';
			default: return '';
		}
	}

	private static Icons: any = {
		light: {
			Modified: getIconUri('status-modified', 'light'),
			Added: getIconUri('status-added', 'light'),
			Deleted: getIconUri('status-deleted', 'light'),
			Renamed: getIconUri('status-renamed', 'light'),
			Copied: getIconUri('status-copied', 'light'),
			Untracked: getIconUri('status-untracked', 'light'),
			Ignored: getIconUri('status-ignored', 'light'),
			Conflict: getIconUri('status-conflict', 'light'),
			TypeChanged: getIconUri('status-type-changed', 'light')
		},
		dark: {
			Modified: getIconUri('status-modified', 'dark'),
			Added: getIconUri('status-added', 'dark'),
			Deleted: getIconUri('status-deleted', 'dark'),
			Renamed: getIconUri('status-renamed', 'dark'),
			Copied: getIconUri('status-copied', 'dark'),
			Untracked: getIconUri('status-untracked', 'dark'),
			Ignored: getIconUri('status-ignored', 'dark'),
			Conflict: getIconUri('status-conflict', 'dark'),
			TypeChanged: getIconUri('status-type-changed', 'dark')
		}
	};

	private getIconPath(theme: string): Uri {
		switch (this.type) {
			case Status.INDEX_MODIFIED: return Resource.Icons[theme].Modified;
			case Status.MODIFIED: return Resource.Icons[theme].Modified;
			case Status.INDEX_ADDED: return Resource.Icons[theme].Added;
			case Status.INDEX_DELETED: return Resource.Icons[theme].Deleted;
			case Status.DELETED: return Resource.Icons[theme].Deleted;
			case Status.INDEX_RENAMED: return Resource.Icons[theme].Renamed;
			case Status.INDEX_COPIED: return Resource.Icons[theme].Copied;
			case Status.UNTRACKED: return Resource.Icons[theme].Untracked;
			case Status.IGNORED: return Resource.Icons[theme].Ignored;
			case Status.INTENT_TO_ADD: return Resource.Icons[theme].Added;
			case Status.INTENT_TO_RENAME: return Resource.Icons[theme].Renamed;
			case Status.TYPE_CHANGED: return Resource.Icons[theme].TypeChanged;
			case Status.BOTH_DELETED: return Resource.Icons[theme].Conflict;
			case Status.ADDED_BY_US: return Resource.Icons[theme].Conflict;
			case Status.DELETED_BY_THEM: return Resource.Icons[theme].Conflict;
			case Status.ADDED_BY_THEM: return Resource.Icons[theme].Conflict;
			case Status.DELETED_BY_US: return Resource.Icons[theme].Conflict;
			case Status.BOTH_ADDED: return Resource.Icons[theme].Conflict;
			case Status.BOTH_MODIFIED: return Resource.Icons[theme].Conflict;
			default: throw new Error('Unknown git status: ' + this.type);
		}
	}

	// The repository URI of the resource
	get leftUri(): Uri | undefined {
		return this._leftUri;
	}

	// The Local workspace URI of the resource
	get rightUri(): Uri | undefined {
		return this._rightUri;
	}

	get type(): Status { return this._type; }

	private get tooltip(): string {
		return Resource.getStatusText(this.type);
	}

	private get strikeThrough(): boolean {
		switch (this.type) {
			case Status.DELETED:
			case Status.BOTH_DELETED:
			case Status.DELETED_BY_THEM:
			case Status.DELETED_BY_US:
			case Status.INDEX_DELETED:
				return true;
			default:
				return false;
		}
	}

	// @memoize
	private get faded(): boolean {
		// TODO@joao
		return false;
		// const workspaceRootPath = this.workspaceRoot.fsPath;
		// return this.resourceUri.fsPath.substr(0, workspaceRootPath.length) !== workspaceRootPath;
	}

	// @memoize
	get resourceUri(): Uri {
		// if (this.renameResourceUri && (this._type === Status.MODIFIED || this._type === Status.DELETED || this._type === Status.INDEX_RENAMED || this._type === Status.INDEX_COPIED || this._type === Status.INTENT_TO_RENAME)) {
		// 	return this.renameResourceUri;
		// }

		return this._resourceUri;
	}

	// @memoize
	get command(): Command {
		return this._commandResolver.resolveDefaultCommand(this);
	}

	get decorations(): SourceControlResourceDecorations {
		const light = this._useIcons ? { iconPath: this.getIconPath('light') } : undefined;
		const dark = this._useIcons ? { iconPath: this.getIconPath('dark') } : undefined;
		const tooltip = this.tooltip;
		const strikeThrough = this.strikeThrough;
		const faded = this.faded;
		return { strikeThrough, faded, tooltip, light, dark };
	}

	clone(resourceGroupType?: ResourceGroupType) {
		return new Resource(this._commandResolver, resourceGroupType ?? this._resourceGroupType, this._resourceUri, this._type, this._useIcons, this._workspaceName, this._componentName, this._componentRootUri, this._renameResourceUri);
	}
}

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
