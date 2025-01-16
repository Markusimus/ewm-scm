import * as vscode from 'vscode';

import { StatusDataI, ComponentI, ChangesetI, ChangeI, WorkspaceI}  from './ewmStatusInterface';
import { EwmShareI } from './ewmSandboxInterface';
import { Ewm } from './ewm';
import * as path from 'path';
import { debounce, memoize, throttle } from './decorators';
import { RelativePattern, Uri, SourceControlResourceGroup, Disposable, SourceControlResourceState, Command, SourceControlResourceDecorations, workspace, l10n, CancellationToken, CancellationError, Event, EventEmitter, CancellationTokenSource, FileDecoration, ThemeColor } from 'vscode';
import { anyEvent, filterEvent, relativePath } from './util';

export const CONFIGURATION_FILE = '.jsewm';
export const EWM_SCHEME = 'ewm';

export type State = 'uninitialized' | 'initialized';

export const enum Status {
	// "add": true,
	// "conflict": false,
	// "content_change": false,
	// "delete": false,
	// "move": false,
	// "potential_conflict": false,
	// "property_change": false

	ADDED,
	CONFLICT,
	MODIFIED,
	DELETED,
	MOVE,
	POTENTIAL_CONFLICT,
	PROPERTY_CHANGE
	// INDEX_MODIFIED,
	// INDEX_ADDED,
	// INDEX_DELETED,
	// INDEX_RENAMED,
	// INDEX_COPIED,

	// MODIFIED,
	// DELETED,
	// UNTRACKED,
	// IGNORED,
	// INTENT_TO_ADD,
	// INTENT_TO_RENAME,
	// TYPE_CHANGED,

	// ADDED_BY_US,
	// ADDED_BY_THEM,
	// DELETED_BY_US,
	// DELETED_BY_THEM,
	// BOTH_ADDED,
	// BOTH_DELETED,
	// BOTH_MODIFIED
}

export const enum ResourceGroupType {
	Incoming,
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
	incomingGroup?: Resource[];
	outgoingGroup?: Resource[];
	unresolvedGroup?: Resource[];
}

const timeout = (millis: number) => new Promise(c => setTimeout(c, millis));

export class EwmRepository implements Disposable, vscode.QuickDiffProvider {
	private _sourceControl: vscode.SourceControl;
	private _componentName : string;
	private _workspaceName: string;
	private _componentRootUri: Uri;
	private ewm : Ewm;
	private disposables: Disposable[] = [];
	private updateModelStateCancellationTokenSource: CancellationTokenSource | undefined;

	private _onDidChangeStatus = new EventEmitter<void>();
	readonly onDidRunGitStatus: Event<void> = this._onDidChangeStatus.event;

	private _incomingGroup: SourceControlResourceGroup;
	get incomingGroup(): EwmResourceGroup { return this._incomingGroup as EwmResourceGroup; }

	private _outgoingGroup: SourceControlResourceGroup;
	get outgoingGroup(): EwmResourceGroup { return this._outgoingGroup as EwmResourceGroup; }

	private _unresolvedGroup: SourceControlResourceGroup;
	get unresolvedGroup(): EwmResourceGroup { return this._unresolvedGroup as EwmResourceGroup; }

	private _onDidChangeOriginalResource = new EventEmitter<Uri>();
	readonly onDidChangeOriginalResource: Event<Uri> = this._onDidChangeOriginalResource.event;

	get componentRootUri(): Uri {
		return this._componentRootUri;
	}

	get root(): string {
		return this._componentRootUri.path;
	}

	get componentName(): string { return this._componentName;}
	get workspaceName(): string { return this._workspaceName;}

	private resourceCommandResolver = new ResourceCommandResolver(this);

    constructor(context: vscode.ExtensionContext, ewmShare: EwmShareI, private outputChannel: vscode.OutputChannel) {
		// Initialization
		this._componentName = ewmShare.remote.component.name;
		this._componentRootUri = Uri.file(ewmShare.local);
		this._workspaceName = ewmShare.remote.workspace.name;

		this.ewm = new Ewm(this._componentRootUri, outputChannel);
		this._sourceControl = vscode.scm.createSourceControl('ewm', 'EWM', this._componentRootUri);
		this.disposables.push(this._sourceControl);

		this._sourceControl.acceptInputCommand = { command: 'ewm-scm.commit', title: 'Commit', arguments: [this._sourceControl] };

		this._incomingGroup = this._sourceControl.createResourceGroup('incoming', 'Incoming Changes');
		this._outgoingGroup = this._sourceControl.createResourceGroup('outgoing', 'Outgoing Changes');
		this._unresolvedGroup = this._sourceControl.createResourceGroup('unresolved', 'Unresolved Changes');

        context.subscriptions.push(this._sourceControl);

		this._sourceControl.quickDiffProvider = this;

		// Setup file system watcher for the repository
		const repositoryWatcher = workspace.createFileSystemWatcher(new RelativePattern(this._componentRootUri, '**'));
		this.disposables.push(repositoryWatcher);

		const onRepositoryFileChange = anyEvent(repositoryWatcher.onDidChange, repositoryWatcher.onDidCreate, repositoryWatcher.onDidDelete);
		const onRepositoryWorkingTreeFileChange = filterEvent(onRepositoryFileChange, uri => !/\.jazz5($|\\|\/)/.test(relativePath(this._componentRootUri.fsPath, uri.fsPath)));

		onRepositoryWorkingTreeFileChange(this.onFileChange, this, this.disposables);
    }


	provideOriginalResource(uri: Uri, _token: vscode.CancellationToken): vscode.ProviderResult<Uri> {
		// Convert to EWM resource uri.
		let resourcePath = uri.path;
		if( resourcePath.toLowerCase().startsWith(this._componentRootUri.path.toLowerCase()) )
		{
			// TODO: If file is not modified provide local file.
			resourcePath = resourcePath.substring(this._componentRootUri.path.length);
			resourcePath = "/" + this._workspaceName + "/" + this._componentName + resourcePath
		}

		return Uri.parse(`${EWM_SCHEME}:${resourcePath}`);
	}

	public async refresh(): Promise<void> {
		await this.status();
		return;
	}


	public async checkin(resourceStates: Resource[]): Promise<void> {
		this.outputChannel.appendLine('commit: ' + resourceStates);
		let uriList: Uri[] = [];
		for (const resourceState of resourceStates) {
			if (resourceState.rightUri){
				uriList.push(resourceState.rightUri);
				// this._onDidChangeOriginalResource.fire(resourceState.rightUri); // TODO: Need to include Workspace
			}
		}

		const commentMsg = this._sourceControl.inputBox.value;

		await this.ewm.checkin(uriList, commentMsg);
		this.updateRepositoryState();

		// Remove the files from the cache.
		for (const resourceState of resourceStates) {
			if (resourceState.leftUri){
				this._onDidChangeOriginalResource.fire(resourceState.leftUri);
			}
		}

		return;
	}

    dispose() {
		// this._onRepositoryChange.dispose();
		this._sourceControl.dispose();
	}


	@throttle
	async status(): Promise<void> {
		// Status Handling
		await this.updateRepositoryState();
	}

	private async updateRepositoryState(optimisticResourcesGroups?: EwmResourceGroups) {
		this.updateModelStateCancellationTokenSource?.cancel();

		this.updateModelStateCancellationTokenSource = new CancellationTokenSource();
		await this._updateRepositoryState(optimisticResourcesGroups, this.updateModelStateCancellationTokenSource.token);
	}

	private async _updateRepositoryState(optimisticResourcesGroups?: EwmResourceGroups, cancellationToken?: CancellationToken): Promise<void> {
		try {
			// Optimistically update resource groups
			if (optimisticResourcesGroups) {
				this._updateResourceGroupsState(optimisticResourcesGroups);
			}

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
		// Resource Groups
		if (resourcesGroups.incomingGroup) { this.incomingGroup.resourceStates = resourcesGroups.incomingGroup; }
		if (resourcesGroups.outgoingGroup) { this.outgoingGroup.resourceStates = resourcesGroups.outgoingGroup; }
		if (resourcesGroups.unresolvedGroup) { this.unresolvedGroup.resourceStates = resourcesGroups.unresolvedGroup; }
	}

	private async getStatus(cancellationToken?: CancellationToken): Promise<EwmResourceGroups> {
		if (cancellationToken && cancellationToken.isCancellationRequested) {
			throw new CancellationError();
		}

		const config = workspace.getConfiguration('ewm-scm');
		const useIcons = !config.get<boolean>('decorations.enabled', true);

		const incomingGroup: Resource[] = [],
		outgoingGroup: Resource[] = [],
		unresolvedGroup: Resource[] = [];

		const workspaceStatus : StatusDataI | null = await this.ewm.getStatus();
		let componentsStatus : ComponentI[] = [] as ComponentI[];
		let componentStatus : ComponentI = {} as ComponentI;

		if (workspaceStatus) {
			// Find workspace in statusData
			for (let ewmWorkspace of workspaceStatus.workspaces)
			{
				if (ewmWorkspace.name && ewmWorkspace.name === this._workspaceName)
				{
					componentsStatus = ewmWorkspace.components;
					break;
				}
			}

			// Find Component in componentsStatus
			for (let _componentStatus of componentsStatus)
			{
				if (_componentStatus.name && _componentStatus.name === this._componentName)
				{
					componentStatus = _componentStatus;
					break;
				}
			}

			const incomingChanges = componentStatus['incoming-changes'];
			const outgoingChanges = componentStatus['outgoing-changes'];		
			const unresolvedChanges = componentStatus.unresolved;
	
			// Update incoming changes
			if (incomingChanges) {
				const incomingFlow = componentStatus['flow-target']['incoming-flow'].name;
				for (const changeSet of incomingChanges) {
					for (const change of changeSet.changes) {
						incomingGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Incoming, change, useIcons, this._workspaceName, this._componentName, this._componentRootUri, incomingFlow));
					}
				}
			}
	
			// Update outgoing changes
			if (outgoingChanges) {
				for (const changeSet of outgoingChanges) {
					for (const change of changeSet.changes) {
						outgoingGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Outgoing, change, useIcons, this._workspaceName, this._componentName, this._componentRootUri));
					}
				}
			}
	
			// Update unresolved Changes
			if (unresolvedChanges) {
				for (const change of unresolvedChanges) {
					unresolvedGroup.push(new Resource(this.resourceCommandResolver, ResourceGroupType.Unresolved, change, useIcons, this._workspaceName, this._componentName, this._componentRootUri));
				}
			}
		}

		return { incomingGroup: incomingGroup, outgoingGroup, unresolvedGroup };
	}

	private onFileChange(_uri: Uri): void {
		// File Changes
		const config = workspace.getConfiguration('ewm-scm');
		const autorefresh = config.get<boolean>('autorefresh', true);

		if (!autorefresh) {
			this.outputChannel.appendLine('[Repository][onFileChange] Skip running git status because autorefresh setting is disabled.');
			return;
		}

		this.eventuallyUpdateWhenIdleAndWait();
	}

	@debounce(1000)
	private eventuallyUpdateWhenIdleAndWait(): void {
		this.updateWhenIdleAndWait();
	}

	@throttle
	private async updateWhenIdleAndWait(): Promise<void> {
		await this.status();
		await timeout(5000);
	}

	// async whenIdleAndFocused(): Promise<void> {
	// 	while (true) {
	// 		if (!this.operations.isIdle()) {
	// 			await eventToPromise(this.onDidRunOperation);
	// 			continue;
	// 		}

	// 		if (!window.state.focused) {
	// 			const onDidFocusWindow = filterEvent(window.onDidChangeWindowState, e => e.focused);
	// 			await eventToPromise(onDidFocusWindow);
	// 			continue;
	// 		}

	// 		return;
	// 	}
	// }
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
			const bothModified = resource.type === Status.CONFLICT;
			if (resource.rightUri && workspace.getConfiguration('ewm-scm').get<boolean>('mergeEditor', false)) {
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
			case Status.MODIFIED:
				return l10n.t('{0} (Modified)', basename);
			case Status.DELETED:
				return l10n.t('{0} (Deleted)', basename);
			case Status.ADDED:
				return l10n.t('{0} (Added)', basename);
			case Status.PROPERTY_CHANGE:
				return l10n.t('{0} (Property changed)', basename);
			default:
				return '';
		}
	}

}


export class Resource implements SourceControlResourceState {
	
	private _leftUri?: Uri;		// The repository URI of the resource
	private _rightUri?: Uri; 	// The Local workspace URI of the resource
	private _resourceUri: Uri;
	private _type: Status;

	constructor(
		private _commandResolver: ResourceCommandResolver,
		private _resourceGroupType: ResourceGroupType,
		private _change: ChangeI,
		private _useIcons: boolean,
		private _workspaceName: string,
		private _componentName: string,
		private _componentRootUri: Uri,
		private _resourceStream?: string,		
	) { 
		this._resourceUri = Uri.file(_change.path);
		this._type = Status.MODIFIED;
		if (_change.state.content_change) { this._type = Status.MODIFIED; }
		if (_change.state.add) { this._type = Status.ADDED; }
		if (_change.state.delete) { this._type = Status.DELETED; }
		if (_change.state.move) { this._type = Status.MOVE; }
		if (_change.state.property_change) { this._type = Status.PROPERTY_CHANGE; }
		if (_change.state.potential_conflict) { this._type = Status.POTENTIAL_CONFLICT; }


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
		
		if( this._type === Status.MODIFIED )
		{
			// The repository path including Stream and component name.
			const repositoryPath = '/' + (this._resourceStream ? this._resourceStream : this._workspaceName) + '/' + this._componentName + repositoryFilePathStripped;
			this._leftUri = Uri.parse(`${EWM_SCHEME}:${repositoryPath}`);
		}
		
	 }

	static getStatusLetter(type: Status): string {
		switch (type) {
			case Status.MODIFIED:
				return 'M';
			case Status.ADDED:
				return 'A';
			case Status.DELETED:
				return 'D';
			case Status.MOVE: // Renamed
				return 'R';
			case Status.PROPERTY_CHANGE:
				return 'P';
			case Status.CONFLICT:
				return '!'; // Using ! instead of ⚠, because the latter looks really bad on windows
			default:
				throw new Error('Unknown EWM status: ' + type);
		}
	}

	static getStatusText(type: Status) {
		switch (type) {
			case Status.MODIFIED: return 'Modified';
			case Status.DELETED: return 'Deleted';
			case Status.ADDED: return 'Add';
			case Status.PROPERTY_CHANGE: return 'Property Changed';
			case Status.DELETED: return 'Deleted';
			case Status.CONFLICT: return 'Conflict';
			case Status.MOVE: return 'Item Moved/Renamed';
			case Status.POTENTIAL_CONFLICT: return 'Potential Conflict';
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

	static getStatusColor(type: Status): ThemeColor {
		switch (type) {
			case Status.MODIFIED:
			// case Status.TYPE_CHANGED:
				return new ThemeColor('gitDecoration.modifiedResourceForeground');
			// case Status.INDEX_DELETED:
			// 	return new ThemeColor('gitDecoration.stageDeletedResourceForeground');
			case Status.DELETED:
				return new ThemeColor('gitDecoration.deletedResourceForeground');
			case Status.ADDED:
			// case Status.INTENT_TO_ADD:
				return new ThemeColor('gitDecoration.addedResourceForeground');
			case Status.MOVE:
			// case Status.INDEX_RENAMED:
			// case Status.INTENT_TO_RENAME:
				return new ThemeColor('gitDecoration.renamedResourceForeground');
			// case Status.UNTRACKED:
			// 	return new ThemeColor('gitDecoration.untrackedResourceForeground');
			// case Status.IGNORED:
			// 	return new ThemeColor('gitDecoration.ignoredResourceForeground');
			// case Status.BOTH_DELETED:
			// case Status.ADDED_BY_US:
			// case Status.DELETED_BY_THEM:
			// case Status.ADDED_BY_THEM:
			// case Status.DELETED_BY_US:
			// case Status.BOTH_ADDED:
			case Status.CONFLICT:
				return new ThemeColor('gitDecoration.conflictingResourceForeground');
			default:
				throw new Error('Unknown git status: ' + type);
		}
	}

	private getIconPath(theme: string): Uri {
		switch (this.type) {
			case Status.MODIFIED: return Resource.Icons[theme].Modified;
			case Status.ADDED: return Resource.Icons[theme].Added;
			case Status.DELETED: return Resource.Icons[theme].Deleted;
			case Status.MOVE: return Resource.Icons[theme].Renamed;
			case Status.PROPERTY_CHANGE: return Resource.Icons[theme].TypeChanged;
			case Status.CONFLICT: return Resource.Icons[theme].Conflict;			
			case Status.POTENTIAL_CONFLICT: return Resource.Icons[theme].Conflict;
			default: throw new Error('Unknown git status: ' + this.type);
		}
	}

	// Return the repository URI of the resource includeing Workspace and Component
	get original(): Uri { return this._resourceUri; }

	// The repository URI of the resource
	get leftUri(): Uri | undefined {
		return this._leftUri;
	}

	// The Local workspace URI of the resource
	get rightUri(): Uri | undefined {
		return this._rightUri;
	}

	get type(): Status { return this._type; }
	get resourceGroupType(): ResourceGroupType { return this._resourceGroupType; }

	get letter(): string {
		return Resource.getStatusLetter(this.type);
	}

	get color(): ThemeColor {
		return Resource.getStatusColor(this.type);
	}

	get resourceDecoration(): FileDecoration {
		const res = new FileDecoration(this.letter, this.tooltip, this.color);
		res.propagate = this.type !== Status.DELETED;
		return res;
	}

	private get tooltip(): string {
		return Resource.getStatusText(this.type);
	}

	private get strikeThrough(): boolean {
		switch (this.type) {
			case Status.DELETED:
				return true;
			default:
				return false;
		}
	}

	get componentName(): string {
		return this._componentName;
	}

	@memoize
	private get faded(): boolean {
		// TODO@joao
		return false;
		// const workspaceRootPath = this.workspaceRoot.fsPath;
		// return this.resourceUri.fsPath.substr(0, workspaceRootPath.length) !== workspaceRootPath;
	}

	@memoize
	get resourceUri(): Uri {
		// if (this.renameResourceUri && (this._type === Status.MODIFIED || this._type === Status.DELETED || this._type === Status.INDEX_RENAMED || this._type === Status.INDEX_COPIED || this._type === Status.INTENT_TO_RENAME)) {
		// 	return this.renameResourceUri;
		// }

		return this._resourceUri;
	}

	@memoize
	get command(): Command {
		return this._commandResolver.resolveDefaultCommand(this);
	}

	/**
	 * Gets the decorations for the source control resource.
	 * 
	 * @returns {SourceControlResourceDecorations} An object containing the following properties:
	 * - `strikeThrough`: A boolean indicating whether the text should be struck through.
	 * - `faded`: A boolean indicating whether the text should be faded.
	 * - `tooltip`: A string containing the tooltip text.
	 * - `light`: An optional object containing the icon path for light themes.
	 * - `dark`: An optional object containing the icon path for dark themes.
	 */
	get decorations(): SourceControlResourceDecorations {
		const light = this._useIcons ? { iconPath: this.getIconPath('light') } : undefined;
		const dark = this._useIcons ? { iconPath: this.getIconPath('dark') } : undefined;
		const tooltip = this.tooltip;
		const strikeThrough = this.strikeThrough;
		const faded = this.faded;
		return { strikeThrough, faded, tooltip, light, dark };
	}

	clone(resourceGroupType?: ResourceGroupType) {
		return new Resource(this._commandResolver, resourceGroupType ?? this._resourceGroupType, this._change, this._useIcons, this._workspaceName, this._componentName, this._componentRootUri, this._resourceStream);
	}
}
