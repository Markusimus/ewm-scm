import { EwmRepository, EwmDocumentContentProvider, EWM_SCHEME, State, Resource } from "./ewmSourceControl";
import { Disposable, EventEmitter, Event, ExtensionContext, workspace, window, Uri, OutputChannel, commands, Memento, SourceControlResourceState, l10n, QuickPickItem } from "vscode";
import { Ewm } from './ewm';
import { EwmShareI } from "./ewmSandboxInterface";
// import { memoize } from "./decorators";

// class RepositoryPick implements QuickPickItem {
// 	@memoize get label(): string {
// 		return path.basename(this.repository.root);
// 	}

// 	@memoize get description(): string {
// 		return [this.repository.headLabel, this.repository.syncLabel]
// 			.filter(l => !!l)
// 			.join(' ');
// 	}

// 	constructor(public readonly repository: EwmRepository, public readonly index: number) { }
// }

interface OpenRepository extends Disposable {
	repository: EwmRepository;
}

export interface ModelChangeEvent {
	repository: EwmRepository;
	uri: Uri;
}

export interface OriginalResourceChangeEvent {
	repository: EwmRepository;
	uri: Uri;
}

export class Model implements Disposable {

	private _onDidOpenRepository = new EventEmitter<EwmRepository>();
	readonly onDidOpenRepository: Event<EwmRepository> = this._onDidOpenRepository.event;

	private _onDidCloseRepository = new EventEmitter<EwmRepository>();
	readonly onDidCloseRepository: Event<EwmRepository> = this._onDidCloseRepository.event;

    private _onDidChangeState = new EventEmitter<State>();
	readonly onDidChangeState = this._onDidChangeState.event;

	private _onDidChangeRepository = new EventEmitter<ModelChangeEvent>();
	readonly onDidChangeRepository: Event<ModelChangeEvent> = this._onDidChangeRepository.event;

	private _onDidChangeOriginalResource = new EventEmitter<OriginalResourceChangeEvent>();
	readonly onDidChangeOriginalResource: Event<OriginalResourceChangeEvent> = this._onDidChangeOriginalResource.event;

    private openRepositories: OpenRepository[] = [];
	get repositories(): EwmRepository[] { return this.openRepositories.map(r => r.repository); }

    private _closedRepositoriesManager: ClosedRepositoriesManager;
	get closedRepositories(): string[] {
		return [...this._closedRepositoriesManager.repositories];
	}

    private _initDone = false;
    private _rootPath: Uri | undefined;
    private disposables: Disposable[] = [];
	// private _repositories: Map<string, EwmRepository> = new Map();


    // get repositories(): EwmRepository[] {
    //     return Array.from(this._repositories.values());
    // }

    private _state: State = 'uninitialized';
	get state(): State { return this._state; }

    setState(state: State): void {
		this._state = state;
		this._onDidChangeState.fire(state);
		commands.executeCommand('setContext', 'ewm-scm.state', state);
	}

    constructor(private context: ExtensionContext, private outputChannel: OutputChannel) {

        // Register update command
        // const disposableUpdate = commands.registerCommand('ewm-scm.ewmUpdate', async () => {
        //     this.updateStatus();
        // });
        // context.subscriptions.push(disposableUpdate);

        // Register checkin command
    	// context.subscriptions.push(commands.registerCommand("ewm-scm.checkin",
        // 	async (...resourceStates: SourceControlResourceState[]) => {
        //             const repository = this.repositories.find(r => (r.componentRootUri === resourceStates[0].resourceUri )); //  contains(resourceState.resourceUri));
        //             if (repository) {
        //                 await repository.checkin(resourceStates);
        //             }
        // 	}));

        this._rootPath =
            workspace.workspaceFolders && workspace.workspaceFolders.length > 0
                ? workspace.workspaceFolders[0].uri
                : undefined;
        
        this._closedRepositoriesManager = new ClosedRepositoriesManager(context.workspaceState);
    
        this.setState('uninitialized');
        this.doInitialScan().finally(() => this.setState('initialized'));
    }

    private async doInitialScan(): Promise<void> {
		this.outputChannel.appendLine('[Model][doInitialScan] Initial repository scan started');

		const config = workspace.getConfiguration('ewm-scm');
		// const autoRepositoryDetection = config.get<boolean | 'subFolders' | 'openEditors'>('autoRepositoryDetection');
		// const parentRepositoryConfig = config.get<'always' | 'never' | 'prompt'>('openRepositoryInParentFolders', 'prompt');
        const autoInit = config.get('autoInit', true);
        await this.initEwm();

        this.outputChannel.appendLine(`[Model][doInitialScan] Initial repository scan completed - repositories (${this.repositories.length}), closed repositories (${this.closedRepositories.length})),`);
    }

    async openRepository(ewmShare: EwmShareI, openIfClosed = false): Promise<void> {
        const repoName = ewmShare.remote.component.name;
		this.outputChannel.appendLine(`[Model][openRepository] Repository: ${repoName}`);
		// const existingRepository = await this.getRepositoryExact(repoPath);
        // if (existingRepository) {
		// 	this.logger.trace(`[Model][openRepository] Repository for path ${repoPath} already exists: ${existingRepository.root}`);
		// 	return;
		// }

        try {
            const repository = new EwmRepository(this.context, ewmShare, this.outputChannel);
            this.open(repository);
            this._closedRepositoriesManager.deleteRepository(repository.root);
            this.outputChannel.appendLine(`[Model][openRepository] Opened repository: ${repository.root}`);

            // Do not await this, we want SCM
            // to know about the repo asap
            await repository.status();
        } catch (err) {
            // noop
            this.outputChannel.appendLine(`[Model][openRepository] Opening repository for path='${ewmShare.remote.path}' failed. Error:${err}`);
        }
    }

    private open(repository: EwmRepository): void {
        this.outputChannel.appendLine(`[Model][open] Repository: ${repository.componentRootUri.path}`);
        // ewmSourceControls.push(ewmSourceControl);
        // this._repositories.set(sandboxShare.remote.component.name, ewmSourceControl);

        const dispose = () => {
            repository.dispose();
            this.openRepositories = this.openRepositories.filter(e => e !== openRepository);
			this._onDidCloseRepository.fire(repository);
        };

        const openRepository = { repository, dispose };
		this.openRepositories.push(openRepository);
        this._onDidOpenRepository.fire(repository);
    }

    getRepository(hint: Resource): EwmRepository | undefined
    getRepository(hint: any): EwmRepository | undefined {
        if (hint instanceof Resource) {
            // Find repository with componentName that matches the hint's componentName
            const componentName = hint.componentName;
            for (const openRepository of this.openRepositories) {
                if (openRepository.repository.componentName === componentName) {
                    return openRepository.repository;
                }
            }
        }
        return undefined;
	}

    async pickRepository(): Promise<EwmRepository | undefined> {
		if (this.openRepositories.length === 0) {
			throw new Error(l10n.t('There are no available repositories'));
		}

        return this.openRepositories[0].repository;

		// const picks = this.openRepositories.map((e, index) => new RepositoryPick(e.repository, index));
		// const active = window.activeTextEditor;
		// const repository = active && this.getRepository(active.document.fileName);
		// const index = picks.findIndex(pick => pick.repository === repository);

		// // Move repository pick containing the active text editor to appear first
		// if (index > -1) {
		// 	picks.unshift(...picks.splice(index, 1));
		// }

		// const placeHolder = l10n.t('Choose a repository');
		// const pick = await window.showQuickPick(picks, { placeHolder });

		// return pick && pick.repository;
	}

    async initEwm() {

        if (this._initDone){
            return;
        }
    
        if (this._rootPath) {
            this._initDone = true;
            const ewm = new Ewm(this._rootPath, this.outputChannel);
            const sandbox = await ewm.getSandbox();
    
            // Go through the sandbox and init components.
            if (sandbox) {			
                const activeWorkspaceFolder = workspace.getWorkspaceFolder(this._rootPath);
                if (activeWorkspaceFolder) {
                    const ewmDocumentContentProvider = new EwmDocumentContentProvider(ewm);
                    this.context.subscriptions.push(workspace.registerTextDocumentContentProvider(EWM_SCHEME, ewmDocumentContentProvider));
    
                    for (const sandboxShare of sandbox.shares) {
                        await this.openRepository(sandboxShare);
                    }
                }
    
                // Display a message box to the user
                window.showInformationMessage('The EWM is initialized.');
            }
            else {
                window.showWarningMessage('No EWM sandbox found');
            }
        } else {
            window.showWarningMessage('No workspace open (Init)');
        }
    
    }

    async updateStatus() {
        if (this._rootPath) {
            for (const openRepository of this.openRepositories) {
                await openRepository.repository.status();
            }
		} else {
			window.showWarningMessage('No workspace open (update)');
		}
    }

    dispose(): void {
		const openRepositories = [...this.openRepositories];
		openRepositories.forEach(r => r.dispose());
		this.openRepositories = [];

		// this.possibleGitRepositoryPaths.clear();
		// this.disposables = dispose(this.disposables);
	}
}

class ClosedRepositoriesManager {

	private _repositories: Set<string>;
	get repositories(): string[] {
		return [...this._repositories.values()];
	}

	constructor(private readonly workspaceState: Memento) {
		this._repositories = new Set<string>(workspaceState.get<string[]>('closedRepositories', []));
		this.onDidChangeRepositories();
	}

	addRepository(repository: string): void {
		this._repositories.add(repository);
		this.onDidChangeRepositories();
	}

	deleteRepository(repository: string): boolean {
		const result = this._repositories.delete(repository);
		if (result) {
			this.onDidChangeRepositories();
		}

		return result;
	}

	isRepositoryClosed(repository: string): boolean {
		return this._repositories.has(repository);
	}

	private onDidChangeRepositories(): void {
		this.workspaceState.update('closedRepositories', [...this._repositories.values()]);
		commands.executeCommand('setContext', 'git.closedRepositoryCount', this._repositories.size);
	}
}
